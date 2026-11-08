#!/usr/bin/env node
/**
 * PRIMEMET — M1 verification gate.
 *
 *   node scripts/verify-m1.mjs --group B
 *   node scripts/verify-m1.mjs --group ALL
 *   node scripts/verify-m1.mjs --selfcheck
 *
 * `--selfcheck` proves the harness itself is usable (build present, replica set up, migrations applied,
 * server answering, data modules importable) without running the assertions; `--group` runs them.
 * The TypeScript resolution hook is registered by importing it, so no `--import` flag is needed.
 *
 * The script imports the real TypeScript modules and starts the real production build, so a pass means
 * the shipped code behaved, not a copy of it. Everything runs against a MongoDB instance created by
 * `mongodb-memory-server`, in scratch databases; no configured cluster is reachable from here.
 *
 * Exit code 0 means every test in the requested groups passed. Any failure exits 1 and names the test.
 */

import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

// Registers the `@/` alias and extensionless-import resolution for every module loaded below.
import "./lib/register-ts.mjs";

import {
  APP_ORIGIN,
  AUTH_SECRET,
  PROJECT_ROOT,
  createClient,
  createReporter,
  ensureRunDir,
  log,
  migrate,
  scratchDb,
  startMongo,
  startServer,
} from "./lib/m1-verify-core.mjs";

const { values } = parseArgs({
  options: {
    group: { type: "string", default: "ALL" },
    port: { type: "string", default: "3210" },
    selfcheck: { type: "boolean", default: false },
  },
});

const selfcheck = values.selfcheck === true;
const requested = String(values.group).toUpperCase();
const groups = selfcheck ? [] : requested === "ALL" ? ["E", "F", "B", "C", "D"] : requested.split(",").map((group) => group.trim().toUpperCase());
for (const group of groups) {
  if (!["B", "C", "D", "E", "F"].includes(group)) {
    log(`Unknown group "${group}". Valid: B, C, D, E, F or ALL.`);
    process.exit(2);
  }
}

const stamp = `${Date.now()}_${randomUUID().slice(0, 6)}`;
const dbName = scratchDb("app", stamp);
const port = Number(values.port);

// Group C reads the isolation fixtures group F creates (a second buyer organisation, an approved
// listing). Requesting C alone therefore runs F first, so every group command stands on its own.
if (!selfcheck && groups.includes("C") && !groups.includes("F")) {
  groups.unshift("F");
  log("  note: group C needs group F's fixtures, so F runs first");
}

const needsServer = selfcheck || groups.some((group) => ["B", "C", "D"].includes(group));
const runDir = ensureRunDir();

log("");
log("PRIMEMET M1 verification gate");
log(`  mode        ${selfcheck ? "selfcheck (harness only, no assertions)" : "groups"}`);
log(`  groups      ${groups.length > 0 ? groups.join(", ") : "—"}`);
log(`  database    ${dbName} (in-memory replica set)`);
log(`  server      ${needsServer ? `next start on 127.0.0.1:${port}` : "not required"}`);
log("");

// The environment is set BEFORE the application modules are imported: `src/lib/env.ts` parses
// `process.env` once, at module load, and the data layer reads the database name from it.
let mongo = null;
let server = null;
let exitCode = 0;
const totals = { passed: 0, failed: 0, skipped: 0, groups: [] };

