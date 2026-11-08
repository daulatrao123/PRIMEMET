#!/usr/bin/env node
/**
 * PRIMEMET — database target safety check (remediation P1.2, P1.3, P1.5).
 *
 *   node scripts/check-db-guard.mjs
 *
 * Offline: no cluster, no network, no credentials. Every assertion runs the production code — the
 * guard module and the CLI as separate processes, and `src/lib/env.ts` / `src/lib/db.ts` imported
 * directly under Node's type stripping — rather than restating the rules here.
 *
 * The four behaviours the remediation promised, and where each is proved:
 *
 * | Requirement | Proved by |
 * |---|---|
 * | a missing database name fails | guard unit case, `db-init.mjs` child, `getDb()` child |
 * | a missing URI fails | `db-init.mjs` child, `getDb()` child |
 * | explicit staging configuration passes | guard unit case, `EnvSchema` case, `db-init.mjs` banner |
 * | explicit production configuration is not rewritten | `EnvSchema` case, `env` object, `db-init.mjs` banner |
 *
 * Two child processes are expected to fail to *connect* (there is no server in this check); what they
 * must prove is that they got past the target rules with the names they were given, and printed them.
 */

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { KNOWN_ENVIRONMENTS, PRODUCTION_DATABASE, checkTarget, uriDatabaseName, uriHost } from "./db-guard.mjs";

const SELF = fileURLToPath(import.meta.url);
const ROOT = process.cwd();
const FLAGS = new Set(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Child modes. Each runs in its own process because `src/lib/env.ts` parses
// `process.env` exactly once, at import time.
// ---------------------------------------------------------------------------
if (FLAGS.has("--probe-env") || FLAGS.has("--probe-db")) {
  const { registerHooks } = await import("node:module");

  // The application imports its own modules through the `@/*` alias. One resolve hook is enough for
  // the probe; nothing is stubbed or mocked — the real TypeScript sources are loaded.
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith("@/")) {
        const url = pathToFileURL(path.join(ROOT, "src", `${specifier.slice(2)}.ts`)).href;
        return { url, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });

  const envUrl = pathToFileURL(path.join(ROOT, "src/lib/env.ts")).href;

  if (FLAGS.has("--probe-env")) {
    const mod = await import(envUrl);
    const URI = "mongodb://127.0.0.1:1";
    const matrix = {
      bare: {},
      uriOnly: { MONGODB_URI: `${URI}/x` },
      staging: { MONGODB_URI: `${URI}/primemet_staging`, MONGODB_DB: "primemet_staging", PRIMEMET_ENV: "staging" },
      production: { MONGODB_URI: `${URI}/primemet`, MONGODB_DB: "primemet", PRIMEMET_ENV: "production" },
      stagingOnProductionDb: { MONGODB_URI: `${URI}/primemet`, MONGODB_DB: "primemet", PRIMEMET_ENV: "staging" },
      previewAsProduction: {
        MONGODB_URI: `${URI}/primemet`,
        MONGODB_DB: "primemet",
        PRIMEMET_ENV: "production",
        VERCEL_ENV: "preview",
      },
      unknownEnvironment: { MONGODB_URI: `${URI}/x`, MONGODB_DB: "x", PRIMEMET_ENV: "staging2" },
    };
    const schema = Object.entries(matrix).map(([name, value]) => {
      const result = mod.EnvSchema.safeParse(value);
      return {
        name,
        success: result.success,
        paths: result.success ? [] : result.error.issues.map((issue) => issue.path.join(".")),
      };
    });
    process.stdout.write(`@@PROBE@@${JSON.stringify({
        schema,
        actual: {
          ok: mod.envErrors.length === 0,
          errors: mod.envErrors,
          mongodbDb: mod.env.MONGODB_DB ?? null,
          primemetEnv: mod.env.PRIMEMET_ENV ?? null,
          configured: mod.isDatabaseConfigured(),
        },
      })}\n`);
    process.exit(0);
  }

  const dbModule = await import(pathToFileURL(path.join(ROOT, "src/lib/db.ts")).href);
  const started = Date.now();
  try {
    const db = await dbModule.getDb();
    process.stdout.write(`@@PROBE@@${JSON.stringify({ threw: false, databaseName: db.databaseName, ms: Date.now() - started })}\n`);
  } catch (error) {
    process.stdout.write(
      `@@PROBE@@${JSON.stringify({
        threw: true,
        name: error?.name ?? "?",
        message: error?.message ?? "",
        ms: Date.now() - started,
      })}\n`,
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];

function eq(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    passed += 1;
    process.stdout.write(`  \u2714 ${name}\n`);
  } else {
    failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.stdout.write(`  \u2716 ${name}\n`);
  }
}

function ok(name, condition, detail = "") {
  eq(`${name}${detail ? ` (${detail})` : ""}`, Boolean(condition), true);
}

/** Environment for a child process, with every target variable removed so the case decides them. */
function cleanEnv(overrides = {}) {
  const child = { ...process.env };
  for (const key of ["MONGODB_URI", "MONGODB_DB", "PRIMEMET_ENV", "VERCEL_ENV", "PRIMEMET_ALLOWED_HOSTS"]) {
    delete child[key];
  }
  return { ...child, ...overrides };
}

function run(script, args, env, timeout = 60000) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8", timeout });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { code: result.status, output, ms: Date.now() - started };
}

