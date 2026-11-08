/**
 * PRIMEMET — identity, organisation, party, pricing, tax, document and audit collections.
 *
 * The PostgreSQL partial unique indexes translate almost one for one, because a MongoDB unique index
 * treats `null` as a real value: two documents that both omit the column collide, which is exactly
 * the COALESCE semantics PostgreSQL needed a function for. Where MongoDB is genuinely weaker the
 * collection note says so and names the control that replaces it.
 */

import { collection, f, ref, refKey, refOpt } from "../define.mjs";
import { ENUMS } from "../enums.mjs";

const ts = { createdAt: f.date(), updatedAt: f.date() };

/**
 * Seller listing review state (Phase 1, migration v006).
 *
 * Kept as a LOCAL value set rather than a new `ListingStatus` member because `ListingStatus` is the
 * frozen Prisma vocabulary (DRAFT | ACTIVE | PAUSED | EXPIRED | WITHDRAWN) and `scripts/check-enums.mjs`
 * proves `db/enums.mjs` still mirrors it. A seller submission is DRAFT plus reviewStatus PENDING; admin
 * approval moves it to PENDING → APPROVED and DRAFT → ACTIVE in the same update, so a listing can never
 * be publicly active while its review is unapproved.
 */
export const LISTING_REVIEW_STATES = ["PENDING", "APPROVED", "REJECTED"];

/**
 * v008: the trade a seller declares at registration.
 *
 * A local value set, like LISTING_REVIEW_STATES, so the validator constrains the field without adding a
 * member to the frozen Prisma vocabulary that scripts/check-enums.mjs compares against. It is a
 * DECLARATION by the applicant, never a verification: nothing in the application treats it as checked.
 */
export const SELLER_BUSINESS_TYPES = [
  "MANUFACTURER",
  "TRADER",
  "STOCKIST",
  "PROCESSOR",
  "RECYCLER",
  "WORKSHOP",
  "OTHER",
];

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const user = collection({
  name: "users",
  model: "User",
  notes: "email is unique and lower-case; the validator refuses a non-normalised address.",
  fields: {
    _id: f.uuid(),
    email: f.str({ maxLength: 320 }),
    emailVerifiedAt: f.dateOpt(),
    passwordHash: f.strOpt(),
    passwordChangedAt: f.dateOpt(),
    fullName: f.str({ maxLength: 200 }),
    phone: f.strOpt(),
    locale: f.str({ maxLength: 12 }),
    role: f.enumOf("UserRole", ENUMS),
    status: f.enumOf("UserStatus", ENUMS),
    mfaEnabled: f.bool(),
    mfaSecretCiphertext: f.strOpt(),
    failedLoginCount: f.int(),
    lockedUntil: f.dateOpt(),
    lastLoginAt: f.dateOpt(),
    deletedAt: f.dateOpt(),
    ...ts,
  },
  indexes: [
    { keys: { email: 1 }, unique: true },
    { keys: { role: 1, status: 1 } },
  ],
  invariants: [
    {
      rule: "email is stored lower-case (no two accounts differ only by case)",
      query: { $expr: { $eq: ["$email", { $toLower: "$email" }] } },
    },
  ],
});

export const session = collection({
  name: "sessions",
  model: "Session",
  notes: "tokenHash unique; an expired session is filtered by expiresAt, never deleted, so history survives.",
  fields: {
    _id: f.uuid(),
    userId: ref("users"),
    tokenHash: f.str({ maxLength: 128 }),
    roleAtIssue: f.enumOf("UserRole", ENUMS),
    ipHash: f.strOpt(),
    userAgentHash: f.strOpt(),
    createdAt: f.date(),
    lastSeenAt: f.date(),
    expiresAt: f.date(),
    revokedAt: f.dateOpt(),
    revokedReason: f.strOpt(),
  },
  indexes: [
    { keys: { tokenHash: 1 }, unique: true },
    { keys: { userId: 1, expiresAt: -1 } },
  ],
});

