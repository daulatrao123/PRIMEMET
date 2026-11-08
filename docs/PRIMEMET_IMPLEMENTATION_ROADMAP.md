# PRIMEMET — Implementation Roadmap (P0–P6)

**Prepared:** 2026-11-02
**Prepared by:** the implementing agent (Exvisit), at owner request
**Basis:** `docs/PRIMEMET_COMPLETE_PRODUCT_READINESS_AUDIT.md` (every finding referenced as §n of that
document). **Nature:** a plan. No code, schema, workflow or configuration was changed to produce it,
and nothing in this roadmap is approved. It is a proposal for the owner to accept, amend or reject.
**Effort units:** engineer-days for one senior full-stack engineer, ±30%. They are estimates, not
commitments, and they exclude owner-decision latency.

---

## 0. How this roadmap is ordered, and why

The ordering is forced by dependencies in the repository, not by preference:

1. **Nothing can be protected before it can identify a request.** Authentication must precede every
   write path, or the first connected database exposes every record (§6.5).
2. **Authentication cannot be signed off before the database design supports it.** W3 needs a fourth
   role, W2-s needs the platform-identity pointer moved by a new migration (§6.4). These are schema
   changes and they come before the login page, not after it.
3. **A write path cannot be tested before a datastore exists.** `MONGODB_URI` is unset and no cluster
   is provisioned (§7.1).
4. **A quotation cannot exist before an enquiry exists; an order cannot exist before a quotation.**
   The commercial engine is a chain (§8.2).
5. **Money movement comes last.** Invoicing and payments depend on orders, tax snapshots and
   approvals; starting them earlier produces throwaway work.

### Dependency graph

```
P0 stop-the-bleed ──► P1 architecture closure ──► P2 identity (M2a) ──► P3 persistence spine
                                                                              │
                                                                              ▼
                                            P6 money + operations ◄── P5 commercial engine ◄── P4 supply side
```

P0 and P1 are small and unblock everything. P3, P4 and P5 are sequential in data terms but P4 and P5
can overlap once P3 ships the enquiry and organisation records. P6 depends on P5 and on the operations
work landing with it.

### Rules that apply to every phase

- No feature starts from an unapproved decision. If a task names a decision ID, that decision must be
  accepted and dated in the decision register first (§8.3).
- No screen ships without a writer behind it, and no empty table is presented as a feature. If a page
  cannot show a real record, it says so — the current `NotConnected` / `ExampleData` pattern is the
  standard to keep (§3).
- Every phase ends with its acceptance criteria run as commands, and the numbers recorded in the
  phase's completion note. Green means observed, not assumed.
- No phase may weaken, skip or delete an existing check to reach green.

---

## P0 — Stop the bleeding (effort 1–2 days, no product dependency)

**Objective:** remove the two live risks that need no design decision, and stop the repository from
misdescribing itself.

| ID | Task | Depends on | Acceptance criteria | Est. |
|---|---|---|---|---|
| P0-1 | Make `.github/workflows/db-init.yml` manual-only (`on: workflow_dispatch`), matching what `PROJECT_SUMMARY.md` already states | — | A push touching `db/**` or `package.json` triggers **no** workflow run; `workflow_dispatch` still runs it; the workflow file no longer contains `push:` to `main` | 0.5 |
| P0-2 | Add required reviewers to the `production-database` environment; confirm the secret is absent | P0-1 | `gh api` shows a protection rule with ≥1 required reviewer; no `MONGODB_URI` secret exists at repo or environment scope | 0.5 |
| P0-3 | Add a machine-checked `Status:` header (`PROPOSAL` / `APPROVED` / `SUPERSEDED`) to every file in `docs/`, plus a check that fails when it is missing | — | `npm run check:docs-status` passes 25/25; a new unstamped document fails it | 0.5 |
| P0-4 | Correct the stale "figures will come from PostgreSQL" copy on the admin dashboard and audit the tree for other PostgreSQL references in user-visible strings | — | `grep -rn "PostgreSQL" src/` returns no user-visible string; `npm run build` exit 0; `check:content` unchanged | 0.5 |

