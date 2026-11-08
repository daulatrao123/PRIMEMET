import { z } from "zod";

/**
 * Environment contract.
 *
 * Two rules govern this module, and both come from the architecture document:
 *
 * 1. **Nothing here is required to build or run the site.** The production build must succeed on a
 *    machine with no `.env` at all, and `/api/health` must keep reporting `not_configured`. So every
 *    variable is optional *on its own*, and nothing in this module opens a connection. What is not
 *    optional is consistency: `MONGODB_URI` without `MONGODB_DB`, or a non-production
 *    `PRIMEMET_ENV` naming the production database, is an error rather than a default.
 *
 * 2. **A value that is present but malformed must not be silently accepted.** `safeParse` collects
 *    the problem instead of throwing during module load (which would take the whole build down for
 *    a typo in an optional variable); `assertEnv` turns those problems into a hard error at the
 *    moment a feature that needs them is actually used.
 *
 * Secrets are never logged and never serialised into a response. This module exposes them to server
 * code only — it is not imported by any client component.
 */

const optionalMongoUri = z
  .string()
  .min(1)
  .refine(
    (value) => /^mongodb(\+srv)?:\/\//.test(value),
    "must be a mongodb:// or mongodb+srv:// connection string",
  );

const optionalHttpUrl = z
  .string()
  .min(1)
  .refine(
    (value) => /^https?:\/\//.test(value),
    "must be an absolute http(s) URL",
  );

export const EnvObjectSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * Canonical site origin. Optional at parse time; the production requirement (https, non-loopback,
   * no fallback) is enforced by `resolveSiteUrl` in `lib/site-url.ts`, called from next.config.ts.
   */
  NEXT_PUBLIC_APP_URL: optionalHttpUrl.optional(),

  /**
   * Primary production database connection. Server-side only — it has no NEXT_PUBLIC_ prefix, so Next.js
   * never inlines it into a browser bundle. Absent until the Atlas cluster exists; nothing here opens
   * a connection at build or module load.
   */
  MONGODB_URI: optionalMongoUri.optional(),

  /**
   * Database name inside the cluster. **Required whenever `MONGODB_URI` is set** — there is no
   * default. The previous documentation said "optional; defaults to primemet", and that default was
   * the production database name: a staging deployment that forgot this variable connected to
   * production and looked healthy while doing it.
   */
  MONGODB_DB: z.string().min(1).max(64).optional(),

  /**
   * Which environment this process is. Optional at parse time, but a non-production value may never be
   * combined with the production database name, and `production` may never run inside a Vercel
   * preview deployment. The same rule is enforced for the CLI by `scripts/db-guard.mjs`.
   */
  PRIMEMET_ENV: z.enum(["development", "test", "staging", "production"]).optional(),

  /** Set by Vercel (`production` | `preview` | `development`). Read only to refuse preview+production. */
  VERCEL_ENV: z.string().min(1).optional(),

  /**
   * Legacy PostgreSQL variables. Kept only so an existing environment does not fail validation; the
   * application no longer reads them. Prisma remains in the repository as the historical schema
   * reference and reads its own `prisma/.env`.
   *
   * @deprecated superseded by MONGODB_URI.
   */
  DATABASE_URL: z.string().min(1).optional(),

  /** @deprecated superseded by MONGODB_URI. */
  DIRECT_URL: z.string().min(1).optional(),

  /** Session signing key. Required before any authentication path is enabled (M2). */
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters").optional(),

  /**
   * Key that authenticates permission events (W3 / P2).
   *
   * Every row in `admin_permission_grants` carries an HMAC over its decision-bearing fields, and the
   * resolver refuses a row whose tag is absent or does not verify. Without this key the resolver reports
   * `UNKEYED` for every row, which is *not* a failure — so an unkeyed deployment accepts a hand-written,
   * validator-conforming GRANT and honours it. That was W3.3: the collection is writable by the
   * application identity, so validation alone is not authorisation.
   *
   * P2 therefore makes the key *load-bearing rather than optional in production*:
   *   - `resolveAdminPermissions` refuses unsigned events whenever the permission-integrity posture is
   *     production (the resolver fails closed), and
   *   - `databaseTargetProblem` refuses to open a production connection without it, so database access
   *     is refused on first database access instead of quietly running with W3 disabled. The process
   *     itself still boots and serves static pages; `/api/health` answers 503 rather than the process
   *     refusing to start.
   *
   * Outside production the key stays optional and `UNKEYED` is *not* a failure, so staging and
   * development honour unsigned rows. That is deliberate — it keeps local work possible — but it means
   * a pre-production environment does not exercise the production posture. See `permissionIntegrityPosture`.
   *
   * Minimum 16 characters, matching `permissionLogKey()` in `lib/permissions/store.ts`, which treats a
   * shorter value as "not configured" rather than as a weak key. See `permissionLogKeyProblem`.
   */
  PERMISSION_LOG_KEY: z.string().min(16, "PERMISSION_LOG_KEY must be at least 16 characters").optional(),

  /** Outbound mail (Zoho). Required before notifications are enabled (M3). */
  ZOHO_SMTP_HOST: z.string().min(1).optional(),
  ZOHO_SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  ZOHO_SMTP_USER: z.string().min(1).optional(),
  ZOHO_SMTP_PASSWORD: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
});