export const authEvent = collection({
  name: "auth_events",
  model: "AuthEvent",
  immutable: true,
  notes: "Append-only authentication trail. No update/delete in the DAO.",
  fields: {
    _id: f.uuid(),
    userId: refOpt("users"),
    emailAttempted: f.strOpt(),
    eventType: f.str({ maxLength: 60 }),
    success: f.bool(),
    ipHash: f.strOpt(),
    userAgentHash: f.strOpt(),
    detail: f.jsonOpt(),
    occurredAt: f.date(),
    createdAt: f.date(),
  },
  indexes: [{ keys: { occurredAt: -1 } }, { keys: { userId: 1, occurredAt: -1 } }],
});

export const adminProfile = collection({
  name: "admin_profiles",
  model: "AdminProfile",
  fields: {
    _id: f.uuid(),
    userId: ref("users"),
    staffCode: f.str({ maxLength: 40 }),
    jobTitle: f.strOpt(),
    desk: f.strOpt(),
    tier: f.enumOf("AdminTier", ENUMS),
    mfaRequired: f.bool(),
    approvalLimit: f.decimalOpt(),
    isActive: f.bool(),
    ...ts,
  },
  indexes: [{ keys: { userId: 1 }, unique: true }, { keys: { staffCode: 1 }, unique: true }],
});

export const adminPermissionGrant = collection({
  name: "admin_permission_grants",
  model: "AdminPermissionGrant",
  notes:
    "A permission event is a fact about access history, so it is append-only: GRANT, DENY and REVOKE " +
    "are appended and never rewritten (D-ARCH-12). Resolution is latest-event-wins over this log, with " +
    "the admin tier default underneath — see src/lib/permissions/resolve.ts.",
  immutable: true,
  fields: {
    _id: f.uuid(),
    adminId: ref("admin_profiles"),
    permission: f.enumOf("AdminPermission", ENUMS),
    // D-ARCH-12: REVOKE is a third effect, not a synonym for DENY. It removes the explicit override and
    // restores the tier default. The enum lives in db/enums-local.mjs because the frozen Prisma model
    // declares effect String and its historical migration must not be rewritten.
    effect: f.enumOf("GrantEffect", ENUMS),
    // Monotonic per admin, allocated in the same transaction as the row. createdAt alone is not a total
    // order — two appends can share a millisecond — and a non-deterministic order means the resolver's
    // answer depends on load, which is the one concurrency hazard the design has to close.
    seq: f.long({ minimum: 0 }),
    // Client-supplied idempotency key. A retried request must be a no-op, not a second row that inverts
    // the outcome of the first.
    eventId: f.str({ maxLength: 64 }),
    // The actor. Required: the brief requires actor, target, permission, reason and timestamp on every
    // permission event, so an unattributed row is refused by the validator rather than by review.
    grantedById: ref("users"),
    // Required and non-blank. A grant with no stated reason is unauditable, and an access change that
    // cannot be explained after the fact is the finding an incident review cannot work around.
    reason: f.str({ maxLength: 500 }),
    expiresAt: f.dateOpt(),
    createdAt: f.date(),
    // W3: an HMAC over the fields that decide access, written by the application and verified by the
    // resolver. Optional in the VALIDATOR so rows written before v005 stay readable; the resolver refuses
    // an unverifiable row whenever a key is configured, which is what makes a hand-written grant inert.
    integrity: f.strOpt({ maxLength: 128 }),
  },
  // {adminId, permission} and {expiresAt} are retained rather than replaced: OD-16 forbids `dropIndex`
  // in any scope, so a superseded index is cheap redundancy, not something to remove here.
  indexes: [
    { keys: { adminId: 1, permission: 1 } },
    { keys: { expiresAt: 1 } },
    { keys: { adminId: 1, eventId: 1 }, unique: true },
    // The tiebreaker has to be a real total order: without this constraint two concurrent appends can
    // read the same maximum and write the same sequence number, and resolution would order them arbitrarily.
    { keys: { adminId: 1, seq: 1 }, unique: true },
    { keys: { adminId: 1, permission: 1, createdAt: -1, seq: -1 } },
  ],
  invariants: [
    {
      rule: "reason is stated, not blank",
      query: { $expr: { $gt: [{ $strLenCP: { $trim: { input: "$reason" } } }, 0] } },
    },
    { rule: "seq is a non-negative sequence number", query: { seq: { $gte: 0 } } },
    {
      rule: "expiry, when set, is after the event instant",
      query: {
        $expr: {
          $or: [
            { $eq: [{ $ifNull: ["$expiresAt", null] }, null] },
            { $gt: ["$expiresAt", "$createdAt"] },
          ],
        },
      },
    },
  ],
});

