#!/usr/bin/env node
/**
 * PRIMEMET — database target guard (remediation P1.5: "one place that decides the target").
 *
 * Every script and workflow that can open a connection to a real cluster asks this module one
 * question: "which database, in which environment, and is that a coherent pair?" Nothing else is
 * allowed to derive the answer, and nothing may guess a database name.
 *
 *   node scripts/db-guard.mjs           print the resolved target, or refuse (exit 1)
 *   node scripts/db-guard.mjs --help    this text
 *
 * Why the rules are refusals rather than warnings: the failure this repairs is silent. A process
 * started with no `MONGODB_DB` used to connect to the database named `primemet` — the production
 * database name — and print a banner that looked normal. A staging deployment that simply forgot one
 * variable therefore performed its migration against production. Guessing is never the safer default
 * for a target that has a production cluster on the other side of it.
 *
 * The rules, in the order they are checked (the first failure is reported):
 *
 * | Rule | Refuses when |
 * |---|---|
 * | 1 | `MONGODB_DB` is unset, empty, or not a plausible database name |
 * | 2 | `PRIMEMET_ENV` is set to something outside the known set (an inconsistent declaration) |
 * | 3 | the caller requires an environment (any write) and `PRIMEMET_ENV` is unset |
 * | 4 | `PRIMEMET_ENV` is not `production` but `MONGODB_DB` is the production database name |
 * | 5 | `VERCEL_ENV=preview` while `PRIMEMET_ENV=production` (a preview must never carry a production identity) |
 * | 6 | the URI names a database that differs from `MONGODB_DB` |
 * | 7 | `PRIMEMET_ALLOWED_HOSTS` is set and the URI host is not one of them |
 *
 * Rule 4 is the one that makes staging unable to reach production by accident; rule 5 is the one that
 * makes a preview deployment unable to inherit a production migration identity. Rules 6 and 7 are
 * cross-checks between two representations of the same intent — they only fire when both sides are
 * actually present, so an existing explicit production configuration keeps working unchanged.
 *
 * This module performs no I/O beyond reading `process.env`. It never logs a connection string; the
 * only URI-derived fact it returns is the host, and only for the allow-list decision.
 */

export const KNOWN_ENVIRONMENTS = Object.freeze(["development", "test", "staging", "production"]);

/** The production database name. Used only to *refuse* it elsewhere — never as a default. */
export const PRODUCTION_DATABASE = "primemet";

/** Conservative database-name shape: Atlas names, no separators that would change the URI path. */
const DATABASE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Host of a mongodb:// or mongodb+srv:// URI, or "" when there is no host to inspect. */
export function uriHost(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?#]+)/.exec(uri ?? "");
  return match ? match[1].toLowerCase() : "";
}

