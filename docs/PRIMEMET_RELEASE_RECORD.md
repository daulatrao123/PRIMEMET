# PRIMEMET — release record and commit manifest

**Status: DRAFT — awaiting owner approval. Nothing staged, committed, pushed or deployed.**
Recorded 2026-11-05 from a strictly read-only audit of the live repository
(`C:/Users/Admin/OneDrive/Documents/PRIMEMET`, branch `main`). The only file added by this
exercise is this record.

MongoDB remains the only application database. No PostgreSQL/Prisma runtime dependency was
introduced. Workstream 6 is out of scope for this release (see §12).

## 1. Git state at audit time

| Item | Value |
| --- | --- |
| Branch / HEAD | `main` / `7863743f20f9938ba1fd2548409ca05cbab0e471` (`feat: add PRIMEMET public site and SEO foundation`) |
| Remote | `origin` → `https://github.com/daulatrao123/PRIMEMET.git` |
| Upstream | `origin/main` = `7863743`, ahead 0 / behind 0 |
| Staged | 0 |
| Modified tracked | 36 |
| Untracked | 222 (258 status paths in total) |
| Tracked at HEAD | 129 files |
| Branches / tags / stashes | one branch, no tags, no stashes |
| Ignored, release-relevant | `.env.local`, `.next/`, `node_modules/`, `next-env.d.ts`, `tsconfig.tsbuildinfo`, `.exvisit/` |

The 36 modified tracked files are the portal implementations replacing the HEAD preview
scaffolds (for example `src/app/admin/dashboard/page.tsx`, whose HEAD version is a static mock).

## 2. Classification of the 257 changed paths

| # | Category | Count | M / U |
| --- | --- | --- | --- |
| 1 | Authentication and authorisation | 31 | 6 / 25 |
| 2 | MongoDB definitions, migrations and DB tooling | 82 | 2 / 80 |
| 3 | Product catalogue | 6 | 0 / 6 |
| 4 | Buyer portal | 9 | 3 / 6 |
| 5 | Seller portal | 15 | 9 / 6 |
| 6 | Admin dashboard | 31 | 8 / 23 |
| 7 | Security and infrastructure | 10 | 5 / 5 |
| 8 | SEO and public website | 1 | 1 / 0 |
| 9 | Documentation and verification | 54 | 2 / 52 |
| 10 | Historical/reference (PostgreSQL–Prisma) | 18 | 0 / 18 |
| — | Excluded tool (stale) | 1 | 0 / 1 |

Convention: a path is assigned to the module that owns it. Admin screens that manage the
catalogue (`src/app/admin/catalogue/**`, `src/app/api/admin/catalogue/**`,
`src/app/admin/products/**`) count under Admin dashboard; the catalogue data layer and the
public product pages count under Product catalogue.

`db/` holds 27 of the 82 in category 2; the remaining 55 are DB tooling and the M1–M5,
Phase-1 and B2 verification suites under `scripts/`.

## 3. Module dependencies

- Every data module imports `@/lib/db`, which imports `@/lib/env`; nine of eleven also import
  `@/lib/auth/session` and/or `@/lib/auth/audit`. Auth and the environment contract must land
  before, or with, the portal data layer.
- `v006`–`v009` each import `../collections/index.mjs` and `../define.mjs`; `v010` imports
  `../guards.mjs` only; `db/migrations/index.mjs` imports all ten.
- `scripts/verify-b2-migration.mjs` imports `db/migrations/index.mjs`, `db/ledger.mjs`,
  `db/roles.mjs`, `db/verify.mjs`, `db/collections/index.mjs`.
- Therefore **B2 cannot be committed independently**: it requires all of `db/**` plus its harness.
  The M1–M5 *application* files are not required for B2 to apply or verify, but they are required
  for the repository to be a working application.

## 4. Secrets review — clean

Every modified and untracked text file was scanned for `mongodb(+srv)://user:pass@`,
private-key blocks, `AKIA…`, `sk-…`, `xox?-…`, `ghp_…`. No real credential exists.

