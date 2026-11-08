# PRIMEMET — Domain Architecture Proposal

**Status:** design for review. No collection created, no migration written, no database contacted.
**Scope:** the ten collections that complete the managed-sourcing model.
**Governing rules:** PRIMEMET quotes and contracts; it is not an open marketplace. Supplier identity, supplier
cost and internal margin never appear in a buyer-facing field. Existing vocabulary is reused — 67 enums already
exist in `db/enums.mjs`, and this proposal adds **one** (`ListingApprovalState`).

---

## 1. Design principles

1. **Store the decision, not a copy.** A match row records *which supplier was chosen and why*, not a snapshot of
   the supplier's profile. Profiles change; the decision must not silently change with them.
2. **Two prices, never one.** `supplierCost` (internal) and `offeredPrice` (buyer-facing) live in different
   collections with different visibility, not as two columns on one row that a careless `select` can return
   together.
3. **Append-only where the value is evidence.** Approvals, matches, quote versions and audit trails are insert-only.
   Current state is a projection, not a mutable flag that erases its own history.
4. **No status without a gate.** Every terminal state names the permission required to enter it.
5. **Absence is a value.** `NOT_SERVICED`, `UNKNOWN` and `NOT_REQUIRED` are recorded explicitly, never inferred
   from a missing row.
6. **Quantity never touches material identity.** A grade has no stock; a listing does.

---

## 2. Creation order

| Step | Collections | Depends on | Unlocks |
|---|---|---|---|
| **D-1** | `listing_approvals`, listing approval fields | — | Phase 4 |
| **D-2** | `location_cities`, `location_districts` | `location_states` ✔ | Phase 3 intake |
| **D-3** | `enquiries`, `enquiry_items`, `enquiry_events` | D-2 | Phase 3 |
| **D-4** | `supplier_matches` | D-3, listings | Phase 5 |
| **D-5** | `supplier_quotes`, `supplier_quote_lines` | D-4 | Phase 5 |
| **D-6** | `buyer_quotes`, `buyer_quote_versions`, `buyer_quote_lines` | D-5 | Phase 5 |
| **D-7** | `orders`, `order_items` | D-6 | Phase 6 |
| **D-8** | `shipments`, `weighments` | D-7 | Phase 6 |
| **D-9** | `invoices`, `payments`, `settlements` | D-7 | Phase 6 |
| **D-10** | `notifications`, `notification_attempts` | any | Phase 7 |

Each step is independently reviewable and independently reversible. Nothing later is required by anything earlier.

---

## 3. Enquiries

```
enquiries                              (mutable: status changes are the point)
  _id                    uuid
  reference              string, unique       // ENQ-2026-000021 via reference_sequences (exists)
  journey                enum EnquiryJourney  // SUPPLY | BUYER_REQUIREMENT  (new, 2 values)
  source                 enum EnquirySource   // WEB_FORM | PHONE | EMAIL | ... (exists)
  status                 enum EnquiryStatus   // 13 values (exists)
  priority               enum EnquiryPriority // exists
  buyerOrgId             ref organisations?   // null only for ADMIN_ENTRY (see rule below)
  buyerUserId            ref users?
  submittedByUserId      ref users?           // the human who submitted; survives role change
  contactName/Email/Phone                     // as submitted, not copied from profile
  destinationStateId     ref location_states
  destinationCityId      ref location_cities?
  requirementKind        enum RequirementKind // SCRAP | SPARE_PARTS | MIXED (new)
  deliveryPreference     string
  targetDate             date?
  notes                  string?
  assignedToId           ref users?           // sourcing desk owner
  qualificationSummary   object?              // computed readiness, never authoritative
  createdAt, updatedAt, closedAt?

enquiry_items                          (what is being asked for)
  _id, enquiryId → enquiries
  kind                   enum RequirementKind
  gradeId                ref scrap_grades?
  productId              ref products?
  quantity               decimal
  uom                    string
  specificationText      string?          // free text; UNKNOWN is recorded, never rejected
  unknownFields          string[]         // e.g. ["grade","quantity"] — drives clarification
  targetPrice            decimal?         // internal only, never returned to a supplier

enquiry_events                         (immutable: true)
  _id, enquiryId, actorId → users?, event, fromStatus?, toStatus?, payload object, createdAt
```

### Rules

