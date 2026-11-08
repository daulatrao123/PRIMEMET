# PRIMEMET — M5: Complete Admin Control Centre (MongoDB)

**Status:** implementation complete; **32/32** M5 checks and every regression green locally.
**Date:** 2026-11-04 (verification runs 2026-11-04T18:4x–19:0x UTC)
**Database:** MongoDB only. No PostgreSQL, no Prisma application code, no dual writes, no deploy, no commit.

This report covers the owner's M5 brief (attachment, 2026-11-04). It states what was built, the
migration and indexes, the test evidence as observed, the security behaviours proved, and the
limitations that remain. It stops here for owner review; M6 is not started.

---

## 1. What the control centre now does

| Brief | Delivered |
| --- | --- |
| **1. Dashboard overview** | `/admin/dashboard` renders all eleven briefed figures read live from MongoDB (buyers; sellers with pending and approved in the same tile; products and published products; pending listings; total, new, in-progress and completed enquiries), plus suspended accounts and the category count. Counts are `$group` aggregations (`adminOverview`), not counters or fixtures. |
| **2. Buyer management** | `/admin/buyers` register with search (company, contact, email, GSTIN, city), account-status filter and pagination; `/admin/buyers/[id]` shows the company record, registered address, organisation details, the buyer's enquiry history and the account standing, with suspend/reactivate forms. |
| **3. Seller management** | `/admin/suppliers` queue (pending first) with search, status filter and pagination; `/admin/suppliers/[id]` shows registration information, GSTIN verification as recorded, the seller's listing submissions, private internal notes, account standing, and the approve/reject decision with a reason. Approve/reject, note and suspend/reactivate all write audit rows. |
| **4. Product management** | Existing catalogue screens retained (create, edit, publish/unpublish, archive with `deletedAt`, categories, families). Added: `/admin/catalogue/manufacturers` with a rename that rewrites the manufacturer on every affected product and **preserves each product's slug/URL**, and the listing review queue `/admin/listing-submissions` with approve/reject + reason. Images are managed as validated `https://` links (no object store — see §6). |
| **5. Enquiry management** | `/admin/enquiries` with status filter, search and pagination; `/admin/enquiries/[id]` shows the enquiry, the buyer link, the product, the status history and a private internal note. Status changes and notes are audited. Enquiries are labelled as enquiries throughout — nothing in the console calls them orders. |
| **6. Dashboard activity** | The dashboard shows four live feeds: recent registrations, recent enquiries, seller/account decisions and product publication events. Every item is a stored document or an append-only `audit_logs` row (`recentActivity`); nothing is derived from a fixture or a session. |
| **7. Security** | Admin route and API guards, data-layer `requireAdminActor` refusals, audited decisions, private notes excluded from buyer/seller projections, organisation isolation preserved and tested. See §5. |
| **8. Performance and usability** | Every register is searched, filtered and paginated (hard caps: 20 rows per page for registers, 25 for the audit log, never more than 100), the overview aggregates in the database, the audit log is never read unbounded, the suspend/reactivate and rename forms are server-posted and redirect with an `ok`/`error` message, empty states exist on every table, and the admin segment now ships `loading.tsx`, `error.tsx` and `not-found.tsx` so a slow read, a failed read and a missing record each have their own screen inside the control centre. |

---

## 2. Changed files

### New