- `.env.example` holds placeholders only.
- `.env.local` is ignored and contains one variable, `NEXT_PUBLIC_APP_URL=https://primemet.example`.
  No `.env*` file has ever been committed (`git log --all`).
- `prisma/.env` holds a deliberately fake PostgreSQL URL and is **ignored** by `.gitignore`
  (`/prisma/.env`). The previous `!/prisma/.env` whitelist was inverted, so a blanket `git add -A`
  can no longer commit it.
- The only `mongodb+srv://` hits are synthetic fixtures inside `scripts/check-db-guard.mjs`.
- CI references `${{ secrets.MONGODB_URI }}` and `${{ vars.MONGODB_DB }}` only.

## 5. Dependency consistency

`package.json` changed in its `scripts` block only; `dependencies` and `devDependencies` are
identical to HEAD. `package-lock.json` is untouched, `lockfileVersion 3`, and the root dependency
map matches `package.json` exactly — `npm ci` needs no lock update.

Finding: `@prisma/client` is a production dependency that nothing imports (zero hits across
`src`, `db`, `scripts`). Removing it is a dependency change and is **not** proposed here.
`@node-rs/argon2` is referenced only by `scripts/verify-argon2-runtime.mjs`; runtime password
hashing is scrypt from `node:crypto`.

## 6. Migration ordering and prerequisites

Registry `db/migrations/index.mjs`: v001 initial collections, v002 permission grant effects,
v003 super-admin continuity guard, v004 organisation kind, v005 platform identity, v006 Phase-1
portal, v007 catalogue media, v008 seller portal, v009 admin console, v010 protected platform
identity. Ascending `version`, unique
versions asserted, each migration's checksum is its own file only, `DEFINITIONS_DIGEST` recorded
at apply and compared by verify/reconcile. Ledger: `_schema_migrations`. **Forward-only: no down
migrations exist.**

- Fresh database: all ten via `npm run db:init` → the declared set (45 business collections plus the
  ledger, the continuity guard and `_platform_identity`).
- Existing database: pending versions only; `--status`, apply, then `--verify-only`; drifted
  definitions digest is refused.
- Prerequisites: `MONGODB_URI` must be the owner identity for init; `MONGODB_DB` is mandatory
  (no default); `PRIMEMET_ENV` is mandatory for `apply`/`--reconcile`; roles provisioned separately
  (`db:provision`, then `db:check-role`).

## 7. Prisma/PostgreSQL containment

No `@prisma/client`, `prisma` or `@prisma/*` import exists in `src/`, `db/` or `scripts/`; the
runtime uses the native `mongodb` driver. However `prisma/schema.prisma` is the source of truth
parsed by `scripts/gen-mongo-enums.mjs`, `check-enums.mjs`, `check-schema.mjs` and
`check-schema-m1.mjs` to validate `db/enums.mjs`, and `check-equivalence` uses
`@electric-sql/pglite` (dev-only oracle). These 18 files must therefore be **kept**; nothing was
deleted and none of them can reach the Next.js bundle or a production connection.

## 8. Checks executed for this record

35 npm scripts were run; exit codes below are observed, not carried over.

Pass (33): `lint`, `typecheck`, `check:routes`, `check:schema`, `check:schema:m1`,
`check:catalogue`, `check:seo`, `test:site-url`, `check:equivalence`, `check:db-guard`,
`check:mongodb`, `check:enums`, `audit:unique-indexes`, `verify:unique-index-semantics`,
`verify:tax-rule-index`, `check:migrations` (74 assertions), `check:permissions` (145),
`check:adversarial` (97), `check:acceptance` (93/93), `check:remediation` (130/130),
`check:reviewer-package` (88/88), `check:authz` (52 held / 6 gaps / 0 failures), `check:env-blank`,
`check:bootstrap` (28/0), `check:content` (182/0), `check:wizard` (100/0),
`verify:m1` (42), `verify:m2` (41), `verify:m3` (28), `verify:m4`, `verify:m5` (32),
`verify:phase1` (13), `verify:b2` (55 held / 0 failures).

Fail (2), both needing infrastructure this record did not have:

| Check | Cause |
| --- | --- |
| `audit:permission-integrity` | `MONGODB_URI is not set` — needs a live database by design |
| `verify:phase3` | inspects an existing `.next` that predates `/products` and the portal routes |

The P1/F1–F5 remediation changes four of the figures above — `check:adversarial` 132/0, `check:authz`
57 held / 3 gaps / 0 failures, `check:remediation` 132/132, `verify:b2` 56 held — and the whole set is
re-executed on the staged tree before any commit is created.

Not run (would write or need infrastructure): `build`, `dev`, `start`, `db:generate`,
`db:validate`, `db:format`, `db:enums`, `db:init`/`db:status`/`db:verify`/`db:provision`,
`db:backfill-organisations`, `verify:argon2-runtime`.

`node scripts-manifest-count.mjs` exits 1: its hard-coded boundaries expect 108 status paths
against 258 today. It is stale and is excluded from the manifest below.

## 9. Excluded from the release

| Path | Reason |
| --- | --- |
| `.env.local` | local values only, ignored |
| `.next/`, `node_modules/`, `next-env.d.ts`, `tsconfig.tsbuildinfo`, `.exvisit/` | build output, dependencies, agent metadata |
| `docs/reviewer-package/**` (9 files) | Workstream 6, excluded by owner ruling — see §12 |
| `prisma/.env` | fake credential; **ignored** by `.gitignore` (`/prisma/.env`) — the former `!/prisma/.env` whitelist was inverted, so no blanket add can commit it |
| `scripts-manifest-count.mjs` | stale manifest tool |
| `scripts/reviewer-probe.mjs` | Workstream 6 reviewer probe |

## 10. Required environment variables

`NEXT_PUBLIC_APP_URL` (required for a production build: absolute https origin, no path, not
localhost) · `MONGODB_URI` (application identity) · `MONGODB_DB` (required whenever the URI is
set; may not be `primemet` unless `PRIMEMET_ENV=production`) · `PRIMEMET_ENV` (required for any
write) · `PRIMEMET_ALLOWED_HOSTS` (optional) · `AUTH_SECRET` (≥32 chars; absent means sign-in is
disabled and the middleware fails closed) · `PLATFORM_ORGANISATION_ID` (**operator-time only**, read by
`db/guards.mjs` and `scripts/db-init.mjs`, never by the application bundle: it names the existing, live
`orgKind: "PRIMEMET"` organisation that v010 seeds the protected pointer from, and must be supplied when
the database already holds operator data but no pointer). Deprecated and unread: `DATABASE_URL`,
`DIRECT_URL`.

## 11. Commit manifest — NOT EXECUTED

Ten ordered commits. `git add -A` is deliberately not used.

1. `chore(repo): add line-ending and binary policy` — `.gitattributes`
2. `feat(db): MongoDB schema definitions, ordered migrations v001-v010 and role provisioning` (62 paths) —
   `db/`, `prisma/`, `scripts/m1-baseline/`, `scripts/{db-init,db-verify,db-guard,check-db-guard,check-mongodb,check-migration-architecture,check-enums,gen-mongo-enums,dev-mongo,audit-unique-indexes,verify-unique-index-semantics,verify-tax-rule-index,backfill-organisations,check-equivalence,check-schema,check-schema-m1}.mjs`, `scripts/lib/{mongo-enums,register-ts,prisma-enums}.mjs`
3. `feat(security): environment contract, database target guard and baseline response headers` —
   `src/lib/{env,db,http,validation}.ts`, `src/app/api/health/route.ts`, `next.config.ts`, `.env.example`, `tsconfig.json`, `scripts/check-env-blank.mjs`
4. `feat(auth): scrypt credentials, sessions, permission tiers and portal middleware` —
   `src/lib/auth/`, `src/lib/permissions/`, `src/lib/data/{authorise,db-safe}.ts`, `src/middleware.ts`, `src/app/(auth)/`, `src/components/auth/`, `src/app/api/auth/`, `scripts/{verify-argon2-runtime,check-authz-authenticated,check-permissions,check-adversarial,audit-permission-integrity,check-bootstrap}.mjs`
