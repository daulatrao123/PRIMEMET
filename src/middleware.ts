import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, readClaims } from "@/lib/auth/cookie";
import { areaForPath, homeForRole } from "@/lib/auth/roles";

/**
 * PRIMEMET — route guard.
 *
 * WHAT THIS DOES. It rejects an anonymous request to a portal area before any page or route handler runs,
 * and it sends a signed-in user who opened the wrong portal to their own one. That is the whole job. It
 * is not the authorisation decision: `getSessionUser()` on the server re-reads the session row, the user
 * status and the role, and every page/route guard refuses a request whose role does not match. This layer
 * exists so a revoked or absent session never reaches a server component, and so the redirect is correct
 * on the first byte rather than after a render.
 *
 * WHY IT DOES NOT QUERY MONGODB. Middleware runs on every portal request and has no Node driver. It
 * verifies the cookie's HMAC with Web Crypto and checks its expiry. A signed cookie for a revoked session
 * passes here and is refused by the server — which is the safe direction for a cheap check to be wrong in.
 *
 * FAIL CLOSED. No `AUTH_SECRET` means no signature can verify, so every portal request is treated as
 * anonymous and sent to sign-in. There is no "skip the guard" branch.
 */

const PUBLIC_PORTAL_PATHS = new Set(["/admin/login", "/login", "/register/buyer", "/register/seller"]);

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const secret = process.env.AUTH_SECRET;
  const claims = await readClaims(request.cookies.get(SESSION_COOKIE)?.value, secret);

  // Sign-in and registration screens are public. Checked first, or /admin/login would be caught by the
  // ADMIN area below and redirect to itself forever.
  if (PUBLIC_PORTAL_PATHS.has(pathname)) {
    if (claims) return NextResponse.redirect(new URL(homeForRole(claims.role), request.url));
    return NextResponse.next();
  }

  const area = areaForPath(pathname);

  if (area) {
    if (!claims) {
      const loginPath = area === "ADMIN" ? "/admin/login" : "/login";
      const url = new URL(loginPath, request.url);
      if (pathname !== homeForRole(area)) url.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
    if (claims.role !== area) {
      return NextResponse.redirect(new URL(homeForRole(claims.role), request.url));
    }
    return NextResponse.next();
  }

  // Any other matched path (a portal area) is guarded above.
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/buyer/:path*", "/seller/:path*", "/login", "/register/:path*"],
};