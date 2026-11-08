import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import { databaseTargetProblem, env, isDatabaseConfigured } from "@/lib/env";

/**
 * Lazy MongoDB access.
 *
 * Chosen persistence layer: the **native `mongodb` driver**, not Prisma's MongoDB connector. The
 * reason is enforcement, not taste: Prisma cannot express MongoDB collection validators, partial
 * unique indexes or `$jsonSchema`, so the business rules this project spent two milestones making
 * database-enforced would have become application-only. Those rules live in `db/collections/*.mjs`
 * and are applied by `npm run db:init`.
 *
 * Two properties are inherited unchanged from the previous implementation:
 *
 * - **No import-time work.** The client is created on first use, so `next build` and every static page
 *   succeed with no `MONGODB_URI` set and no database reachable.
 * - **No invented capability.** `getDb()` throws a named error when unconfigured instead of handing
 *   back a client that cannot connect, so "no database" can never be mistaken for "no rows".
 * - **No invented target.** The database name comes from `MONGODB_DB` and nowhere else: there is no
 *   fallback, so a deployment that forgot the variable fails closed instead of using the production
 *   database name (`scripts/db-guard.mjs` holds the matching rule for the CLI and CI).
 *
 * The connection string is read on the server only. This module is never imported by a client
 * component: `MONGODB_URI` has no `NEXT_PUBLIC_` prefix, so Next.js will not inline it into a browser
 * bundle even if someone tried.
 *
 * A single client per process is cached on `globalThis`, because hot reload in development would
 * otherwise open a new pool per edit.
 */

type GlobalWithMongo = typeof globalThis & {
  __primemetMongoClient?: MongoClient;
  __primemetMongoPromise?: Promise<MongoClient>;
};

/** True when a connection string is configured. Does not open a connection. */
export function isConfigured(): boolean {
  return isDatabaseConfigured();
}

function globalForDb(): GlobalWithMongo {
  return globalThis as GlobalWithMongo;
}

/**
 * Return the connected client, connecting on first use.
 *
 * Concurrent callers share one connection attempt rather than racing to open several pools.
 */
export async function getClient(): Promise<MongoClient> {
  if (!isConfigured()) {
    throw new DatabaseNotConfiguredError();
  }

  // P1.3: a target that would put a non-production process on the production database never reaches
  // the driver. This is checked on the client, not only in `getDb()`, so no caller can route around it.
  const problem = databaseTargetProblem();
  if (problem) {
    throw new DatabaseNotConfiguredError(problem);
  }

  const g = globalForDb();
  if (g.__primemetMongoClient) return g.__primemetMongoClient;

  if (!g.__primemetMongoPromise) {
    const client = new MongoClient(env.MONGODB_URI as string, {
      // Bounded, so a wrong host cannot hang a request: the probe and any page that needs data fail
      // in seconds with a clear reason instead of hanging until the platform timeout.
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      retryWrites: true,
    });
    g.__primemetMongoPromise = client
      .connect()
      .then((connected) => {
        g.__primemetMongoClient = connected;
        return connected;
      })
      .catch((error: unknown) => {
        // Do not cache a failed attempt: a transient outage must not poison the process forever.
        g.__primemetMongoPromise = undefined;
        throw error;
      });
  }

  return g.__primemetMongoPromise;
}

/**
 * PRIMEMET documents carry an application-assigned UUID string in `_id`.
 *
 * The driver's default `Document` type assumes `_id: ObjectId`, which is wrong here and made every
 * typed query fail to compile. The identifier is a UUID because it is generated before the write, so
 * an audit record and the row it describes can share one id without a round trip, and because the
 * same id format is used by the migration fixtures in `db/`.
 */
export type PrimemetDocument = Document & { _id: string };

/**
 * The database handle the application sees: identical to `Db` except that `collection()` defaults to
 * a string-`_id` document. Callers that pass their own schema type keep their own type unchanged.
 */
export type AppDb = Omit<Db, "collection"> & {
  collection<TSchema extends Document = PrimemetDocument>(name: string): Collection<TSchema>;
};

/** The application database handle. Throws `DatabaseNotConfiguredError` when unconfigured. */
export async function getDb(): Promise<AppDb> {
  // Remediation P1.3: the database name is never derived and never defaulted. The previous line was
  // `client.db(env.MONGODB_DB || "primemet")`, which meant a deployment missing one variable silently
  // served and wrote data in the production database. Both checks run before `getClient()`, so a
  // refused configuration cannot open a connection either.
  if (!isConfigured()) {
    throw new DatabaseNotConfiguredError();
  }

  const problem = databaseTargetProblem();
  if (problem) {
    throw new DatabaseNotConfiguredError(problem);
  }

  const name = env.MONGODB_DB;
  if (!name) {
    throw new DatabaseNotConfiguredError(
      "MONGODB_DB is not configured; refusing to guess a database name.",
    );
  }

  const client = await getClient();
  return client.db(name) as unknown as AppDb;
}

/** Drop the cached client. Used by scripts and tests; never by a request path. */
export async function disconnectDb(): Promise<void> {
  const g = globalForDb();
  g.__primemetMongoPromise = undefined;
  const client = g.__primemetMongoClient;
  if (!client) return;
  g.__primemetMongoClient = undefined;
  await client.close();
}

export class DatabaseNotConfiguredError extends Error {
  /**
   * @param reason Optional specific message. The default keeps the original "no URI" text so the
   *   health endpoint's `not_configured` reason and every existing caller behave exactly as before.
   *   A caller passes a message only to name *which* setting is missing; it must never include a
   *   connection string.
   */
  constructor(reason?: string) {
    super(
      reason ??
        "MONGODB_URI is not configured. This deployment has no database; see .env.example and the " +
          "database provisioning steps before enabling any database-backed feature.",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}