export const portalInvitation = collection({
  name: "portal_invitations",
  model: "PortalInvitation",
  fields: {
    _id: f.uuid(),
    email: f.str({ maxLength: 320 }),
    role: f.enumOf("UserRole", ENUMS),
    organisationId: refOpt("organisations"),
    invitedById: refOpt("users"),
    tokenHash: f.str({ maxLength: 128 }),
    expiresAt: f.date(),
    acceptedAt: f.dateOpt(),
    revokedAt: f.dateOpt(),
    createdAt: f.date(),
  },
  indexes: [{ keys: { tokenHash: 1 }, unique: true }, { keys: { email: 1 } }],
});

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

export const organisation = collection({
  name: "organisations",
  model: "Organisation",
  notes:
    "gstin and pan are unique only WHEN PRESENT (partial indexes). Exactly one live PRIMEMET " +
    "organisation may exist — the partial unique index on orgKind with a NULL deletedAt is what makes " +
    "PRIMEMET's own identity single-valued for invoice issuer checks. `deletedAt: null` is an equality, " +
    "not `$exists: false`, because MongoDB refuses $not/$exists inside a partialFilterExpression. " +
    "orgType and orgKind are DIFFERENT columns and must not be conflated: orgType is the counterparty " +
    "kind (BUYER | SELLER | BOTH) and cannot express PRIMEMET, while orgKind is the operator marker " +
    "(PRIMEMET | BUYER | SELLER | PARTNER | OTHER). The first MongoDB port dropped orgKind and put the " +
    "PRIMEMET filter on orgType, which made the platform organisation unstorable and the uniqueness " +
    "guarantee vacuous (defect S-1, corrected by v004).",
  fields: {
    _id: f.uuid(),
    legalName: f.str({ maxLength: 240 }),
    tradeName: f.strOpt(),
    registrationNumber: f.strOpt(),
    gstin: f.strOpt(),
    pan: f.strOpt(),
    iec: f.strOpt(),
    countryCode: f.str({ maxLength: 2 }),
    stateCode: f.strOpt({ maxLength: 8 }),
    city: f.strOpt(),
    website: f.strOpt(),
    accountStatus: f.str({ maxLength: 40 }),
    isListable: f.bool(),
    internalNotes: f.strOpt(),
    orgType: f.enumOf("OrgType", ENUMS),
    // The operator marker. A free string in the frozen Prisma model (default "OTHER"), enumerated here
    // so a typo cannot silently create a second kind of platform organisation.
    orgKind: f.str({ maxLength: 40, enum: ["PRIMEMET", "BUYER", "SELLER", "PARTNER", "OTHER"] }),
    verificationStatus: f.enumOf("VerificationStatus", ENUMS),
    // v008: what the seller declares at registration and what the desk reviews. businessType and
    // description are the applicant's own words; reviewFeedback is the decision note the seller is
    // allowed to read (unlike internalNotes, which never leaves the desk). reviewedAt/reviewedByUserId
    // record who decided, so an approval is attributable without reading the audit log.
    businessType: f.strOpt({ maxLength: 80, enum: [...SELLER_BUSINESS_TYPES, null] }),
    description: f.strOpt({ maxLength: 2000 }),
    reviewFeedback: f.strOpt({ maxLength: 1000 }),
    reviewedAt: f.dateOpt(),
    reviewedByUserId: refOpt("users"),
    // v009: an account the desk has suspended. The reason is internal (never read by the counterparty),
    // and suspendedAt is what makes the suspension reviewable without reading the audit log. A suspended
    // organisation's login carries users.status SUSPENDED, written in the same transaction.
    suspendedAt: f.dateOpt(),
    suspensionReason: f.strOpt({ maxLength: 300 }),
    deletedAt: f.dateOpt(),
    ...ts,
  },
  indexes: [
    { keys: { gstin: 1 }, unique: true, partialFilterExpression: { gstin: { $type: "string" } } },
    { keys: { pan: 1 }, unique: true, partialFilterExpression: { pan: { $type: "string" } } },
    // OD-16 forbids `dropIndex`, so the previous index on `{orgType: "PRIMEMET"}` cannot be removed.
    // It stays as dead structure: its filter matches no document, because OrgType has no PRIMEMET value.
    { keys: { orgType: 1 }, unique: true, partialFilterExpression: { orgType: "PRIMEMET", deletedAt: null } },
    // The guarantee the design actually needs: exactly one live platform organisation.
    { keys: { orgKind: 1 }, unique: true, partialFilterExpression: { orgKind: "PRIMEMET", deletedAt: null } },
    { keys: { orgType: 1, accountStatus: 1 } },
    // v008: the admin seller queue runs exactly this shape — pending first, newest first.
    { keys: { orgType: 1, accountStatus: 1, createdAt: -1 } },
    // v009: the admin buyer/seller register sorts every organisation of one type newest first.
    { keys: { orgType: 1, createdAt: -1 } },
  ],
});

