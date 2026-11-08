import type { NextRequest } from "next/server";

import { writeAuthEvent } from "@/lib/auth/audit";
import { SESSION_COOKIE, getSessionUser, revokeCurrentSession } from "@/lib/auth/session";
import { clientIp, isCrossSite, jsonError, jsonOk, redirectTo } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout — revoke the session row and clear the cookie.
 *
 * Both halves are required. Clearing the cookie alone would leave a valid database row that any captured
 * copy of the cookie could still use; revoking alone would leave a cookie the browser keeps presenting
 * (and which would fail, noisily, on every page).
 *
 * POST only: a GET logout can be triggered by an image tag on another site, which is a denial-of-service
 * against the user's session rather than a security hole, but there is no reason to allow it.
 */
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const user = await getSessionUser().catch(() => null);
  await revokeCurrentSession().catch(() => undefined);

  if (user) {
    await writeAuthEvent({
      userId: user.id,
      eventType: "logout",
      success: true,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
  }

  const area = request.headers.get("referer")?.includes("/admin") ? "/admin/login" : "/login";
  const asJson = (request.headers.get("accept") ?? "").includes("application/json");

  if (asJson) {
    const response = jsonOk({ redirect: area });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  const response = redirectTo(request, area);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}