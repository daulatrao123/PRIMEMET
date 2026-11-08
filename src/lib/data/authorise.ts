import type { AuthUser } from "@/lib/auth/session";

/**
 * PRIMEMET — authorisation at the data layer.
 *
 * WHY THIS EXISTS. A route guard protects one URL. It does not protect the function behind it: the next
 * server action, background script or admin route that forgets `requireApi(["ADMIN"])` would call
 * `decideListing()` and approve a seller's listing. The approval decision is the one place where a
 * missing check is unrecoverable in reputation terms, so the decision functions themselves refuse an
 * actor who is not an administrator — defence in depth, not a replacement for the route guard.
 *
 * The actor is always the session identity resolved from the database (`getSessionUser`), never a value
 * taken from a request body.
 */
export class AuthorisationError extends Error {
  constructor(message = "Your account cannot perform this action.") {
    super(message);
    this.name = "AuthorisationError";
  }
}

/** Refuse anyone who is not an active administrator. */
export function requireAdminActor(actor: AuthUser | null | undefined): asserts actor is AuthUser {
  if (!actor) throw new AuthorisationError("Sign in to continue.");
  if (actor.role !== "ADMIN") throw new AuthorisationError("Only a PRIMEMET administrator can perform this action.");
  if (actor.status !== "ACTIVE") throw new AuthorisationError("This administrator account is not active.");
}

/** Refuse anyone who is not an active buyer, and return the organisation they are confined to. */
export function requireBuyerOrganisation(actor: AuthUser | null | undefined): string {
  if (!actor) throw new AuthorisationError("Sign in to continue.");
  if (actor.role !== "BUYER") throw new AuthorisationError("Only a buyer account can perform this action.");
  if (!actor.organisationId) throw new AuthorisationError("This account is not linked to an organisation yet.");
  return actor.organisationId;
}

/** Refuse anyone who is not an active seller, and return their supplier profile. */
export function requireSellerProfile(actor: AuthUser | null | undefined): { organisationId: string; supplierProfileId: string } {
  if (!actor) throw new AuthorisationError("Sign in to continue.");
  if (actor.role !== "SELLER") throw new AuthorisationError("Only a supplier account can perform this action.");
  if (!actor.organisationId || !actor.supplierProfileId) {
    throw new AuthorisationError("This seller account has no supplier profile.");
  }
  return { organisationId: actor.organisationId, supplierProfileId: actor.supplierProfileId };
}
