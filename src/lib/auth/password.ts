/**
 * PRIMEMET — password storage.
 *
 * scrypt from `node:crypto`, not a third-party hash. The reasoning is the same one the permission
 * layer uses for HMAC: the primitive is in the runtime, so it cannot be swapped out by a transitive
 * dependency, and there is no native build to fail on a deploy host.
 *
 * Parameters are encoded INTO the stored string (`scrypt$N$r$p$salt$hash`), so a future parameter
 * change verifies old passwords with the parameters they were hashed under instead of locking every
 * existing account out. Nothing here invents a default: a stored record that does not parse is a
 * verification failure, never a pass.
 *
 * scrypt is deliberately slow. `maxmem` is raised because Node's default 32 MB is slightly below
 * 128 * N * r for N=32768, and the failure mode would be a runtime error on login rather than a
 * weaker hash — the one place a "helpful" fallback must never exist.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const MAX_MEM = 128 * 1024 * 1024;
const SALT_BYTES = 16;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Why a password is unacceptable, or `null`.
 *
 * Length plus two character classes is a floor, not a policy that pretends to measure strength: the
 * directive asks for secure storage, and the honest control against guessing is the login rate limit
 * and lockout in the write path. Rejecting a 9-character password is cheap; pretending a password
 * strength meter makes an account safe is not.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password)) return "Password must contain at least one letter.";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
  return null;
}

/** A fresh salted hash. One call per registration or password change; never re-hash an existing hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time verification.
 *
 * A malformed or absent record returns `false`. It must never throw: a login for an unknown user and a
 * login with a corrupt hash have to look identical from outside, or the difference becomes an account
 * oracle.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N < 1024 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 8) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltRaw, "base64url");
    expected = Buffer.from(hashRaw, "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(MAX_MEM, 256 * N * r),
    });
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}