#!/usr/bin/env node
/**
 * PRIMEMET — database initialization CLI.
 *
 *   node scripts/db-init.mjs                 apply pending migrations, then verify
 *   node scripts/db-init.mjs --dry-run       report what would be applied; change nothing
 *   node scripts/db-init.mjs --verify-only   verify the live database against the ledger
 *   node scripts/db-init.mjs --status        print the ledger and exit
 *   node scripts/db-init.mjs --reconcile     re-assert validators/indexes for applied migrations
 *
 * Apply and reconcile also accept `--platform-organisation <organisation-id>`. Migration v010 needs it to
 * seed the protected platform identity pointer, and refuses rather than deriving that anchor from state
 * the application can write (F3/F4). Without the flag, `PLATFORM_ORGANISATION_ID` is used; without
 * either, v010 stays pending on a database that already claims an operator.
 *
 * Read-only guarantee (defect D): `--status`, `--dry-run` and `--verify-only` create no collection, no
 * index and no ledger row. Only an apply or a reconcile writes, and the mode line says which.
 *
 * `--reconcile` (defect E) re-runs the idempotent `up()` of migrations the ledger says are applied, so
 * a database that drifted (a hand `collMod`, a dropped index) converges back to the version-controlled
 * definition. It never changes a checksum and never writes a ledger row — the previous version appended
 * a marker to the migration source, which changed the checksum and made every reconcile fail drift.
 *
 * Connection string comes from MONGODB_URI. It is never printed, logged or included in an error
 * message: the GitHub workflow runs this with a secret in scope.
 *
 * Target (remediation P1.2/P1.5): `MONGODB_DB` is **required** — there is no default, because the old
 * default was the production database name. `PRIMEMET_ENV` is required before any mode that writes.
 * Both rules are enforced by `scripts/db-guard.mjs`, the single place that decides the target.
 *
 * Exits non-zero on any failure, so a CI step cannot pass on a broken database.
 */

import { MongoClient } from "mongodb";

import { COLLECTION_NAMES } from "../db/collections/index.mjs";
import { applyMigrations, definitionsDrift, ledgerReport, reconcileMigrations } from "../db/ledger.mjs";
import { MIGRATIONS } from "../db/migrations/index.mjs";
import { verifyDatabase } from "../db/verify.mjs";
import { assertTarget } from "./db-guard.mjs";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

const DRY_RUN = has("--dry-run");
const VERIFY_ONLY = has("--verify-only");
const STATUS_ONLY = has("--status");
const RECONCILE = has("--reconcile");

/**
 * The operator organisation v010 may anchor to (F4).
 *
 * The flag is read before the environment variable so a runbook command and CI can both supply it, and a
 * malformed `--platform-organisation --dry-run` is treated as absent rather than as the id "--dry-run".
 * Absent, v010 refuses instead of deriving the anchor from application-writable state.
 */
const PLATFORM_ORGANISATION_FLAG = "--platform-organisation";
const platformOrganisationId = (() => {
  const index = argv.indexOf(PLATFORM_ORGANISATION_FLAG);
  if (index === -1) return process.env.PLATFORM_ORGANISATION_ID;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) return process.env.PLATFORM_ORGANISATION_ID;
  return value;
})();

function log(message) {
  console.log(message);
}

function fatal(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/**
 * Describe a URI without disclosing it.
 *
 * The host is masked as well as the credentials: an Atlas SRV host names the cluster and is not
 * something a CI log needs to carry. Only the scheme and database name survive, which is enough to
 * tell "wrong database" from "wrong cluster" in an incident.
 */
export function describeUri(uri) {
  const scheme = (uri.match(/^(mongodb(?:\+srv)?):\/\//) ?? [])[1] ?? "mongodb";
  const dbName = (uri.match(/\/([^/?]+)(?:\?|$)/) ?? [])[1] ?? "";
  return `${scheme}://<redacted>${dbName ? `/${dbName}` : ""}`;
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  fatal(
    "MONGODB_URI is not set. Set it in the environment (or in .env.local for local work). " +
      "See .env.example. Nothing was changed.",
  );
}
if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
  fatal("MONGODB_URI must start with mongodb:// or mongodb+srv://. Nothing was changed.");
}

/**
 * A reconcile writes; a dry run, a status report and a verification do not. The distinction matters
 * because the environment declaration is mandatory for exactly the modes that can change a database.
 */
const WRITES = !DRY_RUN && !VERIFY_ONLY && !STATUS_ONLY;

/**
 * Remediation P1.5 — the target rule lives in one module (`scripts/db-guard.mjs`), not here, and it
 * runs before anything can open a connection:
 *
 * - `MONGODB_DB` is required. The previous `|| "primemet"` fallback meant a missing variable silently
 *   targeted the production database, which is how a staging run could migrate production.
 * - `PRIMEMET_ENV` is required for `apply` and `--reconcile`, so every write names its environment.
 * - A non-production environment may not name the production database, and a preview deployment may
 *   not claim a production identity.
 *
 * A refusal here exits 1 with a message that contains the database name and never the URI.
 */
let target;
try {
  target = assertTarget(process.env, { requiresEnvironment: WRITES });
} catch (error) {
  fatal(error && error.message ? error.message : String(error));
}
const dbName = target.database;

const appliedBy = process.env.DB_INIT_ACTOR || (process.env.GITHUB_ACTIONS ? "github-actions" : "local");

log(`PRIMEMET database initialization`);
log(`  target     ${describeUri(uri)}`);
log(`  environment ${target.environment}${WRITES ? " (write)" : " (read-only)"}`);
log(`  database   ${dbName}`);
log(`  actor      ${appliedBy}`);
log(`  mode       ${DRY_RUN ? "dry-run" : VERIFY_ONLY ? "verify-only" : STATUS_ONLY ? "status" : RECONCILE ? "reconcile" : "apply"}`);
log("");

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });

try {
  await client.connect();
  const db = client.db(dbName);
  const serverInfo = await db.admin().serverInfo();
  log(`  connected  MongoDB ${serverInfo.version} (${serverInfo.modules?.includes("enterprise") ? "enterprise" : "community"})`);
  log("");

  if (STATUS_ONLY) {
    const report = await ledgerReport(db, COLLECTION_NAMES);
    log("Ledger:");
    for (const row of report.ledger) {
      const attempts = row.attempts > 1 ? ` (${row.attempts} attempts)` : "";
      log(`  v${String(row.version).padStart(3, "0")}  ${row.status.padEnd(7)} ${row.name}  ${row.appliedAt}${attempts}`);
      if (row.status === "failed" && row.error) log(`        ${row.error}`);
    }
    if (report.ledger.length === 0) log("  (empty — nothing has been applied)");
    log("");
    // F-1: distinguish "an applied migration was edited" (checksum) from "the declared schema moved
    // on without a version" (digest). Both are reported here without writing anything.
    const drift = await definitionsDrift(db);
    log(
      drift
        ? `Declared schema: CHANGED since v${String(drift.version).padStart(3, "0")} was applied ` +
            `(ledger ${String(drift.ledgerDigest).slice(0, 12)}…, current ${String(drift.currentDigest).slice(0, 12)}…) — ${drift.remediedBy}`
        : "Declared schema: matches the applied migrations.",
    );
    log("");
    log(`Collections present: ${report.present.length}/${COLLECTION_NAMES.length}`);
    if (report.missing.length) log(`  missing:    ${report.missing.join(", ")}`);
    if (report.unexpected.length) log(`  unexpected: ${report.unexpected.join(", ")} (never removed automatically)`);
    await client.close();
    process.exit(0);
  }

  if (RECONCILE) {
    // Defect E: reconciliation repairs the DATABASE, never the record of what was applied. No source
    // marker, no checksum change, no ledger row.
    const { reconciled, absent } = await reconcileMigrations(db, {
      migrations: MIGRATIONS,
      log,
      platformOrganisationId,
    });
    log("");
    log(`Reconciled ${reconciled.length} applied migration(s); ${absent.length} not applied.`);
    if (absent.length > 0) {
      log("  Run without --reconcile to apply a migration that has never been applied.");
    }
  } else if (!VERIFY_ONLY) {
    const results = await applyMigrations(db, {
      migrations: MIGRATIONS,
      dryRun: DRY_RUN,
      appliedBy,
      appVersion: process.env.npm_package_version || "0.1.0",
      log,
      platformOrganisationId,
    });

    const applied = results.filter((r) => r.status === "applied").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const would = results.filter((r) => r.status === "dry-run").length;

    log("");
    log(
      `Migrations: ${applied} applied, ${skipped} skipped, ${would} would-apply, ${results.length} total.`,
    );

    if (DRY_RUN) {
      log("\nDry run: nothing was written. Re-run without --dry-run to apply.");
      await client.close();
      process.exit(0);
    }
  }

  // Verification runs after application AND in --verify-only mode: an initialization that cannot
  // prove its own result is not finished.
  log("");
  const verification = await verifyDatabase(db, { collections: COLLECTION_NAMES });

  log(`Verification: ${verification.passed} passed, ${verification.failed} failed.`);
  for (const failure of verification.failures) log(`  ✖ ${failure}`);

  const report = await ledgerReport(db, COLLECTION_NAMES);
  log("");
  log(`Ledger: ${report.ledger.length} version(s) recorded; ${report.present.length}/${COLLECTION_NAMES.length} collections present.`);
  if (report.missing.length) log(`  ✖ missing: ${report.missing.join(", ")}`);
  if (report.unexpected.length) log(`  ! unexpected: ${report.unexpected.join(", ")}`);

  await client.close();

  if (verification.failed > 0 || report.missing.length > 0) {
    console.error("\n✖ Database is NOT correctly initialized.");
    process.exit(1);
  }

  log("\n✔ Database initialized and verified.");
  process.exit(0);
} catch (error) {
  console.error(`\n✖ Initialization failed.`);
  console.error(`  ${error && error.message ? error.message : error}`);
  // Never echo `error` object wholesale: driver errors can carry the URI.
  try {
    await client.close();
  } catch {
    /* nothing useful to do */
  }
  process.exit(1);
}