import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { AuthorisationError } from "@/lib/data/authorise";
import { getSellerApplication } from "@/lib/data/seller-portal";
import { submitMyListing } from "@/lib/data/listings";
import { LIMITS, consume, retryAfterSeconds } from "@/lib/auth/rate-limit";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, shortMessage, wantsJson } from "@/lib/http";
import { firstIssue, listingSubmissionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/seller/listings — submit a product listing for review.
 *
 * The write is always DRAFT + PENDING; `submitMyListing` takes no decision, and the database validator
 * requires an explicit reviewStatus. Nothing submitted here reaches the public catalogue: publication is
 * an administrator's act (`/api/admin/listings` and the catalogue publisher).
 */
const BACK = "/seller/products";

function answer(request: NextRequest, message: string) {
  if (wantsJson(request)) return jsonOk({ message });
  return redirectTo(request, BACK, { ok: message });
}

function refuse(request: NextRequest, message: string, field?: string) {
  if (wantsJson(request)) return jsonError(400, message, field ?? "invalid");
  return redirectTo(request, BACK, { error: shortMessage(message), ...(field ? { field } : {}) });
}

export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["SELLER"]);
  if (!guard.user) return guard.response;

  // The declared policy, now enforced: a seller cannot flood the review queue with submissions.
  const quota = consume("listing:" + guard.user.id, LIMITS.listing.limit, LIMITS.listing.windowMs);
  if (!quota.ok) {
    const message = "Too many listing submissions. Try again in " + retryAfterSeconds(quota.retryAfterMs) + " seconds.";
    return wantsJson(request) ? jsonError(429, message, "rate_limited") : redirectTo(request, BACK, { error: message });
  }

  const application = await getSellerApplication(guard.user);
  if (!application.organisation) {
    return refuse(request, "This account is not linked to a supplier organisation yet.");
  }
  if (!application.canSubmitListings) {
    return refuse(request, "This supplier account cannot submit listings while its application is not active.");
  }

  const input = await readInput(request);
  const parsed = listingSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    return refuse(request, issue.message, issue.field);
  }

  try {
    const listing = await submitMyListing(guard.user, parsed.data);
    return answer(request, "Listing submitted for review. Reference " + listing.id.slice(0, 8) + ".");
  } catch (error) {
    if (error instanceof AuthorisationError) return refuse(request, error.message);
    if (error instanceof Error) return refuse(request, error.message);
    throw error;
  }
}
