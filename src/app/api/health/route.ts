import { NextResponse } from "next/server";

/**
 * Liveness endpoint.
 *
 * There is no database in Stage 1, so `database` is always "not_configured". This
 * endpoint must never report a connection it does not have: when the database stage
 * lands, this value becomes a real check and this comment is replaced.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    database: "not_configured",
  });
}