/**
 * Async variant, used where the parent must keep its event loop alive.
 *
 * `spawnSync` blocks the parent, and the in-memory replica set in section 5 is supervised by that
 * parent: blocking it stalls the child's writes part-way through the migration. The synchronous
 * helper is still right for the short, server-less cases above.
 */
function runAsync(script, args, env, timeout = 180000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], { env });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, ms: Date.now() - started });
    });
  });
}

/** Read the probe's single JSON line. Node warnings are printed around it, not into it. */
function probeJson(output) {
  const marker = "@@PROBE@@";
  const start = output.indexOf(marker);
  if (start === -1) throw new Error(`the probe produced no result:\n${output.slice(0, 400)}`);
  const rest = output.slice(start + marker.length);
  const end = rest.indexOf("\n");
  return JSON.parse(end === -1 ? rest : rest.slice(0, end));
}

const UNREACHABLE = "mongodb://127.0.0.1:1";

// ---------------------------------------------------------------------------
// 1. The guard module: the rules themselves
// ---------------------------------------------------------------------------
process.stdout.write("\n1. Target rule (scripts/db-guard.mjs)\n");

const missingDb = checkTarget({}, { requiresEnvironment: false });
eq("no MONGODB_DB is refused", missingDb.ok, false);
ok("the refusal names MONGODB_DB", missingDb.ok === false && missingDb.reason.includes("MONGODB_DB"));

const emptyDb = checkTarget({ MONGODB_DB: "   " }, {});
eq("a blank MONGODB_DB is refused", emptyDb.ok, false);

const badName = checkTarget({ MONGODB_DB: "primemet/staging" }, {});
eq("a name that would change the URI path is refused", badName.ok, false);

const staging = checkTarget({ MONGODB_DB: "primemet_staging", PRIMEMET_ENV: "staging" }, {});
eq("explicit staging is accepted", staging.ok, true);
eq("staging keeps its own database name", staging.ok === true && staging.target.database, "primemet_staging");
eq("the environment is reported", staging.ok === true && staging.target.environment, "staging");

const production = checkTarget({ MONGODB_DB: "primemet", PRIMEMET_ENV: "production" }, {});
eq("explicit production is accepted", production.ok, true);
eq("production is not rewritten", production.ok === true && production.target.database, "primemet");

const stagingOnProduction = checkTarget({ MONGODB_DB: PRODUCTION_DATABASE, PRIMEMET_ENV: "staging" }, {});
eq("staging pointed at the production database is refused", stagingOnProduction.ok, false);
ok(
  "that refusal names both sides",
  stagingOnProduction.ok === false &&
    stagingOnProduction.reason.includes("staging") &&
    stagingOnProduction.reason.includes(PRODUCTION_DATABASE),
);

const writeNoEnv = checkTarget({ MONGODB_DB: "primemet_staging" }, { requiresEnvironment: true });
eq("a write without PRIMEMET_ENV is refused", writeNoEnv.ok, false);
ok("that refusal names PRIMEMET_ENV", writeNoEnv.ok === false && writeNoEnv.reason.includes("PRIMEMET_ENV"));

