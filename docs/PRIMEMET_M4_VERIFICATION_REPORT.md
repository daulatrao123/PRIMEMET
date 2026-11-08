# PRIMEMET — M4: Seller Portal and Admin Seller Approval (MongoDB)

**Status:** M4 VERIFIED LOCALLY — 55/55 (`node scripts/verify-m4.mjs --group ALL`)
**Date:** 2026-11-04
**Datastore:** MongoDB only (official driver). No PostgreSQL, no Prisma application integration, no dual writes.
**Repository state:** nothing staged, nothing committed, nothing pushed, nothing deployed.

---

## 1. Changed files

### New

| Path | Purpose |
| --- | --- |
| `db/migrations/v008-seller-portal.mjs` | Migration v008: seller application fields, listing submission detail, queue indexes |
| `src/lib/data/seller-portal.ts` | Session-derived seller reads/writes: application view, profile update, dashboard, business-type vocabulary |
| `src/lib/data/seller-admin.ts` | Admin seller queue with filter/search, application detail, internal notes |
| `src/app/api/seller/profile/route.ts` | `POST` — seller edits its own company and registered address |
| `src/app/api/seller/listings/route.ts` | `POST` — seller submits a listing (always PENDING/DRAFT) |
| `src/app/api/seller/listings/update/route.ts` | `POST` — seller corrects and resubmits a PENDING/REJECTED listing |
| `src/app/seller/products/[id]/page.tsx` | Seller edit-and-resubmit page; approved listings are read-only |
| `src/app/api/admin/sellers/route.ts` | `POST` — ADMIN only: approve, reject, or record an internal note |
| `src/app/api/admin/listings/route.ts` | `POST` — ADMIN only: approve or reject one listing |
| `src/app/admin/listing-submissions/page.tsx` | Admin listing review queue with per-listing decisions |
| `src/app/admin/suppliers/[id]/page.tsx` | Admin seller application review, decision, notes, audit trail |
| `scripts/verify-m4.mjs` | M4 verification gate (`--group A..E`, `--selfcheck`) |
| `scripts/lib/m4-groups/a.mjs … e.mjs` | The five M4 test groups |
| `docs/PRIMEMET_M4_VERIFICATION_REPORT.md` | This report |

### Modified

| Path | Change |
| --- | --- |
| `db/collections/core.mjs` | `SELLER_BUSINESS_TYPES`; `organisations.businessType/description/reviewFeedback/reviewedAt/reviewedByUserId`; `supplier_listings.manufacturer/description/specification/supportingInfo/images`; two queue indexes |
| `db/migrations/index.mjs` | v008 registered (source = its own file) |
| `src/lib/data/listings.ts` | Submission content fields; reject-reason required; approval/rejection audited; optional admin review filter; `listMyListings`, `submitMyListing`; `getMyListing` and `updateMyListing` (resubmission clears the decision and audits `listing.resubmitted`) |
| `src/lib/data/admin.ts` | `decideSeller` records seller-facing feedback, reviewer and audit; GSTIN verification deliberately untouched |
| `src/lib/data/accounts.ts` | Registration writes business type, description and the REGISTERED address row |
| `src/lib/validation.ts` | `sellerCompanySchema`, `listingSubmissionSchema`, `sellerAdminActionSchema`; registration gains business type, description, address line and PIN |
| `src/lib/http.ts` | `readInput` joins a JSON string array into the newline form a textarea posts (one validation path) |
| `src/lib/auth/rate-limit.ts` | `sellerProfile` limit added; the previously declared `listing` and `adminWrite` policies are now enforced |
| `src/app/api/auth/register/route.ts` | Passes the new seller registration fields |
| `src/app/(auth)/register/seller/page.tsx` | Business type, registered address, PIN, state code, company description |
| `src/app/seller/dashboard/page.tsx` | Real: status, feedback, counts, recent submissions |
| `src/app/seller/profile/page.tsx` | Real: company, address, business type, description, read-only GSTIN |
| `src/app/seller/products/page.tsx` | Real: submission form and history with decisions and rejection reasons |
| `src/app/seller/tax/page.tsx` | Real, read-only: GSTIN/PAN/state with verification state |
| `src/app/seller/{materials,enquiries,quotations,orders}/page.tsx` | Still previews, now behind `requirePage(["SELLER"], …)` |
| `src/app/seller/layout.tsx` | Comment corrected: the gate lives on each page |
| `src/app/admin/suppliers/page.tsx` | Real queue: counts, status filter, escaped search, links to review |
| `src/lib/content/admin-nav.ts` | "Listing submissions" entry |
| `scripts/check-seo.mjs` | `/seller/dashboard` and `/seller/products` asserted as session-gated (like `/buyer/dashboard`) |
| `package.json` | `verify:m4` script |

