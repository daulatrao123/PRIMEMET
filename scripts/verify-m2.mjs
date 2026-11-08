#!/usr/bin/env node
/**
 * PRIMEMET — M2 catalogue verification gate.
 *
 *   node scripts/verify-m2.mjs --group A
 *   node scripts/verify-m2.mjs --group ALL
 *   node scripts/verify-m2.mjs --selfcheck
 *
 * WHAT A PASS MEANS. The real Next.js server, started from the production build, was driven over HTTP
 * against an isolated in-memory MongoDB replica set with the repository's real migrations applied. The
 * checks assert what a buyer and an administrator actually receive — HTML, status codes, and the
 * documents that ended up stored — rather than calling a copy of the logic.
 *
 * Groups:
 *   A  migration v007: fresh, upgrade from v006, repeat, interrupted recovery, validator, indexes
 *   B  admin catalogue API: auth, CRUD, categories, subcategories, images, specs, publish/unpublish,
 *      archive, validation, organisation of the audit trail
 *   C  public catalogue: only published products, search, filter, sort, pagination, detail page, SEO
 *   D  enquire-now integration: a buyer raises an enquiry from a product page and the desk sees it
 *
 * Exit code 0 means every requested test passed; 1 names the failures.
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
    port: { type: "string", default: "3220" },
    selfcheck: { type: "boolean", default: false },
  },
});

const selfcheck = values.selfcheck === true;
const requested = String(values.group).toUpperCase();
const VALID = ["A", "B", "C", "D"];
const groups = selfcheck ? [] : requested === "ALL" ? VALID : requested.split(",").map((g) => g.trim().toUpperCase());
for (const group of groups) {
  if (!VALID.includes(group)) {
    log(`Unknown group "${group}". Valid: A, B, C, D or ALL.`);
    process.exit(2);
  }
}

/**
 * Groups build on each other's fixtures — B creates the catalogue and the three sessions, C publishes the
 * paged set and signs the buyer in, D raises the enquiry as that buyer. A group command must therefore
 * stand on its own, so its prerequisites are added ahead of it rather than left as a confusing failure.
 */
const GROUP_DEPENDENCIES = { A: [], B: [], C: ["B"], D: ["B", "C"] };
if (!selfcheck) {
  const requestedGroups = [...groups];
  for (const group of requestedGroups) {
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
const dbName = scratchDb("m2", stamp);
const port = Number(values.port);
const needsServer = selfcheck || groups.length > 0;

ensureRunDir();
log("");
log("PRIMEMET M2 catalogue verification gate");
log(`  groups      ${groups.length > 0 ? groups.join(", ") : "— (selfcheck)"}`);
log(`  database    ${dbName} (in-memory replica set)`);
log(`  server      ${needsServer ? `next start on 127.0.0.1:${port}` : "not required"}`);
log("");

let mongo = null;
let server = null;
let exitCode = 0;
const totals = { passed: 0, failed: 0, skipped: 0, groups: [] };

try {
  mongo = await startMongo();
  const db = mongo.client.db(dbName);
  await migrate(db, { appliedBy: "m2-verifier" });

  process.env.MONGODB_URI = mongo.uri;
  process.env.MONGODB_DB = dbName;
  process.env.PRIMEMET_ENV = "test";
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
  process.env.NODE_ENV = "production";

  const [catalogue, accounts, password, enquiries] = await Promise.all([
    import("../src/lib/data/catalogue.ts"),
    import("../src/lib/data/accounts.ts"),
    import("../src/lib/auth/password.ts"),
    import("../src/lib/data/enquiries.ts"),
  ]);

  const ctx = {
    mongo,
    db,
    dbName,
    fixture: {},
    modules: { catalogue, accounts, password, enquiries },
    client: null,
    baseUrl: null,
    serverLogFile: null,
    stamp,
  };

  if (needsServer) {
    server = await startServer({ port, uri: mongo.uri, dbName });
    ctx.baseUrl = server.baseUrl;
    ctx.serverLogFile = server.logFile;
    ctx.client = createClient(server.baseUrl);
    log(`  server ready at ${server.baseUrl} (log: ${path.relative(PROJECT_ROOT, server.logFile)})`);
    log("");
  }

  if (selfcheck) exitCode = await runSelfcheck(ctx);

  for (const group of groups) {
    const reporter = createReporter(group);
    log(`  ── Group ${group} ───────────────────────────────────────────────`);
    const groupModule = await import(`./lib/m2-groups/${group.toLowerCase()}.mjs`);
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

/**
 * Prove the harness can run before any assertion blames the product: build present, replica set up, v007
 * applied, server answering, and the catalogue entry points importable.
 */
async function runSelfcheck(ctx) {
  let failures = 0;
  const check = async (label, fn) => {
    try {
      const detail = await fn();
      log(`  PASS  ${label} — ${detail}`);
    } catch (error) {
      failures += 1;
      log(`  FAIL  ${label} — ${error.message}`);
    }
  };

  await check("production build is present", () => {
    const buildId = path.join(PROJECT_ROOT, ".next", "BUILD_ID");
    if (!existsSync(buildId)) throw new Error("no .next/BUILD_ID; run npm run build");
    return ".next/BUILD_ID found";
  });

  await check("in-memory replica set is up", async () => {
    const hello = await ctx.mongo.client.db("admin").command({ hello: 1 });
    if (!hello.setName) throw new Error("not a replica set");
    return `set ${hello.setName}`;
  });

  await check("migration v007 is applied", async () => {
    const row = await ctx.db.collection("_schema_migrations").findOne({ version: 7 });
    if (!row || row.status !== "applied") throw new Error("v007 not applied");
    return "v007 applied";
  });

  await check("the server answers /api/health", async () => {
    const response = await ctx.client.get("/api/health", { anonymous: true });
    if (response.status !== 200) throw new Error(`status ${response.status}`);
    return `200 (database ${response.json?.database ?? "?"})`;
  });

  await check("the catalogue module exposes the M2 entry points", async () => {
    const needed = [
      "adminCreateProduct",
      "adminUpdateProduct",
      "adminSetPublication",
      "adminArchiveProduct",
      "adminCreateCategory",
      "adminCreateFamily",
      "adminListProducts",
      "listPublishedProducts",
      "getPublishedProductBySlug",
      "catalogueFacets",
    ];
    const missing = needed.filter((name) => typeof ctx.modules.catalogue[name] !== "function");
    if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")}`);
    return `${needed.length} entry points present`;
  });

  log("");
  log(`  SELFCHECK: ${5 - failures} passed, ${failures} failed`);
  return failures === 0 ? 0 : 1;
}

const reportFile = path.join(ensureRunDir(), `m2-report-${stamp}.json`);
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
