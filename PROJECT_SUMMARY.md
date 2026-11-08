# PRIMEMET — project summary

Managed industrial scrap sourcing and spare-parts procurement.

This repository contains the **frontend and application foundation**, together with a **database
layer defined in code that is not connected to any database instance**: there is no Atlas cluster,
no initialised production database, no authentication, no mail provider and no business record.
Every screen that will read or write a database is a labelled preview.

## Stack

- Next.js 15 (App Router) · React 19 · TypeScript (strict)
- Tailwind CSS v4 with design tokens in `src/app/globals.css` (`@theme`)
- ESLint (`next/core-web-vitals` + `next/typescript`)
- Runtime: `mongodb` (native driver — the production data layer), `zod` (environment
  validation), `sharp`
- Tooling: `@prisma/client` + `prisma` 6.16.2 (schema and migration tooling; the application does
  not use Prisma at runtime), `@electric-sql/pglite` and `mongodb-memory-server` as dev-only
  in-process databases so the schema suites need no server. No auth library and no UI dependency.

## Folder layout

```
src/
  app/
    layout.tsx           document shell only (no chrome)
    not-found.tsx        404
    sitemap.ts           /sitemap.xml, derived from the static catalogue
    robots.ts            /robots.txt
    (site)/              public marketing pages + header/footer layout
    (auth)/              login and registration previews (no nav chrome)
    admin/               admin portal + its own layout
    buyer/               buyer portal + its own layout
    seller/              seller portal + its own layout
    api/health/          liveness and database-readiness probe
    globals.css          design tokens
  components/
    ui/                  Button, ButtonLink, Input, Textarea, Select, Checkbox, Field,
                         Card, Badge, Table, Section, SectionHeading, NotConnected,
                         PageHero, Prose
    layout/              Header, Footer, Logo
    marketing/           homepage sections + PreviewForm
    portal/              PortalShell, SideNav, PortalPage, Stat, Panel, ExampleData,
                         InternalOnly, NotRecorded
    auth/                AuthShell for sign-in / registration screens
    seo/                 JSON-LD renderer
  lib/
    cx.ts                class combiner (no dependency)
    db.ts                lazy MongoDB client; throws a named error unless MONGODB_URI is set
    env.ts               zod environment validation; every variable optional
    seo.ts               per-page metadata and canonical URLs
    site-url.ts          the single canonical-origin resolver (also gates production builds)
    content/             static copy: materials, parts, industries, faqs; plus the
                         catalogue/QA domain structure (categories, grades, composition,
                         lots, inspections, rejections)
  middleware.ts          pass-through; Stage 2 guard TODOs

db/                      MongoDB definitions as code: 45 collections, 94 indexes, roles,
                         migration registry and the maintenance CLI
prisma/                  Prisma schema + 7 PostgreSQL migrations (historical reference only)
scripts/                 dependency-free check and test suites
docs/                    architecture, decision and migration records
```

## Routes implemented

**Public:** `/` · `/about` · `/scrap-metals` · `/scrap-metals/[slug]` (7 grades) ·
`/spare-parts` · `/spare-parts/[slug]` (4 categories) · `/sell-scrap` · `/source-scrap` ·
`/request-a-quote` · `/how-it-works` · `/trading-models` · `/quality-assurance` · `/industries` · `/become-a-supplier` · `/faqs` ·
`/contact` · `/privacy` · `/terms`

**Auth previews:** `/login` · `/admin/login` · `/register/buyer` · `/register/seller`

**Admin:** `/admin/dashboard` · `/admin/enquiries` · `/admin/suppliers` · `/admin/buyers` ·
`/admin/materials` · `/admin/products` · `/admin/pricing` · `/admin/supplier-quotations` ·
`/admin/quotations` · `/admin/reports` · `/admin/audit-log` · `/admin/catalogue` (+ nine
`/admin/catalogue/[section]` pages) ·
`/admin/composition` · `/admin/lots` · `/admin/lots/[ref]` · `/admin/inspections` ·
`/admin/rejections`

**Buyer:** `/buyer/dashboard` · `/buyer/enquiries/new` · `/buyer/scrap-sourcing` ·
`/buyer/spare-parts` · `/buyer/quotations` · `/buyer/orders` · `/buyer/profile`

**Seller:** `/seller/dashboard` · `/seller/profile` · `/seller/tax` · `/seller/materials` ·
`/seller/products` · `/seller/quotations` · `/seller/enquiries` · `/seller/orders`

**API:** `/api/health` → `{ status, version, timestamp, database }`. With no `MONGODB_URI` it
answers `200` and `database: "not_configured"`; a bounded `ping` reports `connected`, or `503`
`degraded` when a configured server cannot be reached. It never claims a connection it does not
have, and no other API route exists.

Those four keys are the normal response. Three **conditional** keys appear only when they carry
something that cannot be inferred: `database_latency_ms` when the probe connected;
`database_detail` — a fixed reason such as `connection_failed` or `timeout`, never the driver's
message, which can leak a host name — when it did not; and `config_errors`, a count rather than the
messages, when the environment holds present-but-malformed values. An unconfigured deployment
returns exactly four keys.

**Portals are not protected.** `src/middleware.ts` authenticates nothing — every request passes
through — so `/admin`, `/buyer` and `/seller` are openly reachable in this build. That is the
single largest known gap, and it is why each portal screen carries the preview label.

## UI-only features awaiting integration

Every screen below is a layout preview. Each carries the label
*“Preview — database connection will be configured on the production server.”*

- **Forms** (contact, request a quote, sell scrap, source scrap, supplier registration,
  buyer enquiry): no action, disabled submit, nothing sent, stored or emailed.
