/**
 * PRIMEMET — who may change access (Phase 1A contracts §2.5, §2.6).
 *
 * THE CONTROL THAT MATTERS IS THE CEILING. `ACCESS_GRANT_PERMISSION` without a ceiling is a superuser
 * token: any holder could grant themselves `DATABASE_APPLY_MIGRATION` and then alter history. With the
 * ceiling, the worst an insider can do is redistribute permissions they already hold — which is exactly
 * what a delegation model is, and no more.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not read the database and it does not accept permissions from a
 * caller's request. `mayGrant` receives an `actorPermissions` set that the **caller resolved server-side
 * from the event log**. That is not a convenience: it is the defence against forged event data. A route
 * that passed `body.permissions` here would compile, pass every unit test below, and be a privilege
 * escalation, so `store.ts` is the only supported caller and it always resolves first.
 *
 * Refusals are named, because "you cannot do that" is not an audit record. Each reason below maps to one
 * rule, and `scripts/check-permissions.mjs` proves every one of them refuses.
 */

import {
  ADMIN_PERMISSIONS,
  isAdminPermission,
  isGrantEffect,
  type AdminPermission,
} from "./types.ts";

/**
 * §2.6 — the permissions that change **who may do things** or **what the record says happened**.
 *
 * Grantable by `SUPER_ADMIN` to another admin, never to self, and never by a non-super tier, regardless
 * of whether that tier otherwise holds them.
 */
export const NON_DELEGABLE: readonly AdminPermission[] = [
  "ACCESS_GRANT_PERMISSION",
  "ACCESS_ASSIGN_ROLE",
  "DATABASE_APPLY_MIGRATION",
  "AUDIT_EXPORT",
];

export type DelegationRefusal =
  | "UNKNOWN_PERMISSION"
  | "UNKNOWN_EFFECT"
  | "ACTOR_NOT_PERMITTED"
  | "SELF_TARGET"
  | "NON_DELEGABLE"
  | "CEILING_EXCEEDED"
  | "TARGET_NOT_ACTIVE"
  | "TARGET_IS_SUPER_ADMIN"
  | "NO_REASON_OR_EXPIRY"
  | "EXPIRY_NOT_IN_FUTURE"
  | "EVENT_ID_REQUIRED";

export interface DelegationTarget {
  /** `admin_profiles._id` of the admin the event is about. */
  profileId: string;
  /** `admin_profiles.isActive`. */
  isActive: boolean;
  /** The target's `users.status === "ACTIVE"` (and not soft-deleted). */
  userIsActive: boolean;
  /** The target's tier, used only for the super-admin protection below. */
  tier: string;
}

export interface DelegationRequest {
  permission: string;
  effect: string;
  reason?: string | null;
  expiresAt?: Date | null;
  eventId?: string | null;
}

export interface DelegationInput {
  /** The actor's **resolved** permissions. Never a client-supplied list. */
  actorPermissions: ReadonlySet<AdminPermission>;
  actorProfileId: string;
  actorTier: string;
  target: DelegationTarget;
  request: DelegationRequest;
  now?: Date;
}

export interface DelegationDecision {
  allowed: boolean;
  refusal: DelegationRefusal | null;
}

function refuse(refusal: DelegationRefusal): DelegationDecision {
  return { allowed: false, refusal };
}

/**
 * May this actor append this event?
 *
 * Order matters for the audit record: identity and shape are checked before authority, and the
 * self-target check precedes the ceiling so that an attempted self-grant is recorded as *that*, not as a
 * generic ceiling failure.
 */
export function mayGrant(input: DelegationInput): DelegationDecision {
  const { actorPermissions, actorProfileId, actorTier, target, request } = input;
  const now = input.now ?? new Date();

  // 1. Shape. An unrecognised permission or effect must never reach the log — the database would refuse
  //    it, and the resolver would then have to explain a row it deliberately ignores.
  if (!isAdminPermission(request.permission)) return refuse("UNKNOWN_PERMISSION");
  if (!isGrantEffect(request.effect)) return refuse("UNKNOWN_EFFECT");

  // 2. Identity: the actor must have been given the right to change access at all.
  if (!actorPermissions.has("ACCESS_GRANT_PERMISSION")) return refuse("ACTOR_NOT_PERMITTED");

  // 3. No self-grant, ever — not even of a permission the actor already holds. Promotion by self-service
  //    is how an insider becomes a superuser without a second person noticing.
  if (actorProfileId === target.profileId) return refuse("SELF_TARGET");

  // 4. The four that change who may do things, or what the record says happened.
  if (NON_DELEGABLE.includes(request.permission) && actorTier !== "SUPER_ADMIN") {
    return refuse("NON_DELEGABLE");
  }

  // 5. Transitive ceiling: you may only redistribute what you hold.
  if (!actorPermissions.has(request.permission)) return refuse("CEILING_EXCEEDED");

  // 6. The target must be able to hold a permission: an active admin with an active user.
  if (!target.isActive || !target.userIsActive) return refuse("TARGET_NOT_ACTIVE");

  // 7. A non-super actor must not be able to alter a super admin's access — including by DENY, which is
  //    the quiet way to remove the person who could revert the change.
  if (target.tier === "SUPER_ADMIN" && actorTier !== "SUPER_ADMIN") {
    return refuse("TARGET_IS_SUPER_ADMIN");
  }

  // 8. A grant is never anonymous: a stated reason, or an expiry that makes it self-limiting.
  const reason = typeof request.reason === "string" ? request.reason.trim() : "";
  const hasExpiry = request.expiresAt instanceof Date && !Number.isNaN(request.expiresAt.getTime());
  if (reason.length === 0 && !hasExpiry) return refuse("NO_REASON_OR_EXPIRY");

  // 9. An expiry in the past is inert on arrival and would silently do nothing.
  if (hasExpiry && (request.expiresAt as Date).getTime() <= now.getTime()) {
    return refuse("EXPIRY_NOT_IN_FUTURE");
  }

  // 10. A retried request must be identifiable as the same request, or it can invert its own outcome.
  const eventId = typeof request.eventId === "string" ? request.eventId.trim() : "";
  if (eventId.length === 0) return refuse("EVENT_ID_REQUIRED");

  return { allowed: true, refusal: null };
}

/**
 * Would this event remove the last way back in?
 *
 * A super admin who DENYs their own `ACCESS_GRANT_PERMISSION` — or a super admin who is the only holder
 * and is denied by another super admin — locks the platform's access model with no in-application path
 * to undo it: the log is append-only, so the *next* event must be written by someone who can still write
 * one. This guard is deliberately separate from `mayGrant` because it needs counts, which are the
 * database's business, not the rule engine's.
 *
 * @param target
 * @param permission        the permission the event concerns
 * @param effect            the requested effect
 * @param remainingHolders  active SUPER_ADMIN profiles holding ACCESS_GRANT_PERMISSION *other than* the
 *                          target, counted by the caller in the same transaction
 */
export function wouldLockOutSuperAdmins(input: {
  target: DelegationTarget;
  permission: string;
  effect: string;
  remainingHolders: number;
}): boolean {
  const { target, permission, effect, remainingHolders } = input;
  if (permission !== "ACCESS_GRANT_PERMISSION") return false;
  if (target.tier !== "SUPER_ADMIN") return false;
  // GRANT only adds a way in; REVOKE returns the admin to the tier default, which for a super admin is
  // this very permission.
  if (effect !== "DENY") return false;
  return remainingHolders <= 0;
}

/** Every permission name, re-exported so a caller need not import the tuple as well. */
export { ADMIN_PERMISSIONS };