try {
  mongo = await startMongo();
  const db = mongo.client.db(dbName);
  await migrate(db, { appliedBy: "m1-verifier" });

  process.env.MONGODB_URI = mongo.uri;
  process.env.MONGODB_DB = dbName;
  process.env.PRIMEMET_ENV = "test";
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
  process.env.NODE_ENV = "production";

  // Imported after the environment is fixed, so these modules bind to the isolated database.
  const [{ sha256Hex }, { signClaims }, password, catalogue, accounts, enquiries, listings, admin] = await Promise.all([
    import("../src/lib/auth/hashing.ts"),
    import("../src/lib/auth/cookie.ts"),
    import("../src/lib/auth/password.ts"),
    import("../src/lib/data/catalogue.ts"),
    import("../src/lib/data/accounts.ts"),
    import("../src/lib/data/enquiries.ts"),
    import("../src/lib/data/listings.ts"),
    import("../src/lib/data/admin.ts"),
  ]);

  const modules = { password, catalogue, accounts, enquiries, listings, admin };

  const ctx = {
    mongo,
    db,
    modules,
    dbName,
    sha256Hex,
    signClaims,
    secret: AUTH_SECRET,
    fixture: {},
    client: null,
    baseUrl: null,
    serverLogFile: null,
  };

  if (needsServer) {
    server = await startServer({ port, uri: mongo.uri, dbName });
    ctx.baseUrl = server.baseUrl;
    ctx.serverLogFile = server.logFile;
    ctx.client = createClient(server.baseUrl);
    log(`  server ready at ${server.baseUrl} (log: ${path.relative(PROJECT_ROOT, server.logFile)})`);
    log("");
  } else {
    ctx.client = createClient("http://127.0.0.1:1");
  }

  if (selfcheck) {
    exitCode = await runSelfcheck(ctx);
  }

  for (const group of groups) {
    const reporter = createReporter(group);
    log(`  ── Group ${group} ───────────────────────────────────────────────`);

    if (group === "B" || group === "C" || group === "D" || group === "E" || group === "F") {
      const groupModule = await import(`./lib/m1-groups/${group.toLowerCase()}.mjs`);
      const returned = await groupModule.run(ctx, reporter);
      if (returned && typeof returned === "object") Object.assign(ctx.fixture, returned);
    }

    const summary = reporter.summary();
    totals.passed += summary.passed;
    totals.failed += summary.failed;
    totals.skipped += summary.skipped;
    totals.groups.push({ group, ...summary, results: summary.results });
    log("");
  }

} catch (error) {
  exitCode = 1;
  log("");
  log(`  HARNESS ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  if (server) await server.stop().catch(() => {});
  if (mongo) await mongo.stop().catch(() => {});
}

/**
 * Prove the harness is usable without asserting product behaviour. Each line is a precondition the
 * groups depend on, so a failure here names the infrastructure rather than a mysterious test error.
 */
async function runSelfcheck(ctx) {
  const checks = [];
  const check = async (label, fn) => {
    try {
      const detail = await fn();
      checks.push({ label, ok: true, detail });
      log(`  PASS  ${label} — ${detail}`);
    } catch (error) {
      checks.push({ label, ok: false, detail: error.message });
      log(`  FAIL  ${label} — ${error.message}`);
    }
  };

  await check("production build is present", () => {
    const buildId = path.join(PROJECT_ROOT, ".next", "BUILD_ID");
    if (!existsSync(buildId)) throw new Error("no .next/BUILD_ID; run npm run build");
    return "​.next/BUILD_ID found";
  });

  await check("in-memory replica set is up", async () => {
    const hello = await ctx.mongo.client.db("admin").command({ hello: 1 });
    if (!hello.setName) throw new Error("not a replica set");
    return `set ${hello.setName}`;
  });

  await check("migrations are applied to the scratch database", async () => {
    const applied = await ctx.db.collection("_schema_migrations").countDocuments({ status: "applied" });
    if (applied < 6) throw new Error(`only ${applied} applied`);
    return `${applied} applied`;
  });

  await check("the application server answers /api/health", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/health`);
    if (response.status !== 200) throw new Error(`status ${response.status}`);
    const body = await response.json();
    if (body.database !== "connected" && body.database !== "ok") throw new Error(`database ${body.database}`);
    return `200, database ${body.database}`;
  });

  await check("the data modules import and expose their entry points", async () => {
    const { accounts, enquiries, listings, admin, catalogue } = ctx.modules;
    for (const [name, fn] of Object.entries({ registerAccount: accounts.registerAccount, createEnquiry: enquiries.createEnquiry, decideListing: listings.decideListing, decideSeller: admin.decideSeller, listPublishedProducts: catalogue.listPublishedProducts })) {
      if (typeof fn !== "function") throw new Error(`${name} missing`);
    }
    return "5 entry points present";
  });

  const failed = checks.filter((item) => !item.ok).length;
  log("");
  log(`  SELFCHECK: ${checks.length - failed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

const reportFile = path.join(runDir, `report-${stamp}.json`);
try {
  writeFileSync(
    reportFile,
    JSON.stringify({ groups, totals: { ...totals, groups: totals.groups.map((item) => ({ group: item.group, passed: item.passed, failed: item.failed, skipped: item.skipped })) }, at: new Date().toISOString() }, null, 2),
  );
} catch {
  // A report that cannot be written must not change the verdict.
}

log("");
log(`  TOTAL: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped`);
log(`  report: ${path.relative(PROJECT_ROOT, reportFile)}`);
log(`  verdict: ${selfcheck ? (exitCode === 0 ? "HARNESS READY" : "HARNESS BROKEN") : totals.failed === 0 && exitCode === 0 ? "VERIFIED LOCALLY" : "NOT VERIFIED"}`);
log("");
process.exit(totals.failed === 0 && exitCode === 0 ? 0 : 1);
