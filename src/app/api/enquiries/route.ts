import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { AuthorisationError } from "@/lib/data/authorise";
import { createEnquiry } from "@/lib/data/enquiries";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, wantsJson } from "@/lib/http";
import { enquirySchema, firstIssue } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/enquiries — the "Enquire now" action on a product page.
 *
 * The organisation comes from the session, never from the form, so a buyer cannot raise an enquiry in
 * another company's name by editing a hidden field. The product is resolved server-side against
 * published products only, so a crafted id cannot open a draft.
 *
 * An anonymous visitor is not sent here by the page — the page renders a sign-in call to action instead —
 * but the route refuses one anyway: the page is a convenience, this is the rule.
 */
function answer(request: NextRequest, message: string, reference: string, status = 201) {
  if (wantsJson(request)) return jsonOk({ message, reference }, status);
  return redirectTo(request, "/buyer/enquiries", { ok: message, reference });
}

export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["BUYER"]);
  if (!guard.user) return guard.response;

  const input = await readInput(request);
  const parsed = enquirySchema.safeParse(input);
  if (!parsed.success) {
    const message = firstIssue(parsed.error).message;
    if (wantsJson(request)) return jsonError(400, message, "invalid");
    return redirectTo(request, input.returnTo?.startsWith("/products/") ? input.returnTo : "/products", {
      error: message,
    });
  }

  try {
    const created = await createEnquiry(guard.user, {
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      requirements: parsed.data.requirements,
      deliveryLocation: parsed.data.deliveryLocation,
      contactName: parsed.data.contactName,
      contactEmail: parsed.data.contactEmail,
      contactPhone: parsed.data.contactPhone,
    });
    return answer(request, "Enquiry received.", created.reference);
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return wantsJson(request) ? jsonError(403, error.message, "forbidden") : redirectTo(request, "/products", { error: error.message });
    }
    if (error instanceof Error && /not available for enquiry|organisation/.test(error.message)) {
      const message = error.message;
      return wantsJson(request)
        ? jsonError(409, message, "unavailable")
        : redirectTo(request, input.returnTo?.startsWith("/products/") ? input.returnTo : "/products", { error: message });
    }
    throw error;
  }
}
