# PRIMEMET — M3: Buyer Portal (MongoDB)

**Status:** VERIFIED LOCALLY · **Verified:** 2026-11-04 · **MongoDB only** — no PostgreSQL, no Prisma
application integration, no dual writes.
**M1:** VERIFIED LOCALLY (42/42) · **M2:** VERIFIED LOCALLY (41/41) · **Workstream 6:** OPEN — PENDING
INDEPENDENT HUMAN REVIEW; security acceptance NOT GRANTED.

---

## 1. What M3 delivers

| Requirement | Delivered |
|---|---|
| Buyer registration and login | M1 auth (scrypt + database-backed sessions) drives `/login`, `/register/buyer`; seller and admin sign-in on their own surfaces |
| Company profile | `/buyer/profile` edits legal name, city, state code, website, contact name, phone, job title, department — persisted to `organisations`, `buyer_profiles` and `users`; GSTIN shown, **not** editable |
| Secure organisation-level access | organisation resolved from the session on the server; no request parameter can select a company |
| Enquiry submission | `/buyer/enquiries/new` (portal) and **Enquire now** on `/products/[slug]` → `POST /api/enquiries` → `enquiries` |
| MongoDB persistence | real documents in `enquiries`, with an `ENQ-YYYY-NNNNNN` reference allocated from the database |
| History and status tracking | `/buyer/enquiries` and `/buyer/enquiries/[id]`, status set by the desk and shown to the buyer |
| Admin visibility | `/admin/enquiries` queue with search/status filter and counts; `/admin/enquiries/[id]` with status change and internal notes |

### New and changed files

**Data layer**
- `src/lib/data/buyer-portal.ts` (new) — `getBuyerProfile`, `updateBuyerProfile`, `buyerDashboard`; every
  function takes the `AuthUser` and derives the organisation from it.

**API**
- `src/app/api/buyer/profile/route.ts` (new) — BUYER only, session-derived organisation, cross-site refused.
- `src/app/api/admin/enquiries/route.ts` (new) — ADMIN only; status change and internal notes, both audited
  with `before`/`after` states.

**Pages**
- `src/app/buyer/dashboard/page.tsx` — real counted statistics plus the five latest enquiries.
- `src/app/buyer/profile/page.tsx` — company and contact form.
- `src/app/buyer/enquiries/page.tsx` — history with status badges.
- `src/app/buyer/enquiries/[id]/page.tsx` — one enquiry, 404 for any other organisation.
- `src/app/buyer/enquiries/new/page.tsx` — portal enquiry form fed by the published catalogue.
- `src/app/admin/enquiries/page.tsx` — desk queue, search, status filter, counts.
- `src/app/admin/enquiries/[id]/page.tsx` — status change and internal notes as two separate acts.

**Validation:** `profileSchema` gained `department` and `website`; the legal name travels as `company`, the
same key registration uses.

**Checks:** `scripts/verify-m3.mjs` + `scripts/lib/m3-groups/{a,b,c}.mjs`; `package.json` → `verify:m3`;
`scripts/check-seo.mjs` handles the now session-gated `/buyer/dashboard`.

**No migration was needed.** M3 stores into collections migration v006 already created
(`enquiries`, `buyer_profiles`, `organisations`), so the schema head stays v007.

---

## 2. Test evidence

All commands were run on the final tree, against an isolated in-memory MongoDB **replica set** with the
repository's real migrations, driving the real production build through `next start`.

