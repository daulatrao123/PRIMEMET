/**
 * PRIMEMET — migration ledger and initialization runner.
 *
 * Design rules, straight from the brief:
 *
 *   - **Ledger-gated.** `_schema_migrations` records every version. A version recorded as `applied` is
 *     skipped, so a second run does nothing.
 *   - **Safe to rerun.** Every operation is create-if-absent, `collMod` or `createIndexes`. There is
 *     no drop, no delete, no rename, no collection reset anywhere in this file or in a migration.
 *   - **Checksummed.** A migration file that changes after it was applied is DRIFT and fails loudly
 *     rather than silently diverging from the database. The checksum covers that migration's OWN file
 *     only (F-1 remediation, see db/migrations/index.mjs), so editing a shared definition cannot
 *     change the identity of a migration that is already applied.
 *   - **Definitions are a target state, not an identity.** `definitionsDigest` records the declared
 *     schema at the moment each row was written. When the definitions move without a new version to
 *     carry the change, that is reported and refused — never repaired silently by reconcile.
 *   - **Retryable.** Exactly ONE ledger row per version, keyed by a unique index. A failed attempt
 *     updates that row's status to `failed`; a later attempt transitions it to `applied`. A transient
 *     failure therefore cannot reserve a version and cannot brick initialization (defect B).
 *   - **Read commands do not write.** `--status`, `--dry-run` and `--verify-only` never create the
 *     ledger, a collection or an index. A virgin database is untouched by them (defect D).
 *   - **Verifiable.** Each applied version records what it created, so a later audit can compare the
 *     ledger with reality in both directions.
 *
 * A migration is `{ version, name, description, source, up(db, ctx) }`. `up` must be idempotent.
 */

import { createHash } from "node:crypto";

import { DEFINITIONS_DIGEST } from "./migrations/index.mjs";

export const LEDGER = "_schema_migrations";

/**
 * One document per version, enforced by a unique index.
 *
 * Defect B history: the ledger previously inserted a NEW row on every attempt, so a failed attempt
 * left a `failed` row that permanently occupied the unique `version` key and the next attempt died
 * with `E11000 duplicate key`. Keeping the unique index (rather than making it partial) is the
 * stronger invariant — it makes "two rows for one version" unrepresentable — so the fix is to update
 * the existing row instead of inserting a second one.
 */
export const LEDGER_INDEXES = [
  { key: { version: 1 }, name: "ix_schema_migrations_version_u", unique: true },
  { key: { appliedAt: -1 }, name: "ix_schema_migrations_appliedAt" },
];

/** Validator for the ledger itself. `attempts` and `failedAt` make retry history explicit. */
const LEDGER_VALIDATOR = {
  $jsonSchema: {
    bsonType: "object",
    required: ["version", "name", "checksum", "appliedAt", "appliedBy", "status"],
    properties: {
      version: { bsonType: "int" },
      name: { bsonType: "string" },
      checksum: { bsonType: "string", pattern: "^[0-9a-f]{64}$" },
      appliedAt: { bsonType: "date" },
      appliedBy: { bsonType: "string" },
      status: { bsonType: "string", enum: ["applied", "failed"] },
      // Digest of the declared schema when this row was written. Absent on rows created before the
      // F-1 change; treated as "unknown" rather than as a mismatch, so no history is rewritten.
      definitionsDigest: { bsonType: "string", pattern: "^[0-9a-f]{64}$" },
      durationMs: { bsonType: ["int", "long"] },
      attempts: { bsonType: ["int", "long"] },
      collections: { bsonType: "array", items: { bsonType: "string" } },
      appVersion: { bsonType: "string" },
      error: { bsonType: "string" },
      failedAt: { bsonType: "date" },
    },
  },
};

async function collectionExists(db, name) {
  return db.listCollections({ name }, { nameOnly: true }).hasNext();
}

/**
 * Read-only ledger handle: the collection if it exists, otherwise `null`.
 *
 * Every read path goes through this. Nothing here creates anything, so a virgin database stays a
 * virgin database after `--status`, `--dry-run` or `--verify-only`.
 */
export async function readLedger(db) {
  return (await collectionExists(db, LEDGER)) ? db.collection(LEDGER) : null;
}

/**
 * Ensure the ledger exists (apply path only).
 *
 * This is the single function in the module that may create the ledger. It is called from
 * `applyMigrations` when — and only when — a write is actually going to happen.
 */
export async function ledger(db) {
  if (!(await collectionExists(db, LEDGER))) {
    await db.createCollection(LEDGER, { validator: LEDGER_VALIDATOR });
  }
  const coll = db.collection(LEDGER);
  await coll.createIndexes(LEDGER_INDEXES);
  return coll;
}

