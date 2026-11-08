#!/usr/bin/env node
/**
 * PRIMEMET — regression check: a blank optional variable must not disable the database.
 *
 * The M1 verification harness found this: a deployment template that writes `DATABASE_URL=` (present but
 * empty) made the whole environment object fail validation, so `isDatabaseConfigured()` answered false
 * for a process whose `MONGODB_URI` was perfectly good. Every account request then answered 503 while
 * `/api/health` reported `not_configured` — a healthy-looking deployment with no accounts.
 *
 * The check runs the real `src/lib/env.ts` in a child process, because the module parses `process.env`
 * once at import and cannot be re-imported with a different environment in the same process.
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/check-env-blank.mjs
 *
 * Exit 0 when both cases behave; exit 1 with the observed values otherwise.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const probe = `
  const env = await import("./src/lib/env.ts");
  process.stdout.write(JSON.stringify({
    configured: env.isDatabaseConfigured(),
    errors: env.envErrors,
    uri: Boolean(env.env.MONGODB_URI),
    db: env.env.MONGODB_DB ?? null,
    targetProblem: env.databaseTargetProblem(),
    keyProblem: env.permissionLogKeyProblem(),
    posture: env.permissionIntegrityPosture(),
  }));
`;

function run(extra) {
  const result = spawnSync(process.execPath, ["--import", "./scripts/lib/register-ts.mjs", "--input-type=module", "-e", probe], {
    cwd: projectRoot,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      SYSTEMROOT: process.env.SYSTEMROOT,
      ...extra,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`probe exited ${result.status}: ${result.stderr?.slice(-400)}`);
  }
  return JSON.parse(result.stdout);
}

const failures = [];

const blank = run({
  MONGODB_URI: "mongodb://127.0.0.1:27017/primemet_check",
  MONGODB_DB: "primemet_check",
  PRIMEMET_ENV: "test",
  DATABASE_URL: "",
  DIRECT_URL: "",
});
if (!blank.configured) failures.push(`blank DATABASE_URL/DIRECT_URL disabled the database: ${JSON.stringify(blank)}`);
if (blank.errors.length > 0) failures.push(`blank optional variables produced errors: ${blank.errors.join("; ")}`);
if (blank.db !== "primemet_check") failures.push(`database name was lost: ${blank.db}`);

const absent = run({ PRIMEMET_ENV: "test" });
if (absent.configured) failures.push(`no MONGODB_URI still reported configured: ${JSON.stringify(absent)}`);

// ---------------------------------------------------------------------------
// P2 — the permission-event signing key is required in production and optional elsewhere.
//
// W3.3 was reachable because an unkeyed deployment reported UNKEYED for every permission event and
// UNKEYED was not counted as a failure, so a hand-written, validator-conforming GRANT was honoured.
// These cases pin the two halves of the fix: the environment refuses a production target without the
// key, and it does not refuse anything outside production.
// ---------------------------------------------------------------------------
const PRODUCTION = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/primemet",
  MONGODB_DB: "primemet",
  PRIMEMET_ENV: "production",
};

const productionNoKey = run(PRODUCTION);
if (productionNoKey.targetProblem === null) {
  failures.push("production without PERMISSION_LOG_KEY was accepted; W3 would be silently disabled");
} else if (!productionNoKey.targetProblem.includes("PERMISSION_LOG_KEY")) {
  failures.push(`the production refusal does not name PERMISSION_LOG_KEY: ${productionNoKey.targetProblem}`);
}
if (productionNoKey.keyProblem === null) {
  failures.push("permissionLogKeyProblem() reported no problem for production without a key");
}

const productionWithKey = run({ ...PRODUCTION, PERMISSION_LOG_KEY: "0123456789abcdef" });
if (productionWithKey.targetProblem !== null) {
  failures.push(`a 16-character key was still refused in production: ${productionWithKey.targetProblem}`);
}
if (productionWithKey.keyProblem !== null) {
  failures.push(`permissionLogKeyProblem() refused a valid key: ${productionWithKey.keyProblem}`);
}

const productionShortKey = run({ ...PRODUCTION, PERMISSION_LOG_KEY: "0123456789abcde" });
if (productionShortKey.targetProblem === null) {
  failures.push("a 15-character key was accepted in production; a short key must count as unconfigured");
}

const stagingNoKey = run({
  MONGODB_URI: "mongodb://127.0.0.1:27017/primemet_staging",
  MONGODB_DB: "primemet_staging",
  PRIMEMET_ENV: "staging",
});
if (stagingNoKey.targetProblem !== null) {
  failures.push(`the key was required outside production: ${stagingNoKey.targetProblem}`);
}

// ---------------------------------------------------------------------------
// F-2b — NODE_ENV=production must imply the production posture when PRIMEMET_ENV is undeclared.
//
// P2 keyed the rule off PRIMEMET_ENV alone, so a deployed production process that never declared it got
// no key guard and no unsigned-event refusal, while the CLI already refused to write without declaring
// the environment. These cases pin the narrow fix: NODE_ENV supplies the posture only when PRIMEMET_ENV
// is absent, and an explicit PRIMEMET_ENV always wins.
// ---------------------------------------------------------------------------
const nodeProductionNoKey = run({
  NODE_ENV: "production",
  MONGODB_URI: "mongodb://127.0.0.1:27017/primemet",
  MONGODB_DB: "primemet",
});
if (nodeProductionNoKey.posture !== "production") {
  failures.push(`NODE_ENV=production did not imply the production posture: ${nodeProductionNoKey.posture}`);
}
if (nodeProductionNoKey.targetProblem === null) {
  failures.push("NODE_ENV=production without PERMISSION_LOG_KEY was accepted; the F-2b bypass is open");
} else if (!nodeProductionNoKey.targetProblem.includes("PERMISSION_LOG_KEY")) {
  failures.push(`the NODE_ENV refusal does not name PERMISSION_LOG_KEY: ${nodeProductionNoKey.targetProblem}`);
}

const nodeProductionWithKey = run({
  NODE_ENV: "production",
  MONGODB_URI: "mongodb://127.0.0.1:27017/primemet",
  MONGODB_DB: "primemet",
  PERMISSION_LOG_KEY: "0123456789abcdef",
});
if (nodeProductionWithKey.targetProblem !== null) {
  failures.push(`NODE_ENV=production with a valid key was refused: ${nodeProductionWithKey.targetProblem}`);
}

const explicitStagingWins = run({
  NODE_ENV: "production",
  PRIMEMET_ENV: "staging",
  MONGODB_URI: "mongodb://127.0.0.1:27017/primemet_staging",
  MONGODB_DB: "primemet_staging",
});
if (explicitStagingWins.posture !== "other") {
  failures.push(`an explicit PRIMEMET_ENV=staging did not win over NODE_ENV: ${explicitStagingWins.posture}`);
}
if (explicitStagingWins.targetProblem !== null) {
  failures.push(`explicit staging was treated as production: ${explicitStagingWins.targetProblem}`);
}

if (failures.length > 0) {
  console.error("✖ env blank-value check failed");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  "✔ env blank-value check: blank optional variables are treated as absent; no URI still means " +
    "unconfigured; PERMISSION_LOG_KEY is required in the production posture (PRIMEMET_ENV=production, " +
    "or NODE_ENV=production with PRIMEMET_ENV undeclared) and optional elsewhere",
);
