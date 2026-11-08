import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/session";

/**
 * GET /api/auth/me — the session as the server sees it.
 *
 * Returns only what a signed-in user may know about themselves: no password hash, no internal notes and
 * no organisation other than their own. `401` when there is no session, so a client can distinguish
 * "not signed in" from "signed in without a profile".
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organisationId: user.organisationId,
      organisationName: user.organisationName,
    },
  });
}