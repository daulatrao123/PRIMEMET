# PRIMEMET — Architecture Closure: Conflicting and Missing Definitions

**Status:** proposal for review. No schema change, no migration, no collection created, no database contacted.
**Verified against:** `db/collections/*.mjs` and `prisma/schema.prisma` as they exist at this commit, read directly.
**Rule applied:** where the two stores disagree, nothing is silently chosen. Each issue names the conflict,
the recommended canonical definition, and the owner decision that would settle it.

---

## 0. Summary

| # | Issue | Severity | Blocks | Owner decision |
|---|---|---|---|---|
| 1 | `admin_permission_grants.effect` — `GRANT\|DENY` vs `GRANT\|REVOKE`, plus a unique constraint that forbids append-only | **High** | M2 RBAC | **D-ARCH-1** |
| 2 | `admin_permission_grants.grantedById` — `users` vs `admin_profiles` | Medium | M2 audit trail | confirmation only |
| 3 | `orgKind` absent in MongoDB; one-PRIMEMET invariant unenforced | **High** | invoicing (P-5) | **D-ARCH-2** |
| 4 | Listing approval state and history do not exist anywhere | **High** | Phase 4 | **D-ARCH-3** |
| 5 | Enquiry → payment collections absent (vocabulary present, tables not) | **High** | Phases 5–6 | **D-ARCH-4** |
| 6 | City / district / industrial-area collections absent; one dangling reference | Medium | Phase 3 intake | **D-ARCH-5** |
| 7 | Notification / outbox absent | Medium | Phase 7 | **D-ARCH-6** |
| 8 | Document storage: metadata complete, pipeline absent | Medium | Phase 3 uploads | **D-ARCH-7** |

**One finding changes how the rest should be read.** `db/enums.mjs` holds **67 enums** and already contains the
complete vocabulary for the missing workflow — `EnquiryStatus` (13 values), `SupplierMatchStatus` (7),
`BuyerQuoteStatus` (11), `SupplierQuoteStatus` (4), `OrderStatus` (9), `ShipmentStatus` (6), `DisputeStatus` (6),
`SettlementStatus` (4), `InvoiceStatus` (6), `PaymentStatus` (5), `BuyerApprovalState` (6), `ContactShareStatus` (5),
`CoverageLevel` (4), `SeoPageType` (9), `EmailStatus` (7). The words exist; the collections do not.

That is good news: the proposals in §4–§7 and in `PRIMEMET_DOMAIN_ARCHITECTURE.md` reuse existing vocabulary
rather than inventing parallel terms, so no enum migration is needed for them.

---

## 1. `admin_permission_grants.effect`

### Current MongoDB definition
```js
name: "admin_permission_grants",
immutable: true,                     // append-only
fields: {
  effect: f.str({ maxLength: 20 }),
  ...
},
indexes: [{ keys: { adminId: 1, permission: 1 } }],   // NOT unique
invariants: [{ rule: "effect is GRANT or DENY",
               query: { effect: { $in: ["GRANT", "DENY"] } } }],
```

### Current Prisma definition
```prisma
model AdminPermissionGrant {
  /// GRANT | REVOKE
  effect      String
  ...
  @@unique([adminId, permission])     // UNIQUE
}
```

### The conflict, precisely
The two stores do not merely spell the second value differently — they encode **opposite data models**.

- MongoDB: a grant is a fact in an append-only log. Revoking is writing a `DENY` row. History is retained.
- Prisma: `@@unique([adminId, permission])` permits **one row per pair**. A second row cannot exist, so
  "revoke" can only mean UPDATE or DELETE — the mutable model that `immutable: true` exists to prevent.

`REVOKE` describes a *verb*; `DENY` describes a *state*. A log of verbs cannot be replayed into current access
without also knowing what was there before; a log of states can.

### Business impact
Access history is the evidence trail for who could approve quotes, see supplier costs or export audit data.
If the mutable model is implemented, a revoked grant leaves no record that it ever existed, and an
"who could approve this in March?" question becomes unanswerable. It also collides with the project's
standing rule that commercial decisions are auditable (audit-log requirement R10, D8 §29).