No unrelated file was reset, cleaned or overwritten.

---

## 2. MongoDB migrations and indexes

### Migration v008 — `v008_seller_portal` (head)

Applied through the repository's own ledger (`applyMigrations`, `db/ledger.mjs`), version 8, checksum of its own file.

Order of operations, all idempotent, no drops:

1. Backfill `supplier_listings.images: []` for documents written before v008, **bypassing the old validator** (which forbids additional properties) — the same ordering v006 and v007 used.
2. `collMod` validator convergence for `organisations` and `supplier_listings`.
3. `createIndexes` for every declared index, including the two new queue indexes.

New fields:

- `organisations`: `businessType` (nullable, constrained to MANUFACTURER/TRADER/STOCKIST/PROCESSOR/RECYCLER/WORKSHOP/OTHER), `description` (≤2000), `reviewFeedback` (≤1000, seller-facing), `reviewedAt`, `reviewedByUserId`.
- `supplier_listings`: `manufacturer` (≤160), `description` (≤4000), `specification` (≤4000), `supportingInfo` (≤2000), `images` (array of ≤8 https references).

New indexes:

| Collection | Index | Serves |
| --- | --- | --- |
| `organisations` | `{ orgType: 1, accountStatus: 1, createdAt: -1 }` | Admin seller queue: sellers filtered by decision state, newest first |
| `supplier_listings` | `{ supplierId: 1, createdAt: -1 }` | Seller submission history |

Reused, not duplicated:

| Collection | Index | Used by |
| --- | --- | --- |
| `supplier_listings` | `{ reviewStatus: 1, submittedAt: -1 }` (v006) | Admin listing queue |
| `supplier_listings` | `{ supplierId: 1, status: 1 }` | Supplier reads |
| `supplier_profiles` | `{ organisationId: 1 }`, unique partial `{ userId: 1 }` | Session → supplier profile |
| `organisations` | unique partial `{ gstin: 1 }` | Duplicate/invalid GSTIN registrations |
| `organisation_addresses` | `{ organisationId: 1, kind: 1 }` | Registered office lookup |
| `users` | unique `{ email: 1 }` | Duplicate registration refusal |

Migration and schema controls: `npm run check:migrations` → **74 passed, 0 failed** (46 collections cross-checked); `npm run check:schema` → **61 passed**.

---

## 3. Test results

Everything runs against an isolated in-memory MongoDB replica set, with the repository's real migrations, driving the real production build through `next start`.

### M4 gate — `node scripts/verify-m4.mjs --group ALL`

| Group | Scope | Result |
| --- | --- | --- |
| A | Seller onboarding at the data layer: registration state, duplicate refusal, session-scoped reads/writes, self-decision refusals | **10 / 10 PASS** |
| B | Registration, approval and sign-in over HTTP: PENDING_APPROVAL, pre-approval refusal, admin queue, approval, rejection with reason, sign-in after approval | **9 / 9 PASS** |
| C | Seller portal over HTTP: profile edit, listing submission, history, resubmission after rejection, cross-seller isolation and edit refusal, anonymous/buyer/seller refusals, unsafe image refusal, public-catalogue invisibility, and the per-seller submission quota | **14 / 14 PASS** |
| D | Admin review screens: filter and escaped search, application detail, internal notes never reaching the seller, rejection-reason enforcement, approval, publication gate, admin-only decisions, audit trail | **9 / 9 PASS** |
| E | End-to-end seller onboarding journey (13 numbered steps) | **13 / 13 PASS** |
| **Total** | | **55 passed, 0 failed, 0 skipped — VERIFIED LOCALLY** |

Self-check: `node scripts/verify-m4.mjs --selfcheck` — build present, replica set up, 8 migrations applied (v008 head), `/api/health` 200, seller modules expose all 9 entry points.

### Regression — earlier milestones on this tree

| Gate | Result |
| --- | --- |
| `node scripts/verify-m1.mjs --group ALL` | **42 / 42 PASS** |
| `node scripts/verify-m2.mjs --group ALL` | **41 / 41 PASS** |
| `node scripts/verify-m3.mjs --group ALL` | **28 / 28 PASS** |

