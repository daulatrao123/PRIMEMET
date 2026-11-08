# PRIMEMET — M6: Production Readiness and Controlled Pilot Audit

**Date:** 2026-11-05
**Database:** MongoDB only (no PostgreSQL, no Prisma application code, no dual writes).
**Environment audited:** local workstation, production build (`next build` + `next start`), isolated in-memory MongoDB replica set for the journey suites. **No staging deployment and no production deployment exist.**
**Deployments, provisioning, production migrations, commits and pushes:** none performed.

> **Verdict: NO-GO for production. CONDITIONAL GO for a single-instance, invitation-only pilot** — only after the four P0 blockers in §3 are closed and the owner accepts the residual risk in writing, because independent security acceptance (Workstream 6) is still pending and cannot be self-certified.

---

## 1. Method and verification levels

Every claim below is tied to one of these levels. Nothing is upgraded by inference.

| Level | Meaning in this report |
|---|---|
| **Verified locally** | Executed on this machine against the real production build and/or a real MongoDB replica set, with the command and result recorded in §8. |
| **Verified in staging** | Executed against an isolated staging deployment. **None — no staging environment exists.** |
| **Verified in production** | Executed against the live service. **None — no production environment exists.** |
| **Not tested** | No execution was possible or attempted; the reason is stated. |
| **Blocked** | Cannot be executed until an external prerequisite exists (cluster, provider, credentials, independent reviewer). |

A passing unit or integration suite is **not** treated as production evidence anywhere in this document.

---

## 2. Production readiness matrix

