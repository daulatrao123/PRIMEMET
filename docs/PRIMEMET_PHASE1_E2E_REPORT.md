# PRIMEMET — Phase 1 integrated end-to-end verification

**Status:** run complete — **13/13 journey checks passed**, every regression gate green locally.
**Date:** 2026-11-04 (run 19:1x–19:3x UTC)
**Database:** MongoDB only. No PostgreSQL, no Prisma application code, no deploy, no commit, no production data.

Commissioned by the owner after M5 acceptance: prove the whole Phase 1 journey end to end — admin,
catalogue, public discovery, buyer, enquiry, seller, listing, publication — and report actual evidence,
failures, security limitations and pilot readiness.

**Gate:** `npm run verify:phase1` (`node scripts/verify-phase1.mjs`). It boots an isolated in-memory
replica set, applies the repository's real migration ledger (v001 → v009), starts the real production
build with `next start`, and drives it over HTTP as a browser would. Nothing is mocked; every assertion
reads either MongoDB directly or the running product.

Record: `.exvisit/tmp/m1-verify/phase1-report-<stamp>.json`.

---

## 1. Evidence — the continuous journey

```
PASS  J1   the administrator signs in and the dashboard shows MongoDB's own figures
           sign-in 200, wrong password refused, wrong door 403, dashboard 200
PASS  J2   the administrator creates a draft product, publishes it, and MongoDB holds it
           DRAFT -> PUBLISHED, 2 specification rows, draft page 404, url /products/<slug>
PASS  J3   a public visitor discovers the published product and the page is search-ready
           listed, searchable, canonical + description + breadcrumb JSON-LD, robots and sitemap correct
PASS  J4   a buyer registers and signs in
           201 registration, sign-in 200, buyer dashboard 200, admin area redirected
PASS  J5   the buyer raises an enquiry and the desk receives it
           ENQ-2026-000001 persisted as NEW, on both the buyer's list and the desk queue
PASS  J6   another buyer cannot see the enquiry or raise one in the first buyer's name
           list without the reference, detail 403/404, forged organisation ignored, anonymous redirected
PASS  J7   the administrator manages the enquiry, and the private note stays private
           UNDER_REVIEW stored and audited; note visible to the desk, absent from the buyer page
PASS  J8   a seller registers, is refused sign-in until approved, and the desk approves
           201 pending, sign-in 403, approved and audited, then dashboard 200
PASS  J9   the seller submits two listings and both queues show real records
           2 listings stored PENDING/DRAFT, visible to the seller and in the desk queue with specifications
PASS  J10  the desk rejects one listing with a reason and approves the other, and neither is published
           REJECTED/DRAFT with a reason the seller reads, APPROVED/ACTIVE, public catalogue unchanged
PASS  J11  only the desk's publication makes the product public
           published /products/<slug> 200, searchable, seller anonymous, unknown slug 404
PASS  J12  role permissions, cross-site refusal and suspension are enforced server-side
           6 endpoints x 3 identities refused, cross-site 403, suspension ends a live session and blocks sign-in
PASS  J13  the server restarts on the same database and everything is still there
           restart ok, cookie still valid, 2 published product(s), 2 enquiries, 11 audit rows

TOTAL: 13 passed, 0 failed
verdict: PHASE 1 VERIFIED LOCALLY
```

### The requested journeys, one by one

| Owner's journey | Where proved |
| --- | --- |
| Admin login and dashboard | J1 (door, wrong password, wrong portal, live counts), J7/J9/J10 (queues) |
| Admin creates and publishes a product | J2 (draft is 404 publicly, publish sets `PUBLISHED` + `publishedAt`, slug stable) |
| Public visitor discovers the product | J3 (catalogue listing, search, product page, canonical, meta description, breadcrumb JSON-LD, robots.txt, sitemap.xml) |
| Buyer registers, logs in, submits an enquiry | J4, J5 (enquiry persisted `NEW` with a reference) |
| Admin receives and manages the enquiry | J5 (queue + detail with buyer and quantity), J7 (status `UNDER_REVIEW`, private note, audit row) |
| Seller registers and submits a listing | J8 (register → 403 until approved → approved), J9 (two submissions `PENDING`/`DRAFT`) |
| Admin approves/rejects the seller and listing | J8 (seller approve), J10 (one rejection with a reason, one approval) |
| Approved listing public **only after** admin publication | J10 (public catalogue unchanged by approval), J11 (publication by the desk only) |