export const organisationAddress = collection({
  name: "organisation_addresses",
  model: "OrganisationAddress",
  fields: {
    _id: f.uuid(),
    organisationId: ref("organisations"),
    kind: f.str({ maxLength: 40 }),
    label: f.strOpt(),
    line1: f.strOpt(),
    line2: f.strOpt(),
    city: f.str({ maxLength: 120 }),
    stateCode: f.str({ maxLength: 8 }),
    postalCode: f.strOpt(),
    countryCode: f.str({ maxLength: 2 }),
    isDefault: f.bool(),
    ...ts,
  },
  indexes: [{ keys: { organisationId: 1, kind: 1 } }],
});

export const organisationContact = collection({
  name: "organisation_contacts",
  model: "OrganisationContact",
  notes:
    "shareable defaults to false. Contact details are never exposed by a public page, and this flag " +
    "is the data-side half of the admin-controlled contact-sharing rule (D2).",
  fields: {
    _id: f.uuid(),
    organisationId: ref("organisations"),
    userId: refOpt("users"),
    fullName: f.str({ maxLength: 200 }),
    roleLabel: f.strOpt(),
    email: f.str({ maxLength: 320 }),
    phone: f.strOpt(),
    isPrimary: f.bool(),
    shareable: f.bool(),
    ...ts,
  },
  indexes: [{ keys: { organisationId: 1, isPrimary: 1 } }, { keys: { email: 1 } }],
});

export const organisationVerification = collection({
  name: "organisation_verifications",
  model: "OrganisationVerification",
  fields: {
    _id: f.uuid(),
    organisationId: ref("organisations"),
    type: f.enumOf("VerificationType", ENUMS),
    status: f.enumOf("VerificationStatus", ENUMS),
    referenceValue: f.strOpt(),
    documentId: refOpt("documents"),
    verifiedById: refOpt("users"),
    verifiedAt: f.dateOpt(),
    expiresAt: f.dateOpt(),
    rejectionReason: f.strOpt(),
    ...ts,
  },
  indexes: [{ keys: { organisationId: 1, type: 1 } }],
  invariants: [
    {
      rule: "a VERIFIED organisation check names the verifier and the date",
      query: {
        $or: [
          { status: { $ne: "VERIFIED" } },
          { $and: [{ verifiedById: { $type: "string" } }, { verifiedAt: { $type: "date" } }] },
        ],
      },
    },
  ],
});