| File | Purpose |
| --- | --- |
| `db/migrations/v009-admin-console.mjs` | Migration v009 (see §3). |
| `src/lib/data/admin-console.ts` | `adminOverview`, `recentActivity`, `listBuyersPage`, `getBuyerDetail`, `setAccountStatus`, `listManufacturers`, `renameManufacturer`, `getEnquiryAuditTrail`, `listAuditPage`. |
| `src/app/admin/buyers/[id]/page.tsx` | Buyer detail, company profile, enquiry history, account standing. |
| `src/app/admin/catalogue/manufacturers/page.tsx` | Manufacturer register and rename. |
| `src/app/api/admin/accounts/route.ts` | `POST` suspend/reactivate, ADMIN-only, audited. |
| `src/app/api/admin/manufacturers/route.ts` | `POST` rename, ADMIN-only, audited. |
| `src/app/admin/loading.tsx` | Admin segment loading skeleton. |
| `src/app/admin/error.tsx` | Admin segment error boundary (fixed message + digest, retry). |
| `src/app/admin/not-found.tsx` | Admin-scoped not-found screen (keeps the control-centre chrome). |
| `scripts/verify-m5.mjs` | The M5 gate: boots an in-memory replica set, migrates, builds nothing (uses the existing build), starts `next start`, runs groups A–E. |
| `scripts/lib/m5-groups/a.mjs` | Data layer: overview vs `countDocuments`, registers, buyer detail, suspension, refusals, manufacturer rename, audit read. |
| `scripts/lib/m5-groups/b.mjs` | Admin access over HTTP: door, dashboard, buyer register/detail, seller decisions, suspension. |
| `scripts/lib/m5-groups/c.mjs` | Products: create/publish, edit with stable slug, archive, refusals, manufacturer rename. |
| `scripts/lib/m5-groups/d.mjs` | Enquiries: create, filter/page, status change, private note, refusals, isolation. |
| `scripts/lib/m5-groups/e.mjs` | End-to-end seller relationship: application → approval → listing → rejection → note → suspension → reactivation, the unauthorised sweep, the persisted record, and the 404 boundary. |

### Modified

| File | Change |
| --- | --- |
| `db/collections/core.mjs` | `organisations.suspendedAt`, `suspensionReason`; index `{ orgType: 1, createdAt: -1 }`. |
| `db/collections/commerce.mjs` | Index `{ createdAt: -1 }` on `enquiries` for the unfiltered desk queue and the overview. |
| `db/migrations/index.mjs` | Registry entry for V009 (source digest included). |
| `src/lib/data/admin.ts` | `dashboardStats` delegates to `adminOverview` and carries the full M5 figure set. |
| `src/lib/data/enquiries.ts` | Admin filter gains `page`/`pageSize`, `adminFilterQuery`, `countEnquiriesForAdmin`; the unpaged default stays bounded at 200 rows. |
| `src/lib/data/seller-admin.ts` | `SUSPENDED` queue status, `suspendedAt`/`suspensionReason` on rows, `sellerFilterQuery`, `countSellerApplications`, rank-based paging, verification list on the detail. |
| `src/lib/validation.ts` | `accountStatusSchema`, `manufacturerRenameSchema`. |
| `src/lib/content/admin-nav.ts` | Manufacturers entry. |
| `src/app/admin/layout.tsx` | Async `requireAdminPage` guard, `force-dynamic`. |
| `src/app/admin/dashboard/page.tsx` | Real figures and four activity feeds. |
| `src/app/admin/buyers/page.tsx` | Real register, search, status filter, pagination, suspend/reactivate. |
| `src/app/admin/suppliers/page.tsx` | Real queue, search, status filter, pagination, suspended state. |
| `src/app/admin/suppliers/[id]/page.tsx` | Verification panel, listing submissions, internal notes, account standing. |
| `src/app/admin/enquiries/page.tsx` | Real queue, filter, pagination. |
| `src/app/admin/enquiries/[id]/page.tsx` | Buyer link, history, decision forms. |
| `src/app/admin/audit-log/page.tsx` | Real, searchable, paginated audit read. |
| `scripts/check-seo.mjs` | `/admin/dashboard` moved from the public “200 + noindex” list to the gated (redirect) list. |
| `package.json` | `verify:m5`. |

---

## 3. MongoDB migration and indexes

**Head after this milestone:** `v009_admin_console` (v001–v008 unchanged in intent; v008 remains the
seller-portal migration).

