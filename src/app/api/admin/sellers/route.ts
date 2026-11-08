import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { addSellerInternalNote } from "@/lib/data/seller-admin";
import { decideSeller } from "@/lib/data/admin";
import { AuthorisationError } from "@/lib/data/authorise";
import { LIMITS, consume, retryAfterSeconds } from "@/lib/auth/rate-limit";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, shortMessage, wantsJson } from "@/lib/http";
import { firstIssue, sellerAdminActionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/sellers — the desk deciding a seller application, or recording an internal note.
 *
 * ADMIN ONLY, twice over: `requireApi(["ADMIN"])` refuses the request, and `decideSeller` /
 * `addSellerInternalNote` call `requireAdminActor` again at the data layer. A seller posting here with a
 * valid session gets 403 before any document is read.
 *
 * The organisation id is in the body because an administrator is choosing WHICH application to decide —
 * that is the admin's legitimate parameter, unlike the seller routes where it would be an escalation.
 */
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["ADMIN"]);
  if (!guard.user) return guard.response;

  const quota = consume("admin-write:" + guard.user.id, LIMITS.adminWrite.limit, LIMITS.adminWrite.windowMs);
  if (!quota.ok) {
    const message = "Too many administrative writes. Try again in " + retryAfterSeconds(quota.retryAfterMs) + " seconds.";
    return wantsJson(request) ? jsonError(429, message, "rate_limited") : redirectTo(request, "/admin/suppliers", { error: message });
  }

  const input = await readInput(request);
  const organisationId = (input.organisationId ?? "").trim();
  const back = organisationId ? "/admin/suppliers/" + encodeURIComponent(organisationId) : "/admin/suppliers";
  const asForm = !wantsJson(request);

  const parsed = sellerAdminActionSchema.safeParse(input);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    return asForm
      ? redirectTo(request, back, { error: issue.message })
      : jsonError(400, issue.message, issue.field ?? "validation");
  }
  if (!organisationId) {
    const message = "Choose the seller application to act on.";
    return asForm ? redirectTo(request, "/admin/suppliers", { error: message }) : jsonError(400, message, "organisationId");
  }

  try {
    if (parsed.data.action === "note") {
      await addSellerInternalNote(guard.user, organisationId, parsed.data.note ?? "");
      const message = "Internal note recorded.";
      return asForm ? redirectTo(request, back, { ok: message }) : jsonOk({ message });
    }

    await decideSeller(
      guard.user,
      organisationId,
      parsed.data.action === "approve" ? "APPROVE" : "REJECT",
      parsed.data.reason,
    );
    const message = parsed.data.action === "approve" ? "Seller approved." : "Seller application rejected.";
    return asForm ? redirectTo(request, back, { ok: message }) : jsonOk({ message });
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return asForm
        ? redirectTo(request, back, { error: error.message })
        : jsonError(403, error.message, "forbidden");
    }
    if (error instanceof Error) {
      return asForm
        ? redirectTo(request, back, { error: shortMessage(error.message) })
        : jsonError(400, error.message, "invalid");
    }
    throw error;
  }
}