### Recommended canonical design
**`DENY`, append-only.** Prisma is a frozen historical record and is not edited (standing decision); MongoDB is
the live store and already implements this correctly.

```
GrantEffect = GRANT | DENY            // new enum, mirrors the existing invariant
```

Resolution rule — **latest event wins**:

```
effectivePermission(adminId, permission, at) =
  the grant with the greatest createdAt where createdAt <= at
    and (expiresAt is null or expiresAt > at)
  → GRANT means allowed, DENY means not allowed, no row means not allowed
```

Why latest-wins rather than "deny always wins": under append-only, a permanent deny could never be reversed —
re-granting would require deleting the deny, which `immutable: true` forbids. Latest-wins preserves both
auditability and the ability to grant again.

Index: `{ adminId: 1, permission: 1, createdAt: -1 }` (non-unique), plus the existing `{ expiresAt: 1 }` for
expiry sweeps.

### Migration implications
- **MongoDB:** add the `GrantEffect` enum; the field already validates. If Prisma is used to generate enums,
  `GrantEffect` must be added to `prisma/schema.prisma` first — which cannot be done without a new PostgreSQL
  migration, so declare it directly in `db/enums.mjs` and record the divergence (see D-ARCH-1 alternative).
- **PostgreSQL:** none. It is frozen.
- No data migration: no production database exists.

### Owner decision required
> **D-ARCH-1.** Confirm `GRANT | DENY` with latest-event-wins as canonical, and confirm that `prisma/schema.prisma`
> and its seven migrations stay frozen rather than being corrected. **Recommend: approve both.**
> Alternative: adopt `GRANT | REVOKE` to match Prisma — rejected, because it forces mutable access history.

---

## 2. `admin_permission_grants.grantedById`

### Current MongoDB definition
```js
grantedById: refOpt("users"),
```

### Current Prisma definition
```prisma
grantedBy AdminProfile? @relation("GrantGrantedBy", fields: [grantedById], references: [id], onDelete: SetNull)
```

### Business impact
Three ordinary cases cannot be represented by a reference to `admin_profiles`:

1. **Bootstrap.** The first SUPER_ADMIN seeds their own grants before any `admin_profiles` row exists.
2. **Suspension or deletion.** An actor's admin profile is deactivated; `onDelete: SetNull` erases who granted.
3. **Operational delegation.** A user holding a temporary grant records it against their user identity, which
   may not yet be an admin profile.

In each case the audit trail loses the actor — the one field that makes a grant defensible.

### Recommended canonical design
`grantedById → users`. The admin profile is derivable through the user, so no second reference is needed.
Keep it nullable so a system-generated grant (migration or seed) is representable, with `reason` carrying
`"system"`.

Optionally add `grantedByAdminProfileId` (denormalised, nullable) purely to speed the "who granted what, by tier"
report. Not recommended now: it is a second copy of the same fact that can drift.

### Migration implications
None. MongoDB already points at `users`. PostgreSQL is frozen.

### Owner decision required
No new decision — this is confirmation that the MongoDB definition stands and Prisma is not to be "fixed".

---

## 3. `orgKind` and the one-PRIMEMET invariant

### Current MongoDB definition
```js
// organisations
orgType: f.enumOf("OrgType", ENUMS),       // OrgType = BUYER | SELLER | BOTH
indexes: [
  ...
  { keys: { orgType: 1 }, unique: true,
    partialFilterExpression: { orgType: "PRIMEMET", deletedAt: null } },   // ← DEAD
  { keys: { orgType: 1, accountStatus: 1 } },
],
```
`PRIMEMET` is **not** a member of `OrgType` (measured: `["BUYER","SELLER","BOTH"]`), so the partial filter can
never match. The index is created, occupies space, and protects nothing. There is no `orgKind` field.

