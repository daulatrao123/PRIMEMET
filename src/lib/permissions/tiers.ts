/**
 * PRIMEMET — tier defaults: the authorisation layer *underneath* the explicit event log.
 *
 * D-ARCH-12 changed what a tier is. Before the decision, tiers were merely a seeded set of GRANT rows,
 * so "the tier" and "an explicit grant" were the same thing and could not be told apart. The approved
 * semantics make the tier default a distinct fallback the resolver consults whenever no applicable event
 * exists, or when the newest applicable event is a REVOKE. That is why these sets are code rather than
 * seed data: they are consulted, not projected.
 *
 * The counts are contractual (Phase 1A contracts §2.8) and `scripts/check-permissions.mjs` asserts
 * 74 / 45 / 14 / 20 against the real enum. If an enum value is appended without a tier decision, that
 * check fails and forces the decision instead of leaving a permission nobody can hold.
 */

import { ADMIN_PERMISSIONS, type AdminPermission, type AdminTier } from "./types.ts";

/** Every permission, as a set. `SUPER_ADMIN` is the only tier that reaches all 74. */
const ALL: readonly AdminPermission[] = ADMIN_PERMISSIONS;

/**
 * Sourcing operations: the commercial desk.
 *
 * Cannot reach pricing or tax *editing/approval* (money changes need a second pair of eyes), invoice
 * issue, user administration, access administration, database administration, or audit export. It can
 * see pricing internally and read a tax snapshot, because quoting is impossible without them.
 */
const SOURCING_OPS: readonly AdminPermission[] = [
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
  "DOCUMENT_VIEW_INTERNAL",
  "DOCUMENT_UPLOAD",
  "PRICING_VIEW_INTERNAL",
  "TAX_VIEW_SNAPSHOT",
  "INVOICE_VIEW",
  "PARTY_VIEW",
  "PARTY_EDIT",
  "PARTY_VERIFY",
  "PARTY_SUSPEND",
  "ORDER_VIEW",
  "ORDER_EDIT",
  "ORDER_CANCEL",
  "REPORT_VIEW",
];

/**
 * Catalogue management: the material record.
 *
 * Reaches catalogue and composition, SEO, content, redirects, documents, reports and a read of the
 * party record. Nothing commercial, nothing access-related.
 */
const CATALOGUE: readonly AdminPermission[] = [
  "CATALOGUE_VIEW",
  "CATALOGUE_EDIT",
  "CATALOGUE_PUBLISH",
  "CATALOGUE_EDIT_COMPOSITION",
  "CATALOGUE_APPROVE_COMPOSITION",
  "SEO_EDIT",
  "SEO_PUBLISH",
  "CONTENT_GENERATE",
  "CONTENT_REVIEW",
  "REDIRECT_MANAGE",
  "DOCUMENT_VIEW_INTERNAL",
  "DOCUMENT_UPLOAD",
  "REPORT_VIEW",
  "PARTY_VIEW",
];

/**
 * Read-only: every read permission, by construction.
 *
 * `VIEW` in the name is the rule, with one deliberate exception: `CONTENT_REVIEW` is a *decision* about
 * a generated page, not a read, so a read-only admin does not get it. Nothing here mutates, which is why
 * this tier exists — support and audit staff who need to look without being able to change anything.
 */
const READ_ONLY: readonly AdminPermission[] = ADMIN_PERMISSIONS.filter(
  (permission) => permission.includes("VIEW") && permission !== "CONTENT_REVIEW",
);

export const TIER_DEFAULTS: Readonly<Record<AdminTier, readonly AdminPermission[]>> = {
  SUPER_ADMIN: ALL,
  SOURCING_OPS_ADMIN: SOURCING_OPS,
  CATALOGUE_MANAGER: CATALOGUE,
  READ_ONLY_ADMIN: READ_ONLY,
};

const TIER_DEFAULT_SETS: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(
  Object.entries(TIER_DEFAULTS).map(([tier, permissions]) => [tier, new Set<string>(permissions)]),
);

/**
 * Does this tier grant the permission by default?
 *
 * An **unknown tier grants nothing**. That is the fail-closed direction and it matters: seeding a new
 * tier value without teaching this module about it must lock those accounts out, not hand them
 * `SUPER_ADMIN`'s 74 permissions because a lookup returned `undefined`.
 *
 * Tier defaults do not expire. Expiry belongs to explicit events (§2.4), where a temporary GRANT or DENY
 * lapses and resolution falls through; there is no time-bounded tier.
 */
export function tierDefault(tier: string, permission: string): boolean {
  const defaults = TIER_DEFAULT_SETS[tier];
  if (!defaults) return false;
  return defaults.has(permission);
}

/** The tier's whole default set, for display and for tests. Unknown tier → empty. */
export function tierDefaultSet(tier: string): readonly string[] {
  return TIER_DEFAULTS[tier as AdminTier] ?? [];
}