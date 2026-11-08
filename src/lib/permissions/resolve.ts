/**
 * PRIMEMET — permission resolution. D-ARCH-12, owner-approved 2026-11-01.
 *
 * THE RULE, in one sentence: **the newest applicable, non-expired event decides; if it is a REVOKE, or
 * there is no applicable event at all, the admin tier default decides.**
 *
 * That is latest-event-wins, and it is deliberately *not* deny-wins. The superseded design treated a
 * DENY as absolute and gave a temporary denial the power to become a permanent one; §2.4 of the Phase 1A
 * contracts shows the two rows that decided the question. Expiry makes an event **inert**, not negative,
 * so resolution falls through to the newest event that is still valid.
 *
 * WHY THIS IS A PURE FUNCTION. Resolution is evaluated in three places that must agree: the request
 * guard, the admin screen that explains an access decision, and the tests. If it read the database
 * itself, the screen would be explaining a calculation the guard did not perform. So it takes a snapshot
 * of rows and an instant, and returns a decision with its provenance — never a bare boolean, because an
 * access review must be able to say *which event* allowed or refused.
 *
 * It is also cheap to call per request: the caller supplies rows it already has, and caching across
 * requests would let a new DENY take effect late, which is the one thing §2.4 exists to prevent.
 */

import { tierDefault } from "./tiers.ts";
import {
  ADMIN_PERMISSIONS,
  isAdminTier,
  isGrantEffect,
  type AdminActor,
  type AdminPermission,
  type GrantEffect,
} from "./types.ts";
import { verifyEventIntegrity, type TaggedEvent } from "./integrity.ts";
import { permissionIntegrityPosture } from "../env.ts";

/** Why no permission was returned at all. Every value is a fail-closed outcome. */
export type DenialReason =
  | "NO_ACTOR"
  | "NOT_ADMIN_ROLE"
  | "USER_NOT_ACTIVE"
  | "USER_DELETED"
  | "NO_ADMIN_PROFILE"
  | "PROFILE_INACTIVE"
  | "NO_ORGANISATION"
  | "ORGANISATION_NOT_ACTIVE"
  | "UNKNOWN_TIER";

/** What decided one permission. `decidedBy` is the part an access review needs. */
export interface PermissionDecision {
  allowed: boolean;
  /**
   * What decided this permission.
   *
   * INVALID is the W1 remediation: an *applicable* event carried an effect this system does not
   * recognise, so the permission is REFUSED. It is not NONE (nothing applied) and it is not REVOKE (the
   * override was withdrawn by an administrator). Silently reinterpreting a corrupt row as a REVOKE would
   * restore a tier default nobody asked for; treating it as absent would let an older GRANT, or the
   * tier, decide — which is exactly what the Phase 1 review found.
   */
  effect: GrantEffect | "NONE" | "INVALID";
  /** The event that decided it, or `null` when no event was applicable. */
  eventId: string | null;
  /**
   * `EVENT` when an explicit GRANT or DENY decided, `TIER_DEFAULT` when the tier decided — either
   * because nothing applied, because the newest event was a REVOKE, or because the only applicable
   * events had an effect this resolver does not recognise.
   */
  decidedBy: "EVENT" | "TIER_DEFAULT" | "INVALID_EVENT";
  /**
   * Event ids whose effect was not recognised, newest first. Retained for the access-review screen: a
   * refused permission must be explainable, and "an administrator's DENY was corrupted" is a different
   * story from "no event applied". Since W1 these rows also DECIDE (they deny), so this list is evidence
   * rather than a skip-log.
   */
  ignoredEvents: string[];
}

export interface Resolution {
  /** The permissions the actor holds. Never mutate: callers get a fresh set. */
  allowed: ReadonlySet<AdminPermission>;
  /** Per-permission provenance, for the four reasons above. */
  decisions: ReadonlyMap<AdminPermission, PermissionDecision>;
  /** `null` when the actor passed every gate; otherwise the gate that refused them. */
  deniedAt: DenialReason | null;
  /**
   * Every stored event that could not be interpreted. Non-empty means the permission log needs an
   * operator, even though every affected permission was refused rather than granted.
   */
  integrityDiagnostics: readonly IntegrityDiagnostic[];
}

/**
 * A stored permission event this system cannot interpret, reported rather than swallowed.
 *
 * The diagnostic exists so corruption is visible to an operator. A permission that is quietly denied is
 * safe but silent, and silence is how a mistyped DENY sat undetected in the log.
 */
