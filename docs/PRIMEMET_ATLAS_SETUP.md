# PRIMEMET — MongoDB Atlas Setup Preparation

Status: **preparation only.** No cluster exists, nothing was initialized, no credential was created,
nothing was committed or pushed. This document is the runbook to execute *after* approval.

Verification date: **2026-11-01 (UTC).** External claims are marked with their source; anything I could
not read from an official page today is marked `[unverified]`.

Companion documents: `docs/PRIMEMET_MONGODB_MIGRATION_PLAN.md` (why the schema looks like this),
`db/README.md` (the commands), `docs/PRIMEMET_STAGE_2_ARCHITECTURE.md` §30 (hosting comparison).

---

## 1. What exists in the repository today

| Thing | State | Evidence |
|---|---|---|
| 45 collection definitions + ledger | present, offline-validated | `db/collections/index.mjs`, `npm run db:validate:offline` → 539 checks |
| Migration registry | one version, `v001_initial_collections` | `db/migrations/index.mjs` |
| Least-privilege roles | defined as data | `db/roles.mjs` → `primemet_owner`, `primemet_app`, `primemet_readonly` |
| Role provisioning procedure | implemented | `db/provision-roles.mjs` (`npm run db:provision`) |
| Initialization CLI | implemented, read-only modes proven | `scripts/db-init.mjs` |
| CI workflow | implemented, gated | `.github/workflows/db-init.yml` |
| Application connection | lazy, optional, bounded | `src/lib/db.ts`, `src/lib/env.ts` |
| An actual Atlas project / cluster / user / secret | **does not exist** | owner action, this document |

The application runs and builds with **no** `MONGODB_URI`; `/api/health` reports
`"database": "not_configured"`. Setting up Atlas is therefore additive — it cannot break what is
already working.

---

## 2. Cluster — exact Atlas UI navigation

**Atlas UI path:** `https://cloud.mongodb.com` → sign in → select Organization → select (or create)
Project `primemet-production` → **Build a Database**.

| Setting | Value | Why this value |
|---|---|---|
| Cloud provider | **AWS** | Supabase was the earlier recommendation (§30.9) for PostgreSQL; the persistence layer has since moved to MongoDB, and Atlas on AWS Mumbai is the verified India option below. |
| Region | **Mumbai — AWS `ap-south-1` / Atlas region `AP_SOUTH_1`** | Verified: the Atlas AWS region table lists `ap-south-1` "Mumbai, India" with Atlas Region `AP_SOUTH_1`. <br>Source: https://www.mongodb.com/docs/atlas/reference/amazon-aws/ (retrieved 2026-11-01) |
| Tier | **dedicated, M10 or above** | A transactional, indexed workload with majority writes needs a dedicated cluster. Custom database roles are required by this design and provisioning fails where they are unavailable. <br>Source: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/ (retrieved 2026-11-01) — see the correction in §3 on the "M10+ only" claim. |
| Replication | **3-node replica set (default)** | The SRV connection string and majority write concern assume a replica set; the suites were run against a real replica set, not standalone. |
| Name | `primemet-m1` | Anything readable; it appears inside the SRV host. |
| Project database name | `primemet` | `MONGODB_DB` default in `src/lib/env.ts`, `src/lib/db.ts` and `scripts/db-init.mjs`. |

**Do not choose a free tier for production.** The whole least-privilege model depends on custom roles;
on a free/shared tier `npm run db:provision -- --apply` will fail because `createRole` is unavailable.

**Correction (Task A recheck).** That custom database roles are available *only* on dedicated clusters
(M10+) could **not** be established from the cited page during this review, so it is recorded as an
assumption, not a verified fact. What matters operationally is unchanged: if a tier cannot host custom
roles, provisioning fails at `createRole`. Confirm role availability on the intended tier in the Atlas UI
before committing to a plan. This revises the justification, not the recommendation — a transactional,
indexed workload needs a dedicated cluster regardless.
A free cluster may still be used for a throwaway dry-run **only if** roles are provisioned there too —
which they cannot be, so treat "free tier" as unsuitable for any step of this runbook.

**Cost note.** Dedicated pricing starts at the M10 tier and scales upward; per-hour rates change and
must be read from `https://www.mongodb.com/pricing` at purchase time rather than copied from here.
Mark the monthly figure as **requiring a provider quotation** until the calculator is run for the chosen
tier, storage and backup options. Do not budget from a number quoted in a document.