const readNoEnv = checkTarget({ MONGODB_DB: "primemet_staging" }, { requiresEnvironment: false });
eq("a read without PRIMEMET_ENV is allowed", readNoEnv.ok, true);
eq("and reports the environment as undeclared", readNoEnv.ok === true && readNoEnv.target.environment, "undeclared");

const unknown = checkTarget({ MONGODB_DB: "x", PRIMEMET_ENV: "prod" }, {});
eq("an unknown environment is refused", unknown.ok, false);
ok("the refusal lists the known environments", unknown.ok === false && unknown.reason.includes(KNOWN_ENVIRONMENTS[0]));

const preview = checkTarget({ MONGODB_DB: "primemet", PRIMEMET_ENV: "production", VERCEL_ENV: "preview" }, {});
eq("a preview deployment claiming production is refused", preview.ok, false);
ok("that refusal names the preview", preview.ok === false && preview.reason.includes("preview"));

const mismatch = checkTarget({ MONGODB_URI: `${UNREACHABLE}/primemet`, MONGODB_DB: "primemet_staging" }, {});
eq("a URI naming a different database is refused", mismatch.ok, false);

const sameName = checkTarget({ MONGODB_URI: `${UNREACHABLE}/primemet_staging`, MONGODB_DB: "primemet_staging" }, {});
eq("an agreeing URI is accepted", sameName.ok, true);

const hostBlocked = checkTarget(
  { MONGODB_URI: "mongodb+srv://user:pw@prod-cluster.mongodb.net/primemet_staging", MONGODB_DB: "primemet_staging", PRIMEMET_ENV: "staging", PRIMEMET_ALLOWED_HOSTS: "staging-cluster.mongodb.net" },
  {},
);
eq("a URI outside the host allow-list is refused", hostBlocked.ok, false);

const hostAllowed = checkTarget(
  { MONGODB_URI: "mongodb+srv://user:pw@staging-cluster.mongodb.net/primemet_staging", MONGODB_DB: "primemet_staging", PRIMEMET_ENV: "staging", PRIMEMET_ALLOWED_HOSTS: "staging-cluster.mongodb.net" },
  {},
);
eq("a URI inside the host allow-list is accepted", hostAllowed.ok, true);

eq("uriDatabaseName reads the path", uriDatabaseName("mongodb://h:1/abc?retryWrites=true"), "abc");
eq("uriDatabaseName sees no name in a bare query", uriDatabaseName("mongodb://h:1/?directConnection=true"), "");
eq("uriHost lowercases the host", uriHost("mongodb+srv://u:p@Cluster.MongoDB.net/x"), "cluster.mongodb.net");

// ---------------------------------------------------------------------------
// 2. The guard CLI (npm run db:guard)
// ---------------------------------------------------------------------------
process.stdout.write("\n2. Guard CLI\n");

const guardMissing = run(SELF.replace(/check-db-guard\.mjs$/, "db-guard.mjs"), [], cleanEnv());
eq("npm run db:guard refuses without MONGODB_DB", guardMissing.code, 1);

const guardStaging = run(
  SELF.replace(/check-db-guard\.mjs$/, "db-guard.mjs"),
  [],
  cleanEnv({ MONGODB_DB: "primemet_staging", PRIMEMET_ENV: "staging" }),
);
eq("npm run db:guard accepts explicit staging", guardStaging.code, 0);
ok("the CLI prints the database", guardStaging.output.includes("primemet_staging"));
ok("the CLI prints the environment", guardStaging.output.includes("staging"));

// ---------------------------------------------------------------------------
// 3. The application: env.ts schema and db.ts fail-closed behaviour
// ---------------------------------------------------------------------------
process.stdout.write("\n3. Application (src/lib/env.ts, src/lib/db.ts)\n");

const envProbe = run(SELF, ["--probe-env"], cleanEnv());
const envMatrix = probeJson(envProbe.output);
const byName = Object.fromEntries(envMatrix.schema.map((entry) => [entry.name, entry]));

