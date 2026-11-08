import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { AuthorisationError } from "@/lib/data/authorise";
import { updateBuyerProfile } from "@/lib/data/buyer-portal";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, wantsJson } from "@/lib/http";
import { firstIssue, profileSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/buyer/profile — the buyer editing their own company and contact details.
 *
 * The organisation is taken from the session, so this endpoint has no organisation parameter to tamper
 * with. A GSTIN is not in the schema at all: it is what the account was verified against.
 */
const BACK = "/buyer/profile";

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

  const guard = await requireApi(["BUYER"]);
  if (!guard.user) return guard.response;
  if (!guard.user.organisationId) {
    return refuse(request, "This account is not linked to an organisation yet. Contact the PRIMEMET desk.");
  }

  const input = await readInput(request);
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return refuse(request, firstIssue(parsed.error).message);

  try {
    await updateBuyerProfile(guard.user, parsed.data);
    return answer(request, "Company details saved.");
  } catch (error) {
    if (error instanceof AuthorisationError) return refuse(request, error.message);
    throw error;
  }
}