**Region choice, stated plainly:** Mumbai satisfies the India-residency preference recorded as decision
O-27.7, which is **still pending project-owner approval**. Selecting a region in this document is a
recommendation, not an approval.

---

## 3. Network access — add these before creating users

**Atlas UI path:** `Security → Network Access → Add IP Access List`.
Up to 200 entries per project; each entry is a single IPv4/IPv6 address or a CIDR range.
Source: https://www.mongodb.com/docs/atlas/security/ip-access-list/ (retrieved 2026-11-01)

| Entry | Needed by | Scope | Note |
|---|---|---|---|
| Your workstation's public IPv4 as `/32` | local `db:provision`, `db:init --dry-run`, incident work | temporary | Find it with any IP lookup service; home/office IPs change, which is why a lost connection is first checked here. |
| GitHub Actions runner addresses | the `db:init` workflow | **prefer OIDC over an IP allowlist** | GitHub publishes egress ranges that rotate (`_runner` / `_GHES` sets); pinning them is fragile. Use OIDC federation for the workflow instead of an IP entry, or accept a documented, reviewed range. Do **not** open `0.0.0.0/0` for CI. |
| Vercel egress | the running application | **static outbound IPs, or Private Link** | Vercel serverless functions do **not** have a fixed egress IP by default. Options: (a) enable **Static Outbound IPs** on the project and allowlist exactly those addresses, (b) use VPC Peering / AWS PrivateLink so no public IP is exposed, or (c) temporarily allow `0.0.0.0/0` **only** to prove connectivity, then replace it. The exact feature name, plan availability and current list must be read from `https://vercel.com/docs` before enabling — I could not retrieve it during this preparation, so it is `[unverified]`. |

**Why the access list is broadened at all:** MongoDB Atlas accepts connections *only* from listed
entries, so without one of the above the app simply times out. Each widening is a deliberate,
documented trade-off; `0.0.0.0/0` plus a strong password is weaker than either alternative and should
be a temporary diagnostic state with a removal deadline, never the resting configuration.

**Temporary entries:** Atlas supports expiring access-list entries (up to a 7-day window). Use them for
incident work instead of permanent `/32`s for visitors. Source: same page as above.

---

## 4. Roles — provision before creating users

Roles are **data** in `db/roles.mjs`; the procedure that applies them is `db/provision-roles.mjs`.
Run it with an administrative connection (the initial Atlas user you create), not with the app identity.

```bash
# 1. Print the plan. Changes nothing, needs no credentials.
npm run db:provision

# 2. Apply it. Requires MONGODB_URI pointing at an ADMIN-capable user.
MONGODB_URI="<admin SRV uri>" MONGODB_DB=primemet npm run db:provision -- --apply
```

Behaviour: `createRole`, falling back to `updateRole` when the role already exists (error code 51002),
so re-running converges instead of failing. It refuses to run if `auditRoleDefinitions()` reports any
problem — the separation is asserted before it is written to a cluster.

### The three roles, exactly as defined

| Role | Privileges | Where it is used |
|---|---|---|
| `primemet_owner` | db-wide `find, insert, update, createCollection, collMod, createIndex, listCollections, listIndexes`; ledger `find, insert, update`; `system.js` `find` | **GitHub Actions secret only.** Never deployed. |
| `primemet_app` | db-wide `find`; `find,insert,update,delete` on the 38 mutable collections; **`find,insert` only** on the 7 append-only collections; ledger `find` only | **Vercel.** The only identity the application ever sees. |
| `primemet_readonly` | db-wide `find` | reporting / verification; optional at setup time |

The append-only set enforced by privilege:
`admin_permission_grants`, `audit_log_failures`, `audit_logs`, `auth_events`, `document_access_logs`,
`material_alias_equivalence_decisions`, `material_alias_verifications`.

No role grants `dropCollection`, `dropIndex` or `dropDatabase`. Destructive verbs do not exist anywhere
in `db/` — that is asserted by tests, not by convention.

### Atlas UI path for binding a role to a user

`Data Access → Connect → Create New Database User → Specific Role(s)` does **not** list custom roles.
To bind one: **`Project Settings → Database Users → <user> → Edit → Specific Role(s) → Custom Role`**,
then choose the role and scope it to the database `primemet`. Verify after saving that the user shows
the custom role and **not** `readWriteAnyDatabase`.