eq("a bare checkout still parses", byName.bare.success, true);
eq("MONGODB_URI without MONGODB_DB fails validation", byName.uriOnly.success, false);
eq("the failing field is MONGODB_DB", byName.uriOnly.paths, ["MONGODB_DB"]);
eq("explicit staging configuration passes validation", byName.staging.success, true);
eq("explicit production configuration passes validation", byName.production.success, true);
eq("staging on the production database fails validation", byName.stagingOnProductionDb.success, false);
eq("preview as production fails validation", byName.previewAsProduction.success, false);
eq("an unknown PRIMEMET_ENV fails validation", byName.unknownEnvironment.success, false);

const envProduction = probeJson(
  run(
    SELF,
    ["--probe-env"],
    cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet`, MONGODB_DB: "primemet", PRIMEMET_ENV: "production" }),
  ).output,
);
eq("a production process keeps MONGODB_DB=primemet", envProduction.actual.mongodbDb, "primemet");
eq("a production process keeps PRIMEMET_ENV=production", envProduction.actual.primemetEnv, "production");
eq("a production process reports no configuration error", envProduction.actual.ok, true);
eq("a production process is still configured", envProduction.actual.configured, true);

const envStaging = probeJson(
  run(
    SELF,
    ["--probe-env"],
    cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet_staging`, MONGODB_DB: "primemet_staging", PRIMEMET_ENV: "staging" }),
  ).output,
);
eq("a staging process keeps MONGODB_DB=primemet_staging", envStaging.actual.mongodbDb, "primemet_staging");
eq("a staging process reports no configuration error", envStaging.actual.ok, true);

const dbNoUri = probeJson(run(SELF, ["--probe-db"], cleanEnv()).output);
eq("getDb() without a URI throws DatabaseNotConfiguredError", dbNoUri.name, "DatabaseNotConfiguredError");
ok("the message names MONGODB_URI", dbNoUri.message.includes("MONGODB_URI"));

const dbNoName = probeJson(
  run(SELF, ["--probe-db"], cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet` })).output,
);
eq("getDb() without MONGODB_DB throws DatabaseNotConfiguredError", dbNoName.name, "DatabaseNotConfiguredError");
ok("the message names MONGODB_DB", dbNoName.message.includes("MONGODB_DB"));
ok("it fails without attempting a connection", dbNoName.ms < 2000, `${dbNoName.ms}ms`);

const dbConfigured = probeJson(
  run(
    SELF,
    ["--probe-db"],
    cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet_staging`, MONGODB_DB: "primemet_staging", PRIMEMET_ENV: "staging" }),
  ).output,
);
ok(
  "a valid staging target passes the configuration check",
  dbConfigured.name !== "DatabaseNotConfiguredError",
  `error: ${dbConfigured.name}`,
);

const dbStagingOnProduction = probeJson(
  run(
    SELF,
    ["--probe-db"],
    cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet`, MONGODB_DB: "primemet", PRIMEMET_ENV: "staging" }),
  ).output,
);
eq(
  "a staging process naming the production database is refused by the app",
  dbStagingOnProduction.name,
  "DatabaseNotConfiguredError",
);
ok("and it never reaches the driver", dbStagingOnProduction.ms < 2000, `${dbStagingOnProduction.ms}ms`);
ok("the message names the environment", dbStagingOnProduction.message.includes("staging"));

const dbPreviewProduction = probeJson(
  run(
    SELF,
    ["--probe-db"],
    cleanEnv({
      MONGODB_URI: `${UNREACHABLE}/primemet`,
      MONGODB_DB: "primemet",
      PRIMEMET_ENV: "production",
      VERCEL_ENV: "preview",
    }),
  ).output,
);
eq(
  "a preview deployment with a production identity is refused by the app",
  dbPreviewProduction.name,
  "DatabaseNotConfiguredError",
);
ok("and it never reaches the driver", dbPreviewProduction.ms < 2000, `${dbPreviewProduction.ms}ms`);

// ---------------------------------------------------------------------------
// 4. The CLI: scripts/db-init.mjs end to end
// ---------------------------------------------------------------------------
process.stdout.write("\n4. Initialization CLI (scripts/db-init.mjs)\n");

const initMissingUri = run("scripts/db-init.mjs", [], cleanEnv());
eq("the CLI refuses without MONGODB_URI", initMissingUri.code, 1);
ok("and says so", initMissingUri.output.includes("MONGODB_URI is not set"));

const initMissingDb = run("scripts/db-init.mjs", [], cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet` }));
eq("the CLI refuses without MONGODB_DB", initMissingDb.code, 1);
ok("and says it will not guess", initMissingDb.output.includes("MONGODB_DB is not set"));
ok("it refuses before connecting", initMissingDb.ms < 5000, `${initMissingDb.ms}ms`);