export interface IntegrityDiagnostic {
  /** Which permission the event claimed to decide. */
  permission: string;
  /** The event's idempotency key, when it had one — the handle an investigation needs. */
  eventId: string | null;
  /** The stored value that could not be interpreted. Null when the field was absent. */
  effect: unknown;
  /** EFFECT_NOT_RECOGNISED today; INTEGRITY_INVALID is reserved for a MAC failure. */
  reason: "EFFECT_NOT_RECOGNISED" | "INTEGRITY_INVALID";
  /** True when the event was applicable and therefore refused its permission. */
  decisive: boolean;
}

/** An empty resolution, for a refusal at any gate. */
function refuse(reason: DenialReason): Resolution {
  const decisions = new Map<AdminPermission, PermissionDecision>();
  for (const permission of ADMIN_PERMISSIONS) {
    decisions.set(permission, {
      allowed: false,
      effect: "NONE",
      eventId: null,
      decidedBy: "TIER_DEFAULT",
      ignoredEvents: [],
    });
  }
  return { allowed: new Set(), decisions, deniedAt: reason, integrityDiagnostics: [] };
}

/** Milliseconds since the epoch, from a Date or an ISO string. `null` when unusable. */
function timeOf(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * The sequence number as a BigInt.
 *
 * BSON `long` arrives as a `Long` instance whose `toBigInt()` keeps full precision; a JS `number` would
 * round above 2^53 and make two distinct events compare equal. Anything unparseable sorts *lowest*,
 * so a malformed row loses to a well-formed one instead of winning the tiebreak.
 */
function seqOf(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (value && typeof (value as { toBigInt?: unknown }).toBigInt === "function") {
    try {
      return (value as { toBigInt(): bigint }).toBigInt();
    } catch {
      return -1n;
    }
  }
  if (value && typeof (value as { toString?: unknown }).toString === "function") {
    const text = String(value);
    if (/^-?\d+$/.test(text)) return BigInt(text);
  }
  return -1n;
}

/**
 * Newest first: `(createdAt DESC, seq DESC)`.
 *
 * The sequence number exists for one reason — two appends can share a millisecond, and without a
 * tiebreaker the same input could resolve two ways depending on index order. A non-deterministic
 * authorisation decision is a security defect, not a flaky test.
 */
function compareNewestFirst(a: { createdAt: number; seq: bigint }, b: { createdAt: number; seq: bigint }): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.seq !== b.seq) return a.seq > b.seq ? -1 : 1;
  return 0;
}

/**
 * The gate sequence from §2.3, in the order the contract states.
 *
 * Every branch returns a *reason*, because "you are not signed in" and "your organisation is suspended"
 * are different answers to the person affected, and collapsing them into one empty set hides a
 * misconfiguration behind a permission error.
 */
export function actorDenial(actor: AdminActor | null | undefined): DenialReason | null {
  if (!actor) return "NO_ACTOR";

  const user = actor.user;
  if (!user) return "NO_ACTOR";
  // A BUYER or SELLER session holds no admin permission, whatever else is true of it.
  if (user.role !== "ADMIN") return "NOT_ADMIN_ROLE";
  if (user.status !== "ACTIVE") return "USER_NOT_ACTIVE";
  if (user.deletedAt !== null && user.deletedAt !== undefined) return "USER_DELETED";

  const profile = actor.profile;
  // role=ADMIN with no profile row is a misconfiguration, not an approver.
  if (!profile) return "NO_ADMIN_PROFILE";
  if (profile.isActive !== true) return "PROFILE_INACTIVE";
  if (typeof profile.id !== "string" || profile.id.length === 0) return "NO_ADMIN_PROFILE";

  const org = actor.org;
  if (!org) return "NO_ORGANISATION";
  // Suspension must reach the staff too. The contract's line reads "org is absent or orgKind != PRIMEMET
  // and accountStatus != ACTIVE"; read literally that would let a suspended non-PRIMEMET org through
  // (AND binds tighter than OR). The reading implemented here: the PRIMEMET organisation is the platform
  // itself and is never barred by its own account status; every other organisation must be ACTIVE.
  if (org.orgKind !== "PRIMEMET" && org.accountStatus !== "ACTIVE") return "ORGANISATION_NOT_ACTIVE";

  return null;
}

/**
 * Resolve every permission for one actor at one instant.
 *
 * @param actor   the identity facts, loaded server-side. Never trusted from a request body.
 * @param events  rows from `admin_permission_grants` for this admin; any order is accepted
 * @param now     the authorisation instant — expiry is evaluated here, not when the row was written
 */
