# PRIMEMET — Product, Service and Production Readiness Audit

**Prepared:** 2026-11-01T21:30Z (completed 2026-11-02T04:30Z)
**Prepared by:** the implementing agent (Exvisit), at owner request
**Repository:** `C:\Users\Admin\Documents\PRIMEMET`
**Nature of this document:** an **audit**. No application code, schema, migration, test, script or
configuration was changed to produce it. Two files were added: this audit and
`docs/PRIMEMET_IMPLEMENTATION_ROADMAP.md`.

---

## 0. How this audit was produced, and what it does not claim

### 0.1 Method

Every classification below is grounded in one of three kinds of evidence, and the report says which:

- **Static inspection** of the file named, read in this session.
- **Automated testing** — the repository's own suites, run in this session; the exact command and
  the exact result are quoted.
- **Integration testing** — the production build served on a port and driven by HTTP assertions and
  by a real Chrome browser over the DevTools Protocol.

Nothing was inferred from a page existing, a collection being declared, or a document describing an
intended feature. The repository contains many design documents; a design document is recorded here
as **DOCUMENTED** and never as working.

### 0.2 Evidence levels used (from the brief)

| Level | Meaning in this report |
|---|---|
| DOCUMENTED | Exists only in `docs/`; no schema, no code |
| MODELLED | A collection validator, index, enum or Prisma model exists; no code path reads or writes it |
| IMPLEMENTED | Source code exists that would perform the function |
| TESTED | An automated suite passes against that code |
| INTEGRATION VERIFIED | Real components exercised together (served build, in-process database) |
| PRODUCTION VERIFIED | A deployed environment was observed. **Nothing in this repository reaches this level** |

### 0.3 The one distinction that governs the security section

The repository contains a **substantial, genuinely tested database security design** (roles, append-only
collections, validators, permission resolution) and **no authentication in the application at all**.
These are not in tension; they are two different layers. The database layer has been tested against an
in-process `mongod`. The application layer has nothing to protect because it cannot read, write or
identify anyone. Both facts are stated separately throughout, and no result obtained from
`mongodb-memory-server` is presented as production verification.

### 0.4 Deliberately not done

- No commit, push, merge, tag, deploy, or Vercel/Atlas/DNS operation.
- No production data, credential or infrastructure was contacted. `MONGODB_URI` is not set anywhere
  in this repository, and none of the database suites contact a managed server.
- No fix was implemented, including for findings that are one-line changes. They are listed instead.
- No test was weakened, skipped or removed. Every suite named here was run as it stands.

---

## 1. PART 1 — Protection record (captured before any other work)

Measured at the start of this session and unchanged at the end (re-verified in §11.3):

| Fact | Value |
|---|---|
| Branch | `main` |
| HEAD (full) | `7863743f20f9938ba1fd2548409ca05cbab0e471` |
| HEAD subject | `feat: add PRIMEMET public site and SEO foundation` |
| Commit date | `2026-11-01T17:40:52+05:30` |
| `git status --porcelain -uall` lines | **105** |
| Modified (unstaged) | **6** |
| Untracked | **99** |
| Staged | **0** |
| Deleted | **0** |
| Stashes | **0** |

**The six modified files** (every one preserved untouched):

```
 M PROJECT_SUMMARY.md
 M docs/PRIMEMET_STAGE_2_ARCHITECTURE.md
 M package.json
 M src/app/admin/layout.tsx
 M src/app/api/health/route.ts
 M tsconfig.json
```

The 99 untracked paths are the Stage 1 implementation, the `db/` definition layer, the check suites
and 23 design documents. They are uncommitted work by definition, and this audit treats them as
protected: nothing was staged, reverted, reformatted or deleted. Scratch output used during the audit
was written to the operating system's temp directory (`/tmp`), not into the repository.

---

## 2. Executive summary

**PRIMEMET today is a complete, high-quality, fully working public website and a fully designed,
fully tested database definition layer, joined by nothing.**

There is no authentication, no session, no API that writes, no server action, and no database
connection. The application cannot create, read, update or delete a single business record. Every
buyer, seller and administrator screen is an explicitly labelled preview that renders empty tables and
"not counted" figures rather than invented ones.

This is not an accident of incomplete work; it is a deliberate Stage 1 boundary, stated in
`PROJECT_SUMMARY.md` and repeated in the code comments at every boundary. What the audit establishes
is how much real capability sits on each side of that boundary, and how much remains before a buyer can
transact.

### 2.1 What genuinely works (verified this session)

1. **The public website.** 18 public route groups, 82/82 static pages generated by `next build`
   (exit 0), all internal links resolving (`check:routes`: 59 routes / 56 required / 119 files scanned,
   0 failures), served and re-verified over HTTP (`check:content`: 105/105).
2. **The buying-intent wizard.** A real Chrome browser, driven over CDP against the served production
   build at `/request-a-quote`, executes the multi-step scrap/parts wizard: 100/100 checks pass
   (`check:wizard`). It is a genuine, working front-end. Its submit button is disabled and it stores
   nothing.
3. **SEO foundation.** 654/654 checks pass against prerendered output: 27 sitemap URLs, canonical
   URLs, `robots.txt`, and 39 JSON-LD blocks (Organization ×1, WebSite ×1, BreadcrumbList ×26,
   WebPage ×11).
4. **The database definition layer.** 45 collections, 98 indexes, 5 versioned migrations, 7 append-only
   collections, 2 unprivileged roles — validated offline (549/549) and exercised against an in-process
   `mongod` (105/105, 74/74, 145/145, 97/97, 93/93, 130/130, 23/23, 88/88, 40/40).
5. **The permission and delegation engine as a library.** `src/lib/permissions/*` implements tier
   resolution, delegation, refusal and HMAC integrity. 52 authorisation properties hold against a
   single-node authenticated replica set (`check:authz`). **Nothing calls it**: no route, no page, no
   session.

### 2.2 What does not work, at all

Registration, login, session, logout, password reset, MFA, every form submission, enquiry persistence,
enquiry reference generation, supplier matching, RFQ, supplier quotations, buyer quotations, order
creation, inspection records, dispatch, invoices, payments, settlements, disputes, notifications,
documents, uploads, file scanning, audit-log writes, reporting, admin settings, search, filtering, and
location pages. Each is enumerated with a classification in §3 and §9.

### 2.3 The honest headline

- **Ready for real users:** the public marketing site and catalogue pages, as a lead-generation and
  information surface only. No account, no transaction, no submission.
- **Operational business product:** **none**.
- **Blocking production launch:** the portals are **openly reachable** — `/admin`, `/buyer`, `/seller`
  have no guard of any kind (`src/middleware.ts` returns `NextResponse.next()` for every request).

---

## 3. Service-by-service status matrix

Classification vocabulary is the brief's: WORKING / PARTIAL / UI_ONLY / NOT_IMPLEMENTED / BLOCKED /
UNVERIFIED. "Evidence" is the highest level actually reached this session.

### 3.1 A — Public website and catalogue

| Service | Status | Evidence | Grounds |
|---|---|---|---|
| Public marketing website | **WORKING** | INTEGRATION VERIFIED | 18 route groups under `src/app/(site)/`; build exit 0, 82/82 pages; served and asserted (`check:content` 105/105); links `check:routes` 0 failures |
| Scrap metal catalogue | **PARTIAL** | IMPLEMENTED | `src/app/(site)/scrap-metals/page.tsx` + `[slug]/page.tsx`; 7 grades from `src/lib/content/materials.ts`. No price, tonnage, stock or availability is published; the page states this in a `NotConnected` block |
| Spare-parts catalogue | **PARTIAL** | IMPLEMENTED | `src/app/(site)/spare-parts/*`; 4 categories from `src/lib/content/parts.ts`, same limitation |
| Product / material specifications | **PARTIAL** | MODELLED + static copy | Spec copy exists in `src/lib/content/catalogue.ts`; stored spec templates exist as `spec_templates`, `spec_template_attributes`, `spec_attributes` collections. No read path |
| Search and filtering | **NOT_IMPLEMENTED** | — | 0 matches for `searchParams` in `src/`; no search route; catalogue filters are `aria-disabled` spans (`src/app/admin/enquiries/page.tsx`) |
| SEO metadata, sitemap, canonicals, structured data | **WORKING** | TESTED | `check:seo` 654/654; `src/app/sitemap.ts`, `robots.ts`, `src/lib/seo.ts`, `src/components/seo/json-ld.tsx`; canonical origin resolved by `src/lib/site-url.ts` and enforced at build by `next.config.ts` |
| Location-based SEO | **NOT_IMPLEMENTED** | DOCUMENTED | No city/region route exists. The decision that gates it is open: `O-27.8 serviced cities` in `docs/PRIMEMET_STAGE_2_ARCHITECTURE.md:5336` |
| Public supplier availability / aggregate counts | **NOT_IMPLEMENTED** | — | No aggregate query anywhere; `src/app/(site)/page.tsx` and `source-scrap` describe qualification in prose only |

