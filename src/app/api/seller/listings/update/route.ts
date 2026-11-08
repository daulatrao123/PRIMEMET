import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { AuthorisationError } from "@/lib/data/authorise";
import { updateMyListing } from "@/lib/data/listings";
import { LIMITS, consume, retryAfterSeconds } from "@/lib/auth/rate-limit";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, shortMessage, wantsJson } from "@/lib/http";
import { firstIssue, listingSubmissionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/seller/listings/update — edit and resubmit a rejected or pending submission.
 *
 * The listing id is in the body, but it is not an authority: `updateMyListing` looks the listing up by
 * `supplierId` taken from the session, so another seller's id simply does not exist. The write returns
 * the submission to PENDING / DRAFT and clears the previous decision — it can never approve anything.
 */
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["SELLER"]);
  if (!guard.user) return guard.response;

  const quota = consume("listing:" + guard.user.id, LIMITS.listing.limit, LIMITS.listing.windowMs);
  if (!quota.ok) {
    const message = "Too many listing submissions. Try again in " + retryAfterSeconds(quota.retryAfterMs) + " seconds.";
    return wantsJson(request) ? jsonError(429, message, "rate_limited") : redirectTo(request, "/seller/products", { error: message });
  }

  const input = await readInput(request);
  const asForm = !wantsJson(request);
  const listingId = (input.listingId ?? "").trim();
  const back = "/seller/products" + (listingId ? "/" + encodeURIComponent(listingId) : "");

  if (!listingId) {
    const message = "Choose the submission to update.";
    return asForm ? redirectTo(request, "/seller/products", { error: message }) : jsonError(400, message, "listingId");
  }

  const parsed = listingSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    return asForm
      ? redirectTo(request, back, { error: issue.message })
      : jsonError(400, issue.message, issue.field ?? "validation");
  }

  try {
    await updateMyListing(guard.user, listingId, parsed.data);
    const message = "Resubmitted for review.";
    return asForm ? redirectTo(request, "/seller/products", { ok: message }) : jsonOk({ message });
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
