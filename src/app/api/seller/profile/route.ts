import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { AuthorisationError } from "@/lib/data/authorise";
import { updateSellerProfile } from "@/lib/data/seller-portal";
import { LIMITS, consume, retryAfterSeconds } from "@/lib/auth/rate-limit";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, wantsJson } from "@/lib/http";
import { firstIssue, sellerCompanySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/seller/profile — a seller editing its own company and registered address.
 *
 * The organisation and supplier profile come from the session, so there is no organisation id to tamper
 * with. The schema has no GSTIN, no account status and no review fields: a seller cannot approve itself
 * or rewrite the desk's decision, and the data-layer allow-list would drop them even if it could.
 */
const BACK = "/seller/profile";

function answer(request: NextRequest, message: string) {
  if (wantsJson(request)) return jsonOk({ message });
  return redirectTo(request, BACK, { ok: message });
}

function refuse(request: NextRequest, message: string) {
  if (wantsJson(request)) return jsonError(400, message, "invalid");
  return redirectTo(request, BACK, { error: message });
}

export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["SELLER"]);
  if (!guard.user) return guard.response;

  const quota = consume("seller-profile:" + guard.user.id, LIMITS.sellerProfile.limit, LIMITS.sellerProfile.windowMs);
  if (!quota.ok) {
    const message = "Too many profile changes. Try again in " + retryAfterSeconds(quota.retryAfterMs) + " seconds.";
    return wantsJson(request) ? jsonError(429, message, "rate_limited") : redirectTo(request, BACK, { error: message });
  }

  const input = await readInput(request);
  const parsed = sellerCompanySchema.safeParse(input);
  if (!parsed.success) return refuse(request, firstIssue(parsed.error).message);

  try {
    await updateSellerProfile(guard.user, parsed.data);
    return answer(request, "Company details saved.");
  } catch (error) {
    if (error instanceof AuthorisationError) return refuse(request, error.message);
    throw error;
  }
}
