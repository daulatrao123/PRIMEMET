# PRIMEMET — P0 Staging Safety Remediation Plan

**Version:** 1 · **Prepared:** 2026-11-02 · **Status:** PLAN ONLY — nothing implemented
**Baseline commit:** `7863743` (branch `main`, 121 pre-existing changed/untracked paths — preserved)
**Scope:** plan only. No deployment, no production setting change, no migration run, no commit, no push.

Every finding below was measured in the file named, at the line named. Nothing is inferred from a checklist.

---

## 0. Measured defects (the three P0 failures, line by line)

### D1 — Automatic production database initialisation on push

`.github/workflows/db-init.yml`

| Line | Content | Consequence |
|---|---|---|
| 22–32 | `on: push: branches: [main] paths: [db/**, scripts/db-init.mjs, scripts/gen-mongo-enums.mjs, prisma/schema.prisma, package.json, package-lock.json, .github/workflows/db-init.yml]` | Any merge that touches a migration, the init script or `package.json` **applies migrations to the `production-database` environment with no human in the loop.** |
| 56 | `environment: production-database` | The only gate is a repository-settings convention (required reviewers on that environment). The workflow file itself does not require approval. |
| 69–70 / 88–99 | `npm ci` then `node scripts/db-init.mjs $ARGS` with `ARGS=""` for a push | A push performs a real **apply**, not a dry run: `--dry-run` is only added when the dispatch input `inputs.dry_run` is true. |
| 85–86, 91–92, 103–104, 110 | `MONGODB_URI: ${{ secrets.MONGODB_URI }}`, `MONGODB_DB: ${{ vars.MONGODB_DB \|\| 'primemet' }}` | The secret is read by name, not scoped by name; `MONGODB_DB` is an unencrypted repository **variable** with a production fallback. |

### D2 — Unsafe database-name fallback

| File:line | Content | Consequence |
|---|---|---|
| `scripts/db-init.mjs:73` | `const dbName = process.env.MONGODB_DB \|\| "primemet";` | A missing variable silently targets the production database name. |
| `src/lib/db.ts:82` | `return client.db(env.MONGODB_DB \|\| "primemet");` | The running application does the same, silently. |
| `src/lib/env.ts:54` | `MONGODB_DB: z.string().min(1).max(64).optional()` | The schema makes the variable optional, so nothing fails. |
| `.env.example:43–44` | `# Database name inside the cluster. Optional; defaults to "primemet".` | The fallback is documented as a feature. |

The two files agree only by accident. Nothing asserts that the process, the database name and the cluster belong to the same environment.

### D3 — Shared credentials between environments

| Evidence | Consequence |
|---|---|
| `db-init.yml:75,85,91,103` all read the single secret name `secrets.MONGODB_URI` | One credential name for every environment. If `MONGODB_URI` is also defined as a **repository** secret (the current documented path in `.env.example:27–41`), every workflow job in the repo — and any future preview/deploy job — can read production credentials. |
| `.env.example:33–38` — only two identities exist (`primemet_app`, `primemet_owner`) | No staging identity. A staging deployment must reuse one of the two, i.e. production credentials. |
| `db/provision-roles.mjs` — roles defined are exactly `primemet_owner` and `primemet_app` | Confirmed: there is no `primemet_staging_*` role anywhere in the tree. |
| `package.json` — `db:check-role` = `node db/provision-roles.mjs --check` | The identity check exists but **no workflow or script invokes it** (only `.github/workflows/` contains `db-init.yml` and `m2a-argon2-gate.yml`). |

**What is already correct and must not be broken:** `db-init.mjs:62–71` fails closed when `MONGODB_URI` is absent or malformed; `describeUri()` (56–60) redacts host and credentials; `db-init.mjs:176–185` never echoes a driver error; `src/lib/db.ts` does no work at import time, so `next build` still succeeds with no database.

---

## Phase 1 — Protect production

