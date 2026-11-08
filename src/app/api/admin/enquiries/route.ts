import type { NextRequest } from "next/server";

import { writeAuditLog } from "@/lib/auth/audit";
import { requireApi } from "@/lib/auth/guards";
import { AuthorisationError } from "@/lib/data/authorise";
import { getEnquiryForAdmin, updateEnquiryForAdmin } from "@/lib/data/enquiries";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, wantsJson } from "@/lib/http";
import { enquiryUpdateSchema, firstIssue } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/enquiries — the desk moving an enquiry forward, and its internal notes.
 *
 * `internalNotes` is written here and is never part of `BuyerEnquiry`, so the buyer's own pages cannot
 * render it even if a template asked: the projection excludes it at the query.
 */
function answer(request: NextRequest, message: string, nextPath: string) {
  if (wantsJson(request)) return jsonOk({ message });
  return redirectTo(request, nextPath, { ok: message });
}

function refuse(request: NextRequest, message: string, nextPath: string) {
  if (wantsJson(request)) return jsonError(400, message, "invalid");
  return redirectTo(request, nextPath, { error: message });
}

export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["ADMIN"]);
  if (!guard.user) return guard.response;

  const input = await readInput(request);
  const id = (input.id ?? "").trim();
  const backPath = id ? `/admin/enquiries/${id}` : "/admin/enquiries";
  if (!id) return refuse(request, "Choose an enquiry first.", backPath);

  const parsed = enquiryUpdateSchema.safeParse(input);
  if (!parsed.success) return refuse(request, firstIssue(parsed.error).message, backPath);
  if (parsed.data.status === undefined && parsed.data.internalNotes === undefined) {
    return refuse(request, "Nothing to change.", backPath);
  }

  try {
    const existing = await getEnquiryForAdmin(id);
    if (!existing) return refuse(request, "That enquiry does not exist.", "/admin/enquiries");

    const { before } = await updateEnquiryForAdmin(guard.user, id, parsed.data);

    // The audit row records the transition, not just the fact that something changed: "who moved this
    // enquiry to WON" is the question an incident review asks, and a bare "updated" cannot answer it.
    await writeAuditLog({
      actorUserId: guard.user.id,
      actorRole: guard.user.role,
      action: parsed.data.status ? "enquiry.status_changed" : "enquiry.notes_updated",
      entityType: "Enquiry",
      entityId: id,
      before: { status: before?.status ?? null },
      after: { status: parsed.data.status ?? before?.status ?? null, notesChanged: parsed.data.internalNotes !== undefined },
      severity: "NOTICE",
    });

    return answer(
      request,
      parsed.data.status ? "Enquiry status updated." : "Internal note saved.",
      backPath,
    );
  } catch (error) {
    if (error instanceof AuthorisationError) return refuse(request, error.message, backPath);
    throw error;
  }
}