/** SHA-256 of a migration's source, so a silently edited file is caught. */
export function checksumOf(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

/** Versions the ledger records as applied. Read-only: returns an empty map when no ledger exists. */
export async function appliedVersions(db) {
  const coll = await readLedger(db);
  if (!coll) return new Map();
  const rows = await coll.find({ status: "applied" }).sort({ version: 1 }).toArray();
  return new Map(rows.map((r) => [r.version, r]));
}

/** Every ledger row, applied or failed. Read-only. */
export async function ledgerRows(db) {
  const coll = await readLedger(db);
  if (!coll) return [];
  return coll.find({}).sort({ version: 1 }).toArray();
}

function assertUniqueVersions(migrations) {
  const seen = new Set();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`Duplicate migration version ${m.version}`);
    seen.add(m.version);
  }
}

function short(digest) {
  return typeof digest === "string" && digest.length >= 12 ? `${digest.slice(0, 12)}…` : "unknown";
}

/**
 * The applied row whose recorded schema digest no longer matches the current declarations.
 *
 * Returns `null` when they agree, and also when a row predates the digest field — an older row is
 * "unknown", not "changed", so upgrading the runner never rewrites or invalidates history.
 */
function lastChangedDefinitions(applied, currentDigest) {
  const rows = [...applied.values()].sort((a, b) => a.version - b.version);
  const latest = rows[rows.length - 1];
  if (!latest) return null;
  if (!latest.definitionsDigest) return null;
  return latest.definitionsDigest === currentDigest ? null : latest;
}

/**
 * Read-only: does the live ledger expect the same declared schema as this commit?
 *
 * Used by `--verify-only` so "the definitions moved without a version" is reported as a failure with
 * the remedy named, instead of appearing as an unexplained validator mismatch on every collection.
 */
export async function definitionsDrift(db, currentDigest = DEFINITIONS_DIGEST) {
  const applied = await appliedVersions(db);
  const stale = lastChangedDefinitions(applied, currentDigest);
  if (!stale) return null;
  return {
    version: stale.version,
    name: stale.name,
    ledgerDigest: stale.definitionsDigest,
    currentDigest,
    remediedBy: `add a migration version greater than ${stale.version}`,
  };
}

/**
 * Apply every migration that is not already applied, in ascending version order.
 *
 * @param {import("mongodb").Db} db
 * @param {object} opts
 * @param {Array} opts.migrations   ordered `{ version, name, description, source, up }`
 * @param {boolean} [opts.dryRun]   report what would happen and change NOTHING (no ledger creation)
 * @param {string}  [opts.appliedBy] recorded actor, e.g. "github-actions" or "local"
 * @param {string}  [opts.appVersion]
 * @param {(m:string)=>void} [opts.log]
 */