| # | Area | Status | Evidence | Blocker / gap |
|---|---|---|---|---|
| 1 | Buyer → admin enquiry journey | **Verified locally** (portal path) · **public entry blocked** | J5–J7: buyer registers, raises `ENQ-2026-000001`, desk sees it, status change audited, private note invisible to buyer, second buyer refused (403/404) | `/request-a-quote` and `/source-scrap` are hard-coded previews with a disabled submit (§3 B1) |
| 2 | Seller → admin approval journey | **Verified locally** | J8–J11: registration `PENDING_APPROVAL`, sign-in refused 403, desk approval audited, 2 listings submitted, one rejected with reason, one approved, public catalogue unchanged until separate publication | None functional; no notification to the seller (B9) |
| 3 | Product catalogue publication | **Verified locally** | J2 draft→published, draft 404, live slug 200; J10 approved ≠ public; J11 desk publication only, seller identity never public | Published products absent from sitemap (B4) |
| 4 | Authentication and session security | **Verified locally** + code review | scrypt (N=2^15, per-hash salt, parameters encoded), HMAC-signed token, DB-backed session with `revokedAt` checked per request, 7-day TTL, `httpOnly` + `SameSite=Lax` + `Secure` on https, DB lockout (`failedLoginCount`/`lockedUntil`), 10 attempts/15 min per address+email, suspension ends live sessions (J12) | No MFA, no password reset, no email verification (B9); no CSP (B7); staging/prod cookie behaviour untested |
| 5 | Organisation-level data isolation | **Verified locally (application layer)** | J6: cross-tenant list/detail refused, forged organisation id ignored; 31 organisation-scoped query sites; tenant-prefixed indexes | **No MongoDB RLS.** `check:authz` records 6 known gaps, incl. app identity can relabel a BUYER org to PRIMEMET when no other PRIMEMET row exists, and can re-point the platform identity pointer |
| 6 | Admin privilege protection | **Verified locally** | 13/13 non-auth API routes call `requireApi`; 15/28 admin pages call `requireAdminPage` (the rest are nested under the guarded layout); data-layer `requireAdminActor`; J12: 6 endpoints × 3 identities refused; `check:permissions` 145/145; `check:adversarial` 97/97 | No MFA for admins; no IP allow-list; no break-glass procedure beyond the C3 continuity guard |
| 7 | MongoDB production configuration | **Not tested** (no cluster) + code review | `retryWrites: true`, 5 s server-selection/connect timeouts, single client per process, `MONGODB_DB` mandatory, production-name guard, preview+production refused | No `maxPoolSize` (driver default 100 per instance — dangerous on serverless), no `appName`, no read preference, no TLS options beyond the SRV URI, no connection-limit budget for Atlas Flex (500) |
| 8 | Backup and restore strategy | **Blocked / not implemented** | Checklist only in `docs/PRIMEMET_ATLAS_SETUP.md`; no backup policy, no PITR configuration, no restore script, no rehearsal | No cluster exists; MongoDB is the only copy of the data |
| 9 | Secure image and document storage | **Blocked / not implemented** | Uploads are explicitly disabled in the UI; `imageUrl` is an unverified `https://` string; no S3/R2 client, no signed URLs, no virus scanning | No object-storage provider; documents currently cannot be accepted at all |
| 10 | Rate limiting across instances | **Not tested**; known limitation | Fixed-window in-process `Map` (10k keys, wholesale clear), 6 limit classes; login lockout is persistent in MongoDB | Effective limit multiplies by instance count; no shared store (Redis) |
| 11 | Logging, monitoring, error reporting | **Not implemented** | `/api/health` (bounded ping, 503 on failure, no secrets); `auth_events`, `audit_logs`, `audit_log_failures` in MongoDB; 3 `console.*` calls in the whole app | No log sink, no APM, no alerting, no uptime monitor, no request id (`audit_logs.requestId` is always `null`), no error budget |
| 12 | SEO and sitemap correctness | **Verified locally, with 2 defects** | `check:seo` 656/656; robots disallows `/admin /buyer /seller /api /login /register`; canonical + description + breadcrumb JSON-LD on product pages; 28 sitemap URLs | Build used `https://primemet.example` → every canonical/sitemap URL is a placeholder (B3); published products are not in the sitemap (B4) |
| 13 | Mobile usability | **Partially verified locally** | Home and `/request-a-quote` rendered at 390×844: **no horizontal overflow**, 1-column grids, sticky header, no console errors; wizard interaction suite passes desktop/tablet/mobile (88/100; the 12 failures are admin-only, see B14) | 2 tap targets <44 px on home, 9 on the wizard; 31–38 text runs <12 px; **portal screens not measured** (need an authenticated session); no physical-device pass; no `prefers-reduced-motion` rule |
| 14 | Performance and query efficiency | **Not tested under load** + static review | Compound tenant indexes (`buyerOrganisationId+createdAt`, `status+createdAt`, `createdAt`), pagination capped at 20–100, batched `$in` lookups instead of N+1, `$group` counts | No load test, no query profiler run, no caching strategy (`/products` and product pages are `force-dynamic`), `countDocuments` on every paginated page |
| 15 | Deployment and environment configuration | **Not tested** (no environment) + build gate verified | `next build` fails without a valid non-loopback https `NEXT_PUBLIC_APP_URL`; env schema refuses `MONGODB_DB=primemet` outside production and preview+production; `db:guard`; CI workflow for `db:init` | No staging/production environment, no app CI (typecheck/lint/build/tests), 148 uncommitted files, `.env.example` stale (B13), no `engines`, no Dockerfile/`vercel.json` |

**Verified in staging: 0 areas. Verified in production: 0 areas.**

---

## 3. Critical launch blockers

### B1 — The public enquiry funnel is a dead preview (P0, product)
`/request-a-quote` and `/source-scrap` render `BuyerEnquiryWizard` with a hard-coded `NotConnected` banner and a disabled "Submit (preview)" button. The real enquiry path exists only behind registration (`/buyer/enquiries/new`) or on a product page (`POST /api/enquiries`). A first-time buyer arriving from the website — the exact pilot persona — cannot submit anything.
**Remedy:** wire the public wizard to `POST /api/enquiries` (guest enquiry with contact fields, or redirect to registration with the brief preserved), or change the CTA copy and route to registration. Decide before the pilot; do not ship a disabled form under a "Request a quote" button.

### B2 — The documented owner identity cannot apply migration v006 (P0, database)
`npm run check:authz` now reports **50 properties held, 6 gaps, 2 failures** (previously recorded as 52/6/0). The failure is real and reproduced in isolation:

