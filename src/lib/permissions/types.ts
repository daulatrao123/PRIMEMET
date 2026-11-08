/**
 * PRIMEMET — the permission vocabulary the resolver reads, and the shapes it reads it from.
 *
 * WHY THE LIST IS WRITTEN OUT. The 74 values already exist in `db/enums.mjs` (generated from
 * `prisma/schema.prisma`), which is what the *database* enforces. TypeScript cannot derive a union type
 * from a generated `.mjs` file without losing strictness, so the tuple is declared here and
 * `scripts/check-permissions.mjs` asserts it is **identical, in order**, to `ENUMS.AdminPermission`.
 * A drifted copy therefore fails a check rather than silently changing what the app believes.
 *
 * `GrantEffect` is the one value set Prisma does not declare; it lives in `db/enums-local.mjs` and is
 * repeated here for the same reason, checked the same way.
 */

/** Every admin permission, in the canonical order of `AdminPermission` in the enum file. */
export const ADMIN_PERMISSIONS = [
  "ENQUIRY_VIEW",
  "ENQUIRY_CREATE",
  "ENQUIRY_EDIT",
  "ENQUIRY_CANCEL",
  "ENQUIRY_ASSIGN",
  "ENQUIRY_CLOSE",
  "QUOTE_VIEW",
  "QUOTE_PREPARE",
  "QUOTE_SUBMIT_FOR_APPROVAL",
  "QUOTE_APPROVE",
  "QUOTE_SEND",
  "QUOTE_REVISE",
  "SUPPLIER_QUOTE_REQUEST",
  "SUPPLIER_QUOTE_VIEW",
  "SUPPLIER_QUOTE_COMPARE",
  "LOT_VIEW",
  "LOT_CREATE",
  "LOT_EDIT_DECLARATION",
  "LOT_SCHEDULE_INSPECTION",
  "LOT_RECORD_INSPECTION",
  "LOT_AUTHORISE_DISPATCH",
  "LOT_OVERRIDE_GATE",
  "LOT_CLOSE",
  "APPROVAL_REQUEST",
  "APPROVAL_RECORD",
  "REJECTION_RAISE",
  "REJECTION_RESOLVE",
  "REJECTION_MANAGE_DISPUTE",
  "REJECTION_PREPARE_SETTLEMENT",
  "REJECTION_APPROVE_SETTLEMENT",
  "CONTACT_VIEW_RESTRICTED",
  "CONTACT_APPROVE_SHARE",
  "CATALOGUE_VIEW",
  "CATALOGUE_EDIT",
  "CATALOGUE_PUBLISH",
  "CATALOGUE_EDIT_COMPOSITION",
  "CATALOGUE_APPROVE_COMPOSITION",
  "PRICING_EDIT",
  "PRICING_APPROVE",
  "PRICING_VIEW_INTERNAL",
  "TAX_EDIT",
  "TAX_APPROVE",
  "TAX_VIEW_SNAPSHOT",
  "INVOICE_VIEW",
  "INVOICE_ISSUE",
  "DOCUMENT_VIEW_INTERNAL",
  "DOCUMENT_UPLOAD",
  "AUDIT_VIEW",
  "AUDIT_EXPORT",
  "REPORT_VIEW",
  "USER_VIEW",
  "USER_INVITE",
  "USER_SUSPEND",
  "ACCESS_ASSIGN_ROLE",
  "ACCESS_GRANT_PERMISSION",
  "SEO_EDIT",
  "SEO_PUBLISH",
  "CONTENT_GENERATE",
  "CONTENT_REVIEW",
  "REDIRECT_MANAGE",
  "PARTY_VIEW",
  "PARTY_EDIT",
  "PARTY_VERIFY",
  "PARTY_SUSPEND",
  "ORDER_VIEW",
  "ORDER_EDIT",
  "ORDER_CANCEL",
  "NOTIFICATION_VIEW",
  "NOTIFICATION_RETRY",
  "DATABASE_VIEW_STATUS",
  "DATABASE_VIEW_MIGRATIONS",
  "DATABASE_VIEW_HISTORY",
  "DATABASE_APPLY_MIGRATION",
  "DATABASE_VIEW_BACKUP_STATUS",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** The four staff tiers. A tier is a *default* authorisation layer, not a grant row (D-ARCH-12). */
export const ADMIN_TIERS = [
  "SUPER_ADMIN",
  "SOURCING_OPS_ADMIN",
  "CATALOGUE_MANAGER",
  "READ_ONLY_ADMIN",
] as const;

export type AdminTier = (typeof ADMIN_TIERS)[number];

/**
 * D-ARCH-12. GRANT and DENY are explicit overrides; REVOKE removes the override so the tier default
 * decides again. A value outside this set is never interpreted as a permission decision.
 */
export const GRANT_EFFECTS = ["GRANT", "DENY", "REVOKE"] as const;

export type GrantEffect = (typeof GRANT_EFFECTS)[number];

/** A row of `admin_permission_grants`, as the resolver needs it. */
export interface PermissionEventRow {
  /** Document id. Present on rows read from the database; unused by resolution. */
  _id?: unknown;
  adminId: string;
  permission: string;
  /** Untyped on purpose: the database constrains it, and an unrecognised value must be *ignored*. */
  effect: string;
  /** Per-admin monotonic sequence — the tiebreaker when two events share a millisecond. */
  seq: number | bigint | string | { toString(): string };
  eventId: string;
  grantedById: string;
  reason: string;
  expiresAt: Date | string | null;
  createdAt: Date | string;
}

/** The identity facts an authorisation decision depends on. Every one is loaded server-side. */
export interface AdminActor {
  user: {
    id: string;
    role: string;
    status: string;
    deletedAt?: Date | string | null;
  } | null;
  profile: {
    id: string;
    isActive: boolean;
    tier: string;
  } | null;
  org: {
    id: string;
    orgKind: string;
    accountStatus: string;
  } | null;
}

export function isGrantEffect(value: unknown): value is GrantEffect {
  return typeof value === "string" && (GRANT_EFFECTS as readonly string[]).includes(value);
}

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

export function isAdminTier(value: unknown): value is AdminTier {
  return typeof value === "string" && (ADMIN_TIERS as readonly string[]).includes(value);
}