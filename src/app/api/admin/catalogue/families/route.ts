import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { AuthorisationError } from "@/lib/data/authorise";
import {
  CatalogueError,
  adminCreateFamily,
  adminDeleteFamily,
  adminUpdateFamily,
  type PublicationState,
} from "@/lib/data/catalogue";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, wantsJson } from "@/lib/http";
import { familySchema, firstIssue, slugify } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/catalogue/families — subcategory management.
 *
 * A subcategory is what a product actually belongs to, so it is also the unit the public catalogue
 * filters by. Deleting one is refused while it holds products, in any state.
 */
const BACK = "/admin/catalogue/categories";

function answer(request: NextRequest, message: string, status = 200) {
  if (wantsJson(request)) return jsonOk({ message }, status);
  return redirectTo(request, BACK, { ok: message });
}

function refuse(request: NextRequest, message: string) {
  if (wantsJson(request)) return jsonError(400, message, "invalid");
  return redirectTo(request, BACK, { error: message });
}

export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["ADMIN"]);
  if (!guard.user) return guard.response;

  const input = await readInput(request);
  const action = (input.action ?? "create").trim().toLowerCase();

  try {
    if (action === "create") {
      const parsed = familySchema.safeParse(input);
      if (!parsed.success) return refuse(request, firstIssue(parsed.error).message);
      await adminCreateFamily(guard.user, {
        ...parsed.data,
        slug: parsed.data.slug ?? slugify(parsed.data.name),
      });
      return answer(request, "Subcategory created.", 201);
    }

    const id = (input.id ?? "").trim();
    if (!id) return refuse(request, "Choose a subcategory first.");

    if (action === "update") {
      const name = (input.name ?? "").trim();
      if (name.length < 2) return refuse(request, "Enter a subcategory name.");
      const state = (input.publicationState ?? "").trim().toUpperCase();
      await adminUpdateFamily(guard.user, id, {
        name,
        description: input.description,
        sortOrder: input.sortOrder ? Number(input.sortOrder) : undefined,
        publicationState: state === "PUBLISHED" || state === "DRAFT" || state === "ARCHIVED" ? (state as PublicationState) : undefined,
      });
      return answer(request, "Subcategory saved.");
    }

    if (action === "delete") {
      await adminDeleteFamily(guard.user, id);
      return answer(request, "Subcategory deleted.");
    }

    return refuse(request, "Unknown subcategory action.");
  } catch (error) {
    if (error instanceof CatalogueError || error instanceof AuthorisationError) {
      return refuse(request, error.message);
    }
    throw error;
  }
}
