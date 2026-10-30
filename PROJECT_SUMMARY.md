# PRIMEMET — Stage 1 summary

Managed industrial scrap sourcing and spare-parts procurement. This repository currently
contains the **frontend and application foundation only**: no database, no authentication,
no mail provider and no business records.

## Stack

- Next.js 15 (App Router) · React 19 · TypeScript (strict)
- Tailwind CSS v4 with design tokens in `src/app/globals.css` (`@theme`)
- ESLint (`next/core-web-vitals` + `next/typescript`)
- No database client, ORM, auth library or UI dependency is installed

## Folder layout

```
src/
  app/
    layout.tsx           document shell only (no chrome)
    not-found.tsx        404
    (site)/              public marketing pages + header/footer layout
    (auth)/              login and registration previews (no nav chrome)
    admin/               admin portal + its own layout
    buyer/               buyer portal + its own layout
    seller/              seller portal + its own layout
    api/health/          static liveness endpoint
    globals.css          design tokens
  components/
    ui/                  Button, ButtonLink, Input, Textarea, Select, Checkbox, Field,
                         Card, Badge, Table, Section, SectionHeading, NotConnected,
                         PageHero, Prose
    layout/              Header, Footer, Logo
    marketing/           homepage sections + PreviewForm
    portal/              PortalShell, SideNav, PortalPage, Stat, Panel
    auth/                AuthShell for sign-in / registration screens
  lib/
    cx.ts                class combiner (no dependency)
    content/             static copy: materials, parts, industries, faqs
  middleware.ts          pass-through; Stage 2 guard TODOs
```

## Routes implemented

**Public:** `/` · `/about` · `/scrap-metals` · `/scrap-metals/[slug]` (7 grades) ·
`/spare-parts` · `/spare-parts/[slug]` (4 categories) · `/sell-scrap` · `/source-scrap` ·
`/request-a-quote` · `/how-it-works` · `/industries` · `/become-a-supplier` · `/faqs` ·
`/contact` · `/privacy` · `/terms`

**Auth previews:** `/login` · `/admin/login` · `/register/buyer` · `/register/seller`

**Admin:** `/admin/dashboard` · `/admin/enquiries` · `/admin/suppliers` · `/admin/buyers` ·
`/admin/materials` · `/admin/products` · `/admin/pricing` · `/admin/supplier-quotations` ·
`/admin/quotations` · `/admin/reports` · `/admin/audit-log`

**Buyer:** `/buyer/dashboard` · `/buyer/enquiries/new` · `/buyer/scrap-sourcing` ·
`/buyer/spare-parts` · `/buyer/quotations` · `/buyer/orders` · `/buyer/profile`

**Seller:** `/seller/dashboard` · `/seller/profile` · `/seller/tax` · `/seller/materials` ·
`/seller/products` · `/seller/quotations` · `/seller/enquiries` · `/seller/orders`

**API:** `/api/health` → `{ status: "ok", version, timestamp, database: "not_configured" }`

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

## Run the project

```bash
npm.cmd install          # PowerShell blocks npm.ps1; use npm.cmd
npm.cmd run dev          # http://localhost:3000
npm.cmd run build        # production build
npm.cmd start            # serve the production build
npm.cmd run lint         # ESLint
npm.cmd run typecheck    # tsc --noEmit
npm.cmd run check:routes # route + internal-link integrity check
```

No environment variable is required for any of these commands.

## Database preparation (deferred to a later stage)

Deliberately **not** done here: no PostgreSQL installed, no Supabase project, no Prisma
schema, no migration, no `DATABASE_URL`/`DIRECT_URL`.

When the database stage begins:

1. Create the Supabase project and take both connection strings (pooled 6543 with
   `?pgbouncer=true` for the runtime, direct 5432 for migrations).
2. Add `DATABASE_URL` and `DIRECT_URL` to the server environment; keep them out of git.
3. Write a schema-only Prisma model set: `User` with a role enum (ADMIN/BUYER/SELLER),
   buyer and supplier profiles, materials and products, price records and formulas,
   enquiries, supplier quotations, customer quotations, orders and consignments, and an
   append-only audit log. All money, weight, rate and percentage values as
   `Decimal` with explicit precision — never `Float`.
4. Add a lazy client helper so nothing at build time opens a connection.
5. Run the first migration against `DIRECT_URL`.

## Next stage

Stage 2: authentication, role guards (the TODOs in `src/middleware.ts`), and the enquiry
persistence path. Everything in this repository is built to accept that layer without
rewriting the UI.