> **Gate:** items P1.1, P1.4 and P1.6 change production infrastructure or credentials. They are **not** to be implemented until the owner approves them explicitly. Items P1.2, P1.3 and P1.5 are code changes that make the system fail closed and can be prepared for review first.

### P1.1 — Remove the automatic apply path (owner approval required)

**File:** `.github/workflows/db-init.yml`

1. Delete the `push` block at lines 23–32. Keep `workflow_dispatch` (33–42) as the **only** trigger.
2. Add a read-only push job that can never write:
   - separate workflow `db-status.yml`, `on: push: branches: [main]`, single step
     `node scripts/db-init.mjs --status` and `node scripts/db-init.mjs --dry-run` only,
     with `permissions: contents: read` and **no** `environment:` and **no** apply step.
   - This preserves the useful signal ("does `main` have unapplied migrations?") without the write.
3. Keep `environment: production-database` on the dispatch workflow and keep `concurrency: mongodb-initialization` (45–47).
4. Add an explicit guard so a re-added trigger cannot apply silently:
   ```yaml
   - name: Refuse to apply outside an approved manual dispatch
     if: github.event_name != 'workflow_dispatch'
     run: |
       echo "::error::db-init applies migrations only via workflow_dispatch with environment approval."
       exit 1
   ```
5. Replace `${{ vars.MONGODB_DB || 'primemet' }}` at lines 86, 92, 104, 110 with `${{ vars.MONGODB_DB }}` — no fallback anywhere in the file.

**Acceptance:** AC-1, AC-5, AC-9 (below).

### P1.2 — Fail closed in the initialisation CLI

**File:** `scripts/db-init.mjs` (after line 71, before line 73)

1. Replace line 73 with a required read:
   ```js
   const dbName = process.env.MONGODB_DB;
   if (!dbName) fatal("MONGODB_DB is not set. Refusing to guess a database name. Nothing was changed.");
   ```
2. Add an environment declaration, required for every write mode (`apply`, `reconcile`), optional for `--status`/`--dry-run`/`--verify-only`:
   ```js
   const ENV_NAME = process.env.PRIMEMET_ENV;               // development | test | staging | production
   const WRITES  = !DRY_RUN && !VERIFY_ONLY && !STATUS_ONLY;
   if (WRITES && !["development","test","staging","production"].includes(ENV_NAME))
     fatal("PRIMEMET_ENV must be one of development|test|staging|production before writing.");
   ```
3. Add the cross-check that makes a staging migration unable to target production:
   ```js
   const PRODUCTION_DB = "primemet";
   if (ENV_NAME && ENV_NAME !== "production" && dbName === PRODUCTION_DB)
     fatal(`Refused: PRIMEMET_ENV=${ENV_NAME} with MONGODB_DB=${PRODUCTION_DB} (the production database).`);
   if (ENV_NAME === "production" && process.env.VERCEL_ENV === "preview")
     fatal("Refused: a preview deployment may never carry a production migration identity.");
   ```
4. Print `environment` in the 76–80 banner so every log line names the target environment next to the redacted URI and the database.

**Acceptance:** AC-2, AC-4, AC-7.

### P1.3 — Fail closed in the application

**Files:** `src/lib/env.ts`, `src/lib/db.ts`

1. `env.ts:54` — keep `MONGODB_DB` optional at the schema level (a build with no database must still succeed, `next.config.ts` + `db.ts` header comment), but add `PRIMEMET_ENV` to the schema and a refinement:
   ```ts
   .refine((v) => !v.MONGODB_URI || Boolean(v.MONGODB_DB),
     { message: "MONGODB_DB is required whenever MONGODB_URI is set.", path: ["MONGODB_DB"] })
   ```
2. `db.ts:82` — delete the fallback:
   ```ts
   const name = env.MONGODB_DB;
   if (!name) throw new DatabaseNotConfiguredError("MONGODB_DB is not configured; refusing to guess a database name.");
   return client.db(name);
   ```
   Keep `DatabaseNotConfiguredError` as the single typed failure so `/api/health` keeps returning a fixed `reason` without driver text.