**Phase exit:** the three commands in P0-1/P0-3 run green, and a push to a scratch branch demonstrates
no workflow trigger.

---

## P1 — Architecture closure and the decision register (effort 5–7 days)

**Objective:** make one data architecture true, and convert the proposals that block P2 into dated
decisions. Nothing here is a feature; everything here prevents rework.

| ID | Task | Depends on | Acceptance criteria | Est. |
|---|---|---|---|---|
| P1-1 | Owner decides `D-ARCH-1…7`, `D-TIER-1`, `D-M2a-2`, `D-M2a-3`, `D-BOOT-1…4`, `P-1`; each recorded with a date, a decider and a one-line rationale | P0-3 | 15 decision entries marked `APPROVED` with dates; `check:docs-status` still passes; no `OPEN` decision is referenced by any P2+ task | 2–3 |
| P1-2 | Choose the Prisma disposition: archive it (delete the dependency, retire `check:schema` from the gate, move `prisma/` and `scripts/m1-baseline/` to an archive position) **or** keep it as an annotated baseline artefact | P1-1 | Exactly one of the two states exists; if archived, `grep -r "@prisma/client" src/ scripts/` is 0 and `package.json` no longer lists `prisma`/`@prisma/client`; `npm run build` and the full gate pass | 1–2 |
| P1-3 | Single source for enum vocabulary: generate the documented counts from `db/enums.mjs`, resolving the measured 69-vs-67 discrepancy | P1-2 | A generated artefact states the count; `check:enums` asserts the documented number equals the exported number; the drift is impossible to reintroduce silently | 1 |
| P1-4 | Migration policy: require a documented down/rollback path (or a stated, reviewed reason for irreversibility) for every new migration | P1-3 | `check:migrations` fails a migration without a rollback note; the 5 existing migrations carry the annotation | 0.5–1 |
| P1-5 | Provision the development MongoDB cluster, set `MONGODB_URI` in a non-production environment, apply `v001…v005`, record `db:status` / `db:verify` output **and the wall-clock duration of the first full apply** (the audit could not complete an in-process apply in 600 s) | P1-1 | `npm run db:status` reports 5 applied migrations against the dev cluster; `audit:permission-integrity` now runs instead of refusing (§11.1 row 27); the apply duration is recorded and compared against the CI job timeout | 0.5–1 |

**Phase exit:** one architecture, one enum source, one migration policy, one reachable dev database,
and every decision that P2 depends on dated and approved.

---

## P2 — Identity: the M2a authentication foundation (effort 15–22 days)

**Objective:** a request has an identity, a session and a role, and the portals close. This is the
phase the brief said not to begin during the audit; it begins only after P1-1 is signed.

