import { NextResponse, type NextRequest } from "next/server";

/**
 * Stage 1 middleware.
 *
 * It authenticates nothing and authorises nothing. Every request passes straight through,
 * which is why the portal routes are openly reachable in this build and why each screen
 * carries the preview label. There is no session, no cookie and no role to inspect.
 *
 * The routes below are listed here so Stage 2 has one place to add guards.
 */
const PROTECTED_PREFIXES = ["/admin", "/buyer", "/seller"];

/** Routes that must stay reachable without a session. */
const PUBLIC_PREFIXES = ["/admin/login", "/login", "/register"];

/** Roles the future guards will map each area to. */
const ROLE_BY_PREFIX: Record<string, "ADMIN" | "BUYER" | "SELLER"> = {
  "/admin": "ADMIN",
  "/buyer": "BUYER",
  "/seller": "SELLER",
};

export function middleware(request: NextRequest) {
  // TODO (Stage 2): create the auth session here, read the role from it and enforce:
  //   1. unauthenticated request to a PROTECTED_PREFIXES route → redirect to the matching
  //      login route ("/admin/login" for ADMIN areas, "/login" otherwise), preserving the
  //      original path in a ?next= parameter;
  //   2. authenticated request whose role does not match ROLE_BY_PREFIX → redirect to that
  //      role's own dashboard rather than showing a 403 that leaks route structure;
  //   3. authenticated request to a login or register route → redirect to the dashboard.
  //
  // Nothing above is implemented: applying it now would require an auth provider, and
  // Stage 1 must not contain fake sessions or fake role switching.
  void request;
  void PROTECTED_PREFIXES;
  void PUBLIC_PREFIXES;
  void ROLE_BY_PREFIX;

  return NextResponse.next();
}

export const config = {
  // Only the routes that will need a guard; everything else skips middleware entirely.
  matcher: ["/admin/:path*", "/buyer/:path*", "/seller/:path*", "/login", "/register/:path*"],
};