3. Extend `DatabaseNotConfiguredError` to accept a reason string (currently fixed text at `db.ts:95–103`) — no behavioural change for the existing path.
4. `.env.example:43–44` — change "Optional; defaults to \"primemet\"" to **required with `MONGODB_URI`, no default**, and document `PRIMEMET_ENV`.

**Acceptance:** AC-3, AC-8.

### P1.4 — Separate credentials per environment (owner manual action)

1. New Atlas user `primemet_staging_app` in the **staging** project, `readWrite` on `primemet_staging` only.
2. New role in `db/provision-roles.mjs` mirroring `primemet_app`'s privilege set but scoped to the staging database, so `--apply` on the staging cluster produces it. No staging role may hold `primemet_owner`, `root` or `atlasAdmin` (`provision-roles.mjs:112` already fails on exactly those).
3. Secret placement (GitHub): `MONGODB_URI` exists **only** as an environment secret of `production-database`. Staging lives in a separate `staging-database` environment. No repository-level `MONGODB_URI` remains. `MONGODB_DB` becomes an environment variable per environment (`primemet` / `primemet_staging`).
4. Rotate the current shared credential after the split, so the old value cannot be re-used by a preview.
5. Wire `npm run db:check-role` into the deploy pipeline as a blocking step (it fails when the connected identity holds an owner role — `provision-roles.mjs:112`).

**Acceptance:** AC-6, AC-10.

### P1.5 — One place that decides the target

New file `scripts/db-guard.mjs`, used by both `db-init.mjs` and any future request-path check:

| Assertion | Fails when |
|---|---|
| `PRIMEMET_ENV` is set and known | unset or unknown |
| `MONGODB_DB` is set | missing |
| `PRIMEMET_ENV !== production` ⇒ `MONGODB_DB !== 'primemet'` | staging pointed at the production database |
| `VERCEL_ENV === 'preview'` ⇒ `PRIMEMET_ENV !== production` | preview holding production identity |
| host allow-list per environment (optional, once clusters exist) | staging URI pointing at the production cluster host |

Exposed as `npm run db:guard` and called as the first statement of `db-init.mjs`'s write path, so the CLI and CI obey the same rule instead of two copies of it.

**Acceptance:** AC-4, AC-7, AC-11.

### P1.6 — Vercel environment configuration (owner manual action)

| Setting | Value | Why |
|---|---|---|
| Production scope | `MONGODB_URI` = production app user; `MONGODB_DB=primemet`; `PRIMEMET_ENV=production` | Explicit, not fallback |
| Preview scope | **no** production variables; staging cluster URI + `MONGODB_DB=primemet_staging` + `PRIMEMET_ENV=staging` | Condition 2 of the staging review |
| Development scope | local only | — |
| Deployment Protection | **Standard Protection** (Vercel Authentication) on Preview and Production-preview aliases | Condition 3 |
| `NEXT_PUBLIC_APP_URL` | preview value must be a non-production https origin | `next.config.ts` validates only that it is not loopback — a preview must not advertise the production canonical origin |

**Acceptance:** AC-12.

---

## Phase 2 — Staging isolation

| Item | Setting | Note |
|---|---|---|
| Cluster | **separate Atlas project** (not merely a second database in the production project) | A shared project means a shared network allow-list and shared project-level API keys. If a separate project is refused, a separate cluster with an IP allow-list restricted to Vercel egress is the minimum. |
| Database | `primemet_staging` | Never `primemet` |
| Identity | `primemet_staging_app`, `readWrite` on `primemet_staging` only | Cannot read production collections even if it obtains the production host |
| Migration identity | `primemet_staging_migrator` (or owner scoped to the staging project) | Exists only in the staging environment; `db:init` on staging uses it |
| Vercel | Preview scope only, Deployment Protection on | No public staging URL until application auth exists (finding L6 — every portal URL currently answers 200 anonymously) |
| Test accounts | `scripts/seed-staging-accounts.mjs`, refuses to run unless `PRIMEMET_ENV=staging` **and** `MONGODB_DB=primemet_staging` | Named, synthetic, documented in the checklist; no production data copies |
| Backup | Continuous backup + PITR on the staging cluster; restore tested into a **new** cluster | Matches checklist §8; rollback is restore, not revert (migrations are forward-only) |

