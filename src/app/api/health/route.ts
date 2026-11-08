import { NextResponse } from "next/server";
import pkg from "../../../../package.json";
import { getDb } from "@/lib/db";
import { envErrors, isDatabaseConfigured } from "@/lib/env";

/**
 * Liveness and database readiness probe (§22.6).
 *
 * The contract is fixed by the architecture document and is deliberately conservative:
 *
 * | Condition                   | status     | database          | HTTP |
 * |-----------------------------|------------|-------------------|------|
 * | No MONGODB_URI              | ok         | not_configured    | 200  |
 * | Configured, ping works      | ok         | connected         | 200  |
 * | Configured, ping fails      | degraded   | unavailable       | 503  |
 *
 * Rules it must never break:
 * - It never claims a connection it does not have.
 * - The check is a bounded `ping`; a hung database cannot hang the probe.
 * - The response is never cached.
 * - No version string is invented — `version` is the application's own package version.
 * - No secret is ever in the body: the failure case reports a fixed reason, not the driver's
 *   message, which can contain a host name.
 *
 * With no MONGODB_URI — the state of every deployment until the Atlas cluster is provisioned — this
 * route does no work beyond reading one variable.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Read from package.json at build time (§22.6: "no version string is invented").
const APP_VERSION: string = pkg.version;
const DB_TIMEOUT_MS = 2000;

type DatabaseState = "not_configured" | "connected" | "unavailable";

async function probeDatabase(): Promise<{ state: DatabaseState; reason?: string }> {
  if (!isDatabaseConfigured()) {
    return { state: "not_configured" };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const db = await getDb();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
    });
    // `ping` is the MongoDB equivalent of `SELECT 1`: it proves the server answers, without reading or
    // writing any document.
    await Promise.race([db.command({ ping: 1 }), timeout]);
    return { state: "connected" };
  } catch (error) {
    // A timeout and a connection failure are both "unavailable"; the reason is for operators, not
    // for the public, and it never includes the connection string.
    const reason =
      error instanceof Error && error.message === "timeout"
        ? "timeout"
        : error instanceof Error && error.name === "DatabaseNotConfiguredError"
          ? "not_configured"
          : "connection_failed";
    return { state: "unavailable", reason };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const started = Date.now();
  const { state, reason } = await probeDatabase();

  const body: Record<string, unknown> = {
    status: state === "unavailable" ? "degraded" : "ok",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    database: state,
  };

  // Only exposed when the operator's environment is malformed — never on a clean checkout.
  if (state === "unavailable" && reason) body.database_detail = reason;
  if (envErrors.length > 0) body.config_errors = envErrors.length;
  if (state === "connected") body.database_latency_ms = Date.now() - started;

  // No `environment` field (Decision 2): §22.6 fixes the unconfigured response at four keys, and a
  // public endpoint has no reason to disclose which deployment environment it is running in.

  return NextResponse.json(body, {
    status: state === "unavailable" ? 503 : 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}