# PRIMEMET — M2: Product Catalogue (MongoDB)

**Date:** 2026-11-04
**Scope:** milestone M2 — a fully functional, MongoDB-backed product catalogue.
**Verdict:** **VERIFIED LOCALLY** (`node scripts/verify-m2.mjs --group ALL` → exit 0, 41 passed / 0 failed).

MongoDB is the only application database. No PostgreSQL/Prisma application path was added, no
production database was touched, and nothing was staged, committed, pushed or deployed.

---

## 1. What M2 delivers

| # | Requirement | Delivered | Where |
|---|---|---|---|
| 1 | Admin product CRUD | Create, read, update, archive (soft delete) with audit | `src/app/admin/products/*`, `src/app/api/admin/catalogue/products/route.ts`, `src/lib/data/catalogue.ts` |
| 2 | Category and subcategory management | Create / rename / reorder / publish / delete with orphan guards | `src/app/admin/catalogue/categories/page.tsx`, `src/app/api/admin/catalogue/{categories,families}/route.ts` |
| 3 | Product images | Ordered gallery (max 8), https-only, first image is the hero | `products.images` (migration v007), `ProductForm`, product cards and detail gallery |
| 4 | Manufacturer and technical specifications | `manufacturer`, `brand`, free-text description, ordered specification table | `product_specifications`, `ProductForm`, detail page table |
| 5 | Publish / unpublish controls | Draft → Published → Archived, stamped `publishedAt`, audited | `adminSetPublication`, list-row buttons, editor state select |
| 6 | Public listing and detail pages | `/products` and `/products/[slug]`, server-rendered per request | `src/app/(site)/products/**` |
| 7 | Search, filtering and pagination | Search (title / part no. / brand / manufacturer), category, subcategory, condition, sort, 12-per-page pagination, facets | `listPublishedProducts`, `catalogueFacets` |
| 8 | Enquire Now integration | Product page form → `POST /api/enquiries` → enquiry owned by the session's organisation | `src/app/(site)/products/[slug]/page.tsx`, `src/app/api/enquiries/route.ts` |

### Schema change — migration v007

`db/migrations/v007-catalogue-media.mjs` (registered in `db/migrations/index.mjs`):

- `products.images` — `array` of `{ url, alt, sortOrder }`, `maxItems: 8`, optional (so pre-v007
  documents stay valid), backfilled to `[]` for existing products.
- Indexes: `{ publicationState: 1, publishedAt: -1 }` (public listing) and
  `{ familyId: 1, publicationState: 1 }` (subcategory listing, admin list).
- Converges the `products` and `product_specifications` validators with `collMod`. No drops, no
  rewrites of price, state or image references; re-running is a no-op.

---

## 2. Authorisation and isolation

- Every catalogue mutation goes through `requireApi(["ADMIN"])` **and** `requireAdminActor()`, which
  re-reads the role and status from the session user. A route that forgot the guard still cannot write.
- Cross-site POSTs are refused with 403 before any work (`isCrossSite`).
- The public read path cannot return a draft: `publicationState: "PUBLISHED"` and `deletedAt: null`
  are in the query, not the template.
- An enquiry takes its organisation and user from the session; `buyerOrganisationId` in a payload is
  ignored. The product is resolved server-side against published products only.
- Every mutation writes an `audit_logs` row naming the acting administrator, the action, the entity and
  before/after state.

---

## 3. Test evidence

Harness: `scripts/verify-m2.mjs` (+ `scripts/lib/m2-groups/{a,b,c,d}.mjs`), booting
`mongodb-memory-server` as a single-node replica set, applying the repository's real migrations, and
driving the **production build** through `next start`. Nothing can reach a configured cluster.