### 3.2 B — Buyer services

| Service | Status | Evidence | Grounds |
|---|---|---|---|
| Buyer registration | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/(auth)/register/buyer/page.tsx`; fields render, submit disabled, nothing stored |
| Buyer login | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/(auth)/login/page.tsx`; no action, no cookie, no session |
| Organisation profile | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/buyer/profile/page.tsx`; `organisations`, `organisation_addresses`, `organisation_contacts` collections exist (MODELLED) with no read/write path |
| Business verification | **NOT_IMPLEMENTED** | MODELLED | `organisation_verifications` collection; no upload, no review path, no UI beyond a labelled panel |
| Enquiry submission | **UI_ONLY** | INTEGRATION VERIFIED (UI) | `BuyerEnquiryWizard` (`src/components/enquiry/`), browser-driven 100/100 at `/request-a-quote`; `NotConnected` banner; disabled submit; no handler |
| Scrap and spare-parts enquiry journeys | **UI_ONLY** | same | Separate conditional branches exist in the wizard; neither persists |
| Document submission | **NOT_IMPLEMENTED** | MODELLED | `documents` collection has `visibility`, `scanStatus`, `checksumSha256`, `legalHold`; 0 matches for `upload\|FormData\|multipart` in `src/`; pipeline absent — `docs/PRIMEMET_ARCHITECTURE_CLOSURE.md` §8 (D-ARCH-7) |
| Enquiry reference generation | **NOT_IMPLEMENTED** | MODELLED | `reference_sequences` collection exists; no generator code; the ENQ format is specified only in `docs/PRIMEMET_P1_DECISION_RECORD.md` (P-1, not approved) |
| Enquiry status tracking | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/buyer/dashboard/page.tsx`, `/buyer/orders`; empty tables |
| Quotations and acceptance | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/buyer/quotations/page.tsx`; explicitly states none issued; no accept action |
| Order tracking | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/buyer/orders/page.tsx`; no `orders` collection exists in MongoDB at all |
| Notifications | **NOT_IMPLEMENTED** | DOCUMENTED | `.env.example` holds Zoho SMTP placeholders, commented and unread; `EmailStatus` enum exists; no mail code, no outbox collection |

### 3.3 C — Seller and supplier services

| Service | Status | Evidence | Grounds |
|---|---|---|---|
| Seller registration | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/(auth)/register/seller/page.tsx`; disabled submit |
| GST and business verification | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/seller/tax/page.tsx`; format validation is a TODO; `tax_rules`, `tax_treatments`, `tax_components_ref` are MODELLED |
| Supplier profile management | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/seller/profile/page.tsx`; `supplier_profiles` MODELLED |
| Material and product listings | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/seller/materials`, `/seller/products`; `supplier_listings` MODELLED |
| Listing submission and approval | **NOT_IMPLEMENTED** | DOCUMENTED | No approval state or history exists in either store — `docs/PRIMEMET_ARCHITECTURE_CLOSURE.md` §4, decision **D-ARCH-3** open |
| Supplier availability and capacity | **NOT_IMPLEMENTED** | — | No capacity field, no availability query, no public or internal surface |
| Supplier matching | **NOT_IMPLEMENTED** | MODELLED | `SupplierMatchStatus` (7 values) enum only; no collection, no algorithm, no UI |
| Supplier quotation submission | **UI_ONLY** | IMPLEMENTED (UI) | `src/components/enquiry/supplier-offer-form.tsx` (client component); submits nothing |
| RFQ management | **NOT_IMPLEMENTED** | MODELLED | `src/app/seller/enquiries` is a preview; no RFQ collection, no dispatch path |
| Order fulfilment | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/seller/orders/page.tsx`; empty |
| Supplier performance and ratings | **NOT_IMPLEMENTED** | — | No model, no enum, no screen |

### 3.4 D — Admin services

| Service | Status | Evidence | Grounds |
|---|---|---|---|
| Admin login and authentication | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/(auth)/admin/login/page.tsx`; `src/app/admin/layout.tsx` applies `noindex` only — no guard |
| Admin dashboard and business metrics | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/admin/dashboard/page.tsx`; every tile is a `Stat` with **no value** and the explicit hint "Not yet counted — no database"; the page says figures "will come from PostgreSQL" (stale: MongoDB is the target) |
| Buyer management | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/admin/buyers/page.tsx` |
| Supplier management | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/admin/suppliers/page.tsx` |
| Catalogue management | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/admin/catalogue/*` (10 pages) render from `src/lib/content/catalogue.ts` |
| Category and specification management | **UI_ONLY** | IMPLEMENTED (UI) | `/admin/catalogue/[section]`, `/admin/composition`; `categories`, `material_grades`, `grade_composition_attributes` MODELLED |
| Enquiry management | **UI_ONLY** | IMPLEMENTED (UI) | `/admin/enquiries` (+ `/admin/enquiries/[id]`, whose `example` route renders an illustrative detail) |
| Supplier qualification and verification | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/admin/suppliers/page.tsx` |
| Supplier quotation comparison | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/admin/supplier-quotations/page.tsx`; supplier costs marked `InternalOnly` |
| Internal sourcing operations | **UI_ONLY** | IMPLEMENTED (UI) | `/admin/quotation-preparation`, `/admin/supplier-quotations` |
| Pricing and margin management | **UI_ONLY** | IMPLEMENTED (UI) | `src/app/admin/pricing/page.tsx`; `pricing_rule_sets` MODELLED with `Decimal`-equivalent money rules |
| Buyer quotation preparation and approval | **UI_ONLY** | IMPLEMENTED (UI) | `/admin/quotations`, `/admin/quotation-preparation`; no quotation collection exists |
| Order management | **NOT_IMPLEMENTED** | — | **No admin orders route exists** (`find src/app/admin -name page.tsx`); no `orders` collection |
| Fulfilment and dispatch | **NOT_IMPLEMENTED** | DOCUMENTED | `OrderStatus` (9), `ShipmentStatus` (6) enums only; no collection, no route |
| Inspections and quality reports | **UI_ONLY** | IMPLEMENTED (UI) | `/admin/inspections`; `inspection_method_refs` MODELLED; no inspection record collection |
| Rejections and disputes | **PARTIAL** | IMPLEMENTED (UI) | `/admin/rejections` exists; `DisputeStatus` enum has no collection and no screen |
| Audit logs | **PARTIAL** | TESTED (DB layer only) | `/admin/audit-log` is empty; `audit_logs` + `audit_log_failures` are **append-only and enforced** in the tested DB layer (DAO guard refuses update/delete, 7 collections) — but nothing writes an entry because nothing authenticates |
| User, role and permission management | **PARTIAL** | TESTED (library only) | `src/lib/permissions/*` (6 modules: resolution, delegation, integrity, store, tiers, schema) with 145/145 + 52 properties; **no UI, no route, no session**; `admin_permission_grants` append-only at DB level |
| Admin configuration and settings | **NOT_IMPLEMENTED** | — | No `/admin/settings` route and no entry in `src/lib/content/admin-nav.ts` |

### 3.5 E — Commercial and transaction engine

The three approved models exist as vocabulary and nothing else.

| Service | Status | Evidence | Grounds |
|---|---|---|---|
| PRINCIPAL / AGENCY / MANAGED_SUPPLY | **MODELLED** | MODELLED | `db/enums.mjs:74` `TransactionModel = ["PRINCIPAL","AGENCY","MANAGED_SUPPLY"]`; static marketing copy in `src/lib/content/catalogue.ts:530–568`. No selection, no state machine, no record |
| Supplier costs | **MODELLED** | MODELLED | Fields exist on `supplier_listings` / `pricing_rule_sets`; no writer |
| Buyer prices | **MODELLED** | MODELLED | `pricing_rule_sets`, `tax_rules`; no writer |
| Margins and commissions | **MODELLED** | MODELLED | Marked `InternalOnly` in UI copy; no computed margin anywhere |
| Pricing rule versions | **MODELLED** | MODELLED | `pricing_rule_sets` with version semantics; no read/write path |
| Tax configuration | **MODELLED** | TESTED (rules only) | `db/tax.mjs`, `check:*` suites cover rule shape; `verify:tax-rule-index` exists. No runtime application of tax |
| Tax calculation snapshots | **MODELLED** | DOCUMENTED | `taxSnapshot` is specified in `docs/PRIMEMET_PHASE_1A_CONTRACTS.md` (T16); no snapshot is ever produced |
| Quotation versions | **MODELLED** | MODELLED | `BuyerQuoteStatus` (11) / `SupplierQuoteStatus` (4); no collection |
| Commercial approvals | **MODELLED** | MODELLED | `BuyerApprovalState` (6) enum; no collection, no route |
| Purchase and sales records | **MODELLED** | MODELLED | Prisma models only (`prisma/schema.prisma`, frozen); **no MongoDB collection** for orders/purchases/sales |
| Invoices and payments | **MODELLED** | MODELLED | `InvoiceStatus`, `PaymentStatus` enums; models in frozen Prisma schema; no collection |
| Settlements | **MODELLED** | MODELLED | `SettlementStatus` (4); no collection |
| Refunds, cancellations, disputes | **MODELLED** | MODELLED | `DisputeStatus` (6); no collection |
| Supplier cost / identity / margin leakage into buyer or public payloads | **UNVERIFIED (not applicable yet)** | — | **There is no buyer-facing or public payload**: 0 `POST/PUT/PATCH/DELETE` handlers, 0 server actions. The exposure rule is documented and encoded in UI labels (`InternalOnly`, `ExampleData`) but cannot be tested against a response that does not exist |

