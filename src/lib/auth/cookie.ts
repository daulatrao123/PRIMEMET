/**
 * PRIMEMET — the session cookie, verified without a database.
 *
 * WHY THIS MODULE IS SEPARATE FROM session.ts. Middleware runs before any page or route handler and
 * must answer one question cheaply: "is this request carrying a session this server issued, and for
 * which role?" It cannot open a MongoDB connection — middleware runs on every admin/buyer/seller
 * request and an edge runtime has no Node driver. So the cookie is *signed*, and middleware checks the
 * signature; the server then checks the session against the database, where revocation and expiry are
 * authoritative.
 *
 * The two checks are not redundant, and the distinction matters:
 *
 *   - The signature proves the cookie was minted by this deployment. Without it, a hand-written
 *     `pm_session` cookie naming role=ADMIN would be enough to pass middleware.
 *   - The database lookup proves the session still exists, has not been revoked and has not expired.
 *     A signed cookie from a logged-out session fails this second check.
 *
 * Only the second check decides authorisation. `role` inside the cookie is a routing hint so a buyer
 * hitting /admin is redirected to their own dashboard instead of a login page; every page and API
 * re-derives the role from the database row and refuses a mismatch.
 *
 * Web Crypto (`globalThis.crypto.subtle`) is used rather than `node:crypto` so the identical code runs
 * in middleware and in route handlers. Node 18+ and every supported edge runtime provide it.
 */

import type { Role } from "./roles";

export const SESSION_COOKIE = "pm_session";
export const SESSION_COOKIE_VERSION = "v1";

export type SessionRole = Role;

export interface SessionClaims {
  /** Opaque 256-bit identifier. The database stores only its SHA-256, never the value itself. */
  tokenId: string;
  role: SessionRole;
  /** Unix milliseconds. */
  expiresAt: number;
}

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64url(signature);
}

/** Length-safe comparison. Both sides are fixed-width base64url of the same HMAC, but the loop does
 *  not exit early, so a mismatch position is not observable through timing. */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/** Serialise and sign. Returns the exact cookie value; the caller sets it on the response. */
export async function signClaims(claims: SessionClaims, secret: string): Promise<string> {
  const payload = `${SESSION_COOKIE_VERSION}.${claims.tokenId}.${claims.role}.${claims.expiresAt}`;
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

/**
 * Verify a cookie value.
 *
 * Returns `null` for anything that is not a live, correctly signed claim: wrong version, unknown role,
 * expired, truncated or tampered. There is no "trust the payload anyway" branch — the expiry is checked
 * here as well as in the database so an expired cookie never reaches a query.
 */
export async function readClaims(
  value: string | undefined | null,
  secret: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!value || !secret) return null;

  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [version, tokenId, roleRaw, expiresRaw, signature] = parts;
  if (version !== SESSION_COOKIE_VERSION) return null;
  if (roleRaw !== "ADMIN" && roleRaw !== "BUYER" && roleRaw !== "SELLER") return null;
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(tokenId)) return null;
  if (!/^[0-9]{13}$/.test(expiresRaw)) return null;
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(signature)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const expected = await hmac(secret, `${version}.${tokenId}.${roleRaw}.${expiresRaw}`);
  if (!equalConstantTime(signature, expected)) return null;

  return { tokenId, role: roleRaw, expiresAt };
}

/** Cookie attributes. `httpOnly` keeps the token out of JavaScript; `lax` blocks cross-site POSTs
 *  from carrying it; `secure` is added whenever the site origin is https. */
export function cookieOptions(siteUrl: string | undefined, expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: Boolean(siteUrl && siteUrl.startsWith("https://")),
    path: "/",
    expires: expiresAt,
  };
}