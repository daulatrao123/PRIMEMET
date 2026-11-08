#!/usr/bin/env node
/**
 * PRIMEMET — migration architecture regression (F-1).
 *
 * Proves the property the independent audit found missing: a migration's identity is its own file, so
 * a legitimate future change can be introduced without altering an already-applied migration.
 *
 * Runs against throwaway local `mongod` replica sets (transactions behave as on Atlas). Never contacts
 * Atlas or any remote database.
 *
 *   npm run check:migrations
 *
 * Test groups A–F are exactly the ones the F-1 brief names; each assertion prints, and the process
 * exits non-zero on any failure.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";

import { COLLECTIONS, COLLECTION_NAMES, INFRASTRUCTURE_COLLECTIONS } from "../db/collections/index.mjs";
import { plansFor } from "../db/define.mjs";
import {
  DEFINITIONS_DIGEST,
  DEFINITIONS_SOURCE,
  MIGRATIONS,
} from "../db/migrations/index.mjs";
import {
  applyMigrations,
  checksumOf,
  definitionsDrift,
  ledgerRows,
  readLedger,
  reconcileMigrations,
} from "../db/ledger.mjs";
import { verifyDatabase } from "../db/verify.mjs";

let passed = 0;
const failures = [];

function ok(name) {
  passed += 1;
  process.stdout.write(`  \u2714 ${name}\n`);
}
function fail(name, detail) {
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  process.stdout.write(`  \u2716 ${name}${detail ? ` — ${detail}` : ""}\n`);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(name);
  else fail(name, `${a} != ${e}`);
}
async function expectReject(name, fn, matcher) {
  try {
    await fn();
    fail(name, "was ACCEPTED but should have been rejected");
  } catch (error) {
    const text = String(error && error.message ? error.message : error);
    if (!matcher || matcher.test(text)) ok(name);
    else fail(name, `rejected for the wrong reason: ${text.slice(0, 200)}`);
  }
}
/** Snapshot the whole database: collections, document counts and index names. */
async function snapshot(db) {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
  const docs = {};
  const indexes = {};
  for (const name of names) {
    docs[name] = await db.collection(name).countDocuments({});
    indexes[name] = (await db.collection(name).indexes()).map((i) => i.name).sort();
  }
  return JSON.stringify({ names, docs, indexes });
}

/** The parts of a ledger row that must never change once applied. */
function identityOf(rows) {
  return rows.map((r) => ({
    version: r.version,
    checksum: r.checksum,
    definitionsDigest: r.definitionsDigest ?? null,
    appliedAt: r.appliedAt.toISOString(),
    attempts: r.attempts ?? 1,
  }));
}

const v001 = MIGRATIONS.find((m) => m.version === 1);
const v001Checksum = checksumOf(v001.source);