### 3.6 G — Infrastructure and integrations

| Service | Status | Evidence | Grounds |
|---|---|---|---|
| Database architecture and connectivity | **IMPLEMENTED, UNVERIFIED** | IMPLEMENTED | `src/lib/db.ts` lazy native driver, 5 s bounds, named `DatabaseNotConfiguredError`; `/api/health` probes with a 2 s `ping`. **No `MONGODB_URI` exists**, so connectivity is unverified |
| MongoDB vs PostgreSQL / Prisma consistency | **CONFLICT — see §8** | DOCUMENTED | Mongo is runtime; Prisma 6.16.2 + 7 SQL migrations + 46 models are retained "frozen"; both schemas disagree on at least 8 points |
| Database migrations | **WORKING (definition layer)** | TESTED | `db/migrations/v001…v005` + ledger; `check:migrations` 74/74; `db:validate:offline` 549/549 |
| Runtime and owner database roles | **IMPLEMENTED (definitions)** | TESTED | `db/roles.mjs`: `primemet_app`, `primemet_owner`, `primemet_readonly`; no `drop*` on any role; `check:mongodb` 105/105 incl. "the app role cannot update/delete append-only collections". Not provisioned in any cluster |
| Vercel deployment | **UNVERIFIED** | — | No `vercel.json`; no deployment record; no environment variables set |
| Domain and DNS | **UNVERIFIED** | DOCUMENTED | `https://primemet.in` is the documented production origin; `.env.local` currently holds `https://primemet.example` |
| Environment variables | **PARTIAL** | TESTED (schema) | `src/lib/env.ts` (zod, all optional, malformed values reported); only `NEXT_PUBLIC_APP_URL` and `MONGODB_URI` are read by running code |
| Private document storage | **NOT_IMPLEMENTED** | MODELLED | No bucket, no signed URL, no client |
| File scanning | **NOT_IMPLEMENTED** | MODELLED | `scanStatus` field only |
| Email provider and notification delivery | **NOT_IMPLEMENTED** | DOCUMENTED | Zoho SMTP placeholders, unread |
| Background jobs | **NOT_IMPLEMENTED** | — | No queue, no scheduler, no worker |
| Monitoring and logging | **NOT_IMPLEMENTED** | IMPLEMENTED (probe only) | `/api/health` is the only observability surface; no APM, no log sink, no alerting |
| Backups, PITR, restore testing | **NOT_IMPLEMENTED** | DOCUMENTED | Checklist-level only in `docs/PRIMEMET_ATLAS_SETUP.md`; no cluster exists to back up |
| CI/CD | **PARTIAL** | IMPLEMENTED | Two workflows exist. `db-init.yml` **is live on pushes to `main`** touching `db/**` or `package.json` and will run against `environment: production-database`; `m2a-argon2-gate.yml` is `workflow_dispatch` only |
| Deployment rollback | **NOT_IMPLEMENTED** | — | No rollback procedure, no immutable artefact strategy, no Vercel project |

---

## 4. Buyer, seller and admin readiness

### 4.1 Buyer — what a real buyer can do today

A buyer can read the public site, read the catalogue copy, open the enquiry wizard, fill in every
field, and reach a **disabled** submit button. That is the entire journey. There is no account to
create, no reference number to receive, no confirmation, no way to return and see the enquiry, and no
one on the other side to receive it.

**Readiness: 0% of the transactional journey; 100% of the information journey.**

### 4.2 Seller — what a real supplier can do today

A supplier can read the public site, read `/become-a-supplier`, and fill in a disabled registration
form. There is no listing to create, no RFQ to receive, no quotation to submit, no order to fulfil, and
no way to be matched to a brief.

**Readiness: 0% of the supplier journey.**

### 4.3 Administrator — what the desk can do today

An administrator can open 22 admin screens without authenticating, and every one of them is empty by
design. The dashboard states "Not yet counted — no database" on each tile; the enquiry register says
"No enquiries recorded"; the audit log says "No audit entries". The desk cannot create, review, price,
approve, dispatch or record anything.

**Readiness: 0% of desk operations; the information architecture and screen inventory are complete.**

### 4.4 The one thing that is *not* merely empty

`src/lib/permissions/*` is real, non-trivial, tested code: tier resolution, delegation with refusal
reasons, HMAC-SHA256 integrity over canonical grant fields, and a store that reads
`admin_permission_grants`. It is the only business-logic layer in the application that has been
executed against a database. It is also **unreachable**: no route imports it for a request, because
there is no request identity to resolve.

---

## 5. PART 3 — End-to-end workflow readiness

Verdict vocabulary: **OPERATIONAL** (every essential step works), **PREVIEW** (UI exists, nothing
persists), **NOT IMPLEMENTED** (a step has no implementation at all).

### Journey 1 — Buyer registers → submits enquiry → receives reference → admin receives it

| | |
|---|---|
| Starting point | `/register/buyer` renders a registration form |
| Completed steps | Registration form renders; enquiry wizard renders and is fully operable in a real browser (100/100 CDP checks); field model covers groups A–F including scrap and spare-parts branches |
| Missing steps | Account creation; password hashing; session; server-side validation; enquiry persistence; ENQ reference generation; desk notification; admin visibility |
| Evidence | `check:wizard` 100/100 (INTEGRATION VERIFIED, UI only); `src/app/buyer/enquiries/new/page.tsx` `NotConnected` banner; 0 write handlers in `src/` |
| Verdict | **PREVIEW** |

### Journey 2 — Admin reviews enquiry → finds suppliers → requests supplier quotations

| | |
|---|---|
| Starting point | `/admin/enquiries` — empty register |
| Completed steps | Screen inventory and desk sequence are described on the page; supplier qualification screen exists |
| Missing steps | Any enquiry to review; supplier search/matching (no collection, no algorithm); RFQ creation and dispatch; supplier notification |
| Evidence | `src/app/admin/enquiries/page.tsx` (empty `EmptyRow`); `SupplierMatchStatus` enum with no collection |
| Verdict | **NOT IMPLEMENTED** (beyond static screens) |

### Journey 3 — Supplier receives RFQ → submits quotation → admin compares offers

| | |
|---|---|
| Starting point | `/seller/enquiries` — preview list |
| Completed steps | Supplier offer form component exists (`src/components/enquiry/supplier-offer-form.tsx`); comparison screen exists |
| Missing steps | RFQ delivery; supplier authentication; quotation persistence; comparison data; cost normalisation |
| Evidence | Client component with no handler; `/admin/supplier-quotations` empty |
| Verdict | **PREVIEW** |

### Journey 4 — Admin calculates costs and margins → approves buyer quotation

| | |
|---|---|
| Starting point | `/admin/pricing`, `/admin/quotation-preparation` |
| Completed steps | Pricing formula screen; margin columns marked `InternalOnly`; tax rule definitions exist and are tested as definitions |
| Missing steps | Cost capture; margin computation; tax application and snapshot; quotation versioning; approval state machine; approval permission enforcement |
| Evidence | `pricing_rule_sets` / `tax_rules` MODELLED; `BuyerApprovalState` enum only; no quotation collection |
| Verdict | **NOT IMPLEMENTED** |

### Journey 5 — Buyer receives quotation → accepts → order is created

| | |
|---|---|
| Starting point | `/buyer/quotations` — empty |
| Completed steps | Screen states exactly what a quotation will and will not contain (a genuine confidentiality design) |
| Missing steps | Quotation issuance; buyer notification; acceptance action; order creation; **no `orders` collection exists in MongoDB** |
| Evidence | `src/app/buyer/quotations/page.tsx`; collection inventory (45 names) contains no order/invoice/payment collection |
| Verdict | **NOT IMPLEMENTED** |

### Journey 6 — Admin manages order → inspection → dispatch → fulfilment