### MongoDB persistence, isolation, permissions, API security, SEO

* **Persistence** — J2, J5, J9, J10 assert the stored documents (states, specification rows, references)
  directly in MongoDB. **J13 restarts the server on the same database**: the product page, the
  administrator's pre-restart cookie and the dashboard counts all survive, proving state lives in MongoDB
  and sessions are database rows, not process memory.
* **Organisation isolation** — J6: a second buyer's list has no trace of the first buyer's enquiry, the
  detail route returns 403/404, and a forged `organisationId`/`buyerOrganisationId` in the request body is
  ignored (the stored enquiry carries the caller's own organisation). J10: an approved but unpublished
  listing is absent from the public catalogue and search.
* **Role permissions** — J4 (buyer → admin area redirected), J6 (anonymous → redirected), J12 (six admin
  endpoints × buyer/seller/anonymous = 403/403/401, and no decision was written by any refused call).
* **API security** — J12: cross-site `POST` with a foreign `Origin` → 403 `cross_site`; suspension ends a
  live session and blocks a fresh sign-in; J1: the administrator account cannot sign in through the buyer
  portal, and a wrong password is refused.
* **SEO** — J3: product `<title>`, `<link rel="canonical">` on the product's own URL, `<meta
  name="description">`, `BreadcrumbList` JSON-LD, robots.txt disallowing `/admin`, `/buyer`, `/seller`,
  `/api` and naming the sitemap, sitemap containing `/products` and no portal URL. `npm run check:seo`
  additionally passes **656 checks** over the prerendered build (28 public URLs, 39 JSON-LD blocks).

---

## 2. Regressions and the project gate on the final tree

| Gate | Result |
| --- | --- |
| `node scripts/verify-m1.mjs --group ALL` | **42 passed, 0 failed** |
| `node scripts/verify-m2.mjs --group ALL` | **41 passed, 0 failed** |
| `node scripts/verify-m3.mjs --group ALL` | **28 passed, 0 failed** |
| `node scripts/verify-m4.mjs --group ALL` | **55 passed, 0 failed** |
| `node scripts/verify-m5.mjs --group ALL` | **32 passed, 0 failed** |
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 warnings |
| `npm run build` | pass, 58 pages |
| `npm run check:seo` | 656 passed, 0 failed |
| `npm run check:routes` | pass — 88 routes, 56 required, 175 files |
| `npm run check:migrations` | 74 passed, 0 failed |
| `npm run check:schema` | 61 passed, 0 failed |
| `npm run check:catalogue` | 55 passed, 0 failed |

Combined journey evidence: **13 + 198 milestone checks**, 0 failures.

---

## 3. What the run found (and how each was resolved)

The first two executions failed; both causes were in the harness, not the product, and the product's
behaviour was left untouched:

1. **Category kind** — the catalogue accepts `SCRAP` and `SPARE_PARTS` only; the harness asked for
   `COMPONENT` and got a correct 400. The harness learned the real enum.
2. **Enquiry payload** — `contactPhone` is required and `quantity` is a string in the form schema; the
   harness sent a number and no phone and got a correct 400 “Required”. Corrected in the harness.
3. **Sitemap host** — the sitemap is prerendered at build time from the build's `NEXT_PUBLIC_APP_URL`,
   so it publishes `https://primemet.example` even when the server runs under another URL. This is real
   product behaviour, not a harness defect; it is carried into the readiness items below (§5, item 1).

No product defect was found by this run. The three findings above are recorded because a 400 that the
gate did not expect is evidence about the contract, and because the sitemap finding is a deployment
requirement rather than a bug to hide.

---

## 4. Security limitations (unchanged by this milestone)

1. **Rate limiting is in-process.** Counters live in module memory, so limits are per Node instance and
   multiply across instances; a restart clears the budget (observable in this run). Not solved.
2. **No object storage.** No document or image upload exists: seller compliance documents are checked out
   of band, and product images are external `https://` links that the platform does not fetch or verify.
3. **Isolation is application-layer.** There is no MongoDB row-level security; every isolation result in
   §1 is enforced by query scoping and projection in `src/lib/data`. A principal with direct database
   credentials bypasses it. D9 Task 2 remains unstarted.
4. **GSTIN is never auto-verified** — the format is validated, the registration is not.
5. **No notification channel.** Enquiry submission and seller decisions are visible in the portals only;
   there is no email or SMS, so a rejected seller learns the outcome when they next sign in.
6. **Enquiries are not orders.** No payment, quotation acceptance, inspection, dispatch or fulfilment
   entity exists; the dashboards say so.
7. **Security acceptance is NOT GRANTED.** Workstream 6 remains OPEN pending independent human review; per
   the owner's decision of 2026-11-04 it was not re-run, refreshed, republished or self-certified in this
   milestone.

---

## 5. Pilot readiness

**Verdict: locally verified and demonstrable; NOT yet pilot-ready.** The functional journey works end to
end on a clean database, but the following are prerequisites before a pilot user is invited:

1. **Deployment URL and sitemap.** `NEXT_PUBLIC_APP_URL` must be the real origin at build time (it is
   baked into the sitemap and canonical URLs). Today the repository build uses `https://primemet.example`.
   Fix by building with the staging origin and re-running `check:seo`.
2. **Dynamic product SEO.** Product pages are dynamic and are not in `sitemap.xml` (the sitemap is a
   static route registry). Crawlers only reach products by following `/products` links. Decide whether to
   add a database-backed sitemap before pilot.
3. **Administrator provisioning runbook.** No self-service admin creation exists; the gate created the
   administrator as an operational database step. This must be documented for staging (with separate
   owner/application identities, per D9).
4. **Object storage decision.** Without it, compliance documents and product images cannot be uploaded —
   a blocker for real seller onboarding at pilot scale.
5. **Rate-limiting decision.** Choose a shared store (or accept per-instance limits, documented) before
   running more than one instance.
6. **Notification channel.** Decide whether enquiry/seller outcomes need email at pilot; otherwise brief
   pilot users that the portal is the only channel.
7. **Independent security review (W6).** Pilot with real company data needs the external acceptance that
   remains open.

**What is ready now:** the four portal journeys, MongoDB persistence, role separation, application-layer
organisation isolation, the publication gate, the audit trail, the admin control centre and the SEO
surface of the public site — all proved on a clean database by a repeatable gate (`npm run verify:phase1`).

---

## 6. Reproduce

```bash
npm run build
npm run verify:phase1        # 13 journey checks
npm run verify:m5            # 32
npm run verify:m4            # 55
node scripts/verify-m3.mjs --group ALL   # 28
node scripts/verify-m2.mjs --group ALL   # 41
node scripts/verify-m1.mjs --group ALL   # 42
npm run typecheck && npm run lint && npm run check:seo && npm run check:routes
npm run check:migrations && npm run check:schema && npm run check:catalogue
```

The gate never touches a configured cluster: it creates `primemet_phase1_<stamp>` on an in-memory replica
set and drops it afterwards.

---

## 7. Stop point

Phase 1 verification is complete and reported. No commit, push, staging, deploy or production data
change was made; PostgreSQL/Prisma were not introduced; Workstream 6 and `docs/reviewer-package/` were
left untouched. Awaiting owner direction for the next milestone.