**Three roles exist; two users are required.** `db/roles.mjs` defines `primemet_app`, `primemet_owner`
and `primemet_readonly`, and `buildRoleDefinitions()` provisions all three — but only the first two need
an Atlas *user* at setup time. `primemet_readonly` stays unbound until a reporting consumer exists:
creating a user for it now would add a credential with no owner.

---

## 5. Database users — two identities, deliberately different

**Atlas UI path:** `Security → Database Access → Add New Database User`.
Authentication method: **SCRAM** (username/password). Password: generate, store in the secret manager,
never paste into a chat, ticket or commit.

| # | User | Role binding | Connection goes to | Notes |
|---|---|---|---|---|
| 1 | `primemet_admin` *(temporary)* | built-in `atlasAdmin` or `clusterAdmin` | your workstation, only long enough to run `db:provision --apply` | Delete or disable once roles exist. This is the shortest-lived high-privilege credential in the system. |
| 2 | `primemet_owner` | custom role `primemet_owner` | **GitHub Actions secret `MONGODB_URI`** | Initialization and structural change. Must never appear in Vercel. |
| 3 | `primemet_app` | custom role `primemet_app` | **Vercel environment variable `MONGODB_URI`** | Runtime identity. Cannot create a collection, change a validator, write the ledger, or update/delete history. |

Optional later: a `primemet_readonly` user for BI/reporting.

### Which URI goes where

Both strings come from `Database → <cluster> → Connect → Drivers`. Use the **SRV** form and append the
database name and options:

```
mongodb+srv://<user>:<password>@<cluster-srv-host>/primemet?retryWrites=true&w=majority&appName=<cluster>
```

| Destination | Variable | Whose credential | Reason |
|---|---|---|---|
| GitHub → repo → **Secrets and variables → Actions → Repository secret** | `MONGODB_URI` | **`primemet_owner`** | Only the workflow writes collections, validators, indexes and the ledger. |
| Vercel → project → **Settings → Environment Variables** | `MONGODB_URI` | **`primemet_app`** | The request path reads and writes business documents and must be structurally incapable of schema change. |
| Both places | `MONGODB_DB` | value `primemet` (plain variable, not a secret) | **Required** whenever `MONGODB_URI` is set; there is no default (a missing value used to fall back to `primemet`). Pair it with `PRIMEMET_ENV=production`. |
| Vercel only | `NEXT_PUBLIC_APP_URL` = `https://primemet.in` | public | Production builds **fail** without it (`next.config.ts` → `resolveSiteUrl`). |

**Never put the owner URI in Vercel, never put the app URI in the workflow secret.** That single swap is
what the split exists to prevent, and `npm run db:check-role` is the tool that proves it.

Note: `src/lib/env.ts` also accepts `DATABASE_URL` / `DIRECT_URL` but marks them deprecated and the
application does not read them; do not populate them.

---

## 6. GitHub protected environment `production-database`

The workflow declares `environment: production-database` on its only job. Declaring it is **not** the
control — the control is configured in the repository.

**Path:** `github.com/<owner>/primemet → Settings → Environments → production-database`.

| Setting | Required value | Effect |
|---|---|---|
| Environment name | `production-database` (exact match) | The workflow fails closed if the environment does not exist. |
| **Deployment protection rules → Required reviewers** | at least one named human approver | A run pauses until that person approves it. Without this, "approved push to main" is just a branch name. |
| Wait timer | `0` | Do not let a timer auto-approve in place of a reviewer. |
| **Secrets → `MONGODB_URI`** | owner credential | Environment secret preferred over a repository secret, so only this environment can read it. |
| **Variables → `MONGODB_DB`** | `primemet` | The workflow falls back to `primemet` via `vars.MONGODB_DB \|\| 'primemet'`. |
| Branch policy (optional) | `main` only | Belt-and-braces alongside the trigger filter. |

Facts about the workflow worth knowing before you approve a run (all read from
`.github/workflows/db-init.yml`):

- Triggers: `push` to `main` **filtered to** `db/**`, `scripts/db-init.mjs`, `scripts/gen-mongo-enums.mjs`,
  `prisma/schema.prisma`, `package.json`, `package-lock.json`, and the workflow file itself; plus
  `workflow_dispatch`.
- `concurrency.group: mongodb-initialization`, `cancel-in-progress: false` — two initializations cannot
  race, and a running one is never killed mid-write.
- `permissions: contents: read` — no write access to the repository.
- Steps in order: checkout → Node 22 → `npm ci` → assert `MONGODB_URI` is present (value withheld) →
  `--status` (reads the ledger **before** writing anything) → apply (or `--dry-run` / `--reconcile` from
  the dispatch inputs) → `--verify-only` unless it was a dry run → write a step summary.