Migration v009 is additive and idempotent — it converges validators with `collMod` and ensures declared
indexes; it drops nothing, rewrites no document and needs no backfill:

1. **`organisations`** gains `suspendedAt` (date, optional) and `suspensionReason` (string ≤ 300,
   optional). Both are optional, so “absent” and “not suspended” are the same state.
2. **`organisations`** index `{ orgType: 1, createdAt: -1 }` — serves both registers (buyers, sellers)
   sorted newest first. The v006 per-status index does not serve an unfiltered sort.
3. **`enquiries`** index `{ createdAt: -1 }` — serves the overview’s aggregation and the unfiltered desk
   queue.

`npm run check:migrations` — **74 passed, 0 failed**, 46 collections cross-checked, the verification
database still byte-for-byte empty at the end of the ledger.

`npm run check:schema` — **61 passed, 0 failed** (validator semantics, including the new optional fields).
`npm run check:catalogue` — **55 passed, 0 failed**.

---

## 4. Test results (observed)

### M5 gate — `node scripts/verify-m5.mjs --group ALL`

Fresh in-memory replica set, full migration ledger, `next start` on 127.0.0.1:3250, database
`primemet_m1_m5_<stamp>`:

```
Group A: 7 passed, 0 failed, 0 skipped
Group B: 6 passed, 0 failed, 0 skipped
Group C: 5 passed, 0 failed, 0 skipped
Group D: 6 passed, 0 failed, 0 skipped
Group E: 8 passed, 0 failed, 0 skipped
TOTAL: 32 passed, 0 failed, 0 skipped
verdict: VERIFIED LOCALLY
```

Machine-readable record: `.exvisit/tmp/m1-verify/m5-report-<stamp>.json`. `npm run verify:m5` is the
same command.

What the groups prove, by name (the harness prints the one-line evidence for each):

* **A1** every overview figure equals a direct `countDocuments` on `organisations`, `products`,
  `supplier_listings`, `enquiries` and `categories`.
* **A2/A3** buyer register search/filter/page excludes sellers; buyer detail carries the enquiry history;
  the buyer projection carries no `internalNotes`.
* **A4/A5** suspension requires a reason, moves organisation **and** login together, writes
  `account.suspended` with a before-state, refuses a second suspension, reactivates cleanly; a buyer and
  a seller are refused at the data layer.
* **A6/A7** manufacturer rename reaches the product and preserves its slug, audited; the audit read is
  paginated, searchable and returns no raw audit document.
* **B1–B6** anonymous → `/admin/login`, buyer → `/buyer`, admin 200; dashboard shows the live figures and
  the activity feed; buyer register/detail render; a seller is approved and another rejected over HTTP
  (both audited, a short reason refused); suspend/reactivate through the form endpoint with 403 for a
  buyer and 401 for anonymous.
* **C1–C5** draft → publish, edit keeps the slug, archive removes the product from the public catalogue
  while keeping the record (public 404), three identities refused, manufacturer rename leaves the URL
  alone.
* **D1–D6** a buyer raises an enquiry and the desk sees it; filter and page; status change audited and
  visible to the buyer; the private note is absent from three buyer-readable surfaces; refusals; each
  buyer sees only its own organisation's enquiries.
* **E1** a real registration is refused sign-in while pending, appears in the pending queue and on the
  review page, is approved over HTTP (audited), and the overview moves pending −1 / approved +1 with the
  seller total +1.
* **E2** the approved seller signs in, submits a listing stored `PENDING`/`DRAFT`, sees it as “Awaiting
  approval”, and the desk's queue shows it with supplier and specification; pending listings +1.
* **E3** a rejection stores the reason, shows it to **its own** seller, hides it from another seller and
  from the public catalogue (list and search), leaves the product unpublished and audited; pending
  listings −1.
* **E4** the desk's internal seller note is stored, audited, visible on the review page and absent from
  `/seller/dashboard`, `/seller/profile`, `/seller/products`, `/seller/tax` and `/api/seller/profile`.
