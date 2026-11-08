#!/usr/bin/env node
/**
 * PRIMEMET — M4 seller-portal verification gate.
 *
 *   node scripts/verify-m4.mjs --group A
 *   node scripts/verify-m4.mjs --group ALL
 *   node scripts/verify-m4.mjs --selfcheck
 *
 * Groups
 *   A  seller onboarding at the data layer: registration state, duplicate refusal, session-scoped profile
 *      and listing reads/writes, and that a seller actor cannot decide anything
 *   B  registration, approval and sign-in over HTTP: PENDING_APPROVAL, refusal before approval, the admin
 *      queue, approval, rejection with a reason, and sign-in only after approval
 *   C  the seller portal over HTTP: profile edit, listing submission, history, isolation from another
 *      seller, and the refusals (anonymous, buyer, seller posting at admin routes)
 *   D  the admin review screens: queue search/filter, application detail, internal notes, listing
 *      rejection reasons, approval, and the publication gate on the public catalogue
 *   E  the end-to-end seller onboarding journey, one seller from registration to approved listing
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
    port: { type: "string", default: "3240" },
    selfcheck: { type: "boolean", default: false },
  },
});

const selfcheck = values.selfcheck === true;
const requested = String(values.group).toUpperCase();
const VALID = ["A", "B", "C", "D", "E"];
const groups = selfcheck ? [] : requested === "ALL" ? VALID : requested.split(",").map((g) => g.trim().toUpperCase());
for (const group of groups) {
  if (!VALID.includes(group)) {
    log(`Unknown group "${group}". Valid: A, B, C or ALL.`);
    process.exit(2);
  }
}

// A creates the sellers every later group signs in as.
const GROUP_DEPENDENCIES = { A: [], B: ["A"], C: ["A", "B"], D: ["A", "B", "C"], E: ["A", "B", "C", "D"] };
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
const dbName = scratchDb("m4", stamp);
const port = Number(values.port);

ensureRunDir();
log("");
log("PRIMEMET M4 seller-portal verification gate");
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
  await migrate(db, { appliedBy: "m4-verifier" });

  process.env.MONGODB_URI = mongo.uri;
  process.env.MONGODB_DB = dbName;
  process.env.PRIMEMET_ENV = "test";
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
  process.env.NODE_ENV = "production";

  const [accounts, password, catalogue, listings, sellerPortal, sellerAdmin, admin] = await Promise.all([
    import("../src/lib/data/accounts.ts"),
    import("../src/lib/auth/password.ts"),
    import("../src/lib/data/catalogue.ts"),
    import("../src/lib/data/listings.ts"),
    import("../src/lib/data/seller-portal.ts"),
    import("../src/lib/data/seller-admin.ts"),
    import("../src/lib/data/admin.ts"),
  ]);

  const ctx = {
    mongo,
    db,
    dbName,
    baseUrl: null,
    serverLogFile: null,
    stamp,
    fixture: {},
    modules: { accounts, password, catalogue, listings, sellerPortal, sellerAdmin, admin },
  };

  server = await startServer({ port, uri: mongo.uri, dbName });
  ctx.baseUrl = server.baseUrl;
  ctx.serverLogFile = server.logFile;
  log(`  server ready at ${server.baseUrl}`);

  if (selfcheck) exitCode = await runSelfcheck(ctx);

  for (const group of groups) {
    const reporter = createReporter(group);
    log(`  ── Group ${group} ───────────────────────────────────────────────`);
    const groupModule = await import(`./lib/m4-groups/${group.toLowerCase()}.mjs`);
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
    if (applied < 8) throw new Error(`only ${applied} applied`);
    return `${applied} applied (v008 head)`;
  });

  await check("the server answers /api/health", async () => {
    const response = await createClient(ctx.baseUrl).get("/api/health", { anonymous: true });
    if (response.status !== 200) throw new Error(`status ${response.status}`);
    return `200 (database ${response.json?.database ?? "?"})`;
  });

  await check("the seller modules expose their entry points", async () => {
    const needed = [
      ["sellerPortal", "getSellerApplication"],
      ["sellerPortal", "updateSellerProfile"],
      ["sellerPortal", "sellerDashboard"],
      ["listings", "submitMyListing"],
      ["listings", "listMyListings"],
      ["listings", "decideListing"],
      ["sellerAdmin", "listSellerApplications"],
      ["sellerAdmin", "getSellerApplicationDetail"],
      ["admin", "decideSeller"],
    ];
    const missing = needed.filter(([module, name]) => typeof ctx.modules[module][name] !== "function");
    if (missing.length > 0) throw new Error(`missing: ${missing.map((pair) => pair.join(".")).join(", ")}`);
    return `${needed.length} entry points present`;
  });

  log("");
  log(`  SELFCHECK: ${5 - failures} passed, ${failures} failed`);
  return failures === 0 ? 0 : 1;
}

const reportFile = path.join(ensureRunDir(), `m4-report-${stamp}.json`);
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