```
not authorized on primemet to execute command { update: "supplier_listings", ... }
```

Cause, confirmed by experiment: v006's backfill runs `updateMany(..., { bypassDocumentValidation: true })`, and `primemet_owner` is granted `find/insert/update` but **not `bypassDocumentValidation`**. With the action added, the same update succeeds; without it, it is denied. Because earlier migrations create `supplier_listings`, the backfill always runs — so `npm run db:init -- --apply` fails on any database that already has the collection, i.e. every upgrade and every fresh authenticated run.
**Remedy:** add `bypassDocumentValidation` to the owner role on mutable collections (or restructure v006 to relax the validator before backfilling). Re-run `check:authz` to 0 failures before provisioning.

### B3 — The build is pinned to a placeholder origin (P0, deployment)
`.env.local` sets `NEXT_PUBLIC_APP_URL=https://primemet.example`. The current build therefore emits `https://primemet.example` in all 28 sitemap entries, every canonical tag, `robots.txt` `Host`/`Sitemap`, and Open Graph URLs. Canonicals are baked at build time.
**Remedy:** build with the real production origin; add a deploy-time assertion that the built sitemap contains the expected host.

### B4 — Published products are not in the sitemap (P1, SEO)
`sitemap.ts` maps the static `PUBLIC_ROUTES` registry only. Dynamic `/products/[slug]` pages are `force-dynamic` and never listed. A published catalogue is invisible to crawlers except through internal links.
**Remedy:** decide — dynamic sitemap from published products (with a cache/revalidate policy) or accept link-only discovery. Record the decision.

### B5 — No object storage: documents and images cannot be accepted (P1, product/security)
Uploads are disabled everywhere; `imageUrl` accepts any `https://` string without fetching or validating it. A pilot that needs drawings, certificates or nameplate photographs has no path.
**Remedy:** provision R2/S3 with private buckets, signed upload/download URLs, type/size limits and malware scanning; until then, state in the pilot terms that documents are exchanged out of band.

### B6 — Rate limiting is per instance (P1, security)
The limiter is an in-process `Map`. Two instances double every limit. The persistent login lockout in MongoDB mitigates password guessing but not registration or enquiry flooding.
**Remedy:** single instance for the pilot (documented), or a shared store (Upstash Redis) before scaling out.

### B7 — No observability (P1, operations)
No log sink, APM, alerting or uptime monitor. `/api/health` is the only signal, and nothing watches it. Audit rows carry `requestId: null`, so an incident cannot be correlated to a request. There is no CSP; HSTS is not set by the app.
**Remedy:** log drain + error tracker (Sentry or equivalent), uptime check on `/api/health` with alerting, request ids threaded into audit rows, CSP with nonces at the edge, HSTS at the platform.

### B8 — No backup, PITR or restore rehearsal (P1, data safety)
MongoDB is the only copy. There is no backup policy, no PITR configuration, no restore procedure and no rehearsal. The C3 continuity guard must be restored with the rest of the data or guarded changes are refused.
**Remedy:** see §6.

### B9 — No outbound mail (P1, operations)
No SMTP/API integration exists: no password reset, no verification, no enquiry or approval notifications. Buyers and sellers learn about decisions only by signing in.
**Remedy:** add a transactional provider and the three minimum templates (verify, reset, decision), or run the pilot with manual phone/email contact and say so.

### B10 — No executable admin bootstrap (P1, operations)
`docs/PRIMEMET_ORGANISATION_BOOTSTRAP.md` is design-only. The Phase 1 gate seeds an administrator directly into MongoDB. There is no reviewed, repeatable runbook for creating the first real admin and organisation.
**Remedy:** write and rehearse the runbook (owner identity, audit row, no shared credentials) before onboarding.

### B11 — Serverless connection-pool risk (P2, database)
No `maxPoolSize` is set, so each instance may open up to 100 connections. On Atlas Flex (500-connection ceiling) a handful of concurrent lambdas can exhaust the cluster.
**Remedy:** set `maxPoolSize` to 5–10 for serverless, or run a single long-lived Node process.