### Current Prisma definition
```prisma
orgType OrgType  @default(...)      // enum: BUYER | SELLER | BOTH  — counterparty role
orgKind String   @default("OTHER")  // @map("org_kind")            — legal entity kind
```
```sql
CREATE UNIQUE INDEX ... ON "organisations" ("org_kind")
  WHERE "org_kind" = 'PRIMEMET' AND "deleted_at" IS NULL;
ALTER TABLE "organisations" ADD CONSTRAINT "orgs_org_kind_known"
  CHECK ("org_kind" IN ('PRIMEMET', 'BUYER', 'SELLER', 'PARTNER', 'OTHER'));
```
Two axes, correctly separated: `orgType` is *what part a counterparty plays*; `orgKind` is *what kind of legal
entity this is*, including PRIMEMET itself.

### Business impact
The invariant "exactly one live PRIMEMET organisation" is **unenforced in the live store**. Invoice issuer
determination (D5) and the agency/principal distinction both depend on knowing unambiguously which organisation
is PRIMEMET. Two live PRIMEMET rows would make the issuer ambiguous, which is exactly the failure the Prisma
index exists to prevent.

There is a second, subtler risk: the field name `orgType` is used for two different meanings across the two
stores, so a future reader can implement the wrong one and pass review.

### Recommended canonical design
Mirror Prisma's two axes exactly.

```
orgType  = enum OrgType          // BUYER | SELLER | BOTH   (unchanged)
orgKind  = f.str({ maxLength: 20,
                   pattern: "^(PRIMEMET|BUYER|SELLER|PARTNER|OTHER)$" })   // new
```

`orgKind` is a **pattern-constrained string, deliberately not an enum**, because `OrgKind` is not a Prisma enum —
it is `String` plus a CHECK constraint. `db/enums.mjs` is generated from Prisma, so declaring an enum that Prisma
does not have would be erased on the next `npm run db:enums`.

Index replacement:
```
{ keys: { orgKind: 1 }, unique: true,
  partialFilterExpression: { orgKind: "PRIMEMET", deletedAt: null } }
```

The dead `orgType` index is **not dropped** — no role holds `dropIndex` (decision OD-16), and dropping it would
require the privilege that decision refused. It stays as recorded technical debt.

### Migration implications
- One additive `v002` step: add `orgKind` (required, default `"OTHER"`), create the new partial unique index.
- No backfill needed (no production data). If data existed, the backfill would be `orgKind = "OTHER"` for all
  rows, then a single manual promotion of the PRIMEMET row.
- **FU-1 (follow-up):** promote `orgKind` to a real enum the day Prisma is retired or regenerated, so the pattern
  stops being the only guard.

### Owner decision required
> **D-ARCH-2.** Approve the pattern-constrained `orgKind` string plus the new partial unique index, and approve
> leaving the dead `orgType` index in place as debt. **Recommend: approve.** Alternative: add a Prisma `OrgKind`
> enum — rejected for now because it requires touching the frozen schema and a new PostgreSQL migration.

---

## 4. Listing approval state and history

### Current MongoDB definition
```js
// supplier_listings
status: f.enumOf("ListingStatus", ENUMS),   // DRAFT | ACTIVE | PAUSED | EXPIRED | WITHDRAWN
gradeId, productId, quantityKg, locationCityId, availableFrom, availableTo, notes
// no approval field, no invariants, no approval collection
```

### Current Prisma definition
Identical in substance: `status ListingStatus @default(DRAFT)`, no approval columns, no approval model.

### Business impact
Both stores agree — and both are wrong for the business. A listing can move from `DRAFT` to `ACTIVE` with no
review, no approver and no record. That means:

- a supplier can publish availability nobody has verified;
- the "managed sourcing, not an open marketplace" model is defeated at the one point where it matters;
- a buyer enquiry can be matched to stock that does not exist;
- no permission exists to gate the transition (see §8 of the security plan).

`ListingStatus` also conflates two questions: *has this been approved?* and *is it currently offered?* A listing
can be legitimately approved and then paused; under one enum, `PAUSED` and `WITHDRAWN` erase the fact of approval.