### Project gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 errors, 0 warnings) |
| `npm run build` | PASS — 73 pages, 82 routes |
| `npm run check:seo` (`NEXT_PUBLIC_APP_URL=https://primemet.example`) | PASS — 656/656, 28 sitemap URLs, 39 JSON-LD blocks |
| `npm run check:routes` | PASS — 82 routes, 56 required, 165 files |
| `npm run check:migrations` | PASS — 74/74 |
| `npm run check:schema` | PASS — 61/61 |
| `npm run check:catalogue` | PASS — 55/55 |
| `npm run check:content` | Not run — requires a live server on 127.0.0.1:3100 (pre-existing behaviour) |

### The owner's numbered acceptance list

| # | Step | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Seller registers | PASS | E1: 201, user INVITED, organisation PENDING_APPROVAL |
| 2 | Seller logs in | PASS (after approval) | E2: 403 `inactive` before approval; E6: signed in after approval |
| 3 | Seller sees PENDING_APPROVAL | PASS, as the secure behaviour allows | E2: the pending state is returned by the registration response and the sign-in refusal; a pending seller cannot hold a session, so it cannot see a portal page. E6 shows the signed-in state immediately after approval. **Deviation from the literal order, required by the M1 rule that only an ACTIVE account signs in.** |
| 4 | Seller submits company information | PASS | E7: company, business type, description, registered address |
| 5 | Seller submits a product listing | PASS | E8: stored PENDING / DRAFT |
| 6 | Admin logs in | PASS | E3: administrator door, queue lists the application |
| 7 | Admin reviews seller registration | PASS | E4: company, address, description, GSTIN on the review page |
| 8 | Admin approves or rejects seller | PASS | E5 approve; B8 reject with a mandatory reason and 403 on later sign-in |
| 9 | Seller sees the updated status | PASS | E6: dashboard shows "Registration status: Approved" |
| 10 | Admin reviews the submitted listing | PASS | E10: queue shows supplier, specification, quantity, images |
| 11 | Admin approves the listing | PASS | E11: APPROVED + ACTIVE, reviewer and audit row |
| 12 | Approved product appears in the central catalogue only after admin publication | PASS | E12 and D6/D7: approval creates no catalogue product; only an admin-published product is on `/products`; no seller identity on the public page |
| 13 | Seller cannot modify approval status or access another seller's data | PASS | E13, A8/A9, C8/C9, D8: 403 at routes and at the data layer; second seller sees none of it |

### Security requirements from the directive

| Requirement | Result | Evidence |
| --- | --- | --- |
| Seller A cannot access Seller B's profile | PASS | A7, C6, C7, E13 — every read derives the organisation from the session |
| Seller A cannot access Seller B's listings | PASS | A7, C6, C7, E13 |
| Seller cannot approve themselves | PASS | A9, C8, E13 (403 route + AuthorisationError at data layer) |
| Seller cannot modify their own approval status | PASS | A5, C3 (posted `accountStatus`/`verificationStatus` ignored), E13 |
| Seller cannot publish directly | PASS | A6, C5, C11, D6 — payload `reviewStatus`/`status` ignored; validator requires an explicit review state |
| Buyer cannot access seller management | PASS | C2, D8 |
| Anonymous users cannot access protected seller operations | PASS | C1 (4 pages), C9 (401) |
| Only admin can approve or reject sellers | PASS | A9, C8, D8 |
| Only admin can publish seller-submitted products | PASS | A8, C8, D5, D6, E11/E12 |
| Frontend-only controls | None relied on | Guards live in `requirePage`/`requireApi` and again in `requireAdminActor`/`requireSellerProfile` |

---

## 4. Security limitations

These are recorded, not hidden. None of them is a passing test that was faked.