### B12 — Repository and CI hygiene (P2, delivery)
148 files are uncommitted (36 modified, the rest untracked, including the whole `db/` layer and the Phase 1 gate). CI runs only `db-init` and an argon2 gate; nothing runs typecheck, lint, build or the verification suites on push.
**Remedy:** commit the reviewed tree on a branch, add a CI job that runs `typecheck`, `lint`, `build`, `check:*` and `verify:phase1` against an ephemeral replica set.

### B13 — `.env.example` is stale and misleading (P2, documentation)
It states "There is no authentication and no mail integration yet" and that `AUTH_SECRET` is "not read by any code yet". Authentication exists and `AUTH_SECRET` signs sessions and keys IP hashes. A deployment engineer following this file would omit a required secret.
**Remedy:** rewrite the file against the current env schema; mark `AUTH_SECRET` as required in production.

### B14 — Two legacy suites fail and are not in the documented gate (P2, test hygiene)
`npm run check:content` → 84 passed / **49 failed**; `npm run check:wizard` → 88 passed / **12 failed**. The failures are stale expectations, not product defects: `smoke-content.mjs` still asserts a "Preview" label and disabled submit on portal/auth pages that became real in M2, and the wizard's admin section reads `/admin/enquiries/example` anonymously, which now redirects to sign-in. They are excluded from the documented gate, so "all suites green" is only true of the gate as defined.
**Remedy:** retire or rewrite both scripts; add them to CI only once they assert current behaviour.

---

## 4. Infrastructure requirements

| Component | Requirement | Why |
|---|---|---|
| MongoDB Atlas | Dedicated **M10** (or Flex for non-production), region Mumbai (`ap-south-1`), Cloud Backup + PITR enabled, IP access list, TLS via `mongodb+srv` | Backups/PITR are not available on the free tier; M10 is the smallest tier with production backup guarantees |
| Database identities | `primemet_owner` (init only, CI secret), `primemet_app` (runtime), `primemet_readonly` (reporting) | Separation already designed; `db:check-role` proves the runtime identity is not the owner |
| Application host | Vercel Pro (Node 20/22) **or** a single long-lived Node process behind a reverse proxy | Single instance keeps the in-process limiter honest; Vercel needs `maxPoolSize` tuning |
| Environment | `NEXT_PUBLIC_APP_URL` (real https origin), `MONGODB_URI` (app user), `MONGODB_DB=primemet`, `PRIMEMET_ENV=production`, `AUTH_SECRET` ≥32 bytes, `PRIMEMET_ALLOWED_HOSTS` | Build fails without the origin; sessions fail without the secret |
| Object storage | Private R2/S3 bucket, signed URLs, 10 MB/file, JPG/PNG/PDF/DWG/XLSX, malware scan | B5 |
| Mail | Transactional provider (Resend/Zoho) with SPF/DKIM/DMARC on the sending domain | B9 |
| Monitoring | Error tracker, log drain, uptime check on `/api/health`, alert to a named person | B7 |
| Shared limiter | Redis (Upstash) before a second instance | B6 |
| DNS/TLS | Real domain, HSTS at the edge, CSP with nonces | B3, B7 |
| CI | typecheck, lint, build, `check:*`, `verify:phase1` on every push | B12 |

---

## 5. Estimated operational costs (pilot scale)

List prices observed 2026-11-05; **verify in the provider console before budgeting** — the repository's own Atlas guide says the same.

| Item | Option | Monthly (USD) |
|---|---|---|
| MongoDB Atlas | Flex $0.011/hr (~$8, capped at $30) | 8–30 |
| | **M10 dedicated $0.08/hr (~$57), backups included** | ~57 |
| App host | Vercel Pro ($20, includes $20 usage credit) | 20 |
| | or a 2 vCPU VPS | 6–12 |
| Object storage | Cloudflare R2: 10 GB + 1M Class A free, then $0.015/GB-month, egress free | 0–2 |
| Mail | Resend free (3k/month) or Zoho Mail Lite ~$1/user | 0–3 |
| Monitoring | Sentry free tier / Team $26; UptimeRobot free | 0–26 |
| Domain | `.in` or `.com`, amortised | 1–2 |
| **Total — minimum credible pilot** | Flex + Vercel Pro + free tiers | **~$30–35** |
| **Total — recommended pilot** | M10 + Vercel Pro + Sentry Team + mail + domain | **~$105–120** |

