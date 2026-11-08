#!/usr/bin/env node
/**
 * PRIMEMET — integrity audit of the permission log (W3 verification tool).
 *
 * WHAT IT ANSWERS. Every row in `admin_permission_grants` carries an HMAC tag over its decision-bearing
 * fields (`src/lib/permissions/integrity.ts`). The resolver refuses a row whose tag is absent or does not
 * verify. This CLI reports, for a live database, exactly how many rows are in each of those states — the
 * evidence an operator needs before trusting that the log decides what the application says it decides.
 *
 * WHY IT DOES NOT "RE-SIGN" ANYTHING. The log is append-only: the collection is `immutable: true` and
 * `primemet_app` holds no update or delete privilege on it. A tag therefore cannot be repaired in place,
 * and rewriting history to make it verify would destroy the property the tag exists to provide. The
 * supported repair is to append a new event through `appendPermissionEvent`, which signs it with the
 * current key. A key rotation is consequently a re-decision, not a re-labelling: old rows keep their old
 * tags, stop verifying, and stop deciding — which is the fail-closed outcome, reported here.
 *
 * READ-ONLY. There is no `--apply`. This script opens one connection, reads, prints and exits.
 *
 * Usage:
 *   node scripts/audit-permission-integrity.mjs            human-readable report
 *   node scripts/audit-permission-integrity.mjs --json     machine-readable report
 *
 * Exit codes: 0 = every row verifies; 2 = rows do not verify (rotation in progress, or a forged insert);
 * 1 = usage or environment error, nothing read.
 */

import { MongoClient } from "mongodb";

import { GRANTS_COLLECTION, permissionLogKey } from "../src/lib/permissions/store.ts";
import { verifyEventIntegrity } from "../src/lib/permissions/integrity.ts";
import { checkTarget } from "./db-guard.mjs";

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const HELP = argv.includes("--help") || argv.includes("-h");
const KNOWN = new Set(["--json", "--help", "-h"]);

function fail(message, code = 1) {
  process.stderr.write(`\n  \u2716 ${message}\n`);
  process.exit(code);
}

if (HELP) {
  process.stdout.write(
    "\n  node scripts/audit-permission-integrity.mjs [--json]\n\n" +
      "  Reports which rows in admin_permission_grants verify under the current PERMISSION_LOG_KEY.\n" +
      "  Read-only by design: the log is append-only, so a decision is restored by appending a new\n" +
      "  event, never by rewriting history.\n\n",
  );
  process.exit(0);
}

for (const flag of argv) {
  if (!KNOWN.has(flag)) fail(`unknown argument ${flag}. Nothing was read; nothing was changed.`);
}

const uri = process.env.MONGODB_URI;
if (!uri) fail("MONGODB_URI is not set. Nothing was read; nothing was changed.");
if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
  fail("MONGODB_URI must start with mongodb:// or mongodb+srv://. Nothing was read; nothing was changed.");
}

const key = permissionLogKey();
if (!key) {
  fail(
    "PERMISSION_LOG_KEY is not configured (or is shorter than 16 characters).\n" +
      "  Without a key nothing can be verified, so this report would say nothing. Set the key first.",
  );
}

// Remediation P1.2/P1.5: no implicit database name. The previous line fell back to "primemet", the
// production database, whenever MONGODB_DB was missing.
const target = checkTarget(process.env, { requiresEnvironment: false });
if (!target.ok) fail(target.reason);
const dbName = target.target.database;
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });

try {
  await client.connect();
  const db = client.db(dbName);
  const exists = await db.listCollections({ name: GRANTS_COLLECTION }, { nameOnly: true }).hasNext();
  if (!exists) fail(`${GRANTS_COLLECTION} does not exist. Run the migrations first. Nothing was changed.`);

  const rows = await db.collection(GRANTS_COLLECTION).find({}).sort({ createdAt: 1, seq: 1 }).toArray();

  const buckets = { VALID: [], MISSING: [], INVALID: [], UNKEYED: [] };
  for (const row of rows) buckets[verifyEventIntegrity(row, key)].push(row);

  const brief = (row) => ({ _id: String(row._id), permission: row.permission, effect: row.effect });
  const report = {
    database: dbName,
    total: rows.length,
    valid: buckets.VALID.length,
    missingTag: buckets.MISSING.length,
    tagInvalid: buckets.INVALID.length,
    unkeyed: buckets.UNKEYED.length,
    examples: {
      missingTag: buckets.MISSING.slice(0, 5).map(brief),
      tagInvalid: buckets.INVALID.slice(0, 5).map(brief),
    },
  };

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(
      `\n  ${GRANTS_COLLECTION} in "${dbName}"\n` +
        `  rows                : ${report.total}\n` +
        `  verify under key    : ${report.valid}\n` +
        `  no tag at all       : ${report.missingTag}\n` +
        `  tag does not verify : ${report.tagInvalid}\n`,
    );
    for (const row of report.examples.missingTag) {
      process.stdout.write(`    missing  ${row._id}  ${row.permission} ${row.effect}\n`);
    }
    for (const row of report.examples.tagInvalid) {
      process.stdout.write(`    invalid  ${row._id}  ${row.permission} ${row.effect}\n`);
    }
    process.stdout.write(
      "\n  A row that does not verify does NOT decide: the resolver denies the permission and reports it\n" +
        "  through integrityDiagnostics. To restore the decision, append a new event through\n" +
        "  appendPermissionEvent. History is never edited.\n\n",
    );
  }

  process.exit(report.missingTag + report.tagInvalid > 0 ? 2 : 0);
} catch (error) {
  fail(`integrity audit failed: ${String(error?.message ?? error)}`);
} finally {
  await client.close().catch(() => {});
}