**No production data or credentials may be used.** A staging seed must be synthetic; copying production documents into staging is prohibited.

---

## Phase 3 — Verification (six required proofs)

Each test must fail loudly today and pass only after the matching Phase 1/2 item exists. Proposed file per test; none is written yet.

| # | Proof | Test | Pass condition | Today |
|---|---|---|---|---|
| T1 | Staging credentials cannot access production | `scripts/check-db-isolation.mjs` — connect with the staging URI, then `db("primemet").command({ listCollections: 1 })` and an insert into `_isolation_probe` | Both are **denied** by the server; script exits 0 only on denial, 1 on success | Impossible — no staging identity exists |
| T2 | Production credentials cannot leak into a preview build | `NEXT_PUBLIC_APP_URL=… npm run build` with the Preview env only, then `grep -r` the build output for the cluster host and `mongodb+srv` | 0 matches; `NEXT_PUBLIC_*` count stays 1 | Would pass today, but the assumption is untested because the secret placement is manual |
| T3 | Missing database configuration fails startup | `MONGODB_URI` unset → `/api/health` non-200 with a fixed reason; `MONGODB_URI` set, `MONGODB_DB` unset → the server refuses (`DatabaseNotConfiguredError`), never opens `primemet` | Non-200 in both cases; a connection attempt to `primemet` is observable as zero in Atlas metrics | **Fails** — `db.ts:82` silently opens `primemet` |
| T4 | A staging migration cannot target production | `PRIMEMET_ENV=staging MONGODB_DB=primemet node scripts/db-init.mjs --dry-run` | Exit 1 with the refusal message; nothing written | **Fails** — no guard exists (`db-init.mjs:73`) |
| T5 | A push to `main` cannot initialise or migrate production | Static assertion over `.github/workflows/*.yml`: no workflow with `on: push` may contain a step that runs `db-init.mjs` without `--status`/`--dry-run`; plus a CI job that greps for it | Assertion passes; a deliberately added apply step fails CI | **Fails** — `db-init.yml:22–32` |
| T6 | Unauthenticated preview access is blocked | `curl -s -o /dev/null -w '%{http_code}' https://<preview-url>/admin/dashboard` | `401` / `403` from Deployment Protection | Not measurable — no preview exists; and application-level auth is absent (35 portal URLs return 200) |

T6 must be read precisely: Deployment Protection is a platform control, not application authorisation. **Finding L6 (no authentication in any portal) is a separate P0** and is not closed by this plan; a staging URL must therefore stay protected at the platform edge.

---

## Acceptance criteria