Excludes labour, GST/VAT, and any paid support. Costs scale with data volume and egress, not with the number of pilot users at this size.

---

## 6. Backup and recovery requirements

**Targets for the pilot:** RPO ≤ 15 minutes, RTO ≤ 4 hours, restore rehearsal before the first real buyer.

1. **Enable Atlas Cloud Backup with point-in-time recovery** on the production cluster; confirm the retention window in the console and record it.
2. **Snapshot schedule:** daily snapshot retained ≥ 7 days, plus the PITR window; keep one monthly snapshot for 90 days.
3. **Restore rehearsal (mandatory, before onboarding):** restore the latest snapshot to a *new* cluster, then verify — collection count, `organisations`, `users`, `products`, `enquiries`, `supplier_listings`, `audit_logs` row counts, one spot-check document, and that `_permission_guards` is present (C3: a missing guard document refuses guarded changes).
4. **Restore procedure:** freeze writes (maintenance page), restore to a new cluster, point `MONGODB_URI` at it, run `npm run db:status` and `npm run check:schema`, then re-open. Never restore over the live cluster.
5. **Access:** restore is an owner-identity action, logged; the runtime identity cannot drop or restore.
6. **Evidence:** record each rehearsal (date, snapshot id, counts, operator) in `docs/`. A backup that has never been restored is a hypothesis, not a control.
7. **Data-loss boundary:** MongoDB is the only application database. There is no second copy and no dual write; the backup is the only recovery path.

---

## 7. Controlled pilot checklist

**Pre-flight (all must be true)**
- [ ] B2 fixed; `npm run check:authz` → 0 failures; `npm run db:init -- --status` clean.
- [ ] Production build made with the real `NEXT_PUBLIC_APP_URL`; sitemap and canonical spot-checked.
- [ ] Atlas M10 with backups + PITR; restore rehearsed and recorded.
- [ ] `AUTH_SECRET` set (≥32 bytes, unique per environment); `db:check-role` proves the runtime identity is not the owner.
- [ ] First admin and first organisation created by the documented runbook, with an audit row.
- [ ] Error tracker, log drain and uptime alert live, pointing at a named person.
- [ ] B1 decided: public enquiry wired, or CTA copy changed and buyers onboarded by invitation.
- [ ] Pilot terms state: no uploads, no automated email, single instance, enquiries are not orders.
- [ ] Owner has accepted the residual risk in writing, with Workstream 6 still open.

**Day-one smoke (on the deployed instance)**
- [ ] `/api/health` → 200 `database: connected`.
- [ ] Public pages 200; `/admin`, `/buyer`, `/seller` redirect anonymously; `/api/*` 401/403.
- [ ] Buyer registers → enquiry → desk sees it → status change audited.
- [ ] Seller registers → refused until approved → listing → approval → separate publication.
- [ ] Second buyer cannot see the first buyer's enquiry.
- [ ] Mobile pass on a real phone: home, product, enquiry, sign-in.

**Daily during the pilot**
- [ ] Error rate and 5xx reviewed; `/api/health` history clean.
- [ ] `audit_logs` and `auth_events` reviewed for unexpected admin actions or repeated refusals.
- [ ] Snapshot taken and its timestamp recorded.

**Rollback**
- [ ] Previous build redeployable (immutable deployment id).
- [ ] Database restore path rehearsed (§6); maintenance page ready.
- [ ] Decision owner named; rollback triggers written down (data corruption, auth bypass, >1% 5xx for 15 min).