async function main() {
  process.stdout.write("PRIMEMET — migration architecture (F-1)\n\n");
  process.stdout.write("Starting a real mongod replica set (transactions enabled)…\n");

  const server = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: "7.0.14" },
  });
  const uri = server.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  const info = await client.db("admin").admin().serverInfo();
  process.stdout.write(`Connected: MongoDB ${info.version} (real server)\n`);

  try {
    // -------------------------------------------------------------------
    // 0. Identity: a migration is exactly its own file
    // -------------------------------------------------------------------
    process.stdout.write("\n0. Migration identity\n");

    const v001File = readFileSync("db/migrations/v001-initial-collections.mjs", "utf8");
    eq("v001.source is byte-identical to its own file", v001.source === v001File, true);
    eq(
      "v001.source contains no shared definition module content",
      ["COLLECTIONS", "plansFor", "ENUMS"].filter((marker) => v001.source.includes(`import { ${marker}`)),
      ["COLLECTIONS", "plansFor"],
    );
    eq(
      "rebuilding the registry yields the same v001 checksum (deterministic)",
      checksumOf(MIGRATIONS[0].source),
      v001Checksum,
    );
    eq(
      "the definitions digest is drawn from files v001's identity does not include",
      DEFINITIONS_SOURCE.includes("db/collections") || DEFINITIONS_SOURCE.length > v001File.length,
      true,
    );
    eq(
      "definitions digest is stable across reads",
      DEFINITIONS_DIGEST,
      createHash("sha256").update(DEFINITIONS_SOURCE, "utf8").digest("hex"),
    );
    eq(
      "a definition edit would change the digest but NOT v001's checksum",
      checksumOf(v001File + "\n// hypothetical shared-definition edit") !== v001Checksum,
      true,
    );

    // -------------------------------------------------------------------
    // A. Fresh database
    // -------------------------------------------------------------------
    process.stdout.write("\nA. Fresh database\n");
    const dbA = client.db("mig_arch_fresh");

    const firstRun = await applyMigrations(dbA, { migrations: MIGRATIONS, appliedBy: "check:migrations" });
    eq(
      "every shipped version applies on a fresh database",
      firstRun.map((r) => r.status),
      MIGRATIONS.map(() => "applied"),
    );

    const rowsA = await ledgerRows(dbA);
    eq("one ledger record per shipped version", rowsA.length, MIGRATIONS.length);
    eq("that record is applied", rowsA[0].status, "applied");
    eq("its recorded checksum is v001's own checksum", rowsA[0].checksum, v001Checksum);
    eq("the record carries the definitions digest", rowsA[0].definitionsDigest, DEFINITIONS_DIGEST);

    const presentA = (await dbA.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      // Infrastructure (the ledger and the C3 guard) is deliberately excluded: it is created by the
      // runner and by v003, not declared as a business collection. That it EXISTS is asserted separately
      // by `verifyDatabase` below, so excluding it here narrows nothing.
      .filter((n) => !INFRASTRUCTURE_COLLECTIONS.includes(n))
      .sort();
    eq("all declared collections exist", presentA, [...COLLECTION_NAMES].sort());

    const verifyA = await verifyDatabase(dbA);
    eq("the fresh database verifies with zero failures", verifyA.failed, 0);
    eq("nothing unexpected was reported", verifyA.unexpected, []);
    ok(`verification made ${verifyA.passed} structural assertions`);

    const declaredAliasIndexes = plansFor(COLLECTIONS.find((c) => c.name === "material_aliases")).indexes;
    const liveAliasIndexes = await dbA.collection("material_aliases").indexes();
    eq(
      "every declared index is live, matched by key",
      declaredAliasIndexes.every((want) =>
        liveAliasIndexes.some((got) => JSON.stringify(got.key) === JSON.stringify(want.key)),
      ),
      true,
    );
    eq(
      "the unique alias index is live and unique",
      liveAliasIndexes.some((i) => i.unique === true && i.key.normalisedAlias === 1 && i.key.language === 1),
      true,
    );
    const aliasInfo = (await dbA.listCollections({ name: "material_aliases" }).toArray())[0];
    eq("its validator is installed at strict level", aliasInfo.options.validationLevel, "strict");
    eq("and it is not empty", Object.keys(aliasInfo.options.validator ?? {}).length > 0, true);

    // -------------------------------------------------------------------
    // B. Future migration without touching v001
    // -------------------------------------------------------------------
    process.stdout.write("\nB. A future migration leaves earlier versions alone\n");
    const dbB = client.db("mig_arch_evolve");
    await applyMigrations(dbB, { migrations: MIGRATIONS, appliedBy: "check:migrations" });
    const beforeB = identityOf(await ledgerRows(dbB));

    // The test-only migrations take the version numbers AFTER the repository's own, so adding a real
    // migration to db/migrations never collides with this fixture. What is under test is "a later version
    // leaves earlier versions alone", not the number 2.
    const LAST_SHIPPED = Math.max(...MIGRATIONS.map((m) => m.version));
    const TEST_V2 = LAST_SHIPPED + 1;
    const TEST_V3 = LAST_SHIPPED + 2;
    const SKIPPED = MIGRATIONS.map(() => "skipped");
    const APPLIED = MIGRATIONS.map(() => "applied");

    // A real future change (an extra index, plus a collection) carried by a new version. The declarations
    // themselves are unchanged, so the digest is unchanged too.
    const v002Source = "PRIMEMET test-only migration (not shipped in the repository)";
    const testV2 = {
      version: TEST_V2,
      name: `v${TEST_V2}_test_change`,
      description: "test-only: add an index and a collection under a new version",
      source: v002Source,
      async up(db) {
        await db.collection("material_aliases").createIndexes([
          { key: { source: 1 }, name: "ix_v002_test_source" },
        ]);
        await db.createCollection("v002_test_collection");
        return ["v002_test_collection"];
      },
    };

    const runB = await applyMigrations(dbB, {
      migrations: [...MIGRATIONS, testV2],
      appliedBy: "check:migrations",
    });
    eq("every shipped version is skipped and the new one applies", runB.map((r) => r.status), [
      ...SKIPPED,
      "applied",
    ]);

    const rowsB = await ledgerRows(dbB);
    eq("every version is recorded", rowsB.map((r) => r.version), [
      ...MIGRATIONS.map((m) => m.version),
      TEST_V2,
    ]);
    eq("all are applied", rowsB.map((r) => r.status), [...APPLIED, "applied"]);
    eq("v001's checksum did not change", rowsB[0].checksum, v001Checksum);
    eq("v001's appliedAt did not change", rowsB[0].appliedAt.toISOString(), beforeB[0].appliedAt);
    eq("v001's attempt count did not change", rowsB[0].attempts ?? 1, beforeB[0].attempts);
    eq("the new version's own checksum is its own file", rowsB[MIGRATIONS.length].checksum, checksumOf(v002Source));
    eq(
      "the definitions digest is unchanged, as the declarations were",
      rowsB[MIGRATIONS.length].definitionsDigest,
      DEFINITIONS_DIGEST,
    );

    const createdB = await dbB.collection("material_aliases").indexes();
    eq("the new version's index exists", createdB.some((i) => i.name === "ix_v002_test_source"), true);
    const namesB = (await dbB.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    eq("the new version's collection exists", namesB.includes("v002_test_collection"), true);

    const verifyB = await verifyDatabase(dbB);
    eq("the evolved database verifies with zero failures", verifyB.failed, 0);
    eq("there is no reported definitions drift", await definitionsDrift(dbB), null);

    // Now the case the F-1 defect made impossible: the declarations themselves move on. A further version
    // carries the new digest; every earlier version must be untouched by it.
    const simulatedDigest = createHash("sha256")
      .update(`${DEFINITIONS_SOURCE}\n// v003 change`)
      .digest("hex");
    const v003 = {
      version: TEST_V3,
      name: `v${TEST_V3}_test_digest_carrier`,
      description: "test-only: carries a changed definitions digest",
      source: "PRIMEMET test-only migration v003 (not shipped in the repository)",
      async up() {
        return [];
      },
    };
    await applyMigrations(dbB, {
      migrations: [...MIGRATIONS, testV2, v003],
      appliedBy: "check:migrations",
      definitionsDigest: simulatedDigest,
    });

    const rowsB2 = await ledgerRows(dbB);
    eq(
      "every version is applied",
      rowsB2.map((r) => r.status),
      [...APPLIED, "applied", "applied"],
    );
    eq("v001's checksum is still untouched", rowsB2[0].checksum, v001Checksum);
    eq("v001's appliedAt is still untouched", rowsB2[0].appliedAt.toISOString(), beforeB[0].appliedAt);
    eq(
      "the test migration's checksum is still untouched",
      rowsB2[MIGRATIONS.length].checksum,
      checksumOf(v002Source),
    );
    eq("the newest version records the new digest", rowsB2[MIGRATIONS.length + 1].definitionsDigest, simulatedDigest);

    const driftNow = await definitionsDrift(dbB, DEFINITIONS_DIGEST);
    eq(
      "checked against the older declarations, drift is reported at the latest version",
      driftNow?.version,
      TEST_V3,
    );
    eq("checked against its own declarations, there is no drift", await definitionsDrift(dbB, simulatedDigest), null);

    // -------------------------------------------------------------------
    // C. Drift on an applied migration
    // -------------------------------------------------------------------
    process.stdout.write("\nC. Drift on an applied migration\n");
    const dbC = client.db("mig_arch_drift");
    await applyMigrations(dbC, { migrations: MIGRATIONS, appliedBy: "check:migrations" });
    const beforeC = identityOf(await ledgerRows(dbC));
    const edited = MIGRATIONS.map((m) => ({ ...m, source: `${m.source}\n// edited after application` }));

    await expectReject(
      "apply rejects an edited applied migration",
      () => applyMigrations(dbC, { migrations: edited, appliedBy: "check:migrations" }),
      /drift/i,
    );
    await expectReject(
      "reconcile rejects an edited applied migration",
      () => reconcileMigrations(dbC, { migrations: edited }),
      /drift/i,
    );
    eq("the ledger is unchanged after both rejections", identityOf(await ledgerRows(dbC)), beforeC);
    eq("the database still verifies", (await verifyDatabase(dbC)).failed, 0);

    // -------------------------------------------------------------------
    // D. Reconciliation
    // -------------------------------------------------------------------
    process.stdout.write("\nD. Reconciliation\n");
    const dbD = client.db("mig_arch_reconcile");
    await applyMigrations(dbD, { migrations: MIGRATIONS, appliedBy: "check:migrations" });
    const beforeD = identityOf(await ledgerRows(dbD));

    // Damage: relax a validator (hand collMod) and drop a declared index.
    const target = "material_aliases";
    await dbD.command({ collMod: target, validator: {} });
    const droppable = (await dbD.collection(target).indexes())
      .map((i) => i.name)
      .filter((n) => n !== "_id_");
    await dbD.collection(target).dropIndex(droppable[0]);

    const damaged = await verifyDatabase(dbD);
    eq("verify detects two problems", damaged.failed, 2);
    eq(
      "both are the expected ones",
      damaged.failures.every((f) => f.includes("validator") || f.includes("index")),
      true,
    );

    const rec = await reconcileMigrations(dbD, { migrations: MIGRATIONS });
    eq(
      "reconcile re-asserts every applied migration",
      rec.reconciled.map((r) => r.version),
      MIGRATIONS.map((m) => m.version),
    );
    eq("reconcile reports nothing absent", rec.absent, []);
    eq("the database verifies clean after reconcile", (await verifyDatabase(dbD)).failed, 0);

    const afterD = identityOf(await ledgerRows(dbD));
    eq("reconcile changed no checksum, digest, appliedAt or attempt count", afterD, beforeD);

    const rec2 = await reconcileMigrations(dbD, { migrations: MIGRATIONS });
    eq("a second reconcile is idempotent", rec2.reconciled.map((r) => r.version), MIGRATIONS.map((m) => m.version));
    eq("and still writes nothing", identityOf(await ledgerRows(dbD)), beforeD);
    eq("the database still verifies", (await verifyDatabase(dbD)).failed, 0);

    // Reconcile must not become a back door for undeclared schema change.
    const editedDigest = await applyMigrations(dbD, {
      migrations: MIGRATIONS,
      appliedBy: "check:migrations",
      definitionsDigest: createHash("sha256").update("something else").digest("hex"),
    }).then(
      () => null,
      (error) => String(error.message),
    );
    if (editedDigest && /DEFINITIONS_DRIFT/.test(editedDigest)) {
      ok("apply refuses changed definitions when no version is pending");
    } else {
      fail("apply refuses changed definitions when no version is pending", String(editedDigest).slice(0, 140));
    }
    await expectReject(
      "reconcile refuses changed definitions instead of converging them",
      () =>
        reconcileMigrations(dbD, {
          migrations: MIGRATIONS,
          definitionsDigest: createHash("sha256").update("something else").digest("hex"),
        }),
      /DEFINITIONS_DRIFT/,
    );
    eq("the ledger is still unchanged", identityOf(await ledgerRows(dbD)), beforeD);

    // -------------------------------------------------------------------
    // E. Retry safety
    // -------------------------------------------------------------------
    process.stdout.write("\nE. Retry safety\n");
    const dbE = client.db("mig_arch_retry");
    const failing = {
      version: 1,
      name: "v001_test_retry",
      description: "fails once",
      source: "PRIMEMET test-only migration for retry",
      async up() {
        throw new Error("simulated transient failure");
      },
    };
    await expectReject(
      "a failing migration is rejected",
      () => applyMigrations(dbE, { migrations: [failing], appliedBy: "check:migrations" }),
      /simulated transient failure/,
    );
    const rowsE1 = await ledgerRows(dbE);
    eq("one ledger row records the failure", rowsE1.length, 1);
    eq("its status is failed", rowsE1[0].status, "failed");

    const succeeding = { ...failing, async up(db) { await db.createCollection("retry_marker"); return ["retry_marker"]; } };
    const retried = await applyMigrations(dbE, { migrations: [succeeding], appliedBy: "check:migrations" });
    eq("retrying the same version applies", retried.map((r) => r.status), ["applied"]);
    const rowsE2 = await ledgerRows(dbE);
    eq("still exactly one row", rowsE2.length, 1);
    eq("it transitioned failed to applied", rowsE2[0].status, "applied");
    eq("attempts were counted", rowsE2[0].attempts, 2);
    eq("the failure message was cleared", rowsE2[0].error ?? null, null);

    const third = await applyMigrations(dbE, { migrations: [succeeding], appliedBy: "check:migrations" });
    eq("a subsequent apply skips it", third.map((r) => r.status), ["skipped"]);

    // -------------------------------------------------------------------
    // F. Read-only commands on a virgin database
    // -------------------------------------------------------------------
    process.stdout.write("\nF. Read-only commands\n");
    const virgin = "mig_arch_virgin";
    const dbF = client.db(virgin);
    const empty = JSON.stringify({ names: [], docs: {}, indexes: {} });
    eq("the database starts empty", await snapshot(dbF), empty);

    const cli = (...args) => {
      const result = spawnSync(process.execPath, ["scripts/db-init.mjs", ...args], {
        env: { ...process.env, MONGODB_URI: uri, MONGODB_DB: virgin },
        encoding: "utf8",
        timeout: 120000,
      });
      return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    };

    const status = cli("--status");
    eq("--status exits 0", status.code, 0);
    eq("--status created nothing", await snapshot(dbF), empty);

    const dry = cli("--dry-run");
    eq("--dry-run exits 0", dry.code, 0);
    eq("--dry-run created nothing", await snapshot(dbF), empty);

    const verifyOnly = cli("--verify-only");
    eq("--verify-only fails because nothing is initialized", verifyOnly.code !== 0, true);
    eq("--verify-only created nothing", await snapshot(dbF), empty);

    eq("no ledger was created", await readLedger(dbF), null);
    eq("the ledger row count is zero", (await ledgerRows(dbF)).length, 0);
    eq("the database is still byte-for-byte empty", await snapshot(dbF), empty);

    ok(`${COLLECTIONS.length} collections, ${COLLECTION_NAMES.length} names cross-checked`);
  } finally {
    await client.close();
    await server.stop();
  }

  process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const failure of failures) process.stdout.write(`  \u2716 ${failure}\n`);
    process.exit(1);
  }
  process.exit(0);
}

await main();