| ID | Task | Depends on | Acceptance criteria | Est. |
|---|---|---|---|---|
| P2-1 | **W3 — fourth database role.** Create a writer identity that alone holds `insert` on `admin_permission_grants` and `PERMISSION_LOG_KEY`; remove `insert` from `primemet_app` | P1-1, P1-5 | Direct insert as `primemet_app` is **refused**, not merely tamper-evident; `check:authz` W3.1 and W3.3 flip to SATISFIED; `check:permissions` and `check:adversarial` still pass | 3–4 |
| P2-2 | **W2-s — migration `v006`** moves the platform-identity pointer into a collection the application role cannot update | P2-1 | `check:authz` W2.2 and W2.6 flip to SATISFIED; app-role update of the pointer is refused; continuity fence still functions; `check:migrations` and `check:bootstrap` pass | 3–4 |
| P2-3 | Session and credential core: Argon2id (per `D-M2a-1`), server-side session store, secure cookie flags, rotation on privilege change, logout, password reset | P2-1 | Login/logout/reset exercised end-to-end against the dev cluster; a forged or expired session is rejected `401`; password never logged; `argon2` is a real dependency with a verified native build | 4–6 |
| P2-4 | Middleware guard on `/admin`, `/buyer`, `/seller`: unauthenticated → redirect/`401`; role mismatch → `403`; replace the pass-through in `src/middleware.ts` | P2-3 | Every portal URL measured in §11.1 row 28 now answers `302`/`401`/`403` anonymously; the 35-URL probe is turned into a permanent check (`check:authz:http`) that fails if any portal route returns `200` anonymously | 1–2 |
| P2-5 | Wire `src/lib/permissions/*` into the request path: resolve the actor's tier and organisation, enforce on each portal route, and make the admin permission UI read from real grants | P2-4 | Organisation A cannot read organisation B's route (tested by two seeded orgs); an admin without the tier gets `403`; the 52 authz properties are exercised through HTTP, not only through the library | 2–3 |
| P2-6 | Baseline hardening on the authenticated surface: CSP, HSTS, `X-Frame-Options`/frame-ancestors, `Referrer-Policy`, `Permissions-Policy`, CSRF tokens on mutations, rate limiting on login/reset | P2-4 | `curl -I` on a portal page shows all six headers; a login attempt above the limit returns `429`; a mutation without a token is refused `403`; no page breaks under the CSP (checked by `check:content` and `check:wizard`) | 2–3 |

**Phase exit:** the anonymous-probe check is green in its inverted form (no portal route is public),
`check:authz` reports 0 open brief-matrix questions except those explicitly deferred with a decision
ID, and the independent reviewer package is updated with the new evidence.

---

## P3 — Persistence spine: enquiry, organisation, documents, notifications (effort 18–26 days)

**Objective:** the first business record that survives a restart, and the machinery that tells a human
it exists.

| ID | Task | Depends on | Acceptance criteria | Est. |
|---|---|---|---|---|
| P3-1 | Enquiry persistence: the wizard's disabled submit becomes a server action that validates (zod), writes an `enquiries` row, and returns a reference | P2-3, P1-5 | Submitting the wizard in Chrome creates a row that `/admin/enquiries` lists; invalid input returns field errors and writes nothing; double submit is idempotent | 3–4 |
| P3-2 | `enquiries` collection + validator + indexes, in a plain-JS migration `v007` with a rollback note (P1-4) | P1-4 | `db:validate:offline` and `check:mongodb` pass with the new collection; the migration applies and is recorded in the ledger; the app role holds no update/delete on it | 1 |
| P3-3 | Reference sequence generator (`reference_sequences`) per the approved `P-1` format | P3-2 | Concurrent submissions produce unique, gapless-per-day references under a load test of 100 parallel writes; a refused write consumes no number | 1–2 |
| P3-4 | Organisation model and buyer account: registration writes `organisations`, `organisation_addresses`, `organisation_contacts`, `users`; the `orgKind` invariant and one-PRIMEMET rule are enforced on write | P2-5, P3-2 | A buyer registration creates a live organisation and a user; relabelling `orgKind` is refused; a second PRIMEMET identity is refused; the new account sees only its own org | 4–6 |
| P3-5 | Document pipeline: private storage client, signed URLs with short TTL, `scanStatus` transition, `document_access_logs` writer, purge/legal-hold job | P3-4 | A PDF uploaded by a buyer is stored, scanned (stub provider acceptable if labelled), and downloadable only through a signed URL that expires; every access is logged; an unscanned document is never served | 4–6 |
| P3-6 | Notification outbox + email delivery (Zoho SMTP or an approved provider): enqueue on enquiry creation, reference issued, document reviewed; retries and failure recording | P3-1 | The outbox row is written in the same transaction as the enquiry; a failed send is retried and then recorded as failed; no email content is logged with PII; a test provider captures the message | 3–5 |
| P3-7 | Convert the buyer portal previews to real reads: dashboard counts, enquiry list, enquiry detail | P3-1 | Every buyer portal figure is computed from records; a new buyer account sees zeros with an honest empty state, never `ExampleData` | 2 |

