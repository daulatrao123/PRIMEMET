import type { NextRequest } from "next/server";

import { requireApi } from "@/lib/auth/guards";
import { LIMITS, consume, retryAfterSeconds } from "@/lib/auth/rate-limit";
import { renameManufacturer } from "@/lib/data/admin-console";
import { AuthorisationError } from "@/lib/data/authorise";
import { isCrossSite, jsonError, jsonOk, readInput, redirectTo, shortMessage, wantsJson } from "@/lib/http";
import { firstIssue, manufacturerRenameSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACK = "/admin/catalogue/manufacturers";

/**
 * POST /api/admin/manufacturers — renaming a manufacturer across the catalogue.
 *
 * Products reference the manufacturer by name, so a rename is one bounded `updateMany`. Product slugs are
 * deliberately untouched: the M5 brief requires existing product URLs to be preserved, and rewriting a
 * slug would break every link and search result for that product.
 */
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");

  const guard = await requireApi(["ADMIN"]);
  if (!guard.user) return guard.response;

  const quota = consume("admin-write:" + guard.user.id, LIMITS.adminWrite.limit, LIMITS.adminWrite.windowMs);
  if (!quota.ok) {
    const message = "Too many administrative writes. Try again in " + retryAfterSeconds(quota.retryAfterMs) + " seconds.";
    return wantsJson(request) ? jsonError(429, message, "rate_limited") : redirectTo(request, BACK, { error: message });
  }

  const input = await readInput(request);
  const asForm = !wantsJson(request);
  const parsed = manufacturerRenameSchema.safeParse(input);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    return asForm ? redirectTo(request, BACK, { error: issue.message }) : jsonError(400, issue.message, issue.field ?? "validation");
  }

  try {
    const result = await renameManufacturer(guard.user, parsed.data.from, parsed.data.to);
    const message = `Renamed across ${result.updated} product${result.updated === 1 ? "" : "s"}.`;
    return asForm ? redirectTo(request, BACK, { ok: message }) : jsonOk({ message, updated: result.updated });
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return asForm ? redirectTo(request, BACK, { error: error.message }) : jsonError(403, error.message, "forbidden");
    }
    if (error instanceof Error) {
      return asForm ? redirectTo(request, BACK, { error: shortMessage(error.message) }) : jsonError(400, error.message, "invalid");
    }
    throw error;
  }
}
