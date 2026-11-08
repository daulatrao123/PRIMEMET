/**
 * PRIMEMET — in-process request throttling.
 *
 * WHAT THIS IS. A fixed-window counter per key, held in module memory. It stops the realistic Phase 1
 * attack — a script guessing one account's password, or one address creating accounts in a loop — and it
 * costs nothing.
 *
 * WHAT IT IS NOT. It is not a distributed limiter. With more than one server instance, each instance
 * counts separately, so the effective limit multiplies by the instance count. That limitation is stated
 * here rather than hidden, and the persistent controls in the login path (`users.failedLoginCount` and
 * `lockedUntil`, in MongoDB) are what survive a restart or a second instance. Phase 1 runs a single
 * application instance; replacing this with a shared store is a deployment step, not a code change that
 * should pretend to already be done.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export interface LimitResult {
  ok: boolean;
  remaining: number;
  /** Milliseconds until the window resets; 0 when allowed. */
  retryAfterMs: number;
}

/** Consume one unit for `key`. A new window starts when the previous one has elapsed. */
export function consume(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();

  // Bound memory: a flood of unique keys must not grow the map without limit. Clearing wholesale is
  // lossy but safe — the counters only ever under-count after a purge, never over-count.
  if (buckets.size > MAX_KEYS) buckets.clear();

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, retryAfterMs: 0 };
}

/** Exposed for tests: forget every counter. */
export function resetLimits(): void {
  buckets.clear();
}

export const LIMITS = {
  /** 10 password attempts per 15 minutes per address+email. */
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  /** 5 registrations per hour per address. */
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
  /** 20 enquiries per hour per user. */
  enquiry: { limit: 20, windowMs: 60 * 60 * 1000 },
  /** 20 listing submissions per hour per seller. */
  listing: { limit: 20, windowMs: 60 * 60 * 1000 },
  /** 30 seller profile writes per hour per seller. */
  sellerProfile: { limit: 30, windowMs: 60 * 60 * 1000 },
  /** 60 privileged admin writes per hour per admin. */
  adminWrite: { limit: 60, windowMs: 60 * 60 * 1000 },
} as const;

/** Human wording for a refusal. Seconds, rounded up, so "0 seconds" can never be shown. */
export function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}