### Recommended canonical design
Approval is an **orthogonal axis** with its own append-only history — the same shape already used for supplier
verification (`organisation_verifications`) and alias equivalence (`material_alias_equivalence_decisions`).

```
supplier_listings (additions)
  approvalState      enum ListingApprovalState   // DRAFT | PENDING_REVIEW | APPROVED | REJECTED | SUSPENDED
  approvedAt         date?
  approvedById       ref users?
  rejectionReason    string?
  CHECK: approvalState = APPROVED  ⇒ approvedAt and approvedById are present
  CHECK: ACTIVE listing            ⇒ approvalState = APPROVED

listing_approvals            (new, immutable: true, insert-only)
  _id, listingId → supplier_listings, actorId → users,
  action  enum ApprovalAction    // SUBMIT_FOR_APPROVAL | APPROVE | REJECT | REQUEST_CHANGES | WITHDRAW
  fromState, toState, reason, createdAt
```

`ListingApprovalState` and `ApprovalAction` **already exist** in `db/enums.mjs` in the buyer-facing sense
(`BuyerApprovalState`, `ApprovalAction`); a supplier-facing `ListingApprovalState` is new. Reusing
`ApprovalAction` keeps one vocabulary for "submit / approve / reject / request changes / withdraw".

### Migration implications
- Additive `v002`: 5 listing fields, 1 new collection, 2 indexes, 2 invariants.
- No existing listing becomes invalid, because there is no production data; a seeded database would set
  `approvalState = DRAFT` for every row.
- Requires a permission to approve (§8 of the security plan: `LISTING_APPROVE`, and it must be added to both
  stores — the Prisma enum is frozen, so this is a MongoDB-only addition plus a documented divergence).

### Owner decision required
> **D-ARCH-3.** Approve a separate approval axis (not a new `ListingStatus` value) with append-only
> `listing_approvals`. **Recommend: approve.** Alternative: extend `ListingStatus` — rejected, because it
> destroys the ability to record "approved but paused".

---

## 5. Missing workflow collections

### Current state
**Present (45 collections)** — identity, organisations, catalogue, suppliers, pricing, tax, documents, audit.
**Absent:** `enquiries`, `supplier_matches`, `supplier_quotes`, `buyer_quotes`, `orders`, `shipments`,
`invoices`, `payments`, `settlements`, `notifications`.

### Current Prisma definition
The Prisma schema contains the *models* for several of these (measured earlier: `buyer_quotes`,
`buyer_quote_versions`, `orders`, `invoices`, `payments`, `settlements`, `tax_reviews` are defined in the
PostgreSQL record). They exist there as design, never as a live table.

### Business impact
The central business flow — enquiry → matching → quotation → order → dispatch → invoice → payment — cannot be
recorded at all. Every portal screen that shows it is an `ExampleData` layout for this reason. This is the
largest single gap in the platform.

### Recommended canonical design
See `PRIMEMET_DOMAIN_ARCHITECTURE.md` for the full ten-collection proposal. The principle applied there:
**reuse the existing vocabulary** (`EnquiryStatus`, `SupplierMatchStatus`, `BuyerQuoteStatus`, `SupplierQuoteStatus`,
`OrderStatus`, `ShipmentStatus`, `InvoiceStatus`, `PaymentStatus`, `SettlementStatus` are all already defined),
and store the *decision* — not a copy of the party or the profile — in every join table, so supplier identity and
internal pricing never leak into a buyer-facing read.

### Migration implications
Two `v002` steps rather than one (identity/approval first, workflow second), so each can be reviewed and rolled
back independently. No enum additions are required for enquiry, matching, quotation status, order, shipment,
invoice or payment — only for `ListingApprovalState` (§4).

### Owner decision required
> **D-ARCH-4.** Approve the phased creation order in `PRIMEMET_DOMAIN_ARCHITECTURE.md` §2 and the
> "store the decision, not a copy" rule. **Recommend: approve.**