| | |
|---|---|
| Starting point | none — **there is no admin orders route** |
| Completed steps | Inspection and rejection screens exist as previews; `OrderStatus`/`ShipmentStatus` enums exist |
| Missing steps | Order record; order management UI; inspection record; quality gate; dispatch authorisation; fulfilment; delivery confirmation |
| Evidence | `find src/app/admin -name page.tsx` returns no orders page; `docs/PRIMEMET_ARCHITECTURE_CLOSURE.md` §5 (D-ARCH-4) |
| Verdict | **NOT IMPLEMENTED** |

### Journey 7 — Buyer and seller see only their own authorised records

| | |
|---|---|
| Starting point | `/buyer/*`, `/seller/*` are reachable by anyone |
| Completed steps | The *design* for organisation scoping is complete and the database layer enforces several invariants (52 properties held) |
| Missing steps | Authentication; session; actor resolution; query scoping; IDOR protection on any endpoint |
| Evidence | `src/middleware.ts` returns `NextResponse.next()` unconditionally; `PROJECT_SUMMARY.md` states "Portals are not protected" |
| Verdict | **NOT IMPLEMENTED — and currently unsafe by construction, not merely empty** |

### Journey 8 — Admin actions are recorded in an audit trail

| | |
|---|---|
| Starting point | `/admin/audit-log` — empty |
| Completed steps | `audit_logs` and `audit_log_failures` are append-only **and enforced**: the DAO guard refuses update/delete on all 7 append-only collections, and the app role holds find/insert only (105/105 checks) |
| Missing steps | Any authenticated actor; any write path; audit entry construction; the audit-log read view |
| Evidence | `check:mongodb` 105/105; `check:adversarial` 97/97; `/admin/audit-log` renders an empty table |
| Verdict | **NOT IMPLEMENTED** (the storage guarantee is real; the trail is empty) |

**Summary: 0 of 8 journeys are operational. 3 are previews. 5 have at least one step with no
implementation at all.**

---

## 6. Security assessment

### 6.1 The two layers, stated separately

| Layer | State |
|---|---|
| **Database-enforced** (roles, validators, `$expr` invariants, partial unique indexes, append-only guards) | Designed, implemented as code, and **tested against an in-process authenticated replica set**. Not provisioned in any cluster; never exercised against Atlas |
| **Application-enforced** (authentication, session, authorisation on requests, CSRF, rate limiting, headers, input validation, output filtering) | **Absent.** There is no request identity, no write endpoint and no server action to protect |

### 6.2 Control-by-control

| Control | Status | Enforcement | Evidence |
|---|---|---|---|
| Authentication | **NOT_IMPLEMENTED** | — | No auth library in `package.json` (0 matches for `next-auth\|@auth/\|iron-session\|jose\|jsonwebtoken`); login pages are previews |
| Session management | **NOT_IMPLEMENTED** | — | No cookie, no session store; `sessions` collection MODELLED only |
| Password hashing | **NOT_IMPLEMENTED** | — | 0 matches for `bcrypt\|argon2\|scrypt` in `package.json`; Argon2id chosen in `docs/PRIMEMET_M2_OWNER_DECISIONS.md` (D-M2a-1, **open**); `scripts/verify-argon2-runtime.mjs` is a compatibility harness, not a dependency |
| MFA requirements | **NOT_IMPLEMENTED** | — | Decision D-BOOT-4 open; no TOTP code, no enrolment |
| Role-based access control | **PARTIAL** | Application (library) | `src/lib/permissions/tiers.ts` + `store.ts`; 145/145 checks; **unwired** |
| Permission resolution | **PARTIAL** | Application (library) | Latest-event-wins over append-only grants; 52 properties held |
| Permission delegation | **PARTIAL** | Application (library) | `delegation.ts` with explicit refusal reasons; tested |
| Organisation-level isolation | **PARTIAL** | Database (invariants) + application (design) | `orgKind` invariant, one-PRIMEMET rule, `organisation-identity.mjs`; no query layer to scope |
| IDOR protection | **UNVERIFIED** | — | No endpoint returns a record, so there is nothing to test; the risk is deferred, not mitigated |
| CSRF protection | **NOT_IMPLEMENTED** | — | No mutation surface exists; no token mechanism exists |
| Rate limiting | **NOT_IMPLEMENTED** | — | No limiter, no store, no edge rule |
| Security headers | **NOT_IMPLEMENTED** | — | `next.config.ts` sets only `reactStrictMode` and `poweredByHeader: false`; no CSP, HSTS, `X-Frame-Options`, `Referrer-Policy` or `Permissions-Policy` |
| Append-only audit history | **PARTIAL** | **Database-enforced** | 7 append-only collections; DAO guard refuses update/delete; app role holds find/insert only (105/105, 97/97). No writer |
| Platform identity protection | **PARTIAL** | Database + application | Continuity fence in `_permission_guards`; **W2.2 and W2.6 OPEN** (see §6.3) |
| Database role separation | **PARTIAL** | **Database-enforced** | `primemet_app` / `primemet_owner` / `primemet_readonly`; no `drop*` anywhere; `db:check-role` proves the deployed identity is not the owner. Definitions only — no cluster |
| Secure file access | **NOT_IMPLEMENTED** | — | No storage, no signed URLs, no access log writer (`document_access_logs` MODELLED) |
| Input validation | **PARTIAL** | Application | `src/lib/env.ts` zod schema (tested); client-side wizard validation; **no server-side request validation exists** because no request is accepted |
| Error handling / sensitive-data exposure | **PARTIAL** | Application | `/api/health` is deliberately conservative: fixed reason strings, never the driver message, `config_errors` as a count, `no-store`. No other endpoint exists to leak |

### 6.3 Measured authorisation results (and what they do and do not prove)

`npm run check:authz` — exit 0, **52 properties held, 6 gaps, 0 failures**, against a single-node
replica set with `--auth` and a keyfile, using per-run credentials.

Brief matrix: **14 questions — 9 satisfied, 4 open, 1 blocked.**

| Question | Verdict | Note |
|---|---|---|
| W3.1 direct insert of a permission grant | **OPEN** | `primemet_app` holds `insert` on `admin_permission_grants` **and** holds the HMAC key, so a hand-inserted row is tamper-*evident*, not tamper-*proof* |
| W3.2 update / replacement | SATISFIED | Append-only guard refuses update |
| W3.3 writer bypass (distinct writer identity) | **OPEN** | No distinct writer identity exists |
| W3.4 valid/invalid delegation | **BLOCKED** | Requires an authenticated actor that does not exist |
| W3.5–W3.7 revoked/expired reuse, forged actor, forged payload | SATISFIED | Integrity verdicts `VALID\|UNKEYED\|MISSING\|INVALID` |
| W2.1 `orgKind` relabel | SATISFIED | Unique partial index + invariant |
| W2.2 pointer replacement | **OPEN** | The platform-identity pointer lives in the same collection the app may update |
| W2.3 referenced organisation deletion | SATISFIED | Fail-closed on non-live organisation; hard delete refused by MongoDB |
| W2.4 identity recreation | SATISFIED | Insert/delete/upsert all refused |
| W2.5 duplicate identity | SATISFIED | Extra document is inert (fixed `_id` read) |
| W2.6 concurrent identity changes | **OPEN** | Two parallel pointer writes both accepted; last write wins, no sequence |
| W2.7 resolution after each attack | SATISFIED | Restores to the governing organisation |

**What this proves:** the *database design* resists the attacks it was written to resist, when the
attacker holds the application credential.
**What it does not prove:** that any of it is reachable, provisioned, or enforced in a deployed system.
The suite runs against `mongodb-memory-server` (mongod 7.0.14) on this machine. It is not Atlas, not
TLS, not SCRAM against a managed cluster, and it is written by the same work it verifies.

### 6.4 The two structural security findings (unchanged, both OPEN)

1. **W3 — no writer identity separation.** `primemet_app` can insert into `admin_permission_grants`
   and holds `PERMISSION_LOG_KEY`. Closing it requires a fourth role that alone holds the key and the
   insert grant, and removing `insert` from `primemet_app`. This is a design change plus a migration,
   not a patch.
2. **W2-s — the platform-identity pointer shares a collection with the continuity fence.** Because
   `_permission_guards` must be updatable by the app (the fence), the pointer is updatable too. Closing
   it requires moving the pointer to a collection the app cannot update (a new migration, e.g. v006).

Both are recorded in `docs/PRIMEMET_SECURITY_CLOSURE_REPORT.md` with the same classification they carry
here: **OPEN**, and both block M2 authentication.

### 6.5 The largest security fact in the repository

`/admin`, `/buyer` and `/seller` are **openly reachable**. `src/middleware.ts` matches those prefixes
and returns `NextResponse.next()` for every request; the file's own comment says it "authenticates
nothing and authorises nothing". The only mitigation present is `noindex` on the admin layout, which
prevents indexing, not access. This is safe today **only because the screens hold no records**. The
moment a database is connected without authentication, every record is public.

---

## 7. Infrastructure and integration assessment

### 7.1 Database