- **Auth**: no sign-in, no session, no cookie, no role switching, no password reset.
- **Admin**: enquiry register, supplier qualification, buyer register, price formulas,
  supplier-quotation comparison, customer quotations, reports, audit log — all empty.
- **Buyer**: enquiries, quotations, order history, profile — all empty.
- **Seller**: listings, quotation submissions, matched briefs, orders, tax details — all empty.
- **Catalogues**: material and part pages are static copy in `src/lib/content/`; no price,
  tonnage or stock position is published anywhere.
- **Catalogue & quality**: category, grade, composition, lot, inspection and rejection
  screens are illustrative layouts over `src/lib/content/catalogue.ts`. No stored record,
  declared or measured composition, test report, quantity, rate or cost exists. Purchase
  rates and margins are marked internal-only and are absent rather than zero, so an unpriced
  lot cannot be mistaken for a free one.

There is **no `POST`, `PUT`, `PATCH` or `DELETE` handler anywhere in `src/`** — the application
cannot write, and the database layer can therefore not be tested end to end until Stage 2.

## Run the project

```bash
npm.cmd install          # PowerShell blocks npm.ps1; use npm.cmd
npm.cmd run dev          # http://localhost:3000
npm.cmd run build        # production build (requires NEXT_PUBLIC_APP_URL, see below)
npm.cmd start            # serve the production build
npm.cmd run lint         # ESLint
npm.cmd run typecheck    # tsc --noEmit
npm.cmd run check:seo    # sitemap, robots, canonicals, structured data (reads the build)
npm.cmd run check:routes # route + internal-link integrity check
npm.cmd run check:wizard # real-browser wizard interaction test (needs a server on :3100)
npm.cmd run db:validate:offline # database definitions; no database is contacted
npm.cmd run check:mongodb       # roles, validators, indexes and DAO against an in-process mongod
```

The content (`check:content`) and interaction (`check:wizard`) suites run against a served build:
`npx.cmd --no-install next start -p 3100` in another terminal, or set `SMOKE_BASE` to the port you
started. The wizard suite drives Chrome through the DevTools Protocol and needs no extra package.
`check:seo` needs no server: by default it checks the prerendered build output.

**One variable matters.** `npm.cmd run build` and `npm.cmd run start` require
`NEXT_PUBLIC_APP_URL` set to the absolute https origin; a production build fails rather than
letting canonical URLs, `sitemap.xml` or `robots.txt` bake in `localhost`. Copy `.env.example` to
`.env.local` for local work — Next.js loads it for `build` and `start`. `check:seo` resolves the same
origin itself, in this order: `EXPECTED_ORIGIN`, then `SMOKE_BASE` (when checking a running server),
then `NEXT_PUBLIC_APP_URL`, then the value recorded in `.env.local` / `.env.production` / `.env`, then
the documented production origin `https://primemet.in`. It reads those files directly, so it agrees
with the build without depending on the shell exporting anything. `npm.cmd run dev` needs no
variable at all, and every database suite runs without one.

## Data foundation — defined in code, not connected

The data layer exists as version-controlled code. **No database instance is connected:** there is no
Atlas cluster, no initialised production database and no credential in the repository. `/api/health`
reports `database: "not_configured"` for exactly that reason, and nothing at build time opens a
connection.

**MongoDB is the production target.** `db/` declares 45 collections with their validators, `$expr`
invariants and 94 indexes as code; 7 of those collections are append-only and published read-only.
Two unprivileged identities are defined (`primemet_app` for runtime, `primemet_owner` for
initialisation, neither holding a `drop*` action). Migration identity is per file, so correcting a
collection definition cannot rewrite an applied migration's checksum. `src/lib/db.ts` is a lazy
native-driver client that throws a named error rather than pretending to be connected.
`.github/workflows/db-init.yml` exists but is deliberately **not** active: it must stay out of the
first push until the `production-database` environment has verified required reviewers and the
secret is configured.

**Prisma and the seven PostgreSQL migrations are retained as historical reference only.** The
PostgreSQL design was superseded by MongoDB. The schema and migrations are kept because they record
decisions the system still honours — every money, weight, rate and percentage value is `Decimal` /
`numeric` with explicit precision, never floating point — and `prisma/README.md` documents the
tooling workaround. The Prisma CLI reads a placeholder URL from `prisma/.env`; the running
application never does.

**Offline validation is not a database.** These suites prove the definitions are internally sound
without contacting a managed server, and they are the only database checks that have ever run:

| Command | What it proves |
|---|---|
| `db:validate:offline` | definitions self-consistent — 539 assertions, no database |
| `check:mongodb` | roles, validators, indexes and the DAO against an in-process `mongod` |
| `check:migrations` | migration identity, drift detection and reconcile behaviour |
| `check:enums` | Prisma → MongoDB enum parity |
| `check:schema` | the seven PostgreSQL migrations apply to in-process PostgreSQL (PGlite) |

**Not done, and not claimed:** no Atlas project, cluster, user or role; no production
initialisation; no `MONGODB_URI`; no authentication; no credential committed. Nothing here has been
exercised against a managed server, so latency, TLS, SCRAM authentication and real role enforcement
remain unverified, and the suites above are written by the same work they verify — they are not
independent acceptance.

## Next stage

In order: (1) resolve the open owner decisions (hosting region, document retention), (2) authorise
and provision the Atlas cluster with the two defined roles, (3) authentication and the role guards
marked as TODOs in `src/middleware.ts` — the portals are openly reachable until then — and (4) the
enquiry persistence path, which is designed but not implemented. Everything in this repository is
built to accept that layer without rewriting the UI.