* **E5** suspending a seller ends the session it already holds (307 to `/login`), refuses a fresh
  sign-in (403, “This supplier account is suspended.”), shows the reason and standing on the review page,
  and reactivation restores a working portal.
* **E6** five admin endpoints × three identities: buyer 403, seller 403, anonymous 401, with a genuinely
  pending application and an enquiry left untouched afterwards; admin pages redirect a buyer.
* **E7** after the whole journey the overview still equals MongoDB on five figures, and registration,
  approval, audit row (entity id + deciding administrator) and dashboard feed all name the journey.
* **E8** three unknown ids render the admin not-found screen (no stack trace, no blank page, a way back).

### The owner's ten acceptance tests

| # | Acceptance test | Evidence |
| --- | --- | --- |
| 1 | Admin login | B1 (anonymous 307 → `/admin/login`, buyer 307 → `/buyer`, admin 200) |
| 2 | Dashboard statistics match MongoDB | A1, B2, E7 |
| 3 | Admin views buyers and sellers | B3, B4, E1 (queue + review page) |
| 4 | Admin approves/rejects a seller | B5, E1 |
| 5 | Admin creates and publishes a product | C1 |
| 6 | Admin edits a product | C2 (slug unchanged) |
| 7 | Admin views buyer enquiries | D1, D2, A3 (buyer enquiry history) |
| 8 | Admin updates enquiry status | D3 |
| 9 | Admin adds private notes | D4 (buyer enquiry), E4 (seller) |
| 10 | Unauthorised users cannot execute admin actions | C4, D5, E6, A5, B6 |

### Regression — earlier milestones on this tree

| Gate | Result |
| --- | --- |
| `node scripts/verify-m1.mjs --group ALL` | **42 passed, 0 failed** — VERIFIED LOCALLY |
| `node scripts/verify-m2.mjs --group ALL` | **41 passed, 0 failed** — VERIFIED LOCALLY |
| `node scripts/verify-m3.mjs --group ALL` | **28 passed, 0 failed** — VERIFIED LOCALLY |
| `node scripts/verify-m4.mjs --group ALL` | **55 passed, 0 failed** — VERIFIED LOCALLY |

(M4 reports 55 checks rather than 52 because its listing group gained assertions for the extended
submission fields in the same tree; no M4 check was weakened or removed.)

### Project gate

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass (`tsc --noEmit`) |
| `npm run lint` | pass (`eslint .`) |
| `npm run build` | pass — 58 pages generated, every `/admin/**` page and `/api/admin/**` route dynamic (`ƒ`) |
| `npm run check:seo` | **656 passed, 0 failed** — 28 sitemap URLs, 39 JSON-LD blocks |
| `npm run check:routes` | pass — 88 routes, 56 required, 175 files scanned |
| `npm run check:migrations` | **74 passed, 0 failed** |
| `npm run check:schema` | **61 passed, 0 failed** |
| `npm run check:catalogue` | **55 passed, 0 failed** |

---

## 5. Security behaviours verified

* **Server-side privilege, three times.** The admin layout calls `requireAdminPage` for every route
  beneath it, each data-reading screen calls it again, every admin API calls `requireApi(["ADMIN"])`, and
  each data-layer mutation calls `requireAdminActor` once more. E6 and A5 show
  the refusals are real (buyer 403, seller 403, anonymous 401; data layer throws for both) and that no
  decision was written by a refused request.
* **Audit is written, not claimed.** Seller decisions (`seller.application.approved|rejected`), account
  standing (`account.suspended|reactivated`), internal notes (`seller.note_added`), manufacturer renames
  (`catalogue.manufacturer.renamed`) and listing decisions (`listing.approved|rejected`) each leave an
  append-only `audit_logs` row with actor, entity and before/after state. A4, A6, B5, E1, E3, E4 assert
  the rows directly in MongoDB.