- `timeout-minutes: 15`.
- Verification failure **fails the job**: an initialization that cannot prove its own result is red.
- The workflow is the only thing that creates collections. **Vercel deployments have no initialization
  code path**, so ordinary deploys cannot create, reset or drop anything. Keep it that way: do not add a
  `postinstall`/build hook that connects to the database.

---

## 7. Dry-run procedure and expected output

Run these **in order**, stopping at the first failure. All commands need `MONGODB_URI` in the
environment; none of the first four writes anything.

```bash
# A. Identity check — proves the connected user is NOT an owner/admin identity.
MONGODB_URI="<app-user uri>" npm run db:check-role
#   expect: "✔ the connected identity is not an owner role (roles: primemet_app)"
#   If it prints primemet_owner / root / atlasAdmin → STOP. Wrong credential.

# B. Offline definition validation — no network, no database.
npm run db:validate:offline
#   expect: 539 passed, 0 failed

# C. Ledger status on the virgin cluster — creates nothing.
MONGODB_URI="<owner uri>" MONGODB_DB=primemet node scripts/db-init.mjs --status
#   expect: mode status; "Ledger: (empty — nothing has been applied)";
#           "Declared schema: matches the applied migrations.";
#           "Collections present: 0/45"

# D. Dry run — reports what would be applied, writes nothing.
MONGODB_URI="<owner uri>" MONGODB_DB=primemet node scripts/db-init.mjs --dry-run
#   expect: "Migrations: 0 applied, 0 skipped, 1 would-apply, 1 total."
#           "Dry run: nothing was written. Re-run without --dry-run to apply."
#           exit code 0

# E. Confirm C and D really changed nothing: re-run C and compare.
MONGODB_URI="<owner uri>" MONGODB_DB=primemet node scripts/db-init.mjs --status
#   expect: identical to the first --status: empty ledger, 0/45 collections.
```

Then, **only after explicit approval**, the real initialization:

```bash
# F. Apply + self-verify (this is what the workflow does).
MONGODB_URI="<owner uri>" MONGODB_DB=primemet node scripts/db-init.mjs
#   expect: "Migrations: 1 applied, 0 skipped, 0 would-apply, 1 total."
#           "Verification: <N> passed, 0 failed."
#           "Ledger: 1 version(s) recorded; 45/45 collections present."
#           "✔ Database initialized and verified."

# G. Prove idempotency: run F again.
#   expect: "Migrations: 0 applied, 1 skipped, 0 would-apply, 1 total." then ✔ again.

# H. Prove the deployed runtime identity works and is limited.
MONGODB_URI="<app-user uri>" ...   # deploy Vercel, then:
curl -s https://primemet.in/api/health
#   expect: {"status":"ok","database":"connected",...}

# I. Prove the app cannot do structural work (run as primemet_app):
#   - createCollection  → unauthorized
#   - collMod           → unauthorized
#   - update on audit_logs → unauthorized
#   - insert on audit_logs → allowed
```

Steps F–I are **not** part of this preparation and must not be executed until you approve them.

---

## 8. Testing TLS, SCRAM, role enforcement and transactions on the real cluster

These are the four things the local suites could not prove. Each has a concrete test.

| Concern | How to test it on Atlas | Pass criterion |
|---|---|---|
| **TLS** | Connect with the SRV string as-is (driver defaults to TLS on Atlas). Then attempt a connection with `tls=false`. | First succeeds; second is refused. Confirms transport encryption is mandatory, not incidental. |
| **SCRAM auth** | Connect with a wrong password; connect with the correct one. | Wrong password → `AuthenticationFailed`, not a silent fallback. |
| **DNS SRV resolution** | `nslookup -type=SRV _mongodb._tcp.<cluster-srv-host>` | Records resolve; otherwise the network access list or the host string is wrong. |
| **Role enforcement** | With `primemet_app`: `createCollection`, `collMod`, `createIndex`, `update` on `audit_logs`, `delete` on `material_alias_verifications`, `insert` on `_schema_migrations`. | Every one refused; `insert` on a business collection allowed. Run `npm run db:check-role` first to confirm you are not accidentally testing as owner. |
| **Transactions** | Open a session and run a two-operation transaction against a replica set. | Commits. (Local suites exercised `withTransaction` on a community replica set; Atlas adds its own proxy/routing layer.) |
| **Connection pooling under Vercel** | Deploy, then hit `/api/health` 50× from cold start and watch Atlas → Metrics → Connections. | Connection count plateaus near concurrency × pool size and returns to idle; no `too many connections` errors. Raise `maxPoolSize` only if measured, not guessed. |
| **Latency (India residency value)** | From a Mumbai-region client, measure p50/p95/p99 of a trivial `ping` and of one indexed query, pooled vs direct. | Recorded numbers, not assumptions. No latency figure is claimed in this document. |
| **Backup / PITR** | Enable backups, take a snapshot, restore to a *new* cluster, verify counts and one spot-check query. | Restored cluster verifies `45/45` and the expected row counts. Test before you need it. |