export const referenceSequence = collection({
  name: "reference_sequences",
  model: "ReferenceSequence",
  notes:
    "Human document numbering (ENQ-2026-000021). _id is '<prefix>:<year>' — a natural key, so the " +
    "counter is addressed directly and cannot be duplicated per prefix and year.",
  fields: {
    _id: f.str({ maxLength: 40, pattern: "^[A-Z]{2,8}:[0-9]{4}$" }),
    prefix: f.str({ maxLength: 8 }),
    year: f.int(),
    lastValue: f.long(),
  },
  indexes: [{ keys: { prefix: 1, year: 1 }, unique: true }],
});

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

export const supplierProfile = collection({
  name: "supplier_profiles",
  model: "SupplierProfile",
  fields: {
    _id: f.uuid(),
    organisationId: ref("organisations"),
    userId: refOpt("users"),
    verification: f.enumOf("VerificationStatus", ENUMS),
    contactRole: f.strOpt(),
    isPrimaryContact: f.bool(),
    canSubmitQuotes: f.bool(),
    capabilities: f.strArray(),
    materialsHandled: f.strArray(),
    geographicReach: f.strArray(),
    monthlyCapacityKg: f.decimalOpt(),
    hasWeighbridge: f.boolOpt(),
    hasTestingFacility: f.boolOpt(),
    paymentTermsDays: f.intOpt(),
    creditTermsDays: f.intOpt(),
    ratingInternal: f.decimalOpt(),
    notesInternal: f.strOpt(),
    ...ts,
  },
  indexes: [{ keys: { organisationId: 1 } }, { keys: { userId: 1 }, unique: true, partialFilterExpression: { userId: { $type: "string" } } }],
});

export const buyerProfile = collection({
  name: "buyer_profiles",
  model: "BuyerProfile",
  fields: {
    _id: f.uuid(),
    organisationId: ref("organisations"),
    userId: refOpt("users"),
    verification: f.enumOf("VerificationStatus", ENUMS),
    jobTitle: f.strOpt(),
    department: f.strOpt(),
    approvalLimit: f.decimalOpt(),
    preferredCurrency: f.strOpt({ maxLength: 3 }),
    defaultShipToId: f.strOpt(),
    industries: f.strArray(),
    preferredGrades: f.strArray(),
    typicalMonthlyKg: f.decimalOpt(),
    deliveryStates: f.strArray(),
    creditTermsDays: f.intOpt(),
    creditLimit: f.decimalOpt(),
    notesInternal: f.strOpt(),
    ...ts,
  },
  indexes: [{ keys: { organisationId: 1 } }, { keys: { userId: 1 }, unique: true, partialFilterExpression: { userId: { $type: "string" } } }],
});

export const supplierListing = collection({
  name: "supplier_listings",
  model: "SupplierListing",
  notes:
    "quantityKg is the only availability quantity in the schema, and it lives here — outside the " +
    "canonical catalogue. A material's identity never carries a quantity.",
  fields: {
    _id: f.uuid(),
    supplierId: ref("supplier_profiles"),
    status: f.enumOf("ListingStatus", ENUMS),
    // v006: the approval gate. Required, so a listing written by any path carries an explicit review
    // state instead of relying on `status` to mean two different things at once.
    reviewStatus: f.str({ maxLength: 20, enum: LISTING_REVIEW_STATES }),
    title: f.str({ maxLength: 200 }),
    submittedAt: f.date(),
    reviewedAt: f.dateOpt(),
    reviewedByUserId: refOpt("users"),
    rejectionReason: f.strOpt({ maxLength: 500 }),
    categoryLabel: f.strOpt({ maxLength: 160 }),
    gradeId: refOpt("scrap_grades"),
    productId: refOpt("products"),
    quantityKg: f.decimalOpt(),
    locationCityId: f.strOpt(),
    availableFrom: f.dateOpt(),
    availableTo: f.dateOpt(),
    notes: f.strOpt(),
    // v008: the submission itself. A seller describes what it can supply; the desk reads this to decide.
    // Images are https references only — Phase 1 has no object storage, so no file is uploaded and the
    // public catalogue never renders a seller-supplied image until an admin publishes the product.
    manufacturer: f.strOpt({ maxLength: 160 }),
    description: f.strOpt({ maxLength: 4000 }),
    specification: f.strOpt({ maxLength: 4000 }),
    supportingInfo: f.strOpt({ maxLength: 2000 }),
    images: f.strArray({ optional: true, maxItems: 8 }),
    ...ts,
  },
  indexes: [
    { keys: { supplierId: 1, status: 1 } },
    // v008: a seller's own submission history, newest first.
    { keys: { supplierId: 1, createdAt: -1 } },
    { keys: { gradeId: 1 } },
    { keys: { productId: 1 } },
    // v006: the admin review queue and the public "approved availability" lookup.
    { keys: { reviewStatus: 1, submittedAt: -1 } },
  ],
});