/**
 * Cross-field rules. These are refinements rather than defaults on purpose: a missing value must
 * produce an error, never a substituted value.
 */
export const EnvSchema = EnvObjectSchema.refine(
  (value) => !value.MONGODB_URI || Boolean(value.MONGODB_DB),
  { message: "MONGODB_DB is required whenever MONGODB_URI is set.", path: ["MONGODB_DB"] },
)
  .refine((value) => value.PRIMEMET_ENV === undefined || value.PRIMEMET_ENV === "production" || value.MONGODB_DB !== "primemet", {
    message:
      'MONGODB_DB must not be "primemet" (the production database) unless PRIMEMET_ENV=production.',
    path: ["MONGODB_DB"],
  })
  .refine((value) => !(value.VERCEL_ENV === "preview" && value.PRIMEMET_ENV === "production"), {
    message: "VERCEL_ENV=preview may not carry PRIMEMET_ENV=production.",
    path: ["PRIMEMET_ENV"],
  });

export type Env = z.infer<typeof EnvSchema>;

type EnvResult =
  | { ok: true; data: Env; errors: [] }
  | { ok: false; data: Env; errors: string[] };

/**
 * `process.env` with blank values removed.
 *
 * A deployment template that writes `DATABASE_URL=` (present but empty) must mean "not set". Without
 * this, one empty optional variable fails the whole object parse, the recovered values fall back to
 * defaults, and `isDatabaseConfigured()` reports "no database" for a deployment whose `MONGODB_URI` is
 * perfectly good — the application then answers 503 to every account request while looking healthy to
 * the platform. Found by the M1 verification harness, which injected exactly that pair.
 */
function definedEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
  );
}

/**
 * Parse once per process. Optional variables that are absent stay `undefined`; only variables that
 * are present and malformed produce errors, so a bare checkout parses cleanly.
 */
const parsed = ((): EnvResult => {
  const source = definedEnv(process.env);
  const result = EnvSchema.safeParse(source);
  if (result.success) {
    return { ok: true, data: result.data, errors: [] };
  }
  // Fall back to the schema defaults for the fields that did parse, so a single bad optional value
  // does not make the rest of the configuration unusable. `EnvObjectSchema` is used here because a
  // `.refine()` chain has no `.partial()`: the cross-field rules must not run a second time.
  const withDefaults = EnvObjectSchema.partial().safeParse(source);
  const data = (withDefaults.success ? withDefaults.data : {}) as Env;
  return {
    ok: false,
    data: {
      NODE_ENV: data.NODE_ENV ?? "development",
      NEXT_PUBLIC_APP_URL: data.NEXT_PUBLIC_APP_URL,
      MONGODB_URI: data.MONGODB_URI,
      MONGODB_DB: data.MONGODB_DB,
      PRIMEMET_ENV: data.PRIMEMET_ENV,
      VERCEL_ENV: data.VERCEL_ENV,
      DATABASE_URL: data.DATABASE_URL,
      DIRECT_URL: data.DIRECT_URL,
      AUTH_SECRET: data.AUTH_SECRET,
      PERMISSION_LOG_KEY: data.PERMISSION_LOG_KEY,
      ZOHO_SMTP_HOST: data.ZOHO_SMTP_HOST,
      ZOHO_SMTP_PORT: data.ZOHO_SMTP_PORT,
      ZOHO_SMTP_USER: data.ZOHO_SMTP_USER,
      ZOHO_SMTP_PASSWORD: data.ZOHO_SMTP_PASSWORD,
      MAIL_FROM: data.MAIL_FROM,
    },
    errors: result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    ),
  };
})();

/** Validated configuration. Invalid-but-present values are also listed in `envErrors`. */
export const env: Env = parsed.data;

/** Malformed optional variables, if any. Empty on a bare checkout. */
export const envErrors: readonly string[] = parsed.errors;

/**
 * The environment this process declares, even when the object parse failed.
 *
 * `env.PRIMEMET_ENV` is `undefined` whenever *any* variable was malformed, because the recovery path
 * cannot re-validate a partially-bad object. A production process must not lose its production posture
 * because an unrelated value was mistyped — that would silently re-enable the very behaviour P2 exists
 * to stop — so the raw declaration is consulted as a fallback. The value is only ever compared against
 * `"production"`; it is never used to build a connection string or a path.
 */
export function declaredEnvironment(): Env["PRIMEMET_ENV"] {
  return env.PRIMEMET_ENV ?? (process.env.PRIMEMET_ENV as Env["PRIMEMET_ENV"] | undefined);
}