- **Target:** MongoDB Atlas (documented), native `mongodb` driver at runtime (`src/lib/db.ts`).
- **Actual connectivity:** none. `MONGODB_URI` is unset; `/api/health` returns
  `database: "not_configured"` with HTTP 200 by design.
- **Definition layer:** 45 collections, 98 indexes, 5 migrations (`v001`–`v005`), 7 append-only
  collections, 3 roles. Offline validation 549/549; in-process `mongod` suites 105/105, 74/74, 145/145,
  97/97, 93/93, 130/130, 23/23, 88/88, 40/40.
- **Not verified:** TLS, SCRAM against a managed cluster, Atlas proxy behaviour, latency, real role
  enforcement, backup/PITR, restore.

### 7.2 The PostgreSQL/Prisma layer

`prisma/schema.prisma` (46 models, 67 enums) and 7 SQL migrations remain in the repository and are
**still executed by a test suite**: `check:schema` applies them to in-process PostgreSQL (PGlite) and
passes 61/61, including 166 index-name-length assertions. The application does not import
`@prisma/client` (0 matches). This is a deliberate "frozen historical record", and it is also a live
maintenance cost and a source of contradiction — see §8.

### 7.3 Deployment, domain, environment

| Item | Finding |
|---|---|
| Vercel | No `vercel.json`, no project link, no deployment evidence. **UNVERIFIED** |
| Domain / DNS | `https://primemet.in` documented; `.env.local` holds `https://primemet.example`. No DNS evidence. **UNVERIFIED** |
| Environment variables | Only `NEXT_PUBLIC_APP_URL` and `MONGODB_URI` are read by running code; `AUTH_SECRET`, Zoho SMTP and `DATABASE_URL` are declared and unread |
| Build gate | `next.config.ts` fails a production build without a valid non-loopback `NEXT_PUBLIC_APP_URL` — a genuinely good control, verified by `test:site-url` |

### 7.4 CI/CD — one live risk

`.github/workflows/db-init.yml` **is active on pushes to `main`** that touch `db/**`,
`scripts/db-init.mjs`, `prisma/schema.prisma`, `package.json`, `package-lock.json` or the workflow
itself. It targets `environment: production-database` and requires `secrets.MONGODB_URI`.

`PROJECT_SUMMARY.md` states the opposite — that the workflow "exists but is deliberately **not
active**: it must stay out of the first push". The file and the summary disagree. Consequences:

- On the first push, the workflow will trigger and fail at the secret-presence step (no secret is
  configured), producing a red build on `main`.
- If a secret is later added without the `production-database` environment's required reviewers, a
  push that edits `package.json` would initialise a production database without human approval.

This is a **configuration/documentation contradiction with a production side effect**, and it is
listed as a P0 item in §13.

### 7.5 Observability, backups, recovery

None. `/api/health` is the only signal; there is no log sink, no APM, no alert, no backup policy, no
PITR configuration, no restore test, and no rollback procedure. All are documented as intentions in
`docs/PRIMEMET_ATLAS_SETUP.md` and none is configured, because no cluster and no deployment exist.

---

## 8. Architecture inconsistencies and conflicts

The repository does not merely lack features; it makes **contradictory statements about itself**.
Each conflict below was measured in files. They are listed because each one either costs a future
implementer time or carries a production risk; none is a matter of taste.

### 8.1 C-1 — Two complete data architectures, one of them dead at runtime

| Dimension | PostgreSQL / Prisma | MongoDB | Measured where |
|---|---|---|---|
| Definition | `prisma/schema.prisma` — **46 models, 67 enums** + 7 SQL migrations | `db/collections/*.mjs` — **45 collections, 98 indexes** + 5 JS migrations | files counted this session |
| Imported by running code | **No** — 0 matches for `new PrismaClient` and 0 for `from "@prisma/client"` in 224 source files | **Yes** — `src/lib/db.ts` (lazy native `mongodb` pool) | grep, read |
| Executed by a test suite | **Yes** — `check:schema` applies the SQL migrations to in-process PostgreSQL (PGlite), **61/61 passed** | **Yes** — `check:mongodb` **105/105**, `check:migrations` **74/74** | commands run |
| Environment variable | `DATABASE_URL`, `DIRECT_URL` — marked *"DEPRECATED — PostgreSQL. No longer read by the application."* in `.env.example` | `MONGODB_URI` — read, **unset everywhere** | `.env.example`, `src/lib/env.ts` |
| Runtime dependencies shipped | `prisma` 6.16.2, `@prisma/client` 6.16.2 | `mongodb` ^7.8.0 | `package.json` |
| Described as target by | the M1 baseline docs, `docs/PRIMEMET_PHASE_1A_CONTRACTS.md` | `PROJECT_SUMMARY.md`, `docs/PRIMEMET_STAGE_2_ARCHITECTURE.md` | docs |
| In the CI path filter | **Yes** — `prisma/schema.prisma` is one of the `db-init.yml` trigger paths | Yes — `db/**` | `.github/workflows/db-init.yml` |

**Measured consequences, not opinions:**

1. **A 46-model schema nothing imports is still compiled, linted, shipped and tested.** It is not inert
   in the build: `check:schema` passes 61/61 against it, so it looks alive to any reader and to CI.
2. **Two enum vocabularies can drift with no test comparing them.** The Prisma schema declares 67
   enums; `db/enums.mjs` exports **69** constants; the design documents say 67. The audit measured the
   two numbers and does not choose between them; the discrepancy itself is the finding.
3. **Editing the dead schema can trigger a live workflow.** `prisma/schema.prisma` is in the
   `db-init.yml` path filter, whose job targets `environment: production-database` (§7.4). A commit
   that changes only the abandoned schema is enough to start a production database initialisation.
4. **The UI repeats the stale claim.** `src/app/admin/dashboard/page.tsx` tells the operator that
   figures "will come from PostgreSQL", while the runtime target is MongoDB — a contradiction visible
   in the product itself.
5. **Tooling will be pointed at the wrong store.** Any engineer who runs `prisma migrate` or
   `prisma studio` — the two obvious commands when they see `prisma/` — will work against a database
   the application never opens.

**Options** (the audit does not choose; the owner does): (a) archive `prisma/` and `scripts/m1-baseline/`
to a clearly-labelled `docs/archive` position, drop both dependencies and retire `check:schema` from the
gate; (b) keep the schema as a *baseline artefact* and rename/annotate it so no command can target a
live database. Either is defensible. **Doing neither is the current state, and it is the single largest
source of misleading evidence in the repository.**

### 8.2 C-2 — Vocabulary without records: the transaction engine has no storage

The commercial engine of §3.5 has identifiers, enums and screens, and no collections to hold a single
row. Measured:

| Entity | Enum(s) that exist | MongoDB collection | Route | Writer |
|---|---|---|---|---|
| Buyer enquiry | — | `enquiries`? **absent** | `/request-a-quote` (wizard only) | none |
| Supplier match | `SupplierMatchStatus` (7 values) | **absent** | **absent** | none |
| RFQ / quotation request | — | **absent** | **absent** | none |
| Supplier quotation | `SupplierQuoteStatus` (4) | **absent** | `/seller/enquiries` (preview) | none |
| Buyer quotation | `BuyerQuoteStatus` (11), `BuyerApprovalState` (6) | **absent** | `/admin/quotations`, `/buyer/quotations` (previews) | none |
| Order | `OrderStatus` (9) | **absent** | `/buyer/orders`, `/seller/orders` (previews); **no admin route** | none |
| Shipment / dispatch | `ShipmentStatus` (6) | **absent** | **absent** | none |
| Invoice | `InvoiceStatus` | **absent** (Prisma model only) | **absent** | none |
| Payment | `PaymentStatus` | **absent** (Prisma model only) | **absent** | none |
| Settlement | `SettlementStatus` (4) | **absent** | **absent** | none |
| Dispute / refund | `DisputeStatus` (6) | **absent** | `/admin/rejections` (preview) | none |
| Inspection | — | **absent** (`inspection_method_refs` is a reference table) | `/admin/inspections` (preview) | none |
| Document | `documents` collection **exists** (metadata) | present | **absent** | none |

Measured by: `grep -rnoE "\"?(orders|purchases|sales|invoices|payments|shipments|supplier_matches|rfqs|quotations)" db/collections/*.mjs`
returned **no match**. The three screens that display orders read from nothing at all, and one of the
three portals (admin) does not even have the screen.

**Why this matters more than a missing feature:** the screens are plausible. A buyer or an operator
looking at `/buyer/orders` sees a structured, branded order page. Only the copy ("nothing is connected")
tells them it can never hold a row. Screens that exist for entities that do not is the specific failure
mode the brief warned against, and it is the shape of this repository.

### 8.3 C-3 — The documentation register is proposals, not approvals

25 files in `docs/` (24 before this audit). Measured status lines:

| Document | Measured status statement | Effect |
|---|---|---|
| `docs/PRIMEMET_M2_OWNER_DECISIONS.md` | *"NOTHING IN THIS DOCUMENT IS APPROVED"*; 8 open decisions (`D-TIER-1`, `D-M2a-2`, `D-M2a-3`, `D-BOOT-1`…`D-BOOT-4`) | M2 cannot start |
| `docs/PRIMEMET_P1_DECISION_RECORD.md` | *"P-1 IS NOT READY TO IMPLEMENT"* | enquiry numbering (ENQ…) unapproved |
| `docs/PRIMEMET_ARCHITECTURE_CLOSURE.md` | *"proposal for review"*; 8 issues `D-ARCH-1`…`D-ARCH-7` plus | schema closure unapproved |
| `D-ARCH-12` (latest-event-wins) | **owner-approved** | the only approved architecture decision found |

**Risk:** nothing in the documents prevents an implementer from building an unapproved design; the
documents are honest, but they sit in the same directory and format as approved material, and the code
already implements some of the proposals (permissions, catalogue). A one-line `Status:` field at the
top of every document, machine-checked, would remove the ambiguity.

### 8.4 C-4 — Three catalogues for the same materials, none compared to another

| Catalogue | Where | Kept current by |
|---|---|---|
| PostgreSQL canonical catalogue | 7 SQL migrations applied by `check:catalogue` (**55/55 passed**) | SQL migrations |
| MongoDB catalogue definitions | `db/collections/catalogue.mjs` (`materials`, `categories`, `material_grades`, `spec_templates`, …) | `db:validate:offline` (**549/549**) |
| TypeScript content rendered by the site | `src/lib/content/materials.ts`, `parts.ts`, `catalogue.ts` (7 scrap grades, 4 parts categories, static spec copy) | hand editing |

No code imports `db/` from `src/` (the app never opens a database), and **no suite compares** the three.
`check:seo` (654/654) verifies the rendered pages; `check:catalogue` verifies the SQL schema;
`db:validate:offline` verifies the MongoDB validators. All three can pass while the grade names, slugs
and counts disagree. Adding a material today requires three coordinated edits with no test to catch a
miss.

### 8.5 C-5 — CI states the opposite of `PROJECT_SUMMARY.md`

Detailed in §7.4. Restated here as an architecture conflict because it is the same class of error:
the workflow is **active** on push to `main` and targets `environment: production-database`, while the
project summary says it "exists but is deliberately not active: it must stay out of the first push".

### 8.6 C-6 — The security design presupposes an identity that does not exist

`src/lib/permissions/*` (6 modules) resolves tiers, delegations and HMAC integrity for a **subject
actor in an organisation**. There is no actor, no session and no reader. The dependency is circular in
practice: M2 authentication cannot be signed off until W3 (distinct writer identity, a fourth database
role) and W2-s (platform-identity pointer moved out of `_permission_guards`, a new migration `v006`)
are closed — and those are database design changes, not login-page work. `W3.4` is recorded **BLOCKED**
precisely because it needs an authenticated actor that does not exist.

### 8.7 C-7 — Portal asymmetry around the order entity

`/buyer/orders` and `/seller/orders` exist; `/admin/orders` **does not** (`find src/app/admin -name page.tsx`
returns 22 files, none of them orders). The entity is displayed in two portals and managed in none, and
stored nowhere. The same asymmetry applies to inspections (admin only) and to quotations (admin and
buyer, but not a seller-facing quotation record).

### 8.8 C-8 — Figure drift between documents and code

Measured examples: enum count (69 exported constants vs 67 documented vs 67 Prisma enums); collection
count (45 in `db/collections`, stated as 45 in the code but the design documents describe a larger
target set, including the entities in §8.2); the CI activity claim in §8.5. There is no generated
"facts" artefact, so every document restates numbers by hand. The check suites verify code; only
`check:seo` and `check:routes` verify a document-adjacent artefact.

---

## 9. Critical blockers and missing capabilities

### 9.1 Blockers

Severity is this audit's judgement; the classification column is the brief's.

| ID | Blocker | What it blocks | Evidence | Class |
|---|---|---|---|---|
| **B-1** | No authentication, session, password hashing or MFA | Every account, every portal, every workflow; M2 sign-off | §6.2: no auth library, 0 matches `bcrypt\|argon2\|scrypt` | **OPEN** |
| **B-2** | `/admin`, `/buyer`, `/seller` are openly reachable | Any connection of a database to the app | `src/middleware.ts` returns `NextResponse.next()`; every portal route was probed anonymously on the served build and **34 static routes plus `/admin/enquiries/example` returned HTTP 200** (19 admin, 7 buyer, 8 seller) | **OPEN** |
| **B-3** | No persistence path at all | Journeys 1–6 (every write) | `src/app/api/` holds only `health/route.ts`; 0 `POST/PUT/PATCH/DELETE` handlers; 0 `"use server"` | **OPEN** |
| **B-4** | No datastore configured | Journey 7–8 verification, any integration test of a real record | `MONGODB_URI` unset; `/api/health` returns `not_configured` | **OPEN** |
| **B-5** | Transaction collections do not exist | Journeys 4–6 (quotation, order, fulfilment, money) | §8.2 table; grep returns no match | **OPEN** |
| **B-6** | No document pipeline (upload, scan, signed access, purge) | Business verification, KYC, inspection evidence, legal hold | `documents` collection metadata only; 0 matches `upload\|FormData\|multipart` | **OPEN** |
| **B-7** | No email or notification of any kind | "Buyer receives a reference", RFQ dispatch, quotation sent, order updates | Zoho SMTP placeholders commented out and unread; no mail code, no outbox | **OPEN** |
| **B-8** | W3 — no writer identity separation | M2 authorisation sign-off; tamper-*proof* permission grants | `primemet_app` holds `insert` on `admin_permission_grants` **and** `PERMISSION_LOG_KEY` | **OPEN** |
| **B-9** | W2-s — platform-identity pointer is updatable by the app | M2 authorisation sign-off; concurrent identity integrity | Pointer co-located with the continuity fence in `_permission_guards` | **OPEN** |
| **B-10** | `db-init.yml` is live on push to `main` against `production-database` | Safe first push; production data safety | §7.4, §8.5 | **OPEN** (P0) |
| **B-11** | 8 owner decisions unapproved (`D-ARCH-1…7`, `D-TIER-1`, `D-M2a-2/3`, `D-BOOT-1…4`, `P-1`) | The design of the very features listed above | §8.3 | **BLOCKED** on the owner |
| **B-12** | W3.4 delegation question | Delegation sign-off | Needs an authenticated actor — none exists | **BLOCKED** |
| **B-13** | Migrations have no down path | Safe rollback of any schema change | 0 matches for `rollback\|revert\|down` in `db/migrations/*.mjs` and `check-migration-architecture.mjs` | **OPEN** |
| **B-14** | No observability, backup, PITR or restore test | Production operation | §7.5 | **OPEN** |

### 9.2 Missing capabilities, by area

- **Accounts** — registration persistence, login, logout, password reset, email verification, session
  revocation, MFA enrolment, organisation invitation, role assignment UI.
- **Buyer** — enquiry persistence and reference generation, enquiry status, quotation receipt and
  acceptance, order tracking, documents, notifications, profile persistence.
- **Seller** — registration persistence, GST/business verification, listing creation and approval
  workflow, capacity/availability, RFQ receipt, quotation submission, order fulfilment updates.
- **Admin** — enquiry queue with real records, supplier qualification, matching, RFQ dispatch,
  quotation comparison with real costs, margin calculation, quotation approval, order management
  (**no route exists**), inspection records, dispatch, dispute handling, audit-log reads, user and
  permission administration UI, settings.
- **Commercial** — transaction-model selection and state machine, price and cost versions, margin and
  commission computation, tax application and snapshots, invoices, payments, settlements, refunds.
- **Platform** — document storage and scanning, email delivery and outbox, background jobs, search,
  filtering, pagination, exports, reporting, rate limiting, security headers, monitoring, backups,
  restore procedure, deployment pipeline, rollback.

---

## 10. Non-functional readiness

Stated as measured, or as *not measurable* — never as an assumption.