export const locationState = collection({
  name: "location_states",
  model: "LocationState",
  fields: {
    _id: f.uuid(),
    code: f.str({ maxLength: 8 }),
    name: f.str({ maxLength: 120 }),
    countryCode: f.str({ maxLength: 2 }),
    taxRegionCode: f.strOpt({ maxLength: 20 }),
    isServiced: f.bool(),
    ...ts,
  },
  indexes: [{ keys: { code: 1 }, unique: true }],
});

// ---------------------------------------------------------------------------
// Pricing and tax
// ---------------------------------------------------------------------------

export const pricingRuleSet = collection({
  name: "pricing_rule_sets",
  model: "PricingRuleSet",
  notes: "One ACTIVE version per key (partial unique index); a superseded set stays as history.",
  fields: {
    _id: f.uuid(),
    key: f.str({ maxLength: 80 }),
    name: f.str({ maxLength: 160 }),
    version: f.int(),
    status: f.enumOf("PricingRuleStatus", ENUMS),
    currencyCode: f.str({ maxLength: 3 }),
    effectiveFrom: f.date(),
    effectiveTo: f.dateOpt(),
    approvedById: refOpt("users"),
    approvedAt: f.dateOpt(),
    ...ts,
  },
  indexes: [
    { keys: { key: 1 }, unique: true, partialFilterExpression: { status: "ACTIVE" } },
    { keys: { key: 1, version: 1 }, unique: true },
  ],
});

export const taxComponentRef = collection({
  name: "tax_components_ref",
  model: "TaxComponentRef",
  notes:
    "_id is the component code (GST, CGST, TDS …), a natural key. This is reference data ONLY: the " +
    "repository seeds no rate, no treatment and no legal conclusion. Components are names.",
  fields: {
    _id: f.str({ maxLength: 20, pattern: "^[A-Z][A-Z0-9_]{1,19}$" }),
    name: f.str({ maxLength: 80 }),
    isStatutory: f.bool(),
    appliesAt: f.enumOf("TaxAppliesTo", ENUMS),
    sortOrder: f.int(),
    active: f.bool(),
    ...ts,
  },
  indexes: [{ keys: { active: 1, sortOrder: 1 } }],
});