**Exit criteria**
- [ ] 10 real enquiries and 3 real listings handled end to end without manual database intervention.
- [ ] No P0/P1 incident open; restore rehearsal repeated after any schema change.

---

## 8. Commands run and results (this tree, 2026-11-05)

| Command | Result |
|---|---|
| `npm run typecheck` | PASS, 0 errors |
| `npm run lint` | PASS, 0 problems |
| `npm run build` | PASS, Next 15.5.28 |
| `npm run verify:phase1` | **13/13**, verdict `PHASE 1 VERIFIED LOCALLY` |
| `npm run verify:m5` | **32/32** |
| `node scripts/verify-m1..m4.mjs --group ALL` | **42 / 41 / 28 / 55**, 0 failed |
| `npm run check:seo` | 656 passed, 0 failed |
| `npm run check:routes` | 88 routes, 56 required, 175 files |
| `npm run check:migrations` | 74 passed |
| `npm run check:schema` | 61 passed |
| `npm run check:catalogue` | 55 passed |
| `npm run check:enums` | 40 passed |
| `npm run check:permissions` | 145 passed, 0 failed |
| `npm run check:adversarial` | 97 passed, 0 failed |
| `npm run check:authz` | **50 held, 6 gaps, 2 FAILED** (B2) |
| `npm run check:content` | 84 passed, **49 failed** (stale, B14) |
| `npm run check:wizard` | 88 passed, **12 failed** (stale admin section, B14) |
| `curl /api/health` | `{"status":"ok","database":"not_configured"}` |
| `curl /sitemap.xml` | 28 URLs, all `https://primemet.example` (B3) |
| `inspect_page /` at 1440 and 390 | no horizontal overflow; 2 tap targets <44 px; no console errors |
| `inspect_page /request-a-quote` at 390 | no horizontal overflow; 9 tap targets <44 px; preview banner and disabled submit (B1) |

---

## 9. What this audit does not establish

- No staging or production behaviour was observed; every "verified" row is local.
- No load, soak, failover or multi-instance test was run.
- Portal screens were not measured at mobile width (they require an authenticated session and a database).
- No penetration test, no dependency-vulnerability scan, no secret scan was run in this turn.
- **Workstream 6 remains OPEN — PENDING INDEPENDENT HUMAN REVIEW. Security acceptance is NOT GRANTED.** `docs/reviewer-package/` was not created, modified, re-run, re-checked or self-certified in this work, and nothing here should be read as a security sign-off.

---

## 10. GO / NO-GO

**Production: NO-GO.** Four P0 blockers (B1 public funnel, B2 migration privilege, B3 placeholder origin, plus the absence of any staging/production verification) and the missing operational controls (B5–B9) make a public launch unsafe.

**Controlled pilot: CONDITIONAL GO** — single instance, invitation-only, no uploads, manual notifications — once B2 and B3 are closed, B1 is decided, Atlas M10 with a rehearsed restore is live, monitoring alerts a named person, and the owner records acceptance of the residual risk with Workstream 6 still open.

**What would move the pilot to an unconditional GO:** a staging deployment exercised end to end, a shared rate-limit store, object storage with signed URLs, a mail channel, and independent security acceptance.

---

## 11. Owner decision (2026-11-05)

The owner accepted this M6 delivery with **Workstream 6 remaining OPEN**, as a separate status:

1. The M6 production-readiness audit is delivered (this document).
2. The Workstream 6 reviewer package remains DELIVERED at its original repository location, unchanged.
3. Independent human review remains PENDING.
4. Security acceptance remains **NOT GRANTED**.
5. The package must not be copied, relocated, refreshed, rewritten, republished or revalidated.
6. The session project root and repository configuration must not be changed solely to satisfy W6.
7. No self-certification and no waiver request.
8. M6 delivery and W6 security acceptance are tracked independently; PRIMEMET development continues independently of W6.

This does not alter the verdict in §10: production is **NO-GO**; a controlled pilot is **CONDITIONAL GO** once B2 and B3 are closed, B1 is decided, Atlas with a rehearsed restore is live, monitoring alerts a named person, and the owner records residual-risk acceptance.
