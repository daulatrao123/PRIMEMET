import type { NextRequest } from "next/server";

import { writeAuthEvent } from "@/lib/auth/audit";
import { verifyPassword } from "@/lib/auth/password";
import { LIMITS, consume, retryAfterSeconds } from "@/lib/auth/rate-limit";
import { SESSION_COOKIE, cookieOptions, createSession, homeForRole } from "@/lib/auth/session";
import { isConfigured } from "@/lib/db";
import {
  findUserByEmail,
  recordLoginFailure,
  recordLoginSuccess,
  sellerApplicationNotice,
} from "@/lib/data/accounts";
import { env } from "@/lib/env";
import {
  clientIp,
  isCrossSite,
  jsonError,
  jsonOk,
  readInput,
  redirectTo,
  safeNextPath,
  shortMessage,
  wantsJson,
} from "@/lib/http";
import { firstIssue, loginSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A real scrypt hash of a password nobody uses.
 *
 * WHY: without it, a request for an unknown email returns as soon as a single indexed lookup misses,
 * while a request for a real account spends ~50 ms in scrypt. That difference is an account oracle —
 * an attacker learns which addresses are registered without a single successful login. Verifying
 * against this hash keeps both paths the same shape.
 */
const DUMMY_HASH =
  "scrypt$32768$8$1$EYTovcG5xlb2pb3-3xIwtg$7YSCj_bVmgSq2xhdVBgINAZlGAH93aSbccHuftnIzCMEi3mrIY54ivx_VeQDGTVt1I08w0viu3_YuERHd0KDCw";

const GENERIC_FAILURE = "Email or password is incorrect.";

/**
 * POST /api/auth/login — issue a session for an ACTIVE account.
 *
 * The response deliberately does not say whether the email exists. A seller whose application is still
 * pending gets a different message, because that is not a credential guess — the correct password was
 * supplied — and leaving them with "incorrect password" would be a support call with no explanation.
 */
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");
  if (!isConfigured()) return jsonError(503, "Accounts are not available on this deployment yet.", "unavailable");

  const input = await readInput(request);
  const asForm = !wantsJson(request);
  const adminRoute = input.area === "admin";
  const backPath = adminRoute ? "/admin/login" : "/login";
  const next = safeNextPath(input.next);

  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    return asForm
      ? redirectTo(request, backPath, { error: shortMessage(issue.message), next: next ?? "" })
      : jsonError(400, issue.message, "validation");
  }

  const ip = clientIp(request);
  const limit = consume(`login:${ip ?? "unknown"}:${parsed.data.email}`, LIMITS.login.limit, LIMITS.login.windowMs);
  if (!limit.ok) {
    const message = `Too many sign-in attempts. Try again in ${retryAfterSeconds(limit.retryAfterMs)} seconds.`;
    return asForm ? redirectTo(request, backPath, { error: message }) : jsonError(429, message, "rate_limited");
  }

  const user = await findUserByEmail(parsed.data.email).catch(() => null);
  const passwordOk = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordOk) {
    if (user) await recordLoginFailure(user._id).catch(() => undefined);
    await writeAuthEvent({
      userId: user?._id ?? null,
      emailAttempted: parsed.data.email,
      eventType: "login",
      success: false,
      ip,
      userAgent: request.headers.get("user-agent"),
      detail: { reason: user ? "bad_password" : "unknown_account" },
    });
    return asForm
      ? redirectTo(request, backPath, { error: GENERIC_FAILURE, next: next ?? "" })
      : jsonError(401, GENERIC_FAILURE, "invalid_credentials");
  }

  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    const seconds = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 1000);
    const message = `This account is temporarily locked after repeated failed attempts. Try again in ${Math.ceil(seconds / 60)} minutes.`;
    return asForm ? redirectTo(request, backPath, { error: message }) : jsonError(423, message, "locked");
  }

  if (user.status !== "ACTIVE") {
    // A seller is told what the desk decided, because the password has already been verified and the
    // decision note is written for the seller to read. An internal note is never used here.
    const sellerNotice = user.role === "SELLER" ? await sellerApplicationNotice(user._id).catch(() => null) : null;
    const message =
      user.role !== "SELLER"
        ? "This account is not active. Contact the PRIMEMET desk."
        : sellerNotice?.accountStatus === "REJECTED"
          ? "Your supplier application was not approved." +
            (sellerNotice.reviewFeedback ? " Reason: " + sellerNotice.reviewFeedback : " Contact the PRIMEMET desk.")
          : sellerNotice?.accountStatus === "SUSPENDED"
            ? "This supplier account is suspended. Contact the PRIMEMET desk."
            : "Your supplier application is awaiting PRIMEMET approval. You can sign in once an administrator approves it.";
    await writeAuthEvent({
      userId: user._id,
      emailAttempted: parsed.data.email,
      eventType: "login.refused_inactive",
      success: false,
      ip,
      userAgent: request.headers.get("user-agent"),
      detail: { status: user.status },
    });
    return asForm ? redirectTo(request, backPath, { error: message }) : jsonError(403, message, "inactive");
  }

  // An admin must sign in through the admin screen, and a buyer/seller must not.
  if (adminRoute && user.role !== "ADMIN") {
    const message = "This sign-in is for PRIMEMET staff accounts only.";
    return asForm ? redirectTo(request, backPath, { error: message }) : jsonError(403, message, "wrong_portal");
  }
  if (!adminRoute && user.role === "ADMIN") {
    const message = "PRIMEMET staff sign in through the administrator route.";
    return asForm ? redirectTo(request, backPath, { error: message }) : jsonError(403, message, "wrong_portal");
  }

  await recordLoginSuccess(user._id).catch(() => undefined);
  await writeAuthEvent({
    userId: user._id,
    emailAttempted: parsed.data.email,
    eventType: "login",
    success: true,
    ip,
    userAgent: request.headers.get("user-agent"),
    detail: { role: user.role },
  });

  const session = await createSession({ id: user._id, role: user.role }, {
    ip,
    userAgent: request.headers.get("user-agent"),
  });
  const destination = next ?? homeForRole(user.role);

  if (!asForm) {
    const response = jsonOk({ role: user.role, redirect: destination });
    response.cookies.set(SESSION_COOKIE, session.value, cookieOptions(env.NEXT_PUBLIC_APP_URL, session.expiresAt));
    return response;
  }

  const response = redirectTo(request, destination);
  response.cookies.set(SESSION_COOKIE, session.value, cookieOptions(env.NEXT_PUBLIC_APP_URL, session.expiresAt));
  return response;
}