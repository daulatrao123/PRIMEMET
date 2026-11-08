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

if (failures.length > 0) {
  console.error("✖ env blank-value check failed");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("✔ env blank-value check: blank optional variables are treated as absent; no URI still means unconfigured");
