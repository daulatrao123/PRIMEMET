import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { decideListing } from "@/lib/data/listings";
import { AuthorisationError } from "@/lib/data/authorise";
import { LIMITS, consume, retryAfterSeconds } from "@/lib/auth/rate-limit";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, shortMessage, wantsJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/listings — approve or reject one seller listing submission.
 *
 * ADMIN ONLY. `decideListing` refuses a non-admin actor and refuses a listing that is not PENDING, so an
 * approval cannot be replayed over an earlier rejection (or the reverse), and two admins deciding at
 * once produce one decision and one refusal rather than a silent overwrite.
 */
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["ADMIN"]);
  if (!guard.user) return guard.response;

  const quota = consume("admin-write:" + guard.user.id, LIMITS.adminWrite.limit, LIMITS.adminWrite.windowMs);
  if (!quota.ok) {
    const message = "Too many administrative writes. Try again in " + retryAfterSeconds(quota.retryAfterMs) + " seconds.";
    return wantsJson(request) ? jsonError(429, message, "rate_limited") : redirectTo(request, "/admin/listing-submissions", { error: message });
  }

  const input = await readInput(request);
  const asForm = !wantsJson(request);
  const listingId = (input.listingId ?? "").trim();
  const action = input.action === "approve" ? "APPROVE" : input.action === "reject" ? "REJECT" : null;
  const back = "/admin/listing-submissions";

  if (!listingId || !action) {
    const message = "Choose a listing and an action.";
    return asForm ? redirectTo(request, back, { error: message }) : jsonError(400, message, "invalid");
  }

  try {
    await decideListing(guard.user, listingId, action, input.reason);
    const message = action === "APPROVE" ? "Listing approved." : "Listing rejected.";
    return asForm ? redirectTo(request, back, { ok: message }) : jsonOk({ message });
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return asForm ? redirectTo(request, back, { error: error.message }) : jsonError(403, error.message, "forbidden");
    }
    if (error instanceof Error) {
      return asForm ? redirectTo(request, back, { error: shortMessage(error.message) }) : jsonError(400, error.message, "invalid");
    }
    throw error;
  }
}