export const taxRule = collection({
  name: "tax_rules",
  model: "TaxRule",
  notes:
    "Effective-dated, scope-specific tax rules. PostgreSQL used a btree_gist EXCLUDE constraint over " +
    "(component, model, role, state) equality plus a non-overlapping date range. MongoDB cannot index " +
    "range overlap, so the split is: (1) scope uniqueness by partial unique index — null means 'every " +
    "model/state' and collides with another null, exactly the COALESCE semantics; (2) date overlap is " +
    "checked by db/tax.mjs inside the write transaction. Rule (2) is application-enforced and the " +
    "residual risk is stated in the migration plan.",
  fields: {
    _id: f.uuid(),
    code: f.str({ maxLength: 60 }),
    componentCode: refKey("tax_components_ref"),
    transactionModel: f.enumOpt("TransactionModel", ENUMS),
    invoiceRole: f.enumOf("InvoiceRole", ENUMS),
    appliesTo: f.enumOf("TaxAppliesTo", ENUMS),
    taxableBaseRule: f.enumOf("TaxBaseRule", ENUMS),
    jurisdictionStateId: refOpt("location_states"),
    hsnSacCode: f.strOpt(),
    ratePct: f.decimal(),
    includesFreight: f.bool(),
    reverseCharge: f.bool(),
    thresholdAmount: f.decimalOpt(),
    effectiveFrom: f.date(),
    effectiveTo: f.dateOpt(),
    approvedById: refOpt("users"),
    approvedAt: f.dateOpt(),
    legalReference: f.strOpt(),
    status: f.enumOf("TaxRuleStatus", ENUMS),
    ...ts,
  },
  indexes: [
    {
      // Scope uniqueness IS enforced by the server, but scoped to the start date: at most one ACTIVE
      // rule per (component, model, role, state) may begin on the same day. Two ACTIVE rules for one
      // scope with DIFFERENT start dates are legitimate (a rate change), and the inclusive-date
      // overlap between them is caught by db/tax.mjs inside the write transaction. A scope-only index
      // would have forbidden the rate change itself.
      keys: { componentCode: 1, transactionModel: 1, invoiceRole: 1, jurisdictionStateId: 1, effectiveFrom: 1 },
      unique: true,
      partialFilterExpression: { status: "ACTIVE" },
    },
    { keys: { effectiveFrom: 1, effectiveTo: 1 } },
    { keys: { transactionModel: 1, status: 1 } },
  ],
  invariants: [
    { rule: "invoice_role is never null (ANY is the wildcard)", query: { invoiceRole: { $type: "string" } } },
    { rule: "rate_pct is a decimal between 0 and 100", query: { $expr: { $and: [{ $gte: ["$ratePct", 0] }, { $lte: ["$ratePct", 100] }] } } },
    {
      rule: "an ACTIVE rule must be approved (approver and timestamp)",
      query: {
        $or: [
          { status: { $ne: "ACTIVE" } },
          { $and: [{ approvedById: { $type: "string" } }, { approvedAt: { $type: "date" } }] },
        ],
      },
    },
    {
      rule: "effective_to is absent or not before effective_from",
      query: {
        $expr: {
          $or: [
            // null AND missing both mean "no end date"; a bare "missing" check treats an explicit
            // null as present and then compares null < date, which silently rejected every open rule.
            { $in: [{ $type: "$effectiveTo" }, ["missing", "null"]] },
            { $gte: ["$effectiveTo", "$effectiveFrom"] },
          ],
        },
      },
    },
  ],
});

export const taxTreatment = collection({
  name: "tax_treatments",
  model: "TaxTreatment",
  fields: {
    _id: f.uuid(),
    code: f.str({ maxLength: 60 }),
    name: f.str({ maxLength: 160 }),
    transactionModel: f.enumOf("TransactionModel", ENUMS),
    appliesTo: f.enumOf("TaxAppliesTo", ENUMS),
    invoiceRole: f.enumOf("InvoiceRole", ENUMS),
    jurisdictionStateId: refOpt("location_states"),
    ruleIds: f.strArray(),
    requiresAdminReview: f.bool(),
    status: f.enumOf("TaxRuleStatus", ENUMS),
    effectiveFrom: f.date(),
    effectiveTo: f.dateOpt(),
    ...ts,
  },
  indexes: [{ keys: { code: 1, transactionModel: 1, invoiceRole: 1 }, unique: true }],
});

// ---------------------------------------------------------------------------
// Documents and audit
// ---------------------------------------------------------------------------