export async function applyMigrations(db, opts) {
  const {
    migrations,
    dryRun = false,
    appliedBy = "unknown",
    appVersion = "0.0.0",
    definitionsDigest = DEFINITIONS_DIGEST,
    log = () => {},
    platformOrganisationId,
  } = opts;

  // F4: v010 seeds the protected pointer only from an owner-supplied organisation id. Threading it through
  // here rather than reading `process.env` inside the migration means a caller can pass it explicitly and a
  // test never has to mutate global state. When it is absent the migration reads the same environment
  // variable itself, so `db-init` needs no extra plumbing.
  const upOptions = platformOrganisationId ? { platformOrganisationId } : {};

  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  assertUniqueVersions(ordered);

  // Dry run reads without creating. The apply path creates the ledger only now, having decided to write.
  const applied = await appliedVersions(db);
  const pending = ordered.filter((m) => !applied.has(m.version));

  // F-1: schema change must travel with a version. If nothing is pending and the declared schema no
  // longer matches what the applied rows recorded, no run would ever converge the database, so this
  // is refused with the remedy named. A pending version records the new digest when it applies.
  if (pending.length === 0 && applied.size > 0) {
    const stale = lastChangedDefinitions(applied, definitionsDigest);
    if (stale) {
      throw new Error(
        `DEFINITIONS_DRIFT: the declared schema changed after migration ${stale.version} ` +
          `(${stale.name}) was applied (ledger ${short(stale.definitionsDigest)}, current ${short(definitionsDigest)}). ` +
          "Add a new migration version whose up() converges the change; editing reconciled state " +
          "without a version is not permitted.",
      );
    }
  }

  const coll = dryRun ? null : await ledger(db);

  const results = [];

  for (const m of ordered) {
    const checksum = checksumOf(m.source);

    if (applied.has(m.version)) {
      const row = applied.get(m.version);
      // Drift check. A changed file must never be silently treated as applied.
      if (row.checksum !== checksum) {
        throw new Error(
          `Migration ${m.version} (${m.name}) is already applied but its file changed ` +
            `(ledger ${row.checksum.slice(0, 12)}…, file ${checksum.slice(0, 12)}…). ` +
            "Editing an applied migration is drift: add a new version instead.",
        );
      }
      log(`skip     ${String(m.version).padStart(3, "0")} ${m.name} (already applied ${row.appliedAt.toISOString()})`);
      results.push({ version: m.version, name: m.name, status: "skipped" });
      continue;
    }

    if (dryRun) {
      log(`would-apply ${String(m.version).padStart(3, "0")} ${m.name} — ${m.description}`);
      results.push({ version: m.version, name: m.name, status: "dry-run" });
      continue;
    }

    const started = Date.now();
    log(`apply    ${String(m.version).padStart(3, "0")} ${m.name} — ${m.description}`);
    let created = [];
    try {
      created = (await m.up(db, { log, ...upOptions })) ?? [];
    } catch (error) {
      // Record the failure on the ONE row for this version. Never as `applied`, and never as a second
      // row — the next attempt must be able to reuse the version (defect B).
      await coll.updateOne(
        { version: m.version },
        {
          $set: {
            name: m.name,
            checksum,
            status: "failed",
            appliedAt: new Date(),
            appliedBy,
            durationMs: Date.now() - started,
            collections: [],
            appVersion,
            definitionsDigest,
            error: String(error && error.message ? error.message : error).slice(0, 2000),
            failedAt: new Date(),
          },
          $inc: { attempts: 1 },
        },
        { upsert: true },
      );
      throw error;
    }

    // Applied only after every operation in `up` succeeded. A retry after a failure transitions the
    // same row from `failed` to `applied`.
    await coll.updateOne(
      { version: m.version },
      {
        $set: {
          name: m.name,
          checksum,
          status: "applied",
          appliedAt: new Date(),
          appliedBy,
          durationMs: Date.now() - started,
          collections: created,
          appVersion,
          definitionsDigest,
        },
        $unset: { error: "", failedAt: "" },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    );
    results.push({ version: m.version, name: m.name, status: "applied", collections: created });
  }

  return results;
}

/**
 * Reconcile — re-assert declared state without touching versions or checksums (defect E).
 *
 * Purpose: the ledger can be current while the *database* has drifted, e.g. a validator was changed by
 * hand with `collMod`, or an index was dropped. Reconciliation re-runs each applied migration's
 * idempotent `up()` so the database converges back to the version-controlled definition.
 *
 * What it deliberately does NOT do:
 *   - change a migration's source or checksum (the previous `\u0000reconcile` hack did, which made
 *     every reconcile run fail the drift check it was meant to respect)
 *   - write a ledger row, advance a version, or accept a changed file
 *
 * A checksum mismatch is still a hard failure: reconciliation repairs the database, never the record
 * of what was applied.
 */
export async function reconcileMigrations(db, opts) {
  const { migrations, definitionsDigest = DEFINITIONS_DIGEST, log = () => {}, platformOrganisationId } = opts;
  const upOptions = platformOrganisationId ? { platformOrganisationId } : {};
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  assertUniqueVersions(ordered);

  const applied = await appliedVersions(db);
  const reconciled = [];
  const absent = [];

  // F-1: reconcile repairs a drifted database; it is not a channel for introducing new schema. When
  // the declarations have moved without a version, converging them here would silently apply changes
  // that no migration records, so it is refused with the remedy named.
  const stale = lastChangedDefinitions(applied, definitionsDigest);
  if (stale) {
    throw new Error(
      `DEFINITIONS_DRIFT: the declared schema changed after migration ${stale.version} (${stale.name}) ` +
        `was applied (ledger ${short(stale.definitionsDigest)}, current ${short(definitionsDigest)}). ` +
        "Reconciliation restores applied migrations; it never introduces an undeclared version of the schema.",
    );
  }

  for (const m of ordered) {
    const row = applied.get(m.version);
    if (!row) {
      absent.push({ version: m.version, name: m.name });
      log(`absent   ${String(m.version).padStart(3, "0")} ${m.name} (not applied — run without --reconcile)`);
      continue;
    }
    const checksum = checksumOf(m.source);
    if (row.checksum !== checksum) {
      throw new Error(
        `Migration ${m.version} (${m.name}) is already applied but its file changed ` +
          `(ledger ${row.checksum.slice(0, 12)}…, file ${checksum.slice(0, 12)}…). ` +
          "Editing an applied migration is drift: add a new version instead. Reconciliation repairs " +
          "the database, never the record of what was applied.",
      );
    }
    log(`reconcile ${String(m.version).padStart(3, "0")} ${m.name} — re-asserting validators and indexes`);
    await m.up(db, { log, ...upOptions });
    reconciled.push({ version: m.version, name: m.name });
  }

  return { reconciled, absent };
}

/**
 * Read-only report: what the ledger says versus what the database actually holds, in BOTH directions.
 *
 * A missing collection is a failed initialization; an unexpected collection is reported but never
 * removed — this system does not delete anything. Creates nothing: a virgin database stays untouched.
 */
export async function ledgerReport(db, expectedCollections) {
  const rows = await ledgerRows(db);
  const actual = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => n !== LEDGER)
    .sort();
  const expected = [...expectedCollections].sort();
  return {
    ledger: rows.map((r) => ({
      version: r.version,
      name: r.name,
      status: r.status,
      attempts: r.attempts ?? 1,
      appliedAt: r.appliedAt.toISOString(),
      error: r.error ?? null,
      collections: r.collections?.length ?? 0,
    })),
    missing: expected.filter((n) => !actual.includes(n)),
    unexpected: actual.filter((n) => !expected.includes(n)),
    present: actual.filter((n) => expected.includes(n)),
  };
}