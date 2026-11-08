#!/usr/bin/env node
/**
 * PRIMEMET — legacy organisation backfill CLI (W4-a remediation).
 *
 * WHAT IT REPAIRS. v004 made `organisations.orgKind` required. An organisation stored before v004 cannot
 * satisfy that validator, and the previous v004 refused the whole migration with no report and no ledger
 * record — an upgrade dead end. The classification lives in `db/organisation-identity.mjs` so the
 * migration and this CLI share exactly one implementation:
 *
 *   orgKind already set           -> left alone (never "corrected")
 *   orgType BUYER / SELLER        -> the same marker; derived, not guessed
 *   orgType BOTH, or anything else-> AMBIGUOUS: reported, and REFUSED unless an operator decides
 *   any legacy row claiming PRIMEMET -> never minted; reported as a conflict against the recorded identity
 *
 * DRY RUN IS THE DEFAULT. `--apply` is required to write. Ambiguity is a refusal, not a default: the one
 * thing a migration must not do is choose a business fact that outlives it.
 *
 * Usage:
 *   node scripts/backfill-organisations.mjs                          report only (this is the default)
 *   node scripts/backfill-organisations.mjs --apply                   write derivable rows only
 *   node scripts/backfill-organisations.mjs --apply --both-as=OTHER   also write ambiguous rows
 *   node scripts/backfill-organisations.mjs --json                    machine-readable report
 *
 * `--both-as` accepts PARTNER or OTHER — the two markers that describe a counterparty that is neither
 * the operator nor one of the two unambiguous kinds. PRIMEMET is rejected explicitly.
 *
 * Exit codes: 0 = nothing to do, or applied cleanly; 2 = ambiguous rows need a decision (nothing written);
 * 3 = a conflict with the recorded platform identity (nothing written); 1 = usage/environment error.
 */

import { MongoClient } from "mongodb";

import { MIGRATIONS } from "../db/migrations/index.mjs";
import { checkTarget } from "./db-guard.mjs";
import {
  applyLegacyOrganisationBackfill,
  classifyLegacyOrganisations,
  formatBackfillReport,
  platformIdentityProblems,
} from "../db/organisation-identity.mjs";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const JSON_OUT = has("--json");
const APPLY = has("--apply");
const HELP = has("--help") || has("-h");
const BOTH_AS = (argv.find((a) => a.startsWith("--both-as=")) ?? "").split("=")[1] || null;
const ALLOWED_BOTH_AS = new Set(["PARTNER", "OTHER"]);

function fail(message, code = 1) {
  process.stderr.write(`\n  \u2716 ${message}\n`);
  process.exit(code);
}

if (HELP) {
  process.stdout.write(
    "\n  node scripts/backfill-organisations.mjs [--apply] [--both-as=PARTNER|OTHER] [--json]\n\n" +
      "  Classifies pre-v004 organisations into orgKind. Dry run by default; ambiguous rows are a\n" +
      "  refusal unless --both-as names the marker an operator has decided on.\n\n",
  );
  process.exit(0);
}

const KNOWN_EXACT = new Set(["--json", "--apply", "--help", "-h"]);
for (const flag of argv) {
  if (flag.startsWith("--both-as=")) continue;
  if (!KNOWN_EXACT.has(flag)) fail(`unknown argument ${flag}. Nothing was read; nothing was changed.`);
}
if (BOTH_AS !== null && !ALLOWED_BOTH_AS.has(BOTH_AS)) {
  fail(
    `--both-as=${BOTH_AS} is not an accepted marker. Use PARTNER or OTHER.\n` +
      "  PRIMEMET is refused on purpose: a legacy row carries no evidence of being the operator, and\n" +
      "  minting a second platform identity is the defect this backfill exists to prevent.",
  );
}

const uri = process.env.MONGODB_URI;
if (!uri) fail("MONGODB_URI is not set. Nothing was read; nothing was changed.");
if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
  fail("MONGODB_URI must start with mongodb:// or mongodb+srv://. Nothing was read; nothing was changed.");
}

// Remediation P1.2/P1.5: no implicit database name, and an environment declaration before writing.
// The old line fell back to "primemet", so a staging backfill with one variable missing rewrote
// production organisations.
const target = checkTarget(process.env, { requiresEnvironment: argv.includes("--apply") });
if (!target.ok) fail(target.reason);
const dbName = target.target.database;
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
const log = (line) => process.stdout.write(`${line}\n`);

try {
  await client.connect();
  const db = client.db(dbName);
  const exists = await db.listCollections({ name: "organisations" }, { nameOnly: true }).hasNext();
  if (!exists) {
    fail(
      `the "organisations" collection does not exist in ${dbName}. Apply the migrations first.\n` +
        `  The migration that owns this state is ${MIGRATIONS.map((m) => `v${String(m.version).padStart(3, "0")}`).join(", ")}.`,
    );
  }

  if (!APPLY) {
    const report = await classifyLegacyOrganisations(db);
    const problems = await platformIdentityProblems(db).catch(() => []);
    if (JSON_OUT) {
      process.stdout.write(JSON.stringify({ mode: "dry-run", report, platformIdentityProblems: problems }, null, 2) + "\n");
    } else {
      log("\n  DRY RUN — nothing was written\n");
      log(`  database: ${dbName}`);
      log(formatBackfillReport(report).split("\n").map((l) => `  ${l}`).join("\n"));
      if (problems.length > 0) {
        log("\n  platform identity problems:");
        for (const problem of problems) log(`   ! ${problem}`);
      }
      log("");
    }
    const exitCode = report.ambiguous.length > 0 ? 2 : report.conflicts.length > 0 ? 3 : 0;
    process.exit(exitCode);
  }

  const outcome = await applyLegacyOrganisationBackfill(db, { dryRun: false, bothAs: BOTH_AS, log: () => {} });
  const problems = await platformIdentityProblems(db).catch(() => []);

  if (JSON_OUT) {
    process.stdout.write(
      JSON.stringify({ mode: "apply", written: outcome.written, report: outcome.report, platformIdentityProblems: problems }, null, 2) + "\n",
    );
  } else {
    log(`\n  APPLIED — ${outcome.written} organisation(s) written in ${dbName}\n`);
    log(formatBackfillReport(outcome.report).split("\n").map((l) => `  ${l}`).join("\n"));
    if (problems.length > 0) {
      log("\n  platform identity problems:");
      for (const problem of problems) log(`   ! ${problem}`);
    }
    log("");
  }
  process.exit(0);
} catch (error) {
  const message = String(error?.message ?? error);
  if (message.startsWith("PREFLIGHT_FAILED")) fail(message, 2);
  fail(`backfill failed: ${message}`);
} finally {
  await client.close().catch(() => {});
}