---

## 6. City / district / industrial-area collections

### Current MongoDB definition
```js
// location_states        (exists)
{ code, name, countryCode, taxRegionCode, isServiced }

// supplier_listings
locationCityId: f.strOpt(),      // free string — NO ref, nothing to validate against
```

### Current Prisma definition
```prisma
/// Column retained; the FK to location_cities is added with migration 17 (M8) because that table
/// does not exist yet. Deliberately no relation field, so no dangling FK is created now.
locationCityId String? @map("location_city_id") @db.Uuid
```
The comment is honest about the gap, but note it references **migration 17**, while only seven migrations exist.

### Business impact
Three consequences:
1. `locationCityId` accepts any string — a city name, a typo, a UUID for a row that does not exist.
2. Delivery and pickup feasibility cannot be checked, so a buyer can request a destination PRIMEMET does not serve.
3. Location SEO pages (`SeoPageType` already has `LOCATION_CITY`, `LOCATION_DISTRICT`,
   `LOCATION_INDUSTRIAL_AREA`, `LOCATION_STATE`) have no data to publish, and the "never publish an unserviced
   location" rule has nothing to consult.

### Recommended canonical design
`location_cities` and `location_districts` as first-class collections, each carrying the coverage answer.

```
location_cities
  _id, stateId → location_states, districtId → location_districts?, name, slug,
  coverage enum CoverageLevel     // SERVICED | PICKUP_ONLY | REFERRAL_ONLY | NOT_SERVICED
  isServiced boolean              // derived from coverage, indexed for filters
  publicationState, unique (stateId, slug)

location_districts
  _id, stateId → location_states, name, slug, coverage, unique (stateId, slug)

location_industrial_areas          // optional, phase 4
  _id, cityId → location_cities, name, slug, coverage
```

`CoverageLevel` already exists with exactly these four values. `supplier_listings.locationCityId` then gains a
real `ref("location_cities")` — the reference it was always meant to have.

Publishing rule: a location page may publish only when `coverage != NOT_SERVICED`. `NOT_SERVICED` is a
first-class value, not the absence of a row, so "we looked and we do not serve it" is recorded rather than
inferred from silence.

### Migration implications
Additive `v002`. The `locationCityId` values currently in any seeded data are free strings and would need mapping;
no production data exists, so the ref can be introduced cleanly. If data existed, the migration would quarantine
unmapped values rather than guess.

### Owner decision required
> **D-ARCH-5.** Approve cities and districts now, industrial areas deferred, with `NOT_SERVICED` as an explicit
> value. **Recommend: approve.** Also confirm the serviced-city list is an owner input (O-27.8), not a default.

---

## 7. Notification / outbox

### Current MongoDB definition
**Nothing.** No `notifications`, no `email_deliveries`, no outbox.

### Current Prisma definition
`EmailStatus` enum exists (`QUEUED | SENDING | SENT | FAILED | BOUNCED | SUPPRESSED | CANCELLED`), implying an
email-delivery collection was designed but never written in either store.

### Business impact
Three concrete failures follow from sending mail inline instead of through an outbox:

1. **Enquiry lost on SMTP failure.** The brief's persist-before-notify rule cannot be honourred if the send is
   inside the same request without a durable record.
2. **No retry, no evidence.** A bounced quotation notification leaves no trace, and "we emailed them" is
   unprovable.
3. **Duplicate sends.** A retried request re-sends, because nothing records that it was already queued.

### Recommended canonical design
An outbox with claim-and-attempt semantics, not a queue that only exists in memory.

```
notifications                    (new; mutable — status changes are the point)
  _id, kind, templateKey, toEmail, toUserId?, organisationId?,
  relatedType, relatedId,          // e.g. "enquiry"/"ENQ-2026-000021"
  payload (object), status enum EmailStatus, attempts int,
  lastAttemptAt?, nextAttemptAt?, lastError?, providerMessageId?,
  sentAt?, createdAt
  index { status: 1, nextAttemptAt: 1 }      // the worker's claim query
  index { relatedType: 1, relatedId: 1 }

notification_attempts            (new; immutable: true)
  _id, notificationId, attempt, provider, outcome, error?, at
```

