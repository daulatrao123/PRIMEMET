import type { AppDb } from "@/lib/db";

import { DatabaseNotConfiguredError, getDb, isConfigured } from "@/lib/db";

/**
 * Read-only data access that degrades safely when no database is configured.
 *
 * The public site must build and render on a machine with no `MONGODB_URI` (that is a standing project
 * rule), so a page that lists products shows an empty state instead of throwing at build time. Only
 * `DatabaseNotConfiguredError` is swallowed: a reachable-but-broken database still surfaces, because
 * hiding a connection failure would make an outage look like "no products yet".
 *
 * Writes never use this helper. A write that cannot reach the database must fail loudly — a buyer
 * enquiry that silently disappears is worse than an error page.
 */
export async function dataOr<T>(fallback: T, read: (db: AppDb) => Promise<T>): Promise<T> {
  if (!isConfigured()) return fallback;
  try {
    return await read(await getDb());
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) return fallback;
    throw error;
  }
}