* **Internal notes are private.** Notes live on the enquiry / organisation document and are excluded
  from the buyer and seller projections; A3, D4 and E4 check the projection **and** the rendered pages
  and the seller API, not just the data function.
* **Organisation isolation holds.** A buyer only ever reads its own enquiries (D6), another seller
  cannot read a competitor's listing or rejection reason (E3), and the buyer register never mixes in a
  seller (A2, B3).
* **Publication is a desk action.** A seller submission is `PENDING`/`DRAFT` and never reaches the
  catalogue (E2, E3); approval of a submission does not publish a product (M4 E12); archiving removes the
  public page but keeps the record (C3).
* **Suspension is effective immediately.** A suspension writes the organisation and its people together,
  so an already-issued session stops resolving (E5) — the check runs against the cookie the product
  issued before the suspension.
* **Failure surfaces leak nothing.** The error boundary shows a fixed message and the Next digest only
  (no stack, no query, no document); the not-found boundary stays inside the control centre (E8).

---

## 6. Limitations carried forward (not solved by M5)

1. **The rate limiter is in-process.** `src/lib/auth/rate-limit.ts` keeps counters in module memory, so
   limits are per Node instance. With more than one instance the effective limit multiplies; there is no
   shared store and no distributed limiting. This is documented, not claimed as solved. M5 relies on it
   for the admin write budget (60 writes/hour per administrator) and the login budgets.
2. **No object storage, therefore no document or image upload.** The seller review page shows the
   verification state recorded at registration and states plainly that a licence or certificate file
   cannot be attached; product images are validated `https://` links only (up to eight), never uploaded
   bytes. This limitation was carried from M4 and is unchanged.
3. **Isolation is application-layer.** There is still no MongoDB row-level security; every isolation
   guarantee above is enforced by query scoping and projection in `src/lib/data`, and would be bypassed by
   a client with direct database credentials. D9 Task 2 (RLS/organisation isolation at the database)
   remains unstarted, and PostgreSQL + Prisma remain the approved target with no application integration.
4. **GSTIN is never auto-verified.** The console displays the verification state as recorded; an approval
   does not change it.
5. **Enquiries are not orders.** Status changes are desk bookkeeping against the stored `EnquiryStatus`
   enum (13 values, from `NEW` through `UNDER_REVIEW` to `WON`/`LOST`/`CANCELLED`); no order, payment,
   inspection or dispatch entity exists, and the console says so.
6. **The loading, error and not-found boundaries are compiled and included in the build, but the loading
   and error screens are not exercised end-to-end** by the gate (that would need a stalled or failing
   database). The not-found boundary *is* exercised (E8). The rate limiter's multi-instance behaviour is
   reasoned from the code, not tested across instances.
7. **Mobile layout is CSS-only and not visually verified** in this run: the admin screens use the same
   responsive grid/table primitives as the verified M1–M4 portal, but no browser screenshot pass was part
   of the M5 gate.

---

## 7. How to reproduce

```bash
npm run typecheck
npm run lint
npm run build                 # required: the gate runs `next start`
npm run verify:m5             # M5 gate, groups A–E, 32 checks
npm run verify:m4             # 55 checks
node scripts/verify-m3.mjs --group ALL
node scripts/verify-m2.mjs --group ALL
node scripts/verify-m1.mjs --group ALL
npm run check:seo && npm run check:routes && npm run check:migrations
npm run check:schema && npm run check:catalogue
```

The gate creates its own database (`primemet_m1_m5_<stamp>`), migrates from v001 to v009, and drops the
in-memory server afterwards. It never touches a configured cluster.

---

## 8. Stop point

M5 is implemented and verified locally, and this report is written. Per the brief and the standing
project direction: no commit, no push, no staging, no deploy, no production data change; PostgreSQL and
Prisma are not integrated into application code; Workstream 6 and `docs/reviewer-package/` were not
touched, re-checked or republished. **Awaiting owner review before M6.**