export interface ResolveOptions {
  /**
   * The key used to verify each event's integrity tag (W3 remediation).
   *
   * When supplied, a row whose tag is MISSING or does not verify is treated exactly like an
   * unrecognised effect: it denies the permission it claims to decide, and it is reported. When omitted,
   * verification is disabled — the posture for unit tests and for a deployment that has not yet been
   * provisioned with a key. Omission is never reported as sound: no row is marked VALID, and the caller
   * gets `integrityDiagnostics: []` because nothing was checkable, not because nothing was wrong.
   *
   * P2 changed what "omitted" means in production. `UNKEYED` used to be the one verdict that did not
   * fail, so an unkeyed production deployment honoured a hand-written, validator-conforming GRANT — W3.3.
   * It is now a failure in production; see `requireIntegrity`.
   */
  integrityKey?: string | null;
  /**
   * Treat `UNKEYED` as a failed integrity tag.
   *
   * Defaults to `permissionIntegrityPosture() === "production"`: production when `PRIMEMET_ENV=production`,
   * or when `PRIMEMET_ENV` is undeclared and `NODE_ENV=production` (F-2b) — so a production process that
   * never declared its environment still refuses an unsigned permission event. `env.ts` independently
   * refuses database access without the key, and `check:env-blank` asserts that; this option is the
   * defence in depth for a caller that reaches the resolver by another route.
   *
   * Outside production `UNKEYED` is tolerated, so staging and development honour unsigned rows (F-5).
   * That is deliberate — local work needs to run without a key — but it means a pre-production
   * environment does not exercise the production posture, and must not be described as if it did.
   *
   * Left overridable so the test suites can exercise both postures in one process without mutating
   * `process.env`.
   */
  requireIntegrity?: boolean;
}

