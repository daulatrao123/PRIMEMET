#!/usr/bin/env node
/**
 * PRIMEMET — M3 buyer-portal verification gate.
 *
 *   node scripts/verify-m3.mjs --group A
 *   node scripts/verify-m3.mjs --group ALL
 *   node scripts/verify-m3.mjs --selfcheck
 *
 * Groups
 *   A  organisation isolation at the data layer: profile reads/writes and enquiry reads are scoped by the
 *      session's organisation, and a second buyer cannot reach the first buyer's records
 *   B  the buyer portal over HTTP: sign-in, dashboard, company profile update, enquiry submission from the
 *      portal and from a product page, history, detail, and the refusals (anonymous, seller, cross-buyer)
 *   C  the admin side of the same data: the queue, the detail screen, status changes, internal notes — and
 *      that an internal note never reaches the buyer
 *
 * Everything runs against an isolated in-memory MongoDB replica set with the repository's real
 * migrations, driving the real production build through `next start`.
 */

import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

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
    port: { type: "string", default: "3230" },
    selfcheck: { type: "boolean", default: false },
  },
});

const selfcheck = values.selfcheck === true;
const requested = String(values.group).toUpperCase();
const VALID = ["A", "B", "C"];
const groups = selfcheck ? [] : requested === "ALL" ? VALID : requested.split(",").map((g) => g.trim().toUpperCase());
for (const group of groups) {
  if (!VALID.includes(group)) {
    log(`Unknown group "${group}". Valid: A, B, C or ALL.`);
    process.exit(2);
  }
}

// A creates the buyers and the catalogue B and C read.
const GROUP_DEPENDENCIES = { A: [], B: ["A"], C: ["A", "B"] };
if (!selfcheck) {
  for (const group of [...groups]) {
    for (const dependency of GROUP_DEPENDENCIES[group] ?? []) {
      if (!groups.includes(dependency)) {
        groups.unshift(dependency);
        log(`  note: group ${group} reads group ${dependency}'s fixtures, so ${dependency} runs first`);
      }
    }
  }
  groups.sort((a, b) => VALID.indexOf(a) - VALID.indexOf(b));
}

const stamp = `${Date.now()}_${randomUUID().slice(0, 6)}`;
const dbName = scratchDb("m3", stamp);
const port = Number(values.port);

ensureRunDir();
log("");
log("PRIMEMET M3 buyer-portal verification gate");
log(`  groups      ${groups.length > 0 ? groups.join(", ") : "— (selfcheck)"}`);
log(`  database    ${dbName} (in-memory replica set)`);
log(`  server      next start on 127.0.0.1:${port}`);
log("");

let mongo = null;
let server = null;
let exitCode = 0;
const totals = { passed: 0, failed: 0, skipped: 0, groups: [] };

try {
  mongo = await startMongo();
  const db = mongo.client.db(dbName);
  await migrate(db, { appliedBy: "m3-verifier" });

  process.env.MONGODB_URI = mongo.uri;
  process.env.MONGODB_DB = dbName;
  process.env.PRIMEMET_ENV = "test";
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
  process.env.NODE_ENV = "production";

  const [accounts, password, catalogue, enquiries, portal] = await Promise.all([
    import("../src/lib/data/accounts.ts"),
    import("../src/lib/auth/password.ts"),
    import("../src/lib/data/catalogue.ts"),
    import("../src/lib/data/enquiries.ts"),
    import("../src/lib/data/buyer-portal.ts"),
  ]);

  const ctx = {
    mongo,
    db,
    dbName,
    baseUrl: null,
    serverLogFile: null,
    stamp,
    fixture: {},
    modules: { accounts, password, catalogue, enquiries, portal },
  };

  server = await startServer({ port, uri: mongo.uri, dbName });
  ctx.baseUrl = server.baseUrl;
  ctx.serverLogFile = server.logFile;
  log(`  server ready at ${server.baseUrl}`);

  if (selfcheck) exitCode = await runSelfcheck(ctx);

  for (const group of groups) {
    const reporter = createReporter(group);
    log(`  ── Group ${group} ───────────────────────────────────────────────`);
    const groupModule = await import(`./lib/m3-groups/${group.toLowerCase()}.mjs`);
    const returned = await groupModule.run(ctx, reporter);
    if (returned && typeof returned === "object") Object.assign(ctx.fixture, returned);
    const summary = reporter.summary();
    totals.passed += summary.passed;
    totals.failed += summary.failed;
    totals.skipped += summary.skipped;
    totals.groups.push({ group, passed: summary.passed, failed: summary.failed, skipped: summary.skipped });
    log("");
  }
} catch (error) {
  exitCode = 1;
  log("");
  log(`  HARNESS ERROR: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
} finally {
  if (server) await server.stop().catch(() => {});
  if (mongo) await mongo.stop().catch(() => {});
}

async function runSelfcheck(ctx) {
  let failures = 0;
  const check = async (label, fn) => {
    try {
      log(`  PASS  ${label} — ${await fn()}`);
    } catch (error) {
      failures += 1;
      log(`  FAIL  ${label} — ${error.message}`);
    }
  };

  await check("production build is present", () => {
    if (!existsSync(path.join(PROJECT_ROOT, ".next", "BUILD_ID"))) throw new Error("no .next/BUILD_ID; run npm run build");
    return ".next/BUILD_ID found";
  });

  await check("in-memory replica set is up", async () => {
    const hello = await ctx.mongo.client.db("admin").command({ hello: 1 });
    if (!hello.setName) throw new Error("not a replica set");
    return `set ${hello.setName}`;
  });

  await check("migrations are applied", async () => {
    const applied = await ctx.db.collection("_schema_migrations").countDocuments({ status: "applied" });
    if (applied < 7) throw new Error(`only ${applied} applied`);
    return `${applied} applied (v007 head)`;
  });

  await check("the server answers /api/health", async () => {
    const response = await createClient(ctx.baseUrl).get("/api/health", { anonymous: true });
    if (response.status !== 200) throw new Error(`status ${response.status}`);
    return `200 (database ${response.json?.database ?? "?"})`;
  });

  await check("the buyer-portal module exposes its entry points", async () => {
    const needed = ["getBuyerProfile", "updateBuyerProfile", "buyerDashboard"];
    const missing = needed.filter((name) => typeof ctx.modules.portal[name] !== "function");
    if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")}`);
    return `${needed.length} entry points present`;
  });

  log("");
  log(`  SELFCHECK: ${5 - failures} passed, ${failures} failed`);
  return failures === 0 ? 0 : 1;
}

const reportFile = path.join(ensureRunDir(), `m3-report-${stamp}.json`);
try {
  writeFileSync(reportFile, JSON.stringify({ groups, totals, at: new Date().toISOString() }, null, 2));
} catch {
  // A report that cannot be written must not change the verdict.
}

log("");
log(`  TOTAL: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped`);
log(`  report: ${path.relative(PROJECT_ROOT, reportFile)}`);
log(`  verdict: ${selfcheck ? (exitCode === 0 ? "HARNESS READY" : "HARNESS BROKEN") : totals.failed === 0 && exitCode === 0 ? "VERIFIED LOCALLY" : "NOT VERIFIED"}`);
log("");
process.exit(totals.failed === 0 && exitCode === 0 ? 0 : 1);
