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