5. `feat(catalogue): product data layer and public product pages` —
   `src/app/(site)/products/`, `src/components/admin/product-form.tsx`, `src/lib/catalogue-form.ts`, `src/lib/data/{catalogue,listings}.ts`
6. `feat(buyer): buyer portal and enquiry routes` — `src/app/buyer/`, `src/app/api/buyer/`, `src/app/api/enquiries/`, `src/lib/data/{buyer-portal,enquiries}.ts`
7. `feat(seller): seller portal, listings and tax screens` — `src/app/seller/`, `src/app/api/seller/`, `src/lib/data/{seller-portal,seller-admin}.ts`
8. `feat(admin): admin console, accounts, catalogue and listing queues` — `src/app/admin/`, `src/app/api/admin/`, `src/lib/data/{admin,accounts,admin-console}.ts`, `src/lib/content/admin-nav.ts`
9. `test(db): M1-M5, Phase-1 and B2 verification suites` — `scripts/verify-m*.mjs`, `scripts/verify-phase1.mjs`, `scripts/verify-b2-migration.mjs`, `scripts/{check-acceptance,check-remediation,check-reviewer-package}.mjs`, `scripts/lib/m1-verify-core.mjs`, `scripts/lib/m{1..5}-groups/`, `package.json`
10. `docs: architecture, verification reports and release record` — `docs/PRIMEMET_*.md`, `PROJECT_SUMMARY.md`, `scripts/report-tier-matrix.mjs`, this record

`package.json` is committed last so no earlier commit advertises a script whose file is absent.
`package-lock.json` needs no commit. No push, merge or deployment is part of this manifest.

## 12. Workstream 6 disposition

The nine-file reviewer package remains at `docs/reviewer-package/`, unmodified (mtimes
2026-11-02T10:27), covering all seven required elements plus a classification file;
`npm run check:reviewer-package` exits 0 with 88/88 assertions.

By owner ruling (2026-11-05) it is **excluded from this release**, no separate W6 commit is to be
created, and it is not to be modified, copied, relocated, rewritten or deleted. Independent
reviewer sign-off is **PENDING** — the sign-off block in
`08-classification-and-recommendation.md` is labelled "To be completed by the reviewer, not by the
author" and is blank. **W6 security acceptance has NOT been granted**, and W6 remains a separate
external acceptance dependency that does not gate this product release.

## 13. Deployment blockers carried into this release

1. **B3** — the build origin is `https://primemet.example`; canonicals and the sitemap would be
   wrong. Not authorised, not started.
2. **B1** — `/request-a-quote` and `/source-scrap` are disabled previews with no API route behind them.
3. **CI mismatch — RESOLVED** — `.github/workflows/db-init.yml` now declares `PRIMEMET_ENV: production`
   on the apply step, reads `MONGODB_DB` from `vars.MONGODB_DB` with **no** `|| 'primemet'` fallback, and
   fails closed with `::error::` when the variable is unset. It still triggers on `push` to `main` for
   `db/**`, now behind the `production-database` environment.
4. **Stale gates — RESOLVED for three of the four** — `check:bootstrap` (28/0), `check:content`
   (182/0; it now starts and stops its own server on :3100) and `check:wizard` (100/0; it seeds its own
   admin) pass. The three Phase-1 assertions were replaced with post-portal ones rather than waived, and
   no security assertion was dropped. `verify:phase3` remains stale and is excluded from the release.
5. **Operational gaps** — no object storage, in-process rate limiter, no Mongo pool limit, no
   logging/APM/alerting, no backup/PITR, no mail transport, no admin bootstrap runbook.

6. **Migration v010 is a hard deploy prerequisite** — after F1 there is no legacy pointer fallback, so a
   database whose protected platform identity is unseeded resolves every administrator to
   `NO_ORGANISATION`. Apply v010 with `PLATFORM_ORGANISATION_ID` **before** deploying the application and
   confirm with `npm run db:verify` that the pointer is seeded. Reversing that order locks out every
   administrator.

Verdict: **CONDITIONAL GO** for a private invitation-only pilot repository release;
**NO-GO** for a public production release until B3, B1 and item 6 are closed. Item 3 is now resolved.
