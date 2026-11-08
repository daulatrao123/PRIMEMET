/**
 * PRIMEMET — integrity tags on effective permission events (W3 remediation).
 *
 * THE PROBLEM. `admin_permission_grants` is the collection that decides access. A MongoDB document
 * validator sees one document and one document only: it can check that `effect` is GRANT/DENY/REVOKE and
 * that `reason` is non-blank, but it cannot know whether a delegation check ran, who ran it, or whether
 * the row was written by the application at all. The Phase 1 review demonstrated the consequence: a
 * hand-written, schema-conforming insert granting `DATABASE_APPLY_MIGRATION` was accepted by the database
 * and honoured by the resolver. Validation is not authorisation.
 *
 * THE MECHANISM. Every effective row carries a tag — an HMAC over its decision-bearing fields, keyed by a
 * server-side secret (`PERMISSION_LOG_KEY`). The resolver refuses any row whose tag is absent or does not
 * verify. So an ordinary application identity that can write to the collection still cannot create an
 * EFFECTIVE grant: it can produce a row the resolver ignores.
 *
 * WHAT THIS IS NOT. It is tamper-evidence, not access control. It does not stop a write; it makes an
 * unauthorised write inert. Three limits are real and must not be papered over:
 *
 *   1. An identity that holds both the write privilege AND the key can forge a row. Defence against that
 *      is privilege separation, which needs an authenticated server to demonstrate — BLOCKED here.
 *   2. Rotating the key invalidates every existing tag, so rotation is a re-decision, not a config
 *      change: the old rows stop verifying and stop deciding (fail closed), and the intended decisions
 *      must be re-established by appending new events. The log is append-only, so nothing can be
 *      re-signed in place. `scripts/audit-permission-integrity.mjs` reports the state of every row.
 *   3. Without the key configured, verification is DISABLED — see `verifyEventIntegrity`, which reports
 *      `UNKEYED` rather than pretending the row is sound.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Bumping this invalidates every existing tag, exactly as a key rotation does. */
const TAG_VERSION = "v1";

/** The row shape the tag covers. Deliberately structural: any object with these fields will do. */
export interface TaggedEvent {
  adminId: unknown;
  permission: unknown;
  effect: unknown;
  seq: unknown;
  eventId: unknown;
  grantedById: unknown;
  reason: unknown;
  expiresAt: unknown;
  createdAt: unknown;
}

/**
 * Milliseconds for an instant, or `-` when absent.
 *
 * The tag must not depend on whether the driver handed back a `Date` or the ISO string it serialises to,
 * so both are canonicalised. An absent instant is a distinct value from the epoch.
 */
function instant(value: unknown): string {
  if (value === null || value === undefined) return "-";
  const date = value instanceof Date ? value : new Date(String(value));
  const ms = date.getTime();
  return Number.isNaN(ms) ? "-" : String(ms);
}

/**
 * The exact bytes that are signed.
 *
 * Field order is fixed and every field is length-prefixed, so no rearrangement of values can produce the
 * same canonical string. A `|` separator alone would be forgeable: a permission containing a pipe could
 * shift the boundary into the next field.
 */
function canonical(event: TaggedEvent): string {
  const parts = [
    TAG_VERSION,
    String(event.adminId ?? ""),
    String(event.permission ?? ""),
    String(event.effect ?? ""),
    String(event.seq ?? ""),
    String(event.eventId ?? ""),
    String(event.grantedById ?? ""),
    String(event.reason ?? ""),
    instant(event.expiresAt),
    instant(event.createdAt),
  ];
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

/** The tag for one event under one key. Deterministic: the same row always produces the same tag. */
export function integrityTag(event: TaggedEvent, key: string): string {
  return createHmac("sha256", key).update(canonical(event), "utf8").digest("hex");
}

export type IntegrityVerdict =
  /** The tag verifies against this key. */
  | "VALID"
  /** No key is configured, so nothing can be verified. Reported, never treated as VALID. */
  | "UNKEYED"
  /** The row carries no tag at all — it was not written by the signing path. */
  | "MISSING"
  /** A tag is present and does not verify. */
  | "INVALID";

/**
 * Verify one row.
 *
 * Deliberately returns a named verdict rather than a boolean: "no tag" and "wrong tag" are different
 * findings for an operator, and "no key" must never be silently reported as sound.
 */
export function verifyEventIntegrity(event: TaggedEvent, key: string | null | undefined): IntegrityVerdict {
  if (!key) return "UNKEYED";
  const stored = (event as { integrity?: unknown }).integrity;
  if (typeof stored !== "string" || stored.length === 0) return "MISSING";
  const expected = integrityTag(event, key);
  // Constant-time comparison. The comparison is not a secret-dependent branch on attacker-controlled
  // length, because both sides are fixed-width hex of the same algorithm.
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return "INVALID";
  return timingSafeEqual(a, b) ? "VALID" : "INVALID";
}

/** Structural check used by the write path before it signs. */
export function assertSignable(event: TaggedEvent): void {
  for (const field of ["adminId", "permission", "effect", "eventId", "grantedById"] as const) {
    if (typeof event[field] !== "string" || (event[field] as string).length === 0) {
      throw new Error(`integrity: ${field} must be a non-empty string to sign a permission event`);
    }
  }
}
