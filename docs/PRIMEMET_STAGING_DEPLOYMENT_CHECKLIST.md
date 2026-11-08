# PRIMEMET — Staging deployment checklist

**Prepared:** 2026-11-02 · **Scope:** staging only · **Status:** NOT APPROVED — blockers open

Production database and production credentials must not be used for staging. Nothing in this
checklist authorises a deploy: every step below is executed only after the owner approves it.

---

## 0. Verified baseline (measured this session)

| Fact | Evidence |
|---|---|
| Branch `main`, HEAD `7863743`, 0 staged, 6 modified, 113 untracked | `git status --porcelain -uall` |
| Production build succeeds with a staging origin | `NEXT_PUBLIC_APP_URL=https://staging.primemet.in npm run build` → exit 0 |
| Server starts and serves | `next start -p 3101` → Ready in 920 ms |
| Health probe with no database | `GET /api/health` → 200 `{"status":"ok","database":"not_configured"}` |
| Canonical origin follows the env var | `/sitemap.xml` → `https://staging.primemet.in/...` |
| Portal routes answer anonymously | `/admin/dashboard`, `/admin/enquiries`, `/admin/audit-log`, `/buyer/dashboard`, `/buyer/enquiries/new`, `/seller/dashboard` → all **200** |
| No real credential in the tree | only placeholders in `.env.example`, `prisma/.env`, `scripts/check-schema*.mjs` |

---

## 1. Vercel environment configuration

- [ ] Create a **separate Vercel project** for staging (or a Preview-only project). Do not attach the
      production project to the staging branch.
- [ ] Framework preset: Next.js. Build `npm run build`, install `npm ci`, Node **22.x**
      (`package.json` declares no `engines`; pin it in the project settings).
- [ ] Set `NEXT_PUBLIC_APP_URL` **per environment scope**: Production scope = production origin;
      Preview/Development scope = the staging origin. `next.config.ts` fails the build when this is
      missing, invalid or loopback, so a wrong scope fails loudly rather than shipping localhost URLs.
- [ ] Set `MONGODB_URI` and `MONGODB_DB` for **Preview/Development scope only**. Never in Production
      scope of the staging project, and never the production cluster URI.
- [ ] Enable **Deployment Protection** (Vercel Authentication / password) on the staging project.
      This is the only access control that exists today — see §4.
- [ ] Confirm no `vercel.json` is required: none exists, and the app needs no rewrites, headers or
      cron. If one is added later, it must not point at production resources.
- [ ] Do not add `DATABASE_URL` / `DIRECT_URL` (deprecated PostgreSQL, unread by the app).

## 2. Isolated MongoDB staging database

- [ ] Use a **separate Atlas project or a separate cluster** for staging. A separate database name in
      the production cluster is the minimum fallback, never the default.
- [ ] `MONGODB_DB=primemet_staging` **and** `PRIMEMET_ENV=staging` — both are required, and neither has
      a default (`src/lib/db.ts`, `src/lib/env.ts`, `scripts/db-guard.mjs`). A process with no
      `MONGODB_DB` now refuses to start its database work, and a process with `PRIMEMET_ENV=staging`
      refuses `MONGODB_DB=primemet`. `npm run db:guard` prints the target or refuses.
- [ ] Provision the three roles **in the staging cluster** with owner credentials:
      `MONGODB_URI=<staging owner URI> npm run db:provision -- --apply`
      (`primemet_owner` init only, `primemet_app` runtime, `primemet_readonly` reporting).
- [ ] Prove the deployed identity is not the owner:
      `MONGODB_URI=<staging app URI> npm run db:check-role` → must print
      `the connected identity is not an owner role`.
- [ ] Atlas network access: allowlist Vercel egress only. Vercel serverless has no fixed egress IP by
      default; either enable Static Outbound IPs and allowlist exactly those, or use PrivateLink.
      `0.0.0.0/0` is acceptable only for a short connectivity proof, then removed.
- [ ] Tier: custom roles require a dedicated tier (M10+). A free/shared tier fails at `createRole`.
- [ ] Seed **synthetic data only**. No production dump, no production export, no production PII.

## 3. Environment variables and secrets

| Variable | Read by | Staging value |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `next.config.ts`, `src/lib/site-url.ts` | staging https origin, no path |
| `MONGODB_URI` | `src/lib/db.ts`, `/api/health`, `scripts/db-init.mjs` | staging **app** user URI |
| `MONGODB_DB` | `src/lib/db.ts`, `scripts/db-init.mjs` | `primemet_staging` |
| `AUTH_SECRET` | declared in `src/lib/env.ts` only | not read by any code yet; set ≥32 chars when auth lands |
| `PERMISSION_LOG_KEY` | `src/lib/permissions/store.ts` (scripts only today) | staging-only key; never the production key |
| `ZOHO_SMTP_*`, `MAIL_FROM` | declared only | leave unset until mail is implemented |
| `DATABASE_URL`, `DIRECT_URL` | deprecated | do not set |