/** Database name carried in the URI path, or "" when the URI names none (`/`, `/?x=y`, no slash). */
export function uriDatabaseName(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+(?:\/([^?#]+))?/.exec(uri ?? "");
  const name = match?.[1] ?? "";
  // A leading slash plus query (`/?retryWrites=true`) has no path segment.
  return name.includes("?") ? "" : name;
}

function refuse(reason) {
  return { ok: false, reason };
}

/**
 * Decide the target database.
 *
 * @param {Record<string, string | undefined>} [env] process environment
 * @param {{ requiresEnvironment?: boolean }} [options] `requiresEnvironment` is true for any write
 *   mode (apply, reconcile); read-only modes may run with the environment undeclared.
 * @returns {{ ok: true, target: { environment: string, environmentDeclared: boolean, database: string,
 *   host: string } } | { ok: false, reason: string }}
 */
export function checkTarget(env = process.env, options = {}) {
  const requiresEnvironment = options.requiresEnvironment === true;

  // Rule 1 — the database name is required. There is deliberately no fallback anywhere in this file.
  const database = (env.MONGODB_DB ?? "").trim();
  if (!database) {
    return refuse(
      "MONGODB_DB is not set. Refusing to guess a database name (the old default was the production " +
        "database). Set MONGODB_DB explicitly in the environment. Nothing was changed.",
    );
  }
  if (!DATABASE_NAME.test(database)) {
    return refuse(
      `MONGODB_DB is not a valid database name (expected 1–64 characters from A-Z a-z 0-9 _ -). ` +
        `Nothing was changed.`,
    );
  }

  // Rule 2 / 3 — the environment must be declared, and must be one this project knows.
  const declaredRaw = (env.PRIMEMET_ENV ?? "").trim();
  const environmentDeclared = declaredRaw !== "";
  const environmentKnown = KNOWN_ENVIRONMENTS.includes(declaredRaw);

  if (environmentDeclared && !environmentKnown) {
    return refuse(
      `PRIMEMET_ENV="${declaredRaw}" is not one of ${KNOWN_ENVIRONMENTS.join("|")}. ` +
        `An unknown environment cannot be checked against the production database. Nothing was changed.`,
    );
  }
  if (requiresEnvironment && !environmentDeclared) {
    return refuse(
      `PRIMEMET_ENV must be one of ${KNOWN_ENVIRONMENTS.join("|")} before this command may write. ` +
        `Nothing was changed.`,
    );
  }

  // Rule 4 — the core isolation rule: only production may target the production database.
  if (environmentKnown && declaredRaw !== "production" && database === PRODUCTION_DATABASE) {
    return refuse(
      `Refused: PRIMEMET_ENV=${declaredRaw} with MONGODB_DB=${PRODUCTION_DATABASE} (the production ` +
        `database). A non-production environment must name its own database. Nothing was changed.`,
    );
  }

  // Rule 5 — a preview deployment may never hold a production identity.
  if (environmentKnown && declaredRaw === "production" && (env.VERCEL_ENV ?? "").trim() === "preview") {
    return refuse(
      "Refused: VERCEL_ENV=preview with PRIMEMET_ENV=production. A preview deployment may never carry " +
        "a production database identity. Nothing was changed.",
    );
  }

  // Rule 6 — two representations of the target must not disagree.
  const uriName = uriDatabaseName(env.MONGODB_URI);
  if (uriName && uriName !== database) {
    return refuse(
      `Refused: MONGODB_URI names the database "${uriName}" but MONGODB_DB is "${database}". ` +
        `Configuration is inconsistent; refusing to pick one. Nothing was changed.`,
    );
  }

  // Rule 7 — optional host allow-list, for once a staging cluster exists.
  const allowList = (env.PRIMEMET_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const host = uriHost(env.MONGODB_URI);
  if (allowList.length > 0 && host && !allowList.includes(host)) {
    return refuse(
      `Refused: the MONGODB_URI host is not in PRIMEMET_ALLOWED_HOSTS for this environment. ` +
        `Nothing was changed.`,
    );
  }

  return {
    ok: true,
    target: {
      environment: environmentKnown ? declaredRaw : "undeclared",
      environmentDeclared: environmentKnown,
      database,
      host,
    },
  };
}

/**
 * Throw when the target is unsafe.
 *
 * `scripts/db-init.mjs` calls this as the first statement of its write path, so the CLI and CI obey
 * exactly the rules above rather than a second copy of them.
 */
export function assertTarget(env = process.env, options = {}) {
  const result = checkTarget(env, options);
  if (!result.ok) {
    const error = new Error(result.reason);
    error.name = "DatabaseTargetError";
    throw error;
  }
  return result.target;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (invokedDirectly) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      "PRIMEMET — database target guard (P1.5)\n\n" +
        "  node scripts/db-guard.mjs            resolve and print the target, or refuse with exit 1\n" +
        "  node scripts/db-guard.mjs --help     this text\n\n" +
        "Required: MONGODB_DB. Required before any write: PRIMEMET_ENV " +
        `${KNOWN_ENVIRONMENTS.join("|")}.\n` +
        `A non-production PRIMEMET_ENV may not use MONGODB_DB=${PRODUCTION_DATABASE}.\n` +
        "Never printed: credentials or the connection string.\n",
    );
    process.exit(0);
  }

  const result = checkTarget(process.env, { requiresEnvironment: false });
  if (!result.ok) {
    process.stderr.write(`\n✖ ${result.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`database target\n`);
  process.stdout.write(`  environment  ${result.target.environment}\n`);
  process.stdout.write(`  database     ${result.target.database}\n`);
  process.exit(0);
}