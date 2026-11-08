/**
 * PRIMEMET — server-side route guards.
 *
 * Every one of these resolves the session from the database. None of them trusts a role from the URL,
 * a query parameter, a form field or the cookie's routing hint. A guard that returned "admin" because
 * the request said so would be the exact defect the audit recorded: protected-looking pages that answer
 * HTTP 200 to anyone.
 *
 * Page guards redirect (a browser sees the sign-in screen, preserving where it was going). API guards
 * answer 401/403 and never redirect, because a fetch that follows a 303 to an HTML page turns a clean
 * authorisation failure into a parse error.
 */

import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { getSessionUser, homeForRole, type AuthUser, type Role } from "./session";

/** Require a session with one of `roles`. Redirects to /login, or to the caller's own home. */
export async function requirePage(roles: readonly Role[], nextPath?: string): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) {
    const suffix = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/login${suffix}`);
  }
  if (!roles.includes(user.role)) redirect(homeForRole(user.role));
  return user;
}

/** Require a session on an admin page specifically (the admin has its own sign-in screen). */
export async function requireAdminPage(nextPath?: string): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) {
    const suffix = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/admin/login${suffix}`);
  }
  if (user.role !== "ADMIN") redirect(homeForRole(user.role));
  return user;
}

export type ApiGuard = { user: AuthUser; response: null } | { user: null; response: NextResponse };

/**
 * Require a session for an API route.
 *
 * `401` when there is no session, `403` when the session belongs to another role. The distinction is
 * deliberate: 401 tells a legitimate client to sign in; 403 says "signing in will not help".
 */
export async function requireApi(roles: readonly Role[]): Promise<ApiGuard> {
  const user = await getSessionUser();
  if (!user) return { user: null, response: jsonError(401, "Sign in to continue.", "unauthenticated") };
  if (!roles.includes(user.role)) {
    return { user: null, response: jsonError(403, "Your account cannot perform this action.", "forbidden") };
  }
  return { user, response: null };
}

/** The organisation a buyer/seller request is confined to. An account without one may not write. */
export function requireOrganisation(user: AuthUser): string | NextResponse {
  if (!user.organisationId) {
    return jsonError(
      409,
      "This account is not linked to an organisation yet. Contact the PRIMEMET desk.",
      "no_organisation",
    );
  }
  return user.organisationId;
}