- [ ] Secrets live in the Vercel project settings (Preview scope) and in a password manager — never in
      the repository. `.env*` is git-ignored except `.env.example`; `prisma/.env` is a deliberate fake
      placeholder and must stay fake.
- [ ] Rotate any credential that has ever been pasted into a chat, a doc or a commit.
- [ ] `MONGODB_URI` must never be prefixed `NEXT_PUBLIC_` (it would be inlined into the browser bundle).

## 4. Authentication and organisation isolation — **BLOCKED**

Measured, not assumed:

- `src/middleware.ts` authenticates nothing and authorises nothing; it returns `NextResponse.next()`
  for every request and carries the Stage 2 TODO.
- No session, cookie, JWT or password code exists: `AUTH_SECRET` appears only in the env schema, and
  `cookies()` / `getSession` / `argon2` appear nowhere in `src/`.
- `src/app/(auth)/login/page.tsx` and both registration pages are disabled previews: no action, no
  validation, no record created.
- `src/lib/permissions/resolve.ts` is not called from any request path (finding **L6**); the only
  database consumer in `src/` is `src/lib/permissions/store.ts`, which no route imports.
- Consequence: finding **L6** records **35 portal URLs answering HTTP 200 to an anonymous client**;
  8 of them were re-measured above on the built server. There is no buyer/seller/admin separation and
  no organisation scoping to test.

- [ ] Treat Deployment Protection as mandatory, not optional, for staging.
- [ ] Do not put real customer, supplier or pricing data in staging until auth and org scoping exist.
- [ ] Keep `noindex` on `/admin`, `/buyer`, `/seller` (already set in the layouts) and `robots.txt`
      disallow rules; they reduce exposure but are not access control.

## 5. Database migrations and rollback

- [ ] Migrations are **forward-only**: `db/migrations/v001`–`v005` export `{version, name, description, up}`
      and there is no `down()`. Rollback is therefore *restore*, not *revert*.
- [ ] Ledger: `_schema_migrations` records version, checksum of the migration's own file, and
      `DEFINITIONS_DIGEST`. A checksum mismatch is drift and must stop the run.
- [ ] Pre-flight on staging (read-only): `npm run db:status`, then `npm run db:init -- --dry-run`.
- [ ] Apply: `MONGODB_URI=<staging owner URI> MONGODB_DB=primemet_staging npm run db:init`.
- [ ] Verify: `npm run db:verify` (must report 45/45 collections and matching validators/indexes).
- [ ] Drift repair only: `npm run db:init -- --reconcile` (re-runs idempotent `up()`; never drops).
- [ ] **Rollback plan (staging):** take an Atlas snapshot immediately before the first migration; to roll
      back, restore that snapshot to a *new* staging cluster, repoint `MONGODB_URI`, re-run `db:verify`.
      Dropping and re-initialising `primemet_staging` is acceptable only because the data is synthetic.
- [ ] Record the applied ledger rows and the `DEFINITIONS_DIGEST` in the deployment record.
- [ ] Migration `v006` (auth/org-scope collections) is **not written yet**; staging must not be
      presented as the environment where it was validated.

## 6. Buyer, seller and admin test accounts — **BLOCKED**

- [ ] No account can be created today: registration and login are disabled previews, and
      `scripts/check-bootstrap.mjs` asserts that **no** seed script, default credential or admin-creation
      path exists anywhere in the repository.
- [ ] The organisation bootstrap (platform organisation + first super admin) is designed in
      `docs/PRIMEMET_ORGANISATION_BOOTSTRAP.md` and deliberately **not implemented**.
- [ ] Therefore: no buyer, seller or admin test account can be provisioned for staging without first
      implementing M2 (auth) and the bootstrap. Any account created by hand-editing the staging
      database would be an unverified, unsupported state — do not do it.
- [ ] When M2 lands, the accounts must be: `buyer.staging@…`, `seller.staging@…`, `admin.staging@…`,
      created through the real flows, with credentials stored in the password manager, and each
      organisation distinct so isolation can be tested.

## 7. End-to-end enquiry-to-order testing — **BLOCKED**

- [ ] The only API route in the application is `/api/health`. There are no server actions
      (`"use server"` appears nowhere) and no page imports `@/lib/db`.