| # | Rule | Enforced by |
|---|---|---|
| E1 | A buyer requirement must have `buyerOrgId` | validator invariant |
| E2 | A party-less enquiry requires `source = ADMIN_ENTRY` **and** `submittedByUserId` **and** a non-empty `reason` | validator invariant |
| E3 | A supply submission (seller offering material) never gets the admin exception | write path |
| E4 | `WON`/`LOST`/`CANCELLED` are terminal; no transition out | write path |
| E5 | Every status change appends an `enquiry_events` row in the same transaction | write path |
| E6 | `UNKNOWN` in a technical field creates a clarification task, never a rejection | write path |

### Lifecycle

```
NEW → UNDER_REVIEW → MATCHING_SUPPLIERS → QUOTES_REQUESTED → QUOTES_RECEIVED
    → COMPARING_QUOTES → QUOTE_DRAFTED → QUOTE_SENT → NEGOTIATION
    → [WON | LOST | CANCELLED]
BUYER_SELLER_INTRODUCTION is reachable only from NEGOTIATION and only with an approved contact share.
```

Every arrow requires the `ENQUIRY_EDIT` permission; `WON` additionally requires a linked `orders` row.

---

## 4. Supplier matching

```
supplier_matches                       (immutable: true — a match is a decision, not a preference)
  _id, enquiryId → enquiries, enquiryItemId → enquiry_items
  supplierId             ref supplier_profiles
  listingId              ref supplier_listings?
  status                 enum SupplierMatchStatus   // PROPOSED | APPROVED_FOR_RFQ | RFQ_SENT |
                                                    // QUOTE_RECEIVED | DECLINED | WITHDRAWN | EXCLUDED
  score                  decimal?                   // internal ranking, never exposed
  rationale              string                     // why this supplier: capability, distance, history
  matchedById            ref users
  rfqSentAt, quoteReceivedAt?
  exclusionReason        string?
  createdAt
  index { enquiryId: 1, status: 1 }, index { supplierId: 1, createdAt: -1 }
```

**Why immutable:** a match is a commercial decision taken at a point in time. Re-running matching must not
rewrite why the previous shortlist was chosen — objections and disputes turn on exactly that record. Status
changes are appended as new rows; "current status" is the latest row per `(enquiryItemId, supplierId)`.

---

## 5. Quotations

Two separate chains, deliberately never merged into one row.

```
supplier_quotes                        (what a supplier offers PRIMEMET; INTERNAL)
  _id, reference (SQ-2026-000004), enquiryId, supplierId, matchId
  status                 enum SupplierQuoteStatus   // DRAFT | SUBMITTED | SUPERSEDED | WITHDRAWN | EXPIRED
  currencyCode, validUntil
  subtotal, taxTotal, freight, total    decimal(18,2)
  paymentTerms, deliveryTerms, leadTimeDays
  submittedAt, createdAt

supplier_quote_lines
  _id, supplierQuoteId, enquiryItemId, description
  quantity, uom, unitRate decimal(18,4), lineTotal decimal(18,2)
  gradeId, productId, notes

buyer_quotes                           (what PRIMEMET offers the buyer; EXTERNAL)
  _id, reference (BQ-2026-000011), enquiryId, buyerOrgId
  status                 enum BuyerQuoteStatus      // DRAFT | PENDING_APPROVAL | APPROVED | SENT |
                                                    // VIEWED | NEGOTIATION | ACCEPTED | REJECTED |
                                                    // EXPIRED | SUPERSEDED | CANCELLED
  transactionModel       enum TransactionModel      // PRINCIPAL | AGENCY | MANAGED_SUPPLY
  currentVersionId       ref buyer_quote_versions?
  createdById, approvedById?, sentAt?, acceptedAt?
  createdAt, updatedAt

buyer_quote_versions                   (immutable: true — a sent quote is evidence)
  _id, buyerQuoteId, version int (unique with buyerQuoteId)
  supplierCostTotal      decimal(18,2)   // INTERNAL — never in a buyer DTO
  marginAmount           decimal(18,2)   // INTERNAL
  offeredSubtotal        decimal(18,2)
  taxSnapshot            object          // per-component: code, rate, base, amount, jurisdiction,
                                         // effectiveFrom, ruleId, calculatedAt
  freight, handling, total               decimal(18,2)
  terms                  string
  taxReviewId            ref tax_reviews?
  createdById, createdAt, supersedesVersionId?

buyer_quote_lines
  _id, versionId → buyer_quote_versions, enquiryItemId
  description, quantity, uom, unitPrice decimal(18,4), lineTotal decimal(18,2)
  // NO supplierCost, NO supplierId — the buyer never learns who supplied it
```