| Command | Result |
|---|---|
| `node scripts/verify-m3.mjs --group ALL` | **28 passed, 0 failed** — exit 0, verdict VERIFIED LOCALLY |
| `node scripts/verify-m3.mjs --selfcheck` | 5 passed, 0 failed |
| `node scripts/verify-m2.mjs --group ALL` | **41 passed, 0 failed** |
| `node scripts/verify-m1.mjs --group ALL` | **42 passed, 0 failed** |
| `npm run check:migrations` | 74 passed, 0 failed |
| `npm run check:routes` | ✓ routes 76, required 56, 157 files scanned |
| `npm run check:seo` | 654 passed, 0 failed (28 sitemap URLs, 39 JSON-LD blocks) |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run build` | pass — 78 pages, buyer portal routes all dynamic (`ƒ`) |

### What the 28 M3 assertions cover

**Group A — isolation at the data layer (8)**
A1 profile resolves to the session's organisation · A2 an update touches only the caller's company, profile
and contact row · A3 the update writes an audit row naming the buyer · A4 two buyers' enquiries stay in
separate lists · A5 a cross-organisation read returns `null` · A6 the buyer view has no `internalNotes`
property at all · A7 the dashboard counts only the session organisation · A8 an account with no organisation
cannot update a company.

**Group B — the portal over HTTP (12)**
B1 both buyers sign in and each dashboard names only its own company · B2 anonymous → redirect to sign-in ·
B3 a seller is redirected off the buyer area · B4 the profile page renders stored values · B5 a form save
persists and is audited · B6 an `organisationId` in the payload is ignored · B7 an enquiry raised in the
portal is stored against the buyer's organisation with a real reference · B8 history and detail render it ·
B9 another buyer's id is a 404 with no content · B10 the dashboard shows it · B11 a seller gets 403 on both
buyer endpoints · B12 an anonymous visitor gets 401.

**Group C — the desk (8)**
C1 the queue lists buyers' enquiries with their organisations · C2 reference search, status filter and empty
state · C3 a status change is stored and the buyer sees it · C4 an internal note reaches the desk and neither
buyer screen · C5 the change is audited with `beforeState.status`/`afterState.status` and the acting
administrator · C6 a buyer gets 403 on the desk endpoint and a redirect on the page · C7 anonymous 401 ·
C8 an unknown id is refused with a readable message.

---

## 3. Defects the gate found (and fixed)

1. **`/buyer/enquiries/[id]` called `getEnquiryForOrganisation(organisationId, id)`** while the function is
   `(id, organisationId)`. Every buyer's own enquiry would have returned 404. Found by A5, fixed in the page;
   B9 now proves the cross-organisation case still 404s.
2. **The profile form posted `legalName` but `profileSchema` accepts `company`** — zod stripped the field, so
   the legal name silently did not save while the form reported success. Found by B5/B6; the form, the data
   layer and the tests now all use `company`.

Both were caught by the harness, not by review.

---

## 4. Limitations — stated, not hidden

- **Internal notes have no separate history.** Each save overwrites the previous note; the audit log keeps the
  fact and the transition, not the text. Notes typed and replaced are not recoverable from the note field.
- **No buyer-side cancellation.** A buyer cannot withdraw an enquiry; the desk sets `CANCELLED`.
- **`/buyer/quotations`, `/buyer/orders`, `/buyer/scrap-sourcing`, `/buyer/spares` remain previews.** They are
  outside M3's scope and are still published pages with preview notices.
- **Enquiries are capped at 100 rows per buyer list and 200 per desk list.** Pagination is M5 work.
- **Rate limiting is per process.** Correct on the single-node local run; a multi-instance deployment needs a
  shared store (unchanged from M1).
- **A managed cluster was not exercised.** Replica-set behaviour, sessions and migration v006/v007 are proven
  on an in-memory replica set with real migrations; Atlas-specific behaviour is unverified.
- **`npm run check:content` needs a live server on 127.0.0.1:3100** and was not run (pre-existing).

## 5. Repository state

No commit, push, stage, deploy or production migration was performed. MongoDB remains the only application
datastore; PostgreSQL/Prisma were not touched.

## 6. Workstream 6

Unchanged and untouched: package DELIVERED, independent review PENDING SEPARATE ENGINEER, security
acceptance NOT GRANTED. Nothing in this milestone self-certifies, rewrites or republishes that package.
