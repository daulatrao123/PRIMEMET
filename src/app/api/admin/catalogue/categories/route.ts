import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { AuthorisationError } from "@/lib/data/authorise";
import {
  CatalogueError,
  adminCreateCategory,
  adminDeleteCategory,
  adminUpdateCategory,
} from "@/lib/data/catalogue";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, wantsJson } from "@/lib/http";
import { categorySchema, firstIssue, slugify } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/catalogue/categories — create, rename, reorder, publish and delete a category.
 *
 * Deletion is refused by the data layer while subcategories exist, so the button cannot orphan a
 * catalogue branch. The refusal is a message, not a 500: it is a rule, not a fault.
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
      const parsed = categorySchema.safeParse(input);
      if (!parsed.success) return refuse(request, firstIssue(parsed.error).message);
      await adminCreateCategory(guard.user, {
        ...parsed.data,
        slug: parsed.data.slug ?? slugify(parsed.data.name),
      });
      return answer(request, "Category created.", 201);
    }

    const id = (input.id ?? "").trim();
    if (!id) return refuse(request, "Choose a category first.");

    if (action === "update") {
      const name = (input.name ?? "").trim();
      if (name.length < 2) return refuse(request, "Enter a category name.");
      await adminUpdateCategory(guard.user, id, {
        name,
        shortDescription: input.shortDescription,
        sortOrder: input.sortOrder ? Number(input.sortOrder) : undefined,
        published: input.published === undefined ? undefined : input.published === "yes",
      });
      return answer(request, "Category saved.");
    }

    if (action === "delete") {
      await adminDeleteCategory(guard.user, id);
      return answer(request, "Category deleted.");
    }

    return refuse(request, "Unknown category action.");
  } catch (error) {
    if (error instanceof CatalogueError || error instanceof AuthorisationError) {
      return refuse(request, error.message);
    }
    throw error;
  }
}