### Rules

| # | Rule | Enforced by |
|---|---|---|
| Q1 | A version is immutable once `status >= SENT`; changes create a new version | write path |
| Q2 | `total` must equal the sum of its lines plus tax — recomputed server-side | write path |
| Q3 | Buyer responses are built from `buyer_quote_*` only; `supplierCostTotal` and `marginAmount` never serialised | DTO allow-list |
| Q4 | Approval requires `QUOTE_APPROVE`; above the configured value it requires a second approver | write path (dual control, O-17.4) |
| Q5 | If the tax treatment has `requiresAdminReview`, no version may be `APPROVED` without a `tax_reviews` row | write path |
| Q6 | `transactionModel` is frozen once a version is `SENT` | write path |

### Lifecycle

```
buyer_quote: DRAFT → PENDING_APPROVAL → APPROVED → SENT → VIEWED → [ACCEPTED | REJECTED | EXPIRED]
                                          ↑            ↓
                                    (new version) ← NEGOTIATION → SUPERSEDED
ACCEPTED creates exactly one order and is not reversible without a cancellation record.
```

---

## 6. Orders and fulfilment

```
orders                                 (mutable: fulfilment progresses)
  _id, reference (SO-2026-000007)
  enquiryId, buyerQuoteId, buyerQuoteVersionId   // the exact approved version, not "the latest"
  transactionModel       enum TransactionModel   // frozen from the quote
  inventoryMode          enum InventoryMode      // BACK_TO_BACK | STOCK (exists)
  status                 enum OrderStatus        // DRAFT … CLOSED | CANCELLED
  buyerOrgId, supplierId? (principal only)
  totalAmount            decimal(18,2)
  taxSnapshot            object                  // frozen at order creation
  confirmedAt, closedAt?, cancelledAt?, cancellationReason?
  createdAt, updatedAt

order_items
  _id, orderId, enquiryItemId, description, quantity, uom,
  unitPrice decimal(18,4), lineTotal decimal(18,2)
  // supplier cost lives in order_cost_lines, a separate internal collection

shipments                              (mutable: movement progresses)
  _id, orderId, reference (SH-2026-000002)
  status                 enum ShipmentStatus     // PLANNED | DISPATCHED | IN_TRANSIT |
                                                 // DELIVERED | FAILED | RETURNED
  dispatchAuthorisedById ref users, long          // the gate; see rule D1
  vehicleRef, transporterName, ewayBillNumber
  plannedDispatchAt, dispatchedAt, deliveredAt
  destinationCityId      ref location_cities

weighments                             (immutable: true — a scale reading is evidence)
  _id, orderId, shipmentId?, stage enum WeighmentStage
  grossKg, tareKg, netKg decimal(18,3)
  weighbridgeName, slipDocumentId → documents
  recordedById, recordedAt
```

### Rules

| # | Rule | Enforced by |
|---|---|---|
| O1 | An order references one **exact** quote version — never "current" | schema |
| O2 | `taxSnapshot` and `transactionModel` are frozen at creation | write path |
| D1 | `IN_TRANSIT` requires `dispatchAuthorisedById` **and** a passing inspection for the lot | write path |
| D2 | Net weight for settlement is the average of recorded weighments, or the buyer-accepted figure | write path |
| D3 | A dispute blocks `CLOSED` | write path |

---

## 7. Invoices, payments, settlements

```
invoices                               (mutable until ISSUED, then corrections only)
  _id, reference (INV-2026-000021)
  orderId, invoiceRole enum InvoiceRole       // MATERIAL | COMMISSION | SERVICE_FEE | FREIGHT | OTHER
  issuerOrgId, recipientOrgId                 // agency: material doc may be issued by the supplier
  passThrough            boolean              // goods PRIMEMET never owned
  counterpartyInvoiceId  ref invoices?        // links material doc ↔ fee doc
  subtotal, taxTotal, total decimal(18,2)
  taxSnapshot            object               // frozen per component, per document
  status                 enum InvoiceStatus   // DRAFT | ISSUED | PARTIALLY_PAID | PAID | VOID | CREDITED
  issuedAt, dueAt?
  documentId             ref documents?

payments                               (immutable: true — money movement is evidence)
  _id, reference (PMT-2026-000033)
  direction              enum PaymentDirection   // INBOUND | OUTBOUND (exists)
  partyOrgId             ref organisations
  invoiceId              ref invoices?
  amount decimal(18,2), currencyCode, method, reference, paidAt
  recordedById, createdAt

settlements                            (mutable: status only)
  _id, orderId, status enum SettlementStatus     // PENDING | PARTIALLY_SETTLED | SETTLED | WRITTEN_OFF
  receivable, payable, margin  decimal(18,2)     // INTERNAL
  updatedAt
```