| Dimension | Finding | Basis |
|---|---|---|
| Rendering performance | **Not measurable.** Every page is statically prerendered (82/82) and no page reads data; there is no dynamic path to time | `next build` output |
| Load and scale behaviour | **Not measured.** No cluster, no data path, no load test, no baseline. Any figure would be invented | — |
| Accessibility | **Not verified.** No `axe-core`, `pa11y`, `lighthouse` or `web-vitals` dependency or script exists in `package.json`; no automated a11y check runs in the gate. Manual review was not part of this audit | `package.json` scripts listed and inspected |
| Cross-browser behaviour | **Partially verified.** `check:wizard` drives **Google Chrome** over the DevTools Protocol only (100/100). Firefox/Safari are unexercised | `check:wizard` |
| Internationalisation | **Absent.** One locale, no i18n framework; `docs` mention language-scoped aliases only at the data-model level (`material_aliases.language`) | grep/read |
| Data-protection posture | **Nothing to protect yet.** No PII is stored anywhere because nothing writes. Retention period and hosting region remain **open owner decisions** recorded in the design documents; `documents` models `legalHold`, `checksumSha256`, `visibility`, `scanStatus` with no implementation | §3.2, §8.3 |
| Reliability | **Unmeasurable.** No availability target, no deployment, no failover, no incident procedure. `/api/health` is the only signal and returns 200 with `database: "not_configured"` | §7.5 |
| Security headers | **Absent.** `next.config.ts` sets `reactStrictMode` and `poweredByHeader: false` only | read |
| Secrets handling | **Reasonable for what exists.** No secret is committed; `.env*` is ignored by `.gitignore`; `src/lib/env.ts` reports malformed values by name without printing them, and `/api/health` returns counts and fixed reason strings | read, `check:content` |
| Operability | **Absent.** No runbook, no alert, no log sink, no backup policy, no restore test, no rollback (§9.1 B-13) | §7.5 |

---

## 11. Testing evidence

Every command below was executed **in this session** against the working tree as captured in §1.
Nothing is quoted from an earlier report. `npm` here means `npm.cmd` (Windows).

### 11.1 The battery

| # | Command | Exact result | What it proves |
|---|---|---|---|
| 1 | `npm run typecheck` | **exit 0**, no diagnostics | Types are sound across 121 `src` files |
| 2 | `npm run lint` | **exit 0** | ESLint 9.39.5 clean |
| 3 | `npm run build` | **exit 0**, Next.js **15.5.28**, `✓ Compiled successfully in 4.8s`, **82/82** static pages, `/robots.txt` and `/sitemap.xml` generated | The application builds and prerenders every page |
| 4 | `npm run check:routes` | **exit 0** — `routes: 59  required: 56  source files scanned: 119` | All required routes exist and internal links resolve |
| 5 | `npm run check:seo` | **exit 0** — **654 passed, 0 failed**; origin `https://primemet.example`; **27** sitemap URLs; **39** JSON-LD blocks (Organization ×1, WebSite ×1, BreadcrumbList ×26, WebPage ×11) | SEO metadata is correct **on prerendered output** |
| 6 | `SMOKE_BASE=http://localhost:3100 npm run check:content` | **105 passed** | Pages serve correctly over HTTP from the production build |
| 7 | `SMOKE_BASE=http://localhost:3100 npm run check:wizard` | **100 passed**, real Chrome over CDP | The enquiry wizard works in a browser — as a UI, storing nothing |
| 8 | `npm run check:schema` | **61 passed, 0 failed**, incl. 166 index-name-length assertions, on in-process PostgreSQL (PGlite) | The **frozen Prisma layer** still applies and validates |
| 9 | `npm run check:catalogue` | **55 passed, 0 failed** | The M1 canonical catalogue SQL (materials, aliases, forms, equivalence governance) holds |
| 10 | `npm run check:equivalence` | **48 passed, 0 failed** | Alias-equivalence governance rules hold |
| 11 | `npm run test:site-url` | **30 passed, 0 failed** | The production-origin build gate behaves (§7.3) |
| 12 | `npm run verify:unique-index-semantics` | **exit 0** | Partial unique indexes behave as designed |
| 13 | `npm run verify:tax-rule-index` | **exit 0** | Tax-rule index shape holds |
| 14 | `npm run audit:unique-indexes` | **exit 0** | Index inventory consistent |
| 15 | `npm run db:validate:offline` | **549 passed, 0 failed** — **45 collections, 98 indexes** | MongoDB definitions are internally consistent without a server |
| 16 | `npm run check:mongodb` | **105 passed, 0 failed** | Collections, validators, indexes and append-only guards behave on an in-process `mongod` |
| 17 | `npm run check:migrations` | **74 passed, 0 failed** | Migration set and ledger are coherent |
| 18 | `npm run check:enums` | **40 passed, 0 failed** | Enum sets are consistent with the collections that use them |
| 19 | `npm run check:permissions` | **145 passed, 0 failed** | Tier resolution and permission rules as a library |
| 20 | `npm run check:adversarial` | **97 passed, 0 failed** | Database-level attack cases (insert/update/delete/upsert against append-only and identity collections) |
| 21 | `npm run check:acceptance` | **93 passed, 0 failed** | Acceptance-level database properties |
| 22 | `npm run check:remediation` | **130 passed, 0 failed** | The W1–W4 remediation properties still hold |
| 23 | `npm run check:bootstrap` | **23 passed, 0 failed** | Bootstrap/provisioning path for roles and guards |
| 24 | `npm run check:reviewer-package` | **88 passed, 0 failed** | The Phase 1 reviewer package is internally consistent |
| 25 | `npm run check:authz` | **52 properties held, 6 gaps, 0 failures**; brief matrix **9 satisfied / 4 open / 1 blocked** (`W3.1`, `W3.3`, `W2.2`, `W2.6` open; `W3.4` blocked) | The database security design resists the attacks it was written for — **at the database layer** |
| 26 | `npm run report:tier-matrix` | **exit 0** | Tier matrix generates from definitions |
| 27 | `npm run audit:permission-integrity` | **exit 1** — `✖ MONGODB_URI is not set. Nothing was read; nothing was changed.` | The script **refuses** to invent a result without a cluster. This is correct behaviour and is recorded as such |
| 28 | Anonymous HTTP probe of every portal route on the served build | **35 URLs returned HTTP 200** — 34 static routes (19 admin, 7 buyer, 8 seller) plus `/admin/enquiries/example`; `/api/health` → `200 {"status":"ok","database":"not_configured"}` | The portals are **open**, and the health probe reports the truth about the database |

**Aggregate: 28 commands, 27 pass/refuse correctly, 0 unexpected failures.** No test was modified,
skipped or weakened to obtain these results.

### 11.2 What the battery does not cover

1. **No end-to-end persistence test exists or can exist** — there is no write path to test.
2. **No authentication test** — no identity exists. `W3.4` is *blocked* for this reason, not skipped.
3. **No managed-cluster verification** — every database suite runs against `mongodb-memory-server`
   (mongod 7.0.14) or PGlite on this machine. No TLS, no SCRAM against Atlas, no proxy, no latency.
4. **No performance or load test** — no data path to exercise (§10).
5. **No accessibility test** — no a11y tooling is installed (§10).
6. **No cross-browser test** — Chrome only.
7. **No migration rollback test** — no migration defines a down path (`0` matches for
   `rollback|revert|down` across `db/migrations/*.mjs` and `check-migration-architecture.mjs`).
8. **The full apply path was not completed.** `node scripts/db-init.mjs` against a fresh in-process
   `mongod` 7.0.24 created the first collections of `v001` and had **not finished after 600 s** (an
   earlier 240 s run was killed mid-apply). The suite-level migration checks exercise targeted fixtures,
   not the full 45-collection apply, so they do not measure this. Whether the duration is the cost of the
   migration itself or of this workstation's in-process `mongod` is **unmeasured** — and it must be
   measured on a real cluster before the first deployment, because a CI job that applies 45 collections
   can exceed a default timeout.
9. **Not run in this audit:** `npm run check:schema:m1`, `npm run verify:phase3`,
   `npm run db:status`, `npm run db:verify`, `npm run db:generate`, `npm run db:format`,
   `npm run db:init`, `npm run db:provision`, `npm run db:check-role`, `npm run db:enums`,
   `npm run db:backfill-organisations`, `npm run audit:*` beyond those listed. The `db:*` subset
   either needs a cluster or writes to one; they are excluded deliberately (§0.4).

### 11.3 Evidence independence, and the tree

The suites above were written by the same body of work they verify, and several assert against
in-process databases. They are **self-consistent, not independently validated**. No external reviewer
executed them; `check:authz`, `check:adversarial` and `check:remediation` are the author's own attacks
on the author's own design.

Tree state after all of the above (re-measured at the end of the audit):

| Fact | At capture (§1) | At end |
|---|---|---|
| `git status --porcelain -uall` lines | 105 | **119** (+14 documents) |
| Modified (unstaged) | 6 | **6** — identical set, unchanged |
| Untracked | 99 | **113** |
| Staged | 0 | **0** |
| Deleted | 0 | **0** |
| Commits / pushes / stashes | 0 | **0** |

The 99 pre-existing untracked paths break down as: 30 `scripts/`, 23 `docs/`, 22 `db/`, 11 `prisma/`,
9 `src/`, 2 `.github/`, 2 root files; the 113 at the end are those 99 plus this audit, the roadmap, the
Workstream 6 reviewer package, its evidence transcript, the workstream tracker and the nine files of the
packaged reviewer directory `docs/reviewer-package/`.
Scratch output was written to `/tmp` only; no `.tmp*` file remains
in the tree.