| Command | Exit | Result |
|---|---|---|
| `node scripts/verify-m2.mjs --selfcheck` | 0 | 5/5 (build present, replica set, v007 applied, `/api/health`, 10 catalogue entry points) |
| `node scripts/verify-m2.mjs --group A` | 0 | 7 passed / 0 failed — v007 fresh, upgrade from v006 with backfill, repeat run, interrupted-run recovery (failed → applied, attempts=2), validator limits (9 images and an undeclared field refused, 8 accepted), image shape, data-layer gallery write |
| `node scripts/verify-m2.mjs --group B` | 0 | 14 passed / 0 failed — anonymous 401, buyer/seller 403, category + subcategory create, delete-with-children refused, draft product with 2 images and 3 specification rows, draft invisible publicly, edit replaces gallery and specs, non-https image and short title refused, publish/unpublish round trip, archive keeps the document, 9 audit rows across 7 actions, admin list/search/empty state, category manager renders |
| `node scripts/verify-m2.mjs --group C` | 0 | 14 passed / 0 failed — published-only listing, search by title/part/manufacturer, escaped regex (`.*` matches nothing), category and subcategory filters (14), condition filter (4 USED), pagination 12 + 2 with no overlap, title sort, facets, detail page (specs, facts, gallery, canonical), unknown slug 404 + noindex, anonymous sign-in CTA, buyer form, draft slug 404, sitemap |
| `node scripts/verify-m2.mjs --group D` | 0 | 6 passed / 0 failed — buyer enquiry ENQ-2026-000001 linked to the product, readable by the admin data layer, anonymous 401, draft product 409, seller 403, organisation resolved from the session |
| `node scripts/verify-m2.mjs --group ALL` | 0 | **41 passed, 0 failed, 0 skipped** → verdict `VERIFIED LOCALLY` |
| `node scripts/verify-m1.mjs --group ALL` | 0 | 42 passed, 0 failed (M1 regression intact on the new schema) |
| `npm run check:migrations` | 0 | 74 passed, 0 failed |
| `npm run check:schema` | 0 | 61 passed, 0 failed |
| `npm run check:catalogue` | 0 | 55 passed, 0 failed |
| `npm run check:routes` | 0 | 72 routes, 56 required, 152 files |
| `npm run check:seo` | 0 | 654 passed, 0 failed |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | clean |
| `npm run build` | 0 | production build; `/products`, `/products/[slug]`, admin catalogue pages and both API groups are `ƒ` (dynamic) |

Failure details in the final run: none.

---

## 4. Files

**Database:** `db/migrations/v007-catalogue-media.mjs` (new), `db/migrations/index.mjs`,
`db/collections/catalogue.mjs`.

**Data layer:** `src/lib/data/catalogue.ts` (gallery, specifications, facets, sort/filter, admin list,
and the audited admin mutations), `src/lib/catalogue-form.ts` (new — textarea ↔ list parsing).

**API:** `src/app/api/admin/catalogue/products/route.ts`,
`src/app/api/admin/catalogue/categories/route.ts`,
`src/app/api/admin/catalogue/families/route.ts`, `src/app/api/enquiries/route.ts` (all new).

**UI:** `src/components/admin/product-form.tsx`, `src/app/admin/products/page.tsx`,
`src/app/admin/products/new/page.tsx`, `src/app/admin/products/[id]/page.tsx`,
`src/app/admin/catalogue/categories/page.tsx`, `src/app/(site)/products/page.tsx`,
`src/app/(site)/products/[slug]/page.tsx`, `src/lib/content/admin-nav.ts`, `src/lib/seo.ts`.

**Verification:** `scripts/verify-m2.mjs`, `scripts/lib/m2-groups/{a,b,c,d}.mjs`,
`scripts/lib/m1-groups/e.mjs` (ledger-count assertions made registry-driven now that v007 exists),
`scripts/check-seo.mjs` (dynamic public pages skipped in artefact mode, asserted over HTTP instead),
`package.json` (`verify:m2`).

---

## 5. Limitations and what is not verified

1. `npm run check:content` requires a server on `127.0.0.1:3100`; it was not run (no server there). It
   is a marketing-copy smoke test against a live server and is unaffected by M2.
2. Product images are **URLs**, not uploads: there is no object store, so an administrator pastes an
   https reference. Uploading, resizing and virus scanning are a later milestone.
3. Buyer enquiry history (`/buyer/enquiries`) and the admin enquiry desk (`/admin/enquiries`) are still
   preview screens — that is M3 and M5. M2 verifies the enquiry exists in MongoDB, is owned by the
   session's organisation, and is readable by the admin data layer the desk will use.
4. Per-product URLs are intentionally absent from `sitemap.xml`: the sitemap is static and the check
   asserts it matches the route table exactly. Discoverability for detail pages is on-demand indexing
   plus in-page links from `/products`.
5. Rate limiting remains per-process in memory (unchanged from M1).
6. Not verified: a managed MongoDB cluster, multi-instance behaviour, and any deployment configuration.

## 6. Sequence note (Workstream 6)

Workstream 6 is untouched by this milestone: reviewer package DELIVERED, independent engineer review
PENDING, security acceptance NOT GRANTED. No W6 check was re-run, refreshed or republished, and no
self-certification is claimed.