**Phase exit:** a stranger can register, submit an enquiry, receive a reference by email, and an
administrator can see that enquiry in the queue — the first genuinely end-to-end journey (audit
Journey 1) at TESTED/INTEGRATION VERIFIED level.

---

## P4 — Supply side: sellers, listings, matching, RFQ (effort 15–22 days)

**Objective:** the other side of the marketplace exists as records, and an enquiry can be turned into
work for suppliers.

| ID | Task | Depends on | Acceptance criteria | Est. |
|---|---|---|---|---|
| P4-1 | Seller registration and organisation profile; GST field with format validation and a verification record | P3-4 | A seller registration creates a live organisation with a supplier role; an invalid GSTIN is refused; verification state is stored and displayable | 2–3 |
| P4-2 | Listing CRUD with the approval workflow decided in `D-ARCH-3` (state + append-only history) | P4-1 | A listing moves DRAFT → SUBMITTED → APPROVED/REJECTED with every transition recorded; an unapproved listing is invisible to buyers and to matching; the seller cannot approve their own listing | 3–4 |
| P4-3 | Supplier profile, materials and capacity fields; link listings to canonical materials | P4-2 | A listing references a canonical material; capacity and availability are stored and queryable; the public catalogue can state availability from records | 2–3 |
| P4-4 | Supplier matching: a scored match from enquiry → eligible suppliers (material, form, location, capacity), persisted with a status from `SupplierMatchStatus` | P4-2 | A seeded enquiry returns ranked, explainable candidates; a supplier with no approved listing never appears; the match is stored with its score inputs | 3–4 |
| P4-5 | RFQ dispatch: create an RFQ per selected supplier, notify by email, expose it in the seller portal with a deadline | P4-4, P3-6 | An admin dispatches 3 RFQs; 3 emails are captured; each seller sees only their own RFQ; a deadline passing marks it expired | 3–4 |
| P4-6 | Admin supplier qualification screen reads real profiles and verification records | P4-5 | The admin screen lists real suppliers with real statuses; approve/reject writes an append-only decision | 2 |

**Phase exit:** audit Journey 2 (admin review → supplier discovery → RFQ) is INTEGRATION VERIFIED on a
seeded development database.

---

## P5 — Commercial engine: quotations, orders, fulfilment (effort 22–31 days)

**Objective:** money can be quoted, approved and ordered — still without moving money.

| ID | Task | Depends on | Acceptance criteria | Est. |
|---|---|---|---|---|
| P5-1 | Supplier quotation submission: seller form writes a `supplier_quotations` record with cost, validity, terms; versioned, immutable once superseded | P4-5 | A seller submits a quote; resubmission creates a new version and leaves the old one readable; the admin comparison shows real costs and never leaks them to a buyer payload | 3–4 |
| P5-2 | Cost and margin engine: supplier cost + freight + processing → buyer price, with the transaction model (`PRINCIPAL`/`AGENCY`/`MANAGED_SUPPLY`) selecting the rule set | P5-1, P1-1 | For each model, a worked example computes price and margin with a stored calculation snapshot; changing a rule version never rewrites history; a test asserts the three models produce materially different pricing | 3–4 |
| P5-3 | Tax application and snapshots (`taxSnapshot` per `T16`): rate resolution by HSN/state, stored on the quotation | P5-2 | A quotation stores the tax basis, rate and amount at issue time; a later rate change does not alter an issued quotation | 2–3 |
| P5-4 | Buyer quotation generation, versioning and approval (`BuyerQuoteStatus`, `BuyerApprovalState`) with an approval trail | P5-3 | A quotation is issued with a version; approval by the right tier is recorded append-only; an unapproved quotation cannot become an order | 3–4 |
| P5-5 | Orders: create from an approved quotation, `orders` collection, status machine per `OrderStatus`, admin order route (currently missing) | P5-4 | An approved quotation creates exactly one order; status transitions are guarded; the admin route exists and lists real orders; buyer and seller see only their own | 3–4 |
| P5-6 | Inspections, dispatch and fulfilment (`ShipmentStatus`), with inspection records and evidence linked to the document pipeline | P5-5, P3-5 | An inspection record is attached to an order with evidence documents; dispatch moves the status and notifies both parties; an order cannot ship without a passed inspection if the rule set requires it | 3–4 |
| P5-7 | Operations baseline: structured logs, error reporting, uptime/health alerting, Atlas backup + PITR policy, and one executed restore drill | P5-5 | A restore from backup into a scratch cluster reproduces the seeded dataset and is documented with timings; `db:check-role` proves the deployed identity is not the owner | 5–8 |