---

## 12. Production launch readiness

### 12.1 Verdict per area named in the brief

| # | Area | Verdict | One-line reason |
|---|---|---|---|
| 1 | Public website | **OPERATIONAL (narrow)** | Static, fast, SEO-complete, verified served; it can attract a lead and nothing more |
| 2 | Public catalogue | **PARTIAL** | Grade and part pages render; no price, stock, availability or search |
| 3 | Buyer registration and enquiry submission | **NOT READY** | Screens exist; no account is created and nothing is submitted |
| 4 | Seller registration and supplier listing | **NOT READY** | Screens exist; nothing is stored; no approval workflow exists |
| 5 | Admin operations | **NOT READY** | 21 preview screens with empty tables; no records to operate on |
| 6 | Supplier matching and RFQs | **NOT IMPLEMENTED** | Enum only; no collection, algorithm or dispatch |
| 7 | Supplier quotation collection and comparison | **NOT READY** | Forms are inert; no quotation entity exists |
| 8 | Buyer quotation generation and approval | **NOT READY** | No quotation entity, no approval state, no pricing engine |
| 9 | Orders, payments and fulfilment | **NOT IMPLEMENTED** | No order, invoice, payment or shipment collection anywhere |
| 10 | Commercial pricing, taxes and margins | **MODELLED** | Enums and reference tables only; no calculation, no snapshot |
| 11 | Authentication and organisation-level access control | **NOT IMPLEMENTED** | No auth library, no session; permissions exist as an unwired library |
| 12 | Database and migrations | **READY FOR REVIEW, NOT DEPLOYED** | 45 collections / 98 indexes / 5 migrations, 549/549 offline and 105/105 in-process; no cluster |
| 13 | Email, file storage and notifications | **NOT IMPLEMENTED** | Placeholders only; no sender, no bucket, no outbox |
| 14 | Monitoring, backup and production infrastructure | **NOT IMPLEMENTED** | No deployment, no APM, no backup, no restore, no rollback |

### 12.2 Go / no-go

**NO-GO for production launch.** Not a conditional no-go with a long list of caveats: there is no
transaction path of any kind, and the portals are open. Concretely, launch cannot be considered while
**any one** of the following is true, and all six are true today:

1. `/admin`, `/buyer`, `/seller` answer 200 to an anonymous client (measured: 35 URLs).
2. No request can write and no database is configured, so no business record can exist.
3. The transaction entities (quotation, order, invoice, payment) have no collections.
4. There is no document or email pipeline, so verification and notification cannot happen.
5. W3 and W2-s remain open, blocking authentication sign-off.
6. `db-init.yml` can initialise a production database from a push to `main`.

**The website may be launched on its own** as a marketing and lead-capture surface, provided the
portal routes are not published or are fronted by a deny rule. That is a decision for the owner, and it
is the only launch decision this audit finds supportable today.

---

## 13. PART 7 — Direct answers

### 13.1 How operational is the product? (measured, with the method stated)

Two metrics, both computed from §3 rather than estimated:

**(a) By assessed service row.** §3 contains **79** service rows. Measured distribution:

| Classification | Rows | Share |
|---|---|---|
| WORKING (fully) | 2 | 2.5% |
| WORKING — definition layer only | 2 | 2.5% |
| PARTIAL | 8 | 10.1% |
| UI_ONLY | 27 | 34.2% |
| MODELLED | 13 | 16.5% |
| NOT_IMPLEMENTED | 22 | 27.8% |
| UNVERIFIED / CONFLICT | 4 | 5.1% |
| Not applicable yet | 1 | 1.3% |

**(b) By area of the brief.** Of the **14 areas** in §12.1, **1 is operational for its stated
purpose** (the public website, row 1) and **0 transactional areas are operational**: 7.1% by area
count. The catalogue is partial; everything a buyer, seller or administrator would *do* is not ready.

**Stated assumption:** these percentages count **surfaces**, not effort or value. They are not a
completion estimate. By effort, the remaining work is larger than the row counts suggest, because the
unbuilt rows include the entire transaction engine.

### 13.2 The five biggest blockers

1. **No identity and open portals (B-1, B-2).** Nothing can be authorised, and everything currently
   is anonymous. This is first because connecting a database before fixing it exposes every record.
2. **No persistence (B-3, B-4).** Zero write handlers, zero server actions, no `MONGODB_URI`. The
   platform cannot record that an enquiry happened.
3. **The transaction entities do not exist (B-5).** Quotation, order, invoice, payment and shipment
   have enums and screens and no collections. This is the largest single build.
4. **No document, email or notification pipeline (B-6, B-7).** Verification, RFQ dispatch and
   "buyer receives a reference" all depend on them; none exists.
5. **The database design cannot yet support authentication sign-off (B-8, B-9, B-11).** W3 needs a
   fourth role, W2-s needs a new migration (`v006`), and eight owner decisions are unapproved. These
   are prerequisites, not follow-ups.

**Plus one production-safety risk that is not a launch blocker but is a P0 fix:** `db-init.yml` is
live on `main` and targets `production-database` (B-10, §7.4).

### 13.3 Recommended next implementation task

**Immediate, non-product, ≤ half a day: make `db-init.yml` manual-only** (`on: workflow_dispatch`),
matching what `PROJECT_SUMMARY.md` already claims, and add required reviewers to the
`production-database` environment. This is a one-file change with a production-safety payoff and no
dependency on any open decision.

**Then the first product task: the M2a authentication foundation** — *not* because a login page is the
most visible gap, but because everything else needs an actor. It cannot start until three things land:
`D-M2a-1` (Argon2id), `D-M2a-2/3` and `D-BOOT-1…4` are approved; the W3 fourth-role migration is
designed; and `v006` relocates the platform-identity pointer. Recommended sequencing is in
`docs/PRIMEMET_IMPLEMENTATION_ROADMAP.md` (P2).

### 13.4 What an MVP costs (ESTIMATE — assumptions stated, not measured)

Assumptions: **one senior full-stack engineer**; the existing design documents are the specification;
an Atlas development cluster exists; no parallel QA; estimates ±30%; excludes owner-decision latency,
legal/compliance review, payment-provider onboarding, and data migration (there is no data).

| Phase | Engineer-days |
|---|---|
| P0 Stop the bleeding | 2 |
| P1 Architecture closure and the decision register | 5–7 |
| P2 M2a authentication foundation | 15–22 |
| P3 Persistence spine: enquiry, organisation, documents, notifications | 18–26 |
| P4 Supply side: sellers, listings, matching, RFQs | 15–22 |
| P5 Commercial engine and operations baseline | 22–31 |
| **P0–P5: transactable platform, no money movement** | **77–110** |
| P6 Invoices, payments, settlements, disputes | 10–15 |
| **P0–P6: with money movement** | **87–125** |

**So: roughly 3.9–5.5 months for one engineer to reach a transactable platform without payments, and
4.4–6.3 months with money movement** (20 working days per month). Per-phase task breakdown, dependencies
and acceptance criteria are in `docs/PRIMEMET_IMPLEMENTATION_ROADMAP.md`; these are planning estimates,
not commitments.

### 13.5 What this audit does not establish

- It does **not** establish independent acceptance. No external reviewer executed any command above
  (§11.3). The earlier Workstream 6 package is likewise recorded as
  *FIXED, INDEPENDENT REVIEW PENDING*.
- It does **not** establish production behaviour of any kind: nothing is deployed, no cluster is
  contacted, no production data exists.
- It is **not** a penetration test, a performance test or an accessibility audit.
- It does **not** claim that the unrun `db:*` commands pass (§11.2).

---

## 14. Documents produced by this audit

1. `docs/PRIMEMET_COMPLETE_PRODUCT_READINESS_AUDIT.md` — this document.
2. `docs/PRIMEMET_IMPLEMENTATION_ROADMAP.md` — the dependency-ordered P0–P6 plan with acceptance
   criteria and effort estimates.
3. `docs/PRIMEMET_WORKSTREAM6_REVIEWER_PACKAGE.md` — revision 2 of the Phase 1 reviewer package
   (Workstream 6), separate from this audit and carrying its own classification and recommendation.
4. `docs/PRIMEMET_WORKSTREAM6_EVIDENCE.md` — the raw command transcript behind item 3, hashed and
   dated, so a reviewer can compare their own run against it.
5. `docs/PRIMEMET_WORKSTREAM_TRACKER.md` — the two-axis tracker that records deliverable completion
   separately from security acceptance.
6. `docs/reviewer-package/` — the same package in packaged form: one document per required element
   plus an index.

No application code, schema, migration, test, script, configuration or workflow was changed. No commit,
push, merge, tag, deploy or database operation was performed.