**Agency rule, restated because it is the one most likely to be got wrong:** the material invoice may be issued
by the *supplier* to the *buyer*; PRIMEMET's own revenue is the commission document. `passThrough = true` marks
the former, and **only** `issuerOrgId = PRIMEMET` counts as PRIMEMET revenue. Tax and invoicing treatment for agency
remains pending CA confirmation (D5 / O-15.4a-P).

---

## 8. Notifications (outbox)

As specified in `PRIMEMET_ARCHITECTURE_CLOSURE.md` §7: `notifications` (mutable, `EmailStatus`) plus
`notification_attempts` (immutable). The business record commits first; the notification row commits second; a
worker claims and sends. `SUPPRESSED` stops all further attempts after a hard bounce.

---

## 9. Listing approvals

As specified in `PRIMEMET_ARCHITECTURE_CLOSURE.md` §4: an `approvalState` axis on `supplier_listings` plus
append-only `listing_approvals`. Approval is not a `ListingStatus` value, because an approved listing can
legitimately be paused, and pausing must not erase the fact of approval.

---

## 10. Location hierarchy

As specified in `PRIMEMET_ARCHITECTURE_CLOSURE.md` §6: `location_cities` and `location_districts` with an explicit
`CoverageLevel`, `NOT_SERVICED` recorded rather than implied, and `supplier_listings.locationCityId` promoted from
free string to a real reference.

---

## 11. Confidentiality map — which field may cross which boundary

| Data | Buyer sees | Supplier sees | Admin sees | Never exposed |
|---|---|---|---|---|
| Grade, specification, quantity | ✅ own enquiry | ✅ matched item only | ✅ | — |
| Offered price | ✅ own quote | ❌ | ✅ | — |
| Supplier identity | ❌ (until an approved contact share) | ✅ own | ✅ | public pages, search, listings |
| Supplier cost (`supplierCostTotal`) | ❌ | ❌ | ✅ cost permission | any buyer/supplier DTO |
| Margin (`marginAmount`) | ❌ | ❌ | ✅ | all external responses |
| Internal notes, match score, ranking | ❌ | ❌ | ✅ | — |
| Inspection report | ✅ only if `BUYER_VISIBLE` | ✅ own submission | ✅ | unless explicitly shared |
| Contact details | own only | own only | ✅ with `CONTACT_APPROVE_SHARE` | public, search, listings |
| Tax snapshot | totals only | ❌ | ✅ | internal rate breakdown |

Every "❌" is a DTO rule, not a UI decision. A field that is not in the allow-list is not serialised, so a screen
cannot leak what the response never contained.

---

## 12. What is not proposed, and why

- **No `products`/`materials` duplication.** `products`, `materials`, `material_grades`, `scrap_grades` and
  `product_types` already exist and are used by the catalogue pages. The workflow collections reference them.
- **No second party model.** `organisations`, `buyer_profiles`, `supplier_profiles` are reused as-is.
- **No stock tables yet.** `InventoryMode` has a `STOCK` value, but `stock_positions` / `stock_movements` stay
  deferred until back-to-back is proven (D6).
- **No `seo_pages` here.** Programmatic SEO is a separate phase; `SeoPageType` already enumerates the page kinds.

---

## 13. Open questions for the owner

| ID | Question | Recommend |
|---|---|---|
| D-ARCH-4 | Approve the phased creation order in §2 | approve |
| D-ARCH-8 | `EnquiryJourney` and `RequirementKind` as two separate enums, or one? | two — they answer different questions |
| D-ARCH-9 | Should `supplier_matches` really be immutable (status appended as new rows)? | yes — a shortlist is a decision |
| D-ARCH-10 | Clarification SLA before an enquiry is auto-flagged stale | owner input (O-27.3) |
| D-ARCH-11 | Is buyer-visible inspection evidence allowed by default, or opt-in per report? | opt-in — safer default |