| ID | Criterion | Verified by |
|---|---|---|
| AC-1 | No workflow applies migrations on `push`; `db-init.yml` applies only under `workflow_dispatch` with `environment: production-database` | T5 |
| AC-2 | `db-init.mjs` exits 1 when `MONGODB_DB` is unset, before opening a connection | T3/T4 |
| AC-3 | `src/lib/db.ts` never derives a database name; no `"primemet"` literal remains in `src/` | `grep -rn '"primemet"' src/` → 0 |
| AC-4 | `PRIMEMET_ENV=staging` + `MONGODB_DB=primemet` is refused on both the CLI and the app | T4 |
| AC-5 | No `vars.MONGODB_DB \|\| 'primemet'` expression remains in `.github/workflows/` | `grep -rn "MONGODB_DB ||" .github/` → 0 |
| AC-6 | Production `MONGODB_URI` is either absent or restricted to the `production-database` environment; no repository-level value | GitHub settings review, recorded in the checklist |
| AC-7 | A preview deployment with `VERCEL_ENV=preview` cannot obtain a production migration identity | T2 + P1.2 guard |
| AC-8 | Application with `MONGODB_URI` and no `MONGODB_DB` refuses to serve data, and says why in the log without echoing the URI | T3 |
| AC-9 | A push to `main` touching `db/**` performs at most `--status` and `--dry-run` | T5 |
| AC-10 | `npm run db:check-role` runs in the deploy path and fails the deploy on an owner identity | Pipeline log |
| AC-11 | `npm run db:guard` is the single source of the target rule and is called by `db-init.mjs` | Code review + T4 |
| AC-12 | Preview scope holds no production variable; Deployment Protection is on; preview `NEXT_PUBLIC_APP_URL` is not the production origin | Vercel settings review |
| AC-13 | Staging cluster is a separate Atlas project (or a separate cluster with a separate allow-list) and `primemet_staging` exists | Atlas console |
| AC-14 | Staging app identity holds `readWrite` on `primemet_staging` only and is denied on `primemet` | T1 |
| AC-15 | Backup/PITR enabled on staging; one restore into a new cluster performed and timed | Checklist §8 |

---

## Manual actions required from the owner

These cannot be done from the repository and are **not** performed by this plan.

| # | Action | Why it needs you |
|---|---|---|
| M1 | **Approve or reject P1.1** (deleting the `push` apply trigger) | It changes production CI behaviour. The plan does not touch it without this approval. |
| M2 | Create the staging Atlas project/cluster and the `primemet_staging` database | Console access |
| M3 | Create `primemet_staging_app` and the staging migration identity; record the URIs in a password manager | Credentials never enter the repository or this conversation |
| M4 | Decide whether the **current shared `MONGODB_URI` is rotated** after the split | Rotation invalidates anything using the old value — a deliberate, dated decision |
| M5 | Move `MONGODB_URI` to the `production-database` environment secret; delete the repository-level one; add `staging-database` | GitHub repository settings |
| M6 | Configure Vercel Production/Preview/Development scopes and enable Deployment Protection | Vercel dashboard |
| M7 | Enable required reviewers on `production-database` **and** `staging-database` | GitHub environment protection rules |
| M8 | Enable continuous backup + PITR on staging, and authorise one restore drill | Atlas billing + operational risk |
| M9 | Approve O-27.7 (hosting: provider, region, project name), still unapproved | Decisions log |
| M10 | Confirm the staging test-account identities (names, roles, who owns them) | Business decision |

---

## Sequencing and cost

| Step | Depends on | Repository change? |
|---|---|---|
| 1. P1.2 + P1.3 + P1.5 (fail closed) | nothing | yes — 3 files, reviewable today |
| 2. P1.1 (remove push apply) | M1 | yes — workflow |
| 3. Phase 2 provisioning | M2–M8 | no |
| 4. P1.4 secret split + rotation | M3–M5 | no |
| 5. P1.6 Vercel scoping | M6 | no |
| 6. Phase 3 tests T1–T6 | steps 1–5 | yes — 2 new scripts |
| 7. Re-run the 8-condition staging review | everything above | no |

Step 1 can be implemented and reviewed immediately and is the only step that makes the system safer with no infrastructure decision. Steps 2–6 are blocked on the owner actions above.

---

## What this plan explicitly does not do

- It does not deploy, promote, stage, commit or push anything.
- It does not modify `.github/workflows/db-init.yml` or any production setting.
- It does not run a migration, against any environment.
- It does not close finding **L6** (no authentication) or **B2** (no organisation isolation). A staging URL remains unsafe for public access after this plan; it is safe only behind Deployment Protection.
- It does not resolve **W2-s** or **W3** (blocked on migration `v006` and a fourth role) or the Workstream 6 independent review, which stays **BLOCKED — PENDING EXTERNAL REVIEW**.