Rules: the enquiry (or any business record) is committed **first**, the notification row second, in the same
transaction; the worker claims rows with an atomic `findOneAndUpdate` on
`{ status: QUEUED, nextAttemptAt <= now }`; a send is only ever attempted from a claimed row; `SUPPRESSED` is
honoured so a hard bounce stops further attempts.

`EmailStatus` is reused unchanged — no enum work needed.

### Migration implications
Additive `v002`. No backfill.

### Owner decision required
> **D-ARCH-6.** Approve the outbox now (collection + status model) while accepting that the worker and the mail
> provider arrive in Phase 7. **Recommend: approve** — creating the collection early costs nothing and prevents
> the "send inline for now" shortcut that would have to be undone later.

---

## 8. Document storage and access

### Current MongoDB definition
```js
// documents — metadata only, and deliberately so
{ storageKey, bucket, originalFilename, mimeType, sizeBytes, checksumSha256,
  documentType enum DocumentType, visibility enum DocumentVisibility, sensitivity,
  ownerOrgId, uploadedById, scanStatus enum ScanStatus, scanResult,
  retentionUntil, legalHold, supersededById, createdAt }
invariants: [ "CLEAN scan requires a scan result" ]
indexes: unique storageKey, { ownerOrgId, documentType }, { checksumSha256 }, { retentionUntil }

// document_access_logs — exists
```
**No bytes, no URL, no public link** — correct by design.

### Current Prisma definition
Same shape (the PostgreSQL record defines `Document` with the same fields and the same "no URL" rule).

### Business impact
The metadata model is sound; the *pipeline* is absent, so nothing can be uploaded, served or purged:

1. no storage provider is configured, so `storageKey` can never be satisfied;
2. no upload guard, so a 40 MB PDF or a `.exe` is not rejected before it lands;
3. no signed-access path, so a buyer-visible test report and an internal margin sheet are separated only by a
   field neither store enforces on read;
4. no retention job, so `retentionUntil` and `legalHold` are data nobody acts on.

The genuinely dangerous one is (3): `visibility` is a *label*, and a label is not an access control.

### Recommended canonical design
Keep the metadata model exactly as it is. Add the missing four pieces:

```
Storage        private bucket only; no public ACL, no static path, no signed-forever URL.
Upload guard   allowed MIME allow-list per DocumentType; max size per type; checksum re-verified
               server-side after upload; filename treated as untrusted display text only.
Serve path     short-lived signed URL minted per request, only after an authorisation check that
               reads visibility AND ownerOrgId AND the caller's relationship to the order/enquiry.
Access log     document_access_logs gains one row per serve (who, when, which document, purpose).
Retention      a purge job that refuses while legalHold = true and while any reference exists;
               supersede rather than overwrite.
```

The read rule, stated once so it cannot be re-derived differently per screen:

```
mayRead(caller, doc) =
  doc.visibility = INTERNAL            → caller is ADMIN (and, for supplier cost, holds the cost permission)
  doc.visibility = BUYER_VISIBLE       → caller is the buyer on the owning enquiry/order
  doc.visibility = SUPPLIER_VISIBLE    → caller is the supplier on the owning enquiry/order
  any other caller                     → refused, and logged
```

### Migration implications
None to the collections beyond what exists. The `bucket` field already anticipates a storage provider.

### Owner decision required
> **D-ARCH-7.** Approve a private-bucket, signed-URL-only storage provider and the read rule above; confirm which
> provider (and therefore which region) — this is the same decision family as O-27.7 (hosting region), and the
> two should be made together so documents do not end up in a different jurisdiction from the database.

---

## 9. What this document does not change

No collection, validator, index, enum, migration, role, script or application file was modified. `db:validate:offline`
still reports 45 collections / 94 indexes because the definitions are untouched. Every proposal above is a design
for review.