export const document = collection({
  name: "documents",
  model: "Document",
  notes:
    "Storage metadata only — no bytes, no public URL. visibility is the field that keeps an internal " +
    "inspection report out of any buyer or public response.",
  fields: {
    _id: f.uuid(),
    storageKey: f.str({ maxLength: 400 }),
    bucket: f.str({ maxLength: 120 }),
    originalFilename: f.str({ maxLength: 400 }),
    mimeType: f.str({ maxLength: 160 }),
    sizeBytes: f.long(),
    checksumSha256: f.str({ maxLength: 64, pattern: "^[0-9a-f]{64}$" }),
    documentType: f.enumOf("DocumentType", ENUMS),
    visibility: f.enumOf("DocumentVisibility", ENUMS),
    sensitivity: f.str({ maxLength: 40 }),
    ownerOrgId: refOpt("organisations"),
    uploadedById: refOpt("users"),
    scanStatus: f.enumOf("ScanStatus", ENUMS),
    scanResult: f.strOpt(),
    retentionUntil: f.dateOpt(),
    legalHold: f.bool(),
    supersededById: refOpt("documents"),
    createdAt: f.date(),
  },
  indexes: [
    { keys: { storageKey: 1 }, unique: true },
    { keys: { ownerOrgId: 1, documentType: 1 } },
    { keys: { checksumSha256: 1 } },
    { keys: { retentionUntil: 1 } },
  ],
  invariants: [
    {
      rule: "a CLEAN scan result requires a scan timestamp-bearing result string",
      query: { $or: [{ scanStatus: { $ne: "CLEAN" } }, { scanResult: { $regex: "\\S" } }] },
    },
  ],
});

export const documentAccessLog = collection({
  name: "document_access_logs",
  model: "DocumentAccessLog",
  immutable: true,
  fields: {
    _id: f.uuid(),
    documentId: ref("documents"),
    userId: refOpt("users"),
    orgId: refOpt("organisations"),
    action: f.str({ maxLength: 40 }),
    ipHash: f.strOpt(),
    userAgentHash: f.strOpt(),
    purpose: f.strOpt(),
    createdAt: f.date(),
  },
  indexes: [{ keys: { documentId: 1, createdAt: -1 } }, { keys: { userId: 1 } }],
});

export const auditLog = collection({
  name: "audit_logs",
  model: "AuditLog",
  immutable: true,
  notes: "Append-only. Nothing in the DAO updates or deletes an audit record.",
  fields: {
    _id: f.uuid(),
    occurredAt: f.date(),
    actorUserId: refOpt("users"),
    actorRole: f.enumOpt("UserRole", ENUMS),
    actorIpHash: f.strOpt(),
    action: f.str({ maxLength: 120 }),
    entityType: f.str({ maxLength: 80 }),
    entityId: f.strOpt(),
    beforeState: f.jsonOpt(),
    afterState: f.jsonOpt(),
    requestId: f.strOpt(),
    severity: f.enumOf("AuditSeverity", ENUMS),
    createdAt: f.date(),
  },
  indexes: [
    { keys: { entityType: 1, entityId: 1, occurredAt: -1 } },
    { keys: { actorUserId: 1, occurredAt: -1 } },
    { keys: { occurredAt: -1 } },
  ],
});

export const auditLogFailure = collection({
  name: "audit_log_failures",
  model: "AuditLogFailure",
  immutable: true,
  notes: "An audit write that failed is itself recorded; it is never silently dropped.",
  fields: {
    _id: f.uuid(),
    attemptedAt: f.date(),
    payload: f.json(),
    error: f.str({ maxLength: 2000 }),
    resolved: f.bool(),
    createdAt: f.date(),
  },
  indexes: [{ keys: { resolved: 1, attemptedAt: -1 } }],
});

export const CORE_COLLECTIONS = [
  user,
  session,
  authEvent,
  adminProfile,
  adminPermissionGrant,
  portalInvitation,
  organisation,
  organisationAddress,
  organisationContact,
  organisationVerification,
  referenceSequence,
  supplierProfile,
  buyerProfile,
  supplierListing,
  locationState,
  pricingRuleSet,
  taxComponentRef,
  taxRule,
  taxTreatment,
  document,
  documentAccessLog,
  auditLog,
  auditLogFailure,
];