**Phase exit:** audit Journeys 3–6 are INTEGRATION VERIFIED, and the platform has a restore that has
actually been executed once.

---

## P6 — Money and disputes (effort 10–15 days, phase 2)

**Objective:** invoices, payments, settlements and disputes — the last mile that requires a provider.

| ID | Task | Depends on | Acceptance criteria | Est. |
|---|---|---|---|---|
| P6-1 | Invoice generation from an order, with tax snapshot reuse and immutable numbering | P5-5 | An invoice is generated once per order, numbering is gapless per series, and a corrected invoice is issued as a credit note rather than an edit | 3–4 |
| P6-2 | Payment provider integration and reconciliation (`PaymentStatus`), webhook verification and idempotency | P6-1 | A sandbox payment marks the invoice paid exactly once under replay; an unsigned webhook is refused; reconciliation report matches provider settlement | 4–6 |
| P6-3 | Settlements to suppliers per transaction model (`SettlementStatus`) | P6-2 | For AGENCY and MANAGED_SUPPLY, a settlement record is produced with the correct basis; PRINCIPAL produces none; totals reconcile to margin | 2–3 |
| P6-4 | Refunds, cancellations and disputes (`DisputeStatus`) with an append-only trail and buyer/seller visibility | P6-3 | A cancellation after payment creates a refund record and reverses settlement; a dispute moves through its states with every event recorded; neither party sees the other's internal notes | 1–2 |

**Phase exit:** audit Journey 5 extends through payment, and the money trail is reconstructible from
append-only records alone.

---

## Cross-cutting gates

| Gate | Applies to | Command-level proof |
|---|---|---|
| No public portal route | P2 onwards | `check:authz:http` — every portal URL non-200 anonymously |
| No unapproved decision implemented | every phase | `check:docs-status` + decision register review |
| No fake data in UI | P3 onwards | A grep-level check that `ExampleData`/`NotConnected` only appear on routes with no writer, reviewed per phase |
| Leave-behind quality | every phase | `npm run typecheck && npm run lint && npm run build` plus the full check battery, all green before the phase closes |
| Independent review | P2, P3, P5 | A separate reviewer executes the package; the phase stays *FIXED, INDEPENDENT REVIEW PENDING* until then |

## Totals

| Scope | Engineer-days |
|---|---|
| P0–P5 — transactable platform, no money movement, operations baseline included | **77–110** |
| P0–P6 — adds invoices, payments, settlements, disputes | **87–125** |

**Assumptions behind the totals:** one senior full-stack engineer; the design documents are the
specification; an Atlas development cluster is available; estimates ±30%; excludes owner-decision
latency, legal/compliance review, payment-provider onboarding time and data migration (there is no
data). **These are planning estimates, not commitments.**

## Recommended first action

**P0-1**, today: one line of YAML, no dependency, removes the only way this repository can touch a
production database without a human deciding to.