`[unverified]` items above have never been executed against Atlas by anyone in this project; they are
procedures, not results.

---

## 9. Security checklist before going live

- [ ] `primemet_admin` deleted or disabled after roles are provisioned.
- [ ] No credential in a file that Git tracks. `.gitignore` excludes `.env*` except `.env.example`.
- [ ] Owner URI exists **only** as a GitHub environment secret.
- [ ] App URI exists **only** as a Vercel environment variable, marked sensitive.
- [ ] `npm run db:check-role` passes against the deployed Vercel environment.
- [ ] Access list contains no `0.0.0.0/0` (or such an entry carries a dated removal note).
- [ ] Alerts configured: cluster availability, disk, and (if enabled) audit events.
- [ ] Backups enabled and a restore rehearsed.
- [ ] Rotation plan recorded for both passwords and the admin account.
- [ ] No build/deploy hook touches the database.

---

## 10. Remaining risks and manual actions

**Manual actions (owner):** create project and cluster → network entries → temp admin user →
`db:provision --apply` → two users → bind custom roles → GitHub environment + secret + reviewers →
Vercel env vars → dry-run → **approval** → initialize → health check → delete temp admin.

**Risks that survive this runbook:**

1. **Custom roles require M10+.** A free-tier experiment will fail at `db:provision`; budget accordingly
   and get a quotation from the pricing page rather than from this document.
2. **Vercel egress is dynamic.** Until Static IPs or Private Link is confirmed, either the app cannot
   reach Atlas or the access list is too wide. This is the most likely cause of a failed go-live. Exact
   Vercel feature naming is `[unverified]` here.
3. **Append-only history depends on the binding, not the code.** If the Atlas user ends up with
   `readWrite` instead of `primemet_app`, history becomes mutable at the database level and nothing in
   the repository notices. Step A in §7 is the guard.
4. **Referential integrity and D-1 equivalence approval are application/detection controls** on MongoDB,
   unlike the PostgreSQL triggers. A direct write with owner credentials can forge a verified alias;
   reconciliation detects it. Keep owner credentials scarce.
   **A structural weakening specific to MongoDB, found while preparing this runbook:** `scrap_grades.code`
   carries a unique index but is *optional* in the collection validator, so a document may omit `code`
   entirely — and MongoDB treats every missing field as equal for uniqueness, so only **one** codeless
   grade can ever exist; the second insert fails with a duplicate-key error on `ix_scrap_grades_code_u`.
   The same shape applies to any optional uniquely-indexed field (`products.partNumber`,
   `organisations.gstin`/`pan`). It does not affect initialization, but it will surprise whoever creates
   the first two uncoded grades. Fix belongs in a new migration version (make `code` required, or make
   the index partial on `$type: "string"`) — **not** an edit to an applied migration, which §7's drift
   check rightly refuses.
5. **Decimal scale (2/3/4 dp) is a write-path rule**, not a database constraint.
6. **Tax-rule overlap** is guarded in `db/tax.mjs` with a unique index for the exact-scope case; range
   overlap is not database-enforceable.
7. **Nothing here authorizes Phase 2 tables** (enquiries, lots, orders, invoices, SEO pages, cities).
   Those do not exist in the 45 collections and need their own migration versions.
8. **Decision O-27.7 (hosting provider + region) remains formally unapproved.** This document prepares
   the path; it does not grant it.

---

## 11. Explicit non-actions taken while preparing this document

No Atlas project, cluster, user, role, API key or network entry was created. No command in §5–§7 was
executed against any remote system. No migration ran. No `MONGODB_URI` value exists anywhere in the
repository. Nothing was committed, pushed, released or deployed. The only external pages read were the
three MongoDB documentation URLs cited above.