export function resolveAdminPermissions(
  actor: AdminActor | null | undefined,
  events: readonly unknown[],
  now: Date = new Date(),
  options: ResolveOptions = {},
): Resolution {
  const deniedAt = actorDenial(actor);
  if (deniedAt !== null) return refuse(deniedAt);

  const tier = actor?.profile?.tier ?? "";
  const nowMs = now.getTime();
  const adminId = actor?.profile?.id;

  // P2. In production an unverifiable row must not decide access, and "no key configured" is exactly the
  // condition W3.3 exploited. Resolved once per call rather than per row so the posture cannot vary
  // within a resolution.
  const requireIntegrity = options.requireIntegrity ?? permissionIntegrityPosture() === "production";

  // 2. Project the explicit events: only rows for this admin, already in force at `now`, and not expired.
  type Candidate = {
    permission: string;
    effect: unknown;
    eventId: string;
    createdAt: number;
    seq: bigint;
    /** False when the row cannot be trusted to AUTHORISE anything: bad effect, or a failed integrity tag. */
    interpretable: boolean;
    invalidReason: "EFFECT_NOT_RECOGNISED" | "INTEGRITY_INVALID" | null;
  };

  const candidates: Candidate[] = [];
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.adminId !== adminId) continue;
    if (typeof row.permission !== "string") continue;

    const createdAt = timeOf(row.createdAt as Date | string | null);
    // A row with no usable createdAt cannot be ordered, so it cannot be trusted to decide anything.
    if (createdAt === null || createdAt > nowMs) continue;

    const expiresAt = timeOf(row.expiresAt as Date | string | null);
    // Inert, not negative: an expired row simply does not apply.
    if (expiresAt !== null && expiresAt <= nowMs) continue;
    if (row.expiresAt !== null && row.expiresAt !== undefined && expiresAt === null) continue;

    const verdict = verifyEventIntegrity(row as unknown as TaggedEvent, options.integrityKey ?? null);
    const integrityFailed =
      verdict === "MISSING" || verdict === "INVALID" || (verdict === "UNKEYED" && requireIntegrity);
    candidates.push({
      permission: row.permission,
      effect: row.effect,
      eventId: typeof row.eventId === "string" ? row.eventId : "",
      createdAt,
      seq: seqOf(row.seq),
      interpretable: isGrantEffect(row.effect) && !integrityFailed,
      invalidReason: integrityFailed
        ? "INTEGRITY_INVALID"
        : isGrantEffect(row.effect)
          ? null
          : "EFFECT_NOT_RECOGNISED",
    });
  }

  candidates.sort(compareNewestFirst);

  const decisions = new Map<AdminPermission, PermissionDecision>();
  for (const permission of ADMIN_PERMISSIONS) {
    decisions.set(permission, {
      allowed: false,
      effect: "NONE",
      eventId: null,
      decidedBy: "TIER_DEFAULT",
      ignoredEvents: [],
    });
  }

  // The newest *applicable* event per permission wins, and is then frozen: an older GRANT beneath a newer
  // DENY is not consulted, which is what makes the decision order-dependent instead of set-dependent.
  //
  // W1 REMEDIATION. An unrecognised effect is no longer skipped. Skipping made a corrupt row WEAKER THAN
  // NO ROW AT ALL: the older GRANT beneath it, or the tier default, decided instead, so damaging the log
  // could broaden access. The newest applicable row now wins whether or not it can be interpreted, and an
  // uninterpretable one refuses the permission (see the decision branch below).
  const newest = new Map<string, Candidate>();
  const ignored = new Map<string, string[]>();
  const diagnostics: IntegrityDiagnostic[] = [];
  for (const candidate of candidates) {
    if (!newest.has(candidate.permission)) newest.set(candidate.permission, candidate);
    if (!candidate.interpretable) {
      const list = ignored.get(candidate.permission) ?? [];
      if (candidate.eventId) list.push(candidate.eventId);
      ignored.set(candidate.permission, list);
      diagnostics.push({
        permission: candidate.permission,
        eventId: candidate.eventId === "" ? null : candidate.eventId,
        effect: candidate.effect,
        reason: candidate.invalidReason ?? "EFFECT_NOT_RECOGNISED",
        decisive: newest.get(candidate.permission) === candidate,
      });
    }
  }

  const allowed = new Set<AdminPermission>();
  for (const permission of ADMIN_PERMISSIONS) {
    const skips = ignored.get(permission) ?? [];
    const winner = newest.get(permission);
    const fallback = tierDefault(tier, permission);

    let decision: PermissionDecision;
    if (!winner) {
      // No applicable event: the tier default decides. This is also the REVOKE destination below.
      decision = {
        allowed: fallback,
        effect: "NONE",
        eventId: null,
        decidedBy: "TIER_DEFAULT",
        ignoredEvents: skips,
      };
    } else if (!winner.interpretable) {
      // W1 + W3: the newest applicable event cannot be trusted to authorise anything — its effect is not
      // one this system issues, or its integrity tag does not verify. Refusing is the only safe reading,
      // whichever of the two it is; the diagnostic distinguishes them for the operator.
      decision = {
        allowed: false,
        effect: "INVALID",
        eventId: winner.eventId,
        decidedBy: "INVALID_EVENT",
        ignoredEvents: skips,
      };
    } else if (winner.effect === "GRANT") {
      decision = {
        allowed: true,
        effect: "GRANT",
        eventId: winner.eventId,
        decidedBy: "EVENT",
        ignoredEvents: skips,
      };
    } else if (winner.effect === "DENY") {
      decision = {
        allowed: false,
        effect: "DENY",
        eventId: winner.eventId,
        decidedBy: "EVENT",
        ignoredEvents: skips,
      };
    } else if (winner.effect === "REVOKE") {
      // REVOKE: the explicit override is withdrawn, so the tier default governs again.
      decision = {
        allowed: fallback,
        effect: "REVOKE",
        eventId: winner.eventId,
        decidedBy: "TIER_DEFAULT",
        ignoredEvents: skips,
      };
    } else {
      // W1: the newest applicable event cannot be interpreted, so nothing authorises this permission.
      // Refusing is the only safe reading — the log is damaged in the one place that decides access.
      decision = {
        allowed: false,
        effect: "INVALID",
        eventId: winner.eventId,
        decidedBy: "INVALID_EVENT",
        ignoredEvents: skips,
      };
    }

    decisions.set(permission, decision);
    if (decision.allowed) allowed.add(permission);
  }

  // An unknown tier grants nothing (see `tierDefault`), and saying so is more useful than an empty set
  // that looks like a permissions problem.
  //
  // The per-permission records are rewritten too (defect A-6, found by independent acceptance): returning
  // an empty `allowed` set beside `decisions` entries that still said `allowed: true` made the access
  // review contradict the guard. The provenance is kept — an event did decide — but nothing may read as
  // granted when the set is empty.
  if (!isAdminTier(tier)) {
    for (const [permission, decision] of decisions) {
      decisions.set(permission, { ...decision, allowed: false });
    }
    return { allowed: new Set(), decisions, deniedAt: "UNKNOWN_TIER", integrityDiagnostics: diagnostics };
  }

  return { allowed, decisions, deniedAt: null, integrityDiagnostics: diagnostics };
}

/** One permission, resolved. The convenience form used by route guards. */
export function resolvePermission(
  actor: AdminActor | null | undefined,
  events: readonly unknown[],
  permission: AdminPermission,
  now: Date = new Date(),
): PermissionDecision {
  const resolution = resolveAdminPermissions(actor, events, now);
  return (
    resolution.decisions.get(permission) ?? {
      allowed: false,
      effect: "NONE",
      eventId: null,
      decidedBy: "TIER_DEFAULT",
      ignoredEvents: [],
    }
  );
}