- [ ] The enquiry wizard's submit button is permanently disabled and labelled
      "Frontend preview — nothing is saved or sent" (`src/components/enquiry/wizard.tsx`).
- [ ] No enquiry, RFQ, quotation, margin, order, payment, inspection, dispatch or fulfilment operation
      exists to test. Staging can only exercise rendering, navigation and the health probe.
- [ ] What *can* be tested in staging today: public site rendering and SEO, portal layout/navigation,
      `/api/health` states, `robots.txt`/`sitemap.xml` origin, and the read-only check scripts
      (`check:routes`, `check:content`, `check:wizard`, `check:seo` with `SMOKE_BASE=<staging url>`).
- [ ] Do not describe a green staging smoke run as evidence that the buyer-to-order workflow works.

## 8. Logs, monitoring and backup verification

- [ ] Logs: Vercel function logs only. No log sink, no error tracker, no OpenTelemetry in the repo.
      Decide whether staging needs one before the first shared test session.
- [ ] Monitoring: `/api/health` is the only probe. It returns 200 `not_configured` with no URI,
      200 `connected` on a successful ping, 503 `degraded` on failure, and never leaks the URI.
      Point an external uptime check at it and alert on 503.
- [ ] Audit trail: `audit_logs` exists as an append-only collection with a validator, but nothing in
      `src/` writes to it yet — do not claim audit coverage for staging activity.
- [ ] Backup: Atlas continuous backup / PITR requires a dedicated tier. Enable it on the staging
      cluster, take a snapshot, restore it to a **new** cluster, and verify `npm run db:verify` plus a
      spot-check query. Record the restore time.
- [ ] Confirm the staging cluster is excluded from any production backup/restore drill.

## 9. Unsafe workflows to close before staging

- [ ] `.github/workflows/db-init.yml` runs on **push to `main`** touching `db/**`, `scripts/db-init.mjs`,
      `prisma/schema.prisma`, `package.json` or the lockfile, against the `production-database`
      environment secret. Staging work must not land on `main` while this is the only trigger, or the
      staging push will migrate production.
- [ ] `scripts/db-init.mjs` has **no environment guard**: it will happily migrate whatever
      `MONGODB_URI` points at. The only protection is the operator's environment. Add a staging/production
      confirmation (or a `MONGODB_DB` allowlist) before the first staging run.
- [ ] `db:provision --apply` needs owner credentials; those must never be set in Vercel.
- [ ] No `vercel.json`, no project link, no deployment record exists — the hosting decision **O-27.7**
      (provider + region) is still formally unapproved.

## 10. Blockers and verdict

**Staging deployment is NOT safe to expose publicly today.** It is safe to deploy as a *private,
protected preview* with an isolated staging database, because the application is read-only UI plus a
health probe — but that preview cannot validate authentication, organisation isolation, test accounts
or the enquiry-to-order workflow, because none of them exist.

| # | Blocker | Evidence |
|---|---|---|
| B1 | No authentication or authorisation; all portals open anonymously | `src/middleware.ts`, L6, 200s measured above |
| B2 | No organisation isolation in any request path | `resolve.ts` unused; no org scoping in `src/` |
| B3 | No test accounts possible; bootstrap unimplemented, no seed script | `scripts/check-bootstrap.mjs`, bootstrap doc |
| B4 | No enquiry-to-order workflow; no API routes, no server actions, disabled submit | `src/app/api/**`, `wizard.tsx` |
| B5 | W2-s and W3 BLOCKED (privilege model gaps; needs `v006` + a fourth role) | `docs/reviewer-package/01-security-findings.md` |
| B6 | Environment separation and hosting decision O-27.7 unapproved | `docs/PRIMEMET_STAGE_2_ARCHITECTURE.md`, `PRIMEMET_ATLAS_SETUP.md` |
| B7 | Migrations are forward-only; rollback is restore-from-snapshot | `db/migrations/*.mjs` |
| B8 | `db-init.yml` auto-migrates production on push to `main` | `.github/workflows/db-init.yml` |
| B9 | No backup, log sink or monitoring configured | repo-wide search |
| B10 | `AUTH_SECRET`, `PERMISSION_LOG_KEY`, SMTP unset; permission store unused by routes | `src/lib/env.ts`, `store.ts` |

**Approval gates.** Nothing is staged, committed, pushed or deployed. The next actions require explicit
approval, in this order: (1) approve O-27.7 and the staging project/cluster; (2) approve the staging
`MONGODB_URI`/`MONGODB_DB`; (3) approve the first `db:init` on staging; (4) approve the Vercel deploy.
