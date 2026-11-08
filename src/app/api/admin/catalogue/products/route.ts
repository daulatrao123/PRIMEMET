import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { FormError, parseImageLines, parseSpecLines } from "@/lib/catalogue-form";
import {
  CatalogueError,
  adminArchiveProduct,
  adminCreateProduct,
  adminSetPublication,
  adminUpdateProduct,
  getProductById,
  type PublicationState,
} from "@/lib/data/catalogue";
import { AuthorisationError } from "@/lib/data/authorise";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, wantsJson } from "@/lib/http";
import { firstIssue, productSchema, productUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/catalogue/products — the whole product lifecycle in one endpoint.
 *
 * WHY ONE ENDPOINT. Every action here is "an administrator changed a product": the guard, the cross-site
 * check, the validation and the audit row are identical, and only the operation differs. Four route files
 * would mean four places for the guard to be forgotten.
 *
 * A browser posts the admin form and gets a 303 back to a page with a message; a test or an API client
 * asks for JSON and gets one. Same validation, same data layer, same audit trail.
 */
const PUBLICATION_STATES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

function answer(request: NextRequest, message: string, nextPath: string, status = 200) {
  if (wantsJson(request)) return jsonOk({ message }, status);
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
  const action = (input.action ?? "update").trim().toLowerCase();
  const backPath = input.returnTo?.startsWith("/admin/") ? input.returnTo : "/admin/products";

  try {
    if (action === "create") {
      const parsed = productSchema.safeParse(input);
      if (!parsed.success) return refuse(request, firstIssue(parsed.error).message, "/admin/products/new");

      const created = await adminCreateProduct(guard.user, {
        ...parsed.data,
        images: parseImageLines(input.imageUrls ?? ""),
        specifications: parseSpecLines(input.specifications ?? ""),
        publicationState: input.publish === "yes" ? "PUBLISHED" : "DRAFT",
      });
      return answer(request, "Product created.", `/admin/products/${created.id}`, 201);
    }

    const id = (input.id ?? "").trim();
    if (!id) return refuse(request, "Choose a product first.", backPath);

    if (action === "update") {
      const parsed = productUpdateSchema.safeParse(input);
      if (!parsed.success) return refuse(request, firstIssue(parsed.error).message, `/admin/products/${id}`);

      await adminUpdateProduct(guard.user, id, {
        ...parsed.data,
        images: parseImageLines(input.imageUrls ?? ""),
        specifications: parseSpecLines(input.specifications ?? ""),
      });
      return answer(request, "Product saved.", `/admin/products/${id}`);
    }

    if (action === "publish" || action === "unpublish" || action === "archive") {
      const requested = (input.publicationState ?? "").trim().toUpperCase();
      const state = (requested || (action === "publish" ? "PUBLISHED" : action === "unpublish" ? "DRAFT" : "ARCHIVED")) as PublicationState;
      if (!PUBLICATION_STATES.includes(state)) return refuse(request, "Unknown publication state.", backPath);

      const product = await getProductById(id);
      if (!product) return refuse(request, "That product does not exist.", backPath);

      if (state === "ARCHIVED") await adminArchiveProduct(guard.user, id);
      else await adminSetPublication(guard.user, id, state);

      return answer(
        request,
        state === "PUBLISHED" ? "Product published." : state === "DRAFT" ? "Product unpublished." : "Product archived.",
        backPath,
      );
    }

    return refuse(request, "Unknown catalogue action.", backPath);
  } catch (error) {
    if (error instanceof CatalogueError || error instanceof FormError || error instanceof AuthorisationError) {
      return refuse(request, error.message, backPath);
    }
    throw error;
  }
}