const initWriteNoEnv = run(
  "scripts/db-init.mjs",
  [],
  cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet_staging`, MONGODB_DB: "primemet_staging" }),
);
eq("an apply without PRIMEMET_ENV is refused", initWriteNoEnv.code, 1);
ok("and the message names PRIMEMET_ENV", initWriteNoEnv.output.includes("PRIMEMET_ENV"));

const initPreviewProduction = run(
  "scripts/db-init.mjs",
  [],
  cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet`, MONGODB_DB: "primemet", PRIMEMET_ENV: "production", VERCEL_ENV: "preview" }),
);
eq("a preview apply with a production identity is refused", initPreviewProduction.code, 1);

// The two cases below are expected to fail to CONNECT (nothing is listening on port 1). What they
// must prove is that the target rules accepted them and the banner names what was asked for.
const initStaging = run(
  "scripts/db-init.mjs",
  ["--dry-run"],
  cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet_staging`, MONGODB_DB: "primemet_staging", PRIMEMET_ENV: "staging" }),
);
ok("explicit staging passes the target rules", initStaging.output.includes("database   primemet_staging"));
ok("and the banner declares the environment", initStaging.output.includes("environment staging (read-only)"));
ok("nothing was refused", !initStaging.output.includes("Refused") && !initStaging.output.includes("is not set"));

const initProduction = run(
  "scripts/db-init.mjs",
  ["--dry-run"],
  cleanEnv({ MONGODB_URI: `${UNREACHABLE}/primemet`, MONGODB_DB: "primemet", PRIMEMET_ENV: "production" }),
);
ok("explicit production is not rewritten", initProduction.output.includes("database   primemet"));
ok("and the banner declares production", initProduction.output.includes("environment production (read-only)"));
ok("production is not refused", !initProduction.output.includes("Refused"));

// ---------------------------------------------------------------------------
// 5. End to end: an apply that is explicitly configured actually runs
// ---------------------------------------------------------------------------
process.stdout.write("\n5. Apply with an explicit environment\n");

// A disposable in-memory replica set, the same mechanism `check:migrations` uses. Nothing here can
// reach a real cluster: the URI is loopback and the database is created for this check and discarded.
const { MongoMemoryReplSet } = await import("mongodb-memory-server");
const replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
try {
  const base = replicaSet.getUri();
  const scratch = "p1_guard_apply";
  const uriWithName = base.replace(/\/(\?|$)/, `/${scratch}$1`);

  const applied = await runAsync(
    "scripts/db-init.mjs",
    [],
    cleanEnv({ MONGODB_URI: uriWithName, MONGODB_DB: scratch, PRIMEMET_ENV: "test" }),
  );
  eq("an explicitly configured apply succeeds", applied.code, 0);
  ok("the banner declares the environment as a write", applied.output.includes("environment test (write)"));
  ok("the banner names the database that was written", applied.output.includes(`database   ${scratch}`));
  ok("the apply reports a verified database", applied.output.includes("Database initialized and verified"));

  const withoutEnvironment = await runAsync(
    "scripts/db-init.mjs",
    [],
    cleanEnv({ MONGODB_URI: uriWithName, MONGODB_DB: scratch }),
  );
  eq("the same apply is refused without PRIMEMET_ENV", withoutEnvironment.code, 1);
  ok(
    "and it says why",
    withoutEnvironment.output.includes("PRIMEMET_ENV must be one of"),
  );
} finally {
  await replicaSet.stop();
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const failure of failures) process.stdout.write(`  \u2716 ${failure}\n`);
  process.exit(1);
}
process.stdout.write("\n\u2714 The database target fails closed.\n");
process.exit(0);
