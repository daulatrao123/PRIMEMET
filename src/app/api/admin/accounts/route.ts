import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { LIMITS, consume, retryAfterSeconds } from "@/lib/auth/rate-limit";
import { setAccountStatus } from "@/lib/data/admin-console";
import { AuthorisationError } from "@/lib/data/authorise";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, shortMessage, wantsJson } from "@/lib/http";
import { accountStatusSchema, firstIssue } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/accounts — suspending or reactivating a buyer or seller account.
 *
 * ADMIN ONLY, twice over: `requireApi(["ADMIN"])` refuses the request, and `setAccountStatus` calls
 * `requireAdminActor` again at the data layer. A seller posting here with a valid session gets 403
 * before any document is read.
 *
 * The organisation id is a legitimate administrator parameter — the desk is choosing WHICH account to
 * act on — unlike the seller and buyer routes, where the organisation always comes from the session.
 */
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["ADMIN"]);
  if (!guard.user) return guard.response;

  const quota = consume("admin-write:" + guard.user.id, LIMITS.adminWrite.limit, LIMITS.adminWrite.windowMs);
  if (!quota.ok) {
    const message = "Too many administrative writes. Try again in " + retryAfterSeconds(quota.retryAfterMs) + " seconds.";
    return wantsJson(request) ? jsonError(429, message, "rate_limited") : redirectTo(request, "/admin/buyers", { error: message });
  }

  const input = await readInput(request);
  const asForm = !wantsJson(request);
  const backPath = input.returnTo?.startsWith("/admin/") ? input.returnTo : "/admin/buyers";

  const parsed = accountStatusSchema.safeParse(input);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    return asForm ? redirectTo(request, backPath, { error: issue.message }) : jsonError(400, issue.message, issue.field ?? "validation");
  }

  try {
    const result = await setAccountStatus(
      guard.user,
      parsed.data.organisationId,
      parsed.data.action === "suspend" ? "SUSPEND" : "REACTIVATE",
      parsed.data.reason,
    );
    const message =
      parsed.data.action === "suspend"
        ? "Account suspended. The reason is recorded internally."
        : "Account reactivated.";
    return asForm ? redirectTo(request, backPath, { ok: message }) : jsonOk({ message, before: result.before, after: result.after });
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return asForm ? redirectTo(request, backPath, { error: error.message }) : jsonError(403, error.message, "forbidden");
    }
    if (error instanceof Error) {
      return asForm ? redirectTo(request, backPath, { error: shortMessage(error.message) }) : jsonError(400, error.message, "invalid");
    }
    throw error;
  }
}
