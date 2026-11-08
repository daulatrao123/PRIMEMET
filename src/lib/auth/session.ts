/**
 * PRIMEMET — server-side sessions.
 *
 * A session is a row in `sessions` plus a signed cookie. The cookie carries an opaque 256-bit token;
 * the database stores only its SHA-256. That asymmetry is deliberate: a leaked database dump cannot be
 * replayed as a login, and a revoked session stops working on the next request because the lookup is by
 * hash and `revokedAt` is checked every time.
 *
 * ## Why the organisation is resolved on every request
 *
 * A buyer may only read their own organisation's enquiries (`buyerOrganisationId` filter), and the
 * organisation must come from the server's records, never from a form field, a query parameter or a
 * cookie claim. `getSessionUser()` therefore joins the user to its profile and organisation here, once
 * per request (memoised with React `cache`), and every data helper takes the resulting ids. A buyer
 * cannot widen their scope by editing the request.
 *
 * ## Fail-closed states
 *
 * Missing `AUTH_SECRET` disables sessions entirely rather than issuing unsigned cookies. A user whose
 * status is not ACTIVE is refused even if their cookie is valid — that is what makes "seller remains
 * pending until admin approval" survive an approval reversal or a suspension.
 */

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";

import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { SESSION_COOKIE, cookieOptions, readClaims, signClaims } from "./cookie";
import { keyedHash, sha256Hex } from "./hashing";
import { homeForRole, type Role } from "./roles";

export type { Role };
export { homeForRole };

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: string;
  /** Buyer/seller organisation, resolved server-side. `null` for an admin. */
  organisationId: string | null;
  organisationName: string | null;
  organisationStatus: string | null;
  buyerProfileId: string | null;
  supplierProfileId: string | null;
}

export interface SessionUserRecord {
  _id: string;
  email: string;
  passwordHash?: string;
  fullName: string;
  role: Role;
  status: string;
  failedLoginCount?: number;
  lockedUntil?: Date | null;
}

/** 7 days. A shorter lifetime would log an active buyer out mid-enquiry; longer buys nothing. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Why authentication cannot run, or `null` when it can.
 *
 * Returned rather than thrown so a page can render a specific message ("this deployment has no
 * AUTH_SECRET") instead of a 500. The login route refuses with 503 in that state — it never issues a
 * cookie it cannot sign.
 */
export function authConfigurationProblem(): string | null {
  if (!env.MONGODB_URI) {
    return "This deployment has no database configured, so accounts cannot be used yet.";
  }
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    return "AUTH_SECRET is not configured (it must be at least 32 characters), so sign-in is disabled.";
  }
  return null;
}

function secret(): string {
  const value = env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not configured");
  return value;
}

/**
 * Issue a session and return the value to set as the cookie.
 *
 * The caller sets the cookie on the response — this function does not touch `cookies()`, because a
 * route handler must set the header on the response it returns, not on the incoming request.
 */
export async function createSession(
  user: { id: string; role: Role },
  context: { ip: string | null; userAgent: string | null },
): Promise<{ value: string; expiresAt: Date }> {
  const db = await getDb();
  const tokenId = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db.collection("sessions").insertOne({
    _id: randomUUID(),
    userId: user.id,
    tokenHash: sha256Hex(tokenId),
    roleAtIssue: user.role,
    ipHash: context.ip ? keyedHash(context.ip, secret()) : null,
    userAgentHash: context.userAgent ? keyedHash(context.userAgent, secret()).slice(0, 32) : null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    revokedAt: null,
    revokedReason: null,
  });

  const value = await signClaims({ tokenId, role: user.role, expiresAt: expiresAt.getTime() }, secret());
  return { value, expiresAt };
}

/** Revoke the session named by the current cookie. Idempotent: an unknown cookie is a no-op. */
export async function revokeCurrentSession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw || !env.AUTH_SECRET) return;
  const claims = await readClaims(raw, env.AUTH_SECRET);
  if (!claims) return;

  const db = await getDb();
  await db
    .collection("sessions")
    .updateOne(
      { tokenHash: sha256Hex(claims.tokenId), revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: "logout" } },
    );
}

interface ProfileLink {
  organisationId: string | null;
  buyerProfileId: string | null;
  supplierProfileId: string | null;
}

async function resolveProfile(userId: string, role: Role): Promise<ProfileLink> {
  const empty: ProfileLink = { organisationId: null, buyerProfileId: null, supplierProfileId: null };
  if (role === "ADMIN") return empty;

  const db = await getDb();
  const collection = role === "BUYER" ? "buyer_profiles" : "supplier_profiles";
  const profile = await db.collection(collection).findOne<{ _id: string; organisationId?: string }>(
    { userId },
    { projection: { _id: 1, organisationId: 1 } },
  );
  if (!profile) return empty;

  return {
    organisationId: profile.organisationId ?? null,
    buyerProfileId: role === "BUYER" ? profile._id : null,
    supplierProfileId: role === "SELLER" ? profile._id : null,
  };
}

/**
 * The authenticated user for this request, or `null`.
 *
 * Memoised per request: a layout and the page inside it share one session lookup rather than issuing
 * three identical queries. It is explicitly NOT memoised across requests — revocation must take effect
 * on the next one.
 */
export const getSessionUser = cache(async (): Promise<AuthUser | null> => {
  if (authConfigurationProblem()) return null;

  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    // `cookies()` outside a request (a build-time render of a dynamic page) has no session.
    return null;
  }
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const claims = await readClaims(raw, env.AUTH_SECRET);
  if (!claims) return null;

  const db = await getDb();
  const session = await db.collection("sessions").findOne<{
    _id: string;
    userId: string;
    expiresAt: Date;
    revokedAt?: Date | null;
    lastSeenAt?: Date;
  }>(
    { tokenHash: sha256Hex(claims.tokenId), revokedAt: null },
    { projection: { _id: 1, userId: 1, expiresAt: 1, revokedAt: 1, lastSeenAt: 1 } },
  );
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;

  const user = await db.collection("users").findOne<SessionUserRecord>(
    { _id: session.userId },
    {
      projection: {
        _id: 1,
        email: 1,
        fullName: 1,
        role: 1,
        status: 1,
      },
    },
  );
  // A suspended, disabled or still-pending account is refused even with a valid cookie.
  if (!user || user.status !== "ACTIVE") return null;
  if (user.role !== claims.role) return null;

  const link = await resolveProfile(user._id, user.role);

  let organisationName: string | null = null;
  let organisationStatus: string | null = null;
  if (link.organisationId) {
    const organisation = await db.collection("organisations").findOne<{
      legalName: string;
      accountStatus: string;
    }>(
      { _id: link.organisationId },
      { projection: { legalName: 1, accountStatus: 1 } },
    );
    if (organisation) {
      organisationName = organisation.legalName;
      organisationStatus = organisation.accountStatus;
    }
  }

  // Sliding "last seen", written at most every five minutes so a dashboard refresh is not a write storm.
  const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
  if (Date.now() - lastSeen > 5 * 60 * 1000) {
    await db
      .collection("sessions")
      .updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  return {
    id: user._id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    organisationId: link.organisationId,
    organisationName,
    organisationStatus,
    buyerProfileId: link.buyerProfileId,
    supplierProfileId: link.supplierProfileId,
  };
});

export { SESSION_COOKIE, cookieOptions };