1. **No document upload.** Phase 1 has no secure object store, so business documents cannot be attached. The application form captures declarations and the registered address; the admin review page states plainly that certificate files are checked out of band. Document review is therefore **BLOCKED as a software feature**, not implemented partially.
2. **No email on the decision.** Approval is discovered at the next sign-in. A rejected seller cannot enter the portal, so the desk's reason is returned by the sign-in refusal itself — but only after the password is verified, and only from `reviewFeedback`, never from `internalNotes` (asserted in B8). Proactive notification still requires email, which does not exist yet.
3. **Isolation is application-layer, not database-layer.** MongoDB has no RLS. Every seller function derives the organisation from the session and there is no organisation-id parameter, but a future query that bypasses `seller-portal.ts` would not be stopped by the database. RLS/organisation isolation is D9 Task 2 and is still unstarted.
4. **GSTIN is not verified.** By directive. `verification` stays `PENDING` through registration and approval; approval does not imply tax acceptance (asserted in B6).
5. **Images are references only.** `https://` scheme is validated server-side and at most eight are accepted; PRIMEMET does not fetch, scan or moderate the remote content, and a seller-supplied image is never rendered publicly by the listing queue.
6. **Rate limiting is in-process, not distributed.** Registration and login were already limited; M4 wires the policy that was declared but unused — 20 listing submissions per hour per seller (submit and resubmit share the bucket), 30 profile writes per hour, 60 admin writes per hour — each answered with 429 `rate_limited` (asserted in C14). With more than one server instance each instance counts separately, so the effective limit multiplies; a shared store is a deployment step.
7. **CSRF** protection is the existing M1 design: same-site session cookie, `Origin` check on every write, 303 redirects. There is no per-form token.
8. **Audit writes never fail a request** (by design): a failed insert goes to `audit_log_failures`. An approval therefore commits even if its audit row does not; the failure is itself recorded and must be monitored.
9. **No fixture or seed data** is written by the application; sellers, applications and listings only exist through the real routes.
10. **Seller enquiries, quotations and orders remain previews** (guarded but not implemented) — they are M5+ scope.
11. **Workstream 6 is untouched**: reviewer package DELIVERED, independent review PENDING SEPARATE ENGINEER, security acceptance NOT GRANTED. No package check was re-run. MongoDB remains in freeze-then-retire status; nothing in M4 changes that direction.

---

## 5. Complete seller onboarding journey — confirmed

One seller, one sequence, all asserted against MongoDB and against the rendered pages (`E1`–`E13`):

1. **Register** at `/register/seller` with company, GSTIN, registered address, contact person, email, phone, business type and company description → **201**, user `INVITED`, organisation `PENDING_APPROVAL`, supplier profile `PENDING`, `organisation_addresses` row of kind `REGISTERED`. Duplicate email → **409**; invalid input → **400** with nothing written.
2. **Cannot sign in yet** → **403 `inactive`** with an explicit "awaiting approval" message.
3. **Administrator signs in** at the admin door and the application is in `/admin/suppliers` as *Awaiting decision*.
4. **Administrator reviews** `/admin/suppliers/[id]`: company, trading name, business type, GSTIN, PAN, contact, website, registered address, description, submissions and audit trail.
5. **Administrator approves** (or rejects with a mandatory reason). One transaction moves the user to `ACTIVE` and the organisation to `ACTIVE`; `reviewFeedback`, `reviewedAt` and `reviewedByUserId` are recorded and the action is audited. GSTIN verification is **not** changed.
6. **Seller signs in**, dashboard shows *Approved* and any desk feedback.
7. **Seller submits company information** (`/seller/profile`): company, trading name, business type, description, registered address, contact and phone. GSTIN and every decision field are outside the allow-list.
8. **Seller submits a product listing** (`/seller/products`): product name, category, manufacturer, description, technical specification, image links, available quantity, supporting information and desk notes → stored `PENDING` / `DRAFT`.
9. **Seller sees the submission** in its history as *Awaiting approval*, with any rejection reason when one exists. A rejected or still-pending submission can be opened, corrected against the desk's reason and **resubmitted**: the write clears the previous decision, returns it to PENDING/DRAFT and records `listing.resubmitted`. An approved listing is read-only, and another seller's id simply does not exist for this session.
10. **Administrator reviews the listing** at `/admin/listing-submissions`, with supplier, specification, quantity and images.
11. **Administrator approves or rejects**; rejection requires a reason the seller can read. Approval moves the listing to `APPROVED` / `ACTIVE` and is audited.
12. **Publication is a separate admin act.** An approved listing creates no catalogue product; `/products` shows nothing of the seller's until an administrator publishes a catalogue product, and the public page carries no seller identity.
13. **Isolation and self-decision hold end to end**: a second seller sees none of the first seller's company or submissions, and a seller is refused (403 route, `AuthorisationError` at the data layer) when it tries to approve or reject itself.

**M4 is complete and awaiting owner review. No M5 work has started.**