/**
 * The posture that decides whether permission-event integrity is mandatory (F-2b).
 *
 * P2 originally keyed this off `PRIMEMET_ENV=production` alone, which left a bypass: Next.js sets
 * `NODE_ENV=production` by itself, so a deployed production process that simply never declared
 * `PRIMEMET_ENV` got no key guard and no unsigned-event refusal — production with W3 silently disabled.
 * Meanwhile the CLI (`scripts/db-guard.mjs`, rule 3) already refused to *write* without declaring the
 * environment, so writes were guarded and the runtime was not. That asymmetry is the defect.
 *
 * The rule, narrowly scoped to permission integrity:
 *
 *   1. An explicit `PRIMEMET_ENV` always wins — including `"staging"`, which must stay non-production
 *      so a staging box can run without a signing key.
 *   2. Only when `PRIMEMET_ENV` is undeclared does `NODE_ENV=production` supply the production posture.
 *
 * Deliberately NOT used by `declaredEnvironment()`. That function keeps its current meaning for every
 * other caller — notably the `MONGODB_DB="primemet"` allowance in `databaseTargetProblem` and the
 * matching refinement in `EnvSchema` — so this change cannot move the database-name contract or the
 * 75 assertions in `check:db-guard`. Two notions of "production" do now exist in this module; this one
 * is documented as the integrity posture and is the only one that should be used for W3 decisions.
 */
export function permissionIntegrityPosture(): "production" | "other" {
  const declared = declaredEnvironment();
  if (declared !== undefined) return declared === "production" ? "production" : "other";
  return env.NODE_ENV === "production" ? "production" : "other";
}

/**
 * Explain why the permission-event signing key is unusable, or `null` when it is.
 *
 * `PERMISSION_LOG_KEY` is optional everywhere except production, where its absence would leave W3 inert
 * (see the field comment). The rule is duplicated from `permissionLogKey()` on purpose — that function is
 * the one the resolver actually calls, and this one only explains the same rule to an operator without
 * importing the permission store into the environment module.
 *
 * Keyed off `permissionIntegrityPosture()`, not `declaredEnvironment()`, so an undeclared
 * `PRIMEMET_ENV` under `NODE_ENV=production` is guarded too (F-2b).
 */
export function permissionLogKeyProblem(): string | null {
  const key = env.PERMISSION_LOG_KEY;
  const usable = typeof key === "string" && key.length >= 16;
  if (usable) return null;
  if (permissionIntegrityPosture() !== "production") return null;
  return (
    "PERMISSION_LOG_KEY is not configured (or is shorter than 16 characters) while the " +
    "permission-integrity posture is production (PRIMEMET_ENV=production, or NODE_ENV=production with " +
    "PRIMEMET_ENV undeclared). Permission events would be unverifiable, so a validator-conforming " +
    "insert would be honoured. Refusing database access rather than run with W3 disabled."
  );
}

/**
 * Explain why the configured database target must be refused, or `null` when it is usable.
 *
 * `isDatabaseConfigured()` answers "is there a connection string?". This answers the harder question
 * the same rules ask in `scripts/db-guard.mjs`: does the *pair* (environment, database) make sense?
 * A caller must check this before opening a connection, because a staging process that names the
 * production database is not an inconvenience — it is the exact failure this remediation exists to
 * stop, and `safeParse` failure alone does not prevent it (the recovered values are still usable).
 *
 * Returns a message that never contains the connection string.
 */
export function databaseTargetProblem(): string | null {
  // P2. Checked BEFORE the connection-string guard on purpose. A malformed variable makes the object
  // parse fail, and the recovery path then loses every field — including MONGODB_URI — so a guard that
  // ran first would return "nothing to target" and hide a production process running with W3 disabled.
  // The signing key is a property of the process, not of the target, so it is answered first.
  const keyProblem = permissionLogKeyProblem();
  if (keyProblem) return keyProblem;

  if (!env.MONGODB_URI) return null; // nothing to target; `isDatabaseConfigured()` covers this

  if (!env.MONGODB_DB) {
    return "MONGODB_DB is not configured; refusing to guess a database name.";
  }
  if (env.PRIMEMET_ENV !== undefined && env.PRIMEMET_ENV !== "production" && env.MONGODB_DB === "primemet") {
    return (
      `PRIMEMET_ENV=${env.PRIMEMET_ENV} may not use MONGODB_DB="primemet" (the production ` +
      "database). Refusing to open a connection."
    );
  }
  if (env.VERCEL_ENV === "preview" && env.PRIMEMET_ENV === "production") {
    return "VERCEL_ENV=preview may not carry PRIMEMET_ENV=production. Refusing to open a connection.";
  }
  return null;
}

/** True when a database connection string is configured. Says nothing about reachability. */
export function isDatabaseConfigured(): boolean {
  return Boolean(env.MONGODB_URI);
}

/**
 * Throw if the environment is malformed, or if a variable the caller needs is missing.
 *
 * Call this from the first code path that genuinely needs the value — never at module load, so that
 * `next build` and the public site never depend on production configuration being present.
 */
export function assertEnv(required: readonly (keyof Env)[] = []): void {
  if (!parsed.ok) {
    throw new Error(`Invalid environment configuration:\n- ${envErrors.join("\n- ")}`);
  }
  const missing = required.filter((key) => env[key] === undefined || env[key] === "");
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}