# PRIMEMET — D9 Task 1: PostgreSQL staging foundation

**Provisioning specification and owner action list — the pre-infrastructure gate.**
Prepared 2026-11-03. Status: **SPECIFICATION ONLY. NOTHING PROVISIONED.**

| Item | Value |
|---|---|
| Decision | **D9 approved** — PostgreSQL + Prisma as the single system of record; MongoDB freeze-then-retire |
| This document | Task 1 scope, resource configuration, identities, migration checks, CI, costs, owner actions, acceptance criteria |
| Infrastructure created | **None.** No account, project, database, role, secret, workflow run or connection |
| Repository state at time of writing | branch `main`, HEAD `7863743`, 126 changed paths, **0 staged** |
| Actions taken on the repository | **None** except adding this file (untracked). No commit, no push, no deploy |
| Workstream 6 | Package **DELIVERED** / independent review **PENDING SEPARATE ENGINEER** / security acceptance **NOT GRANTED** — unchanged by this document |

**The gate:** nothing in section 7 happens until the owner approves **D9-a** (section 7, action A1). The agent
creates no cloud resource, receives no credential and opens no connection.

---

## 1. Task 1 scope, and the exact stop line

Task 1 has four deliverables, and only these:

| # | Deliverable | Proof it is done |
|---|---|---|
| T1.1 | An isolated staging PostgreSQL environment | Project exists with the attributes in §2; `prisma migrate deploy` applies 7/7 migrations |
| T1.2 | Two database identities, `primemet_owner` and `primemet_app` | The assertion SQL in §3.5 returns only its expected values; the negative tests in §3.6 all fail closed |
| T1.3 | Prisma migration checks | `db:drift`, `db:migrate:check`, `db:migrate:status` in §4 pass locally and in CI |
| T1.4 | CI verification | The jobs in §5 are green on a pull request, and job A goes red when `schema.prisma` changes without a migration |

**Not in Task 1** (and not started): RLS policies and organisation-level isolation (Task 2), the application
write path, any `@prisma/client` usage in `src/`, authentication, seeding business data, MongoDB retirement,
a production project, any deployment.

**Standing prohibitions, restated because they are binding on every step below:** no staging, commit, push or
deploy; no migration of production data (there is none, and none will be created); no MongoDB file is edited,
and `db/`, `db/migrations/` and the `_schema_migrations` ledger stay untouched.

---

## 2. Resource configuration — exact

### 2.1 The one shape being requested

| Attribute | Value | Why this value |
|---|---|---|
| Provider | **Supabase** (managed PostgreSQL, dedicated instance per project) | The project's own research selected it: `docs/PRIMEMET_STAGE_2_ARCHITECTURE.md` §30.9 — the only option with a *verified* Mumbai region, managed daily backups, a documented pooler and no DBA on the team |
| Product / plan | **Supabase Pro** | Pro is the first plan with daily backups, no 7-day idle pause, and network restrictions. Free pauses after 1 week of inactivity and keeps no daily backups — a staging project that pauses cannot be verified on demand |
| Project name | `primemet-staging` | Distinguishable from the future production project; the name appears in pooler usernames |
| Organisation | the owner's PRIMEMET organisation (create it if absent) | Billing and access boundary |
| **Region** | **`ap-south-1` (Mumbai)** | Fixed at creation; changing it later is a migration, not a setting. Matches §30.9 and the `primemet.in` market |
| PostgreSQL major version | **17 — select it explicitly at project creation** | The committed migrations are proven against PostgreSQL 17 (PGlite, `npm run check:schema`). If the dashboard's default is newer and 17 is not offered, stop and report before creating anything: a different major makes the CI proof and the staging proof incomparable |
| Compute | **Micro** (1 GB RAM, shared) to start | The M1 footprint is 47 tables and reference seeds; no business rows. Escalate to Small only if `migrate deploy` is resource-starved |
| Database name | `postgres` (provider default) | Renaming adds a variable and buys nothing |
| Schema | `public` | Migration 1 already runs `CREATE SCHEMA IF NOT EXISTS "public"` |
| Disk | 8 GB included | M1 data is kilobytes; 8 GB is the plan floor |
| Backups | **Daily, 7-day retention** (included in Pro) | Operational recovery for a staging environment |
| Point-in-time recovery | **Not enabled** | The add-on is priced per compute size and is *not published*; it needs a provider quotation. Not a Task 1 requirement |
| High availability | **Not enabled** | No SLA exists yet; a single instance is the documented assumption (§30.6) |
| TLS | **Required** — `sslmode=require` on every connection string | Credentials cross the public internet from CI |
| Network restrictions | Owner IP allowlisted; **no `0.0.0.0/0`** | See §7 A5 for the CI trade-off and the recommended default |
| Pooler | Supavisor — app uses **transaction mode, port 6543**; migrations use the **direct port 5432** | Transaction pooling is incompatible with session state; Prisma needs `?pgbouncer=true` on the pooled URL |
| Extensions | `btree_gist` only | Migration 2 runs `CREATE EXTENSION IF NOT EXISTS btree_gist`; no other extension is referenced by any migration |
| Shadow database | `primemet_shadow` — empty, created on the same project | `prisma migrate diff --from-migrations` **requires** a shadow database (§4, verified against `prisma migrate diff --help`, 6.16.2) |
| Spend cap | **ON** | A cap, not a warning |

### 2.2 Deliberately not enabled

Supabase Auth, Storage beyond the default, Realtime, Edge Functions, pgvector, read replicas, log drains
($60 per drain per project), custom domains, PgBouncer *session* mode for the application, and any
scheduled job that writes. PRIMEMET's authentication is its own Stage-2 design; enabling a second identity
system on the staging database would create exactly the competing source of truth D9 forbids.

### 2.3 Connection topology — three URLs, three different jobs

| Purpose | Host / port | Identity | Where the credential lives |
|---|---|---|---|
| Application runtime (not built yet) | pooler `…pooler.supabase.com:6543`, `?pgbouncer=true&connection_limit=1` | `primemet_app` | the deployment's secret store; **not** in this repository |
| Migrations and grants | direct `db.<ref>.supabase.co:5432` | `primemet_owner` | GitHub environment `staging-database`, secret `PG_OWNER_URL` |
| Drift check (`--from-migrations`) | `primemet_shadow` on the same project | `primemet_owner` | same secret store; the shadow database is disposable |
| Identity assertions | direct 5432 | `primemet_app` | GitHub environment `staging-database`, secret `PG_APP_URL` |

The owner identity and the application identity never share a URL, an environment file, or a CI job. A job
that migrates does not run application code; a job that runs application code has no DDL right to lose.

**To confirm at action A9, before the first deployment:** the pooler username for a non-default role is
provider-specific (the dashboard's *Connect* panel prints the exact string). Do not assume the direct-host
username format carries over to the pooler — read it from the panel and record it in §2.3.

### 2.4 Staging data rules

- **No production data, no Atlas dump, no `mongodump`** (D9 item 8). Staging starts empty and receives only
  the rows that migration `20261031000200_m1_reference_seeds` inserts (tax components, inspection methods)
  plus synthetic fixtures created by tests.
- Staging is reset by **dropping and recreating the database**, never by reverse migration. There is no
  reverse-migration mechanism in either system: `db/migrations` contains zero `down()` functions, and
  `prisma/migrations` contains no reverse migration — the only `DOWN` token in the SQL is the
  `migration_direction` enum label, which records a direction on a ledger row. Migration 2 documents reversal
  notes block by block precisely because they must be written when needed, not replayed. Task 1 does not
  invent one.
- `integrityTag` values and historical audit evidence live in MongoDB and are **not** copied to staging;
  they remain where they are (D9 item 3).

---

## 3. The two identities

### 3.1 Identity table

| | `primemet_owner` | `primemet_app` |
|---|---|---|
| Purpose | schema change: `prisma migrate deploy`, grants, shadow-database resets | runtime DML only |
| Attributes | `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` | identical — **no** `BYPASSRLS`, because RLS arrives in Task 2 and the app must be subject to it from the start |
| Schema rights | `USAGE`, `CREATE` on `public` | `USAGE` only |
| Table rights | owns every object the migrations create | `SELECT, INSERT, UPDATE, DELETE` on tables; `USAGE, SELECT` on sequences; **no** `TRUNCATE`, `REFERENCES`, `TRIGGER` |
| Special | — | `REVOKE ALL ON public._prisma_migrations`; `UPDATE`/`DELETE` revoked on the two immutable tables (§3.4) |
| Session rails | `statement_timeout 15min`, `lock_timeout 30s`, `idle_in_transaction_session_timeout 5min` | `statement_timeout 5s`, `lock_timeout 2s`, `idle_in_transaction_session_timeout 10s` |
| Used by | the migration job, and nothing else | the deployed application, and nothing else |
| Credential | owner's password manager + `PG_OWNER_URL` | deployment secret store + `PG_APP_URL` |

`postgres` (the provider's own administrative role, created by Supabase) is **break-glass only**: used for
the one-time extension check and for dropping the shadow database. It is not used by CI, not by
migrations, and not by the application.

A third identity `primemet_readonly` existed in MongoDB. It is **not** created in Task 1: nothing in the
Task 1 scope reports on the database, and an unused login role is an unused attack surface. It arrives with
reporting, in the task that needs it.

### 3.2 The SQL, exactly

Save as `prisma/sql/roles/001-roles.sql`. It is executed **once**, against a fresh project, by the owner
(§7 A6) and by CI job B on its ephemeral server. The two tokens `:'owner_password'` and `:'app_password'`
are psql variables; in the Supabase SQL editor the owner replaces them in the editor buffer only — never in
a saved file, a shell history or a chat message.

```sql
-- PRIMEMET D9 Task 1 — database identities.
-- Run once, on a fresh database. Re-running CREATE ROLE fails by design (see §3.3).

-- 1. Owner (DDL) identity.
CREATE ROLE primemet_owner LOGIN
  PASSWORD :'owner_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- 2. Application (DML) identity.
CREATE ROLE primemet_app LOGIN
  PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- 3. Connection rights, scoped to this database.
GRANT CONNECT ON DATABASE postgres TO primemet_owner, primemet_app;

-- 4. Schema rights. PUBLIC loses CREATE: no role gets to add objects by default.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO primemet_owner;
GRANT USAGE ON SCHEMA public TO primemet_app;

-- 5. Existing objects (a no-op on a fresh project; harmless on staging after a migration).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO primemet_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO primemet_app;

-- 6. Future objects created by the migration identity.
ALTER DEFAULT PRIVILEGES FOR ROLE primemet_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO primemet_app;
ALTER DEFAULT PRIVILEGES FOR ROLE primemet_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO primemet_app;

-- 7. Session safety rails.
ALTER ROLE primemet_owner SET statement_timeout = '15min';
ALTER ROLE primemet_owner SET lock_timeout = '30s';
ALTER ROLE primemet_owner SET idle_in_transaction_session_timeout = '5min';
ALTER ROLE primemet_owner SET search_path = public, pg_temp;
ALTER ROLE primemet_app   SET statement_timeout = '5s';
ALTER ROLE primemet_app   SET lock_timeout = '2s';
ALTER ROLE primemet_app   SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE primemet_app   SET search_path = public, pg_temp;
```

`prisma/sql/grants/post-migrate.sql` runs after **every** `migrate deploy` — locally, in CI, and on staging:

```sql
-- Objects created since the last run inherit defaults, but these three need an explicit state.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO primemet_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO primemet_app;

-- The migration ledger is infrastructure, not application data.
REVOKE ALL ON TABLE public._prisma_migrations FROM primemet_app;

-- Defence in depth for the two tables the database already makes immutable (triggers, migration 7).
-- The privileges are removed as well, so an attempted UPDATE fails before it reaches the trigger.
REVOKE UPDATE, DELETE ON TABLE public.material_alias_verifications FROM primemet_app;
REVOKE UPDATE, DELETE ON TABLE public.material_alias_equivalence_decisions FROM primemet_app;
```

### 3.3 Why the grants are a script and not a migration

Prisma migrations are environment-independent DDL; role names are environment-specific. A migration that
grants to `primemet_app` would fail on a developer's throwaway database where that role does not exist, and
would make `migrate deploy` depend on provisioning order. So privileges live in `prisma/sql/`, are applied by
one idempotent script after every deploy, and are **asserted** rather than assumed (§3.5).

### 3.4 Privilege matrix after migration 7 (the state Task 1 must prove)

| Object class | `primemet_app` | Notes |
|---|---|---|
| The 47 tables the migrations create | `SELECT, INSERT, UPDATE, DELETE` | default privileges from `primemet_owner` |
| `material_alias_verifications`, `material_alias_equivalence_decisions` | `SELECT, INSERT` only | `UPDATE`/`DELETE` revoked **and** rejected by `pm_reject_history_mutation` |
| `pm_history_guard` | `SELECT, INSERT` | the unfillable CHECK table behind the immutability constraint |
| `_prisma_migrations` | **none** | the application cannot see or rewrite migration history |
| sequences | `USAGE, SELECT` | no `UPDATE` (no `setval`) |
| schema `public` | `USAGE` only | cannot `CREATE TABLE` |
| database | `CONNECT` | no `CREATE` on the database, so no new schemas |

**Known gap, stated rather than hidden:** `audit_logs`, `audit_log_failures` and `auth_events` are append-only
in MongoDB (7 append-only collections there) but have **no immutability trigger in PostgreSQL yet** — the
only immutability triggers that exist are the three created by migration 7 (two `pm_reject_history_mutation`
triggers plus one `pm_require_approved_equivalence` guard). They are insert-only *by structure* —
`npm run check:schema` asserts that `documents`, `document_access_log`, `audit_logs`, `audit_log_failures` and
`auth_events` carry no `updated_at` — but structure is not a privilege, and nothing yet stops an `UPDATE`
written by mistake. They therefore receive ordinary `UPDATE`/`DELETE` grants in Task 1. Closing that is Task 2
work, alongside RLS, and is recorded here so nobody reads Task 1 as "append-only parity achieved".

### 3.5 Assertions that must pass (fail-closed SQL)

`prisma/sql/checks/assert-identities.sql` is executed with `prisma db execute --file … --url "$PG_APP_URL"`.
It raises an exception — and therefore a non-zero exit — if any expectation is violated. No new dependency
is needed for this; `prisma db execute` is already available.

```sql
DO $$
DECLARE
  bad int;
BEGIN
  -- Both identities exist, can log in, and hold no administrative attribute.
  SELECT count(*) INTO bad FROM pg_roles
   WHERE rolname IN ('primemet_owner','primemet_app')
     AND (NOT rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication);
  IF bad <> 0 THEN RAISE EXCEPTION 'identity attributes wrong: % rows', bad; END IF;

  -- The application cannot create objects in public.
  IF has_schema_privilege('primemet_app','public','CREATE') THEN
    RAISE EXCEPTION 'primemet_app can CREATE in public';
  END IF;

  -- The application owns no table (if it owns one, it can ALTER it).
  SELECT count(*) INTO bad FROM pg_tables WHERE schemaname='public' AND tableowner='primemet_app';
  IF bad <> 0 THEN RAISE EXCEPTION 'primemet_app owns % tables', bad; END IF;

  -- The application holds no TRUNCATE, REFERENCES or TRIGGER privilege anywhere.
  SELECT count(*) INTO bad FROM information_schema.role_table_grants
   WHERE grantee='primemet_app' AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER');
  IF bad <> 0 THEN RAISE EXCEPTION 'primemet_app holds % forbidden grants', bad; END IF;

  -- The application cannot read the migration ledger.
  IF has_table_privilege('primemet_app','public._prisma_migrations','SELECT') THEN
    RAISE EXCEPTION 'primemet_app can read _prisma_migrations';
  END IF;

  -- The application has no UPDATE/DELETE right on the immutable tables.
  IF has_table_privilege('primemet_app','public.material_alias_verifications','UPDATE')
     OR has_table_privilege('primemet_app','public.material_alias_equivalence_decisions','DELETE') THEN
    RAISE EXCEPTION 'immutable table privileges not revoked';
  END IF;

  -- And it can actually read every business table (catches objects created by the wrong role,
  -- which is the failure mode that default privileges do NOT cover).
  SELECT count(*) INTO bad FROM pg_tables t
   WHERE t.schemaname='public'
     AND t.tablename <> '_prisma_migrations'
     AND NOT has_table_privilege('primemet_app', format('public.%I', t.tablename), 'SELECT');
  IF bad <> 0 THEN RAISE EXCEPTION 'primemet_app cannot SELECT % tables', bad; END IF;
END $$;
```

### 3.6 Negative tests — each must fail

`scripts/check-pg-identities.mjs` runs each of these with `primemet_app` and **requires a non-zero exit**:

| File | Statement | Expected |
|---|---|---|
| `deny-ddl.sql` | `CREATE TABLE public.should_not_exist (id int);` | `permission denied for schema public` (42501) |
| `deny-truncate.sql` | `TRUNCATE TABLE public.users;` | `permission denied for table users` |
| `deny-update-immutable.sql` | `UPDATE public.material_alias_verifications SET verified_at = now();` | `permission denied for table …` — before the trigger is reached |
| `deny-ledger.sql` | `SELECT 1 FROM public._prisma_migrations;` | `permission denied for table _prisma_migrations` |
| `deny-set-role.sql` | `SET ROLE primemet_owner;` | `permission denied to set role` |

A negative test that *succeeds* is a Task 1 failure, not a warning.

---

## 4. Prisma migration checks — exact commands

### 4.1 What already exists (reused, not replaced)

| Command | Proves | Cost |
|---|---|---|
| `npm run db:validate` (`prisma validate`) | the schema parses; no connection needed (uses the fake URL in `prisma/.env`) | seconds |
| `npm run check:schema` | all 7 committed migrations apply to PostgreSQL 17 and the constraints behave (PGlite) | ~1 min |
| `npm run check:schema:m1` | the frozen M1 baseline still matches exactly | ~1 min |
| `npm run check:equivalence` | 48 assertions over committed migration files, real engine, nothing mocked | ~1 min |

Verified this turn: `prisma 6.16.2`, schema **valid**, 46 models, 67 enums, 7 migration directories,
47 tables, 2,340 lines of migration SQL, one extension (`btree_gist`), three triggers.

Verified in this workspace on 2026-11-03, not assumed: `npm run db:validate` → *the schema is valid* (exit 0);
`npm run check:schema` → **61 passed, 0 failed** (exit 0), which is what licenses every claim in §2.1 about
migrations, the single extension and the triggers.

### 4.2 What Task 1 adds

```jsonc
// package.json — new scripts
"db:drift":        "node scripts/check-pg-drift.mjs",
"db:migrate:check": "node scripts/check-pg-migrations.mjs",
"db:migrate:status": "prisma migrate status",
"check:pg-identities": "node scripts/check-pg-identities.mjs",
"check:mongodb-freeze": "node scripts/check-mongodb-freeze.mjs",
"check:secrets":   "node scripts/check-secrets.mjs"
```

**`db:drift`** — the invariant that matters: `schema.prisma` and the migration history describe the *same*
database. Exit codes, confirmed against `prisma migrate diff --help` on 6.16.2:
`0` = empty (good), `2` = not empty (**drift — fail the build**), `1` = error.
`--from-migrations` **requires** `--shadow-database-url`; there is no way around it.

The wrapper is a Node script, not a shell one-liner quoting `$SHADOW_DATABASE_URL`: `npm run` on Windows uses
`cmd.exe`, where `$VAR` is not expanded. `check-pg-drift.mjs` reads `SHADOW_DATABASE_URL` from the environment,
refuses to run without it, and exits with Prisma's own code (0/1/2) so CI can tell drift from a tooling error.

**`db:migrate:check`** — `scripts/check-pg-migrations.mjs`, in this order:
1. `prisma migrate deploy` against `$DATABASE_URL` (a throwaway database, never staging);
2. `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`
   → must be `0`, i.e. the applied database and the schema agree;
3. `prisma migrate status` → must report up to date;
4. a query on `_prisma_migrations`: **7 rows, every `finished_at` non-null, no `rolled_back_at`**;
5. `prisma/sql/grants/post-migrate.sql` applied, then `assert-identities.sql`.

**`check:mongodb-freeze`** — D9 item 1 needs enforcement, not a promise. `scripts/check-mongodb-freeze.mjs`
compares SHA-256 digests of the Mongo surface against a committed manifest
(`db/FREEZE.manifest.json`): every file under `db/`, `scripts/db-*.mjs`, `scripts/gen-mongo-enums.mjs`,
`scripts/check-migration-architecture.mjs`, `src/lib/db.ts`, `src/lib/permissions/store.ts`. Added, modified
or deleted → non-zero exit. Creating the manifest is a one-off, reviewed act; it contains digests only, no
credentials. It is the mechanism that keeps "freeze" from decaying into "we agreed not to".

**`check:secrets`** — two real hazards in this repository:
1. `.gitignore` line 21 is a *negation* (`!/prisma/.env`), so `prisma/.env` is **not ignored** — it is
   intended to be committed, and it currently holds a deliberately fake
   `postgresql://…@127.0.0.1:5432/schema_tooling_only`. One paste of a real staging URL into that file and a
   `git add -A` commits a credential. The check must fail if that file's host is not `127.0.0.1`/`localhost`,
   or if any tracked file contains a `postgresql://` URL with a password and a non-loopback host, an
   `mongodb+srv://` URI, a GitHub token or an AWS key.
2. `prisma/.env` is read by the Prisma CLI **only** — `src/` has exactly two `DATABASE_URL` references
   (`src/lib/env.ts:80`, `:143`, both in the optional env schema) and **zero** `@prisma/client` imports. No
   runtime reader exists yet, which is precisely why a real URL there would sit unnoticed.

### 4.3 Lifecycle rules (each one exists because its absence breaks something)

| Rule | Consequence if broken |
|---|---|
| `prisma migrate deploy` only — never `migrate dev`, never `db push` | `migrate dev` can reset a database; `db push` makes the schema and history disagree and destroys the drift baseline |
| Never edit a migration that has been applied anywhere | Prisma stores a checksum; an edit produces a drifted-history error (`P3009`) on the next deploy. This is the same failure the MongoDB ledger already demonstrates with `v004` |
| One migration = one reviewed pull request, with its `db:drift` output attached | else the SQL is unreviewed DDL |
| No `down()` migrations | matches existing practice in `db/migrations` (0 matches); rollback is forward-fix or recreate staging |
| Migration filenames are immutable (`<timestamp>_name`) | Prisma orders by directory name; renaming reorders history |
| `DATABASE_URL` in CI ephemeral jobs only; `PG_OWNER_URL` in the protected environment only | a migration job that can also serve traffic is a migration job that can be triggered by traffic |

---

## 5. CI verification

New workflow: `.github/workflows/pg-staging-verify.yml`. Existing `db-init.yml` (MongoDB) and
`m2a-argon2-gate.yml` are untouched.

```yaml
name: PostgreSQL staging verification

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: pg-verify-${{ github.ref }}
  cancel-in-progress: true

jobs:
  migration-verify:            # A — no secrets, throwaway PostgreSQL 17
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: primemet_ci
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres -d primemet_ci"
          --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/primemet_ci?schema=public
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      - run: npx prisma validate
      - run: npx prisma generate
      - run: npx prisma migrate deploy
      - run: npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
      - run: npx prisma migrate status
      - run: npm run check:schema
      - run: npm run check:equivalence

  identities-and-privileges:   # B — the two identities, exercised, on a throwaway server
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: primemet_ci
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres -d primemet_ci"
          --health-interval 5s --health-timeout 5s --health-retries 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      - name: Create the two identities (passwords generated per run, never persisted)
        run: |
          OWNER_PASSWORD="$(openssl rand -hex 24)"
          APP_PASSWORD="$(openssl rand -hex 24)"
          echo "PG_OWNER_URL=postgresql://primemet_owner:${OWNER_PASSWORD}@localhost:5432/primemet_ci?schema=public" >> "$GITHUB_ENV"
          echo "PG_APP_URL=postgresql://primemet_app:${APP_PASSWORD}@localhost:5432/primemet_ci?schema=public" >> "$GITHUB_ENV"
          PGPASSWORD=postgres psql -h localhost -U postgres -d primemet_ci -v ON_ERROR_STOP=1 \
            -v owner_password="$OWNER_PASSWORD" \
            -v app_password="$APP_PASSWORD" \
            -f prisma/sql/roles/001-roles.sql
      - name: Migrate as primemet_owner, not as postgres
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ env.PG_OWNER_URL }}
      - run: psql "$PG_OWNER_URL" -v ON_ERROR_STOP=1 -f prisma/sql/grants/post-migrate.sql
      - run: npm run check:pg-identities

  mongo-freeze:                # D — D9 item 1, enforced on every pull request
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - run: npm run check:mongodb-freeze

  secret-hygiene:              # E — the un-ignored prisma/.env, and everything else
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - run: npm run check:secrets
```

The property job B proves, and the reason it exists at all: **no step after role creation connects as `postgres`**.
The migration runs as `primemet_owner`; every assertion and every negative test runs as `primemet_app`. A job
that migrated as the platform superuser would pass while proving nothing about the identity model.

**Job C — staging rehearsal, manual and protected, is deliberately *not* on push or pull request.** It runs
only by `workflow_dispatch`, only in the GitHub environment `staging-database` with required reviewers, and
only if the owner's network-restriction decision (§7 A5) permits the runner's address. It executes
`migrate deploy` with `PG_OWNER_URL`, then `migrate status`, then the assertion SQL, then writes the applied
migration list into the run summary. It is the only job that touches staging, and it can never run because
someone opened a pull request.

Notes that matter operationally:
- `push: branches: [main]` is a *trigger*, not a deployment. No job deploys, and none writes to staging
  without the protected environment's approval. This is consistent with D9 item 9 (no deploy without separate
  approval).
- Estimated run time: 4 jobs × 3–5 min ≈ 12–20 minutes per pull request on a cold cache.

---

## 6. Costs — published figures only

Read from the providers' own pricing pages on **2026-11-03**, not from memory. Anything not published is
marked as requiring a quotation rather than estimated.

| Item | Published price | Source | Monthly, Task 1 |
|---|---|---|---|
| Supabase **Pro** (first project included, includes $10/month compute credit) | **$25/month** | supabase.com/pricing | **$25.00** |
| Compute **Micro** (1 GB RAM, shared) | $10/month, covered by the $10 credit | same | $0.00 |
| Compute **Small** (2 GB RAM) — only if Micro is insufficient | $15/month → **$5** after the credit | same | +$5.00 optional |
| Disk beyond 8 GB | $0.125/GB-month | same | $0.00 (M1 footprint ≪ 8 GB) |
| Egress beyond 250 GB | $0.09/GB | same | $0.00 |
| File storage beyond 100 GB | $0.0213/GB | same | $0.00 (no files in Task 1) |
| Daily backups, 7-day retention | included in Pro | same | $0.00 |
| Point-in-time recovery add-on | **not published** — scales with compute size | same | needs a provider quotation; not purchased |
| Log drains | $60 per drain per project | same | $0.00 (not enabled) |
| Second project (when production is created) | from **$10/month** + compute | same | $0.00 in Task 1 |
| GitHub Actions, private repository | **$0.006/minute**, standard Linux runner; included minutes come from the account plan (Free 2,000/month, Pro 3,000) — **confirm on the billing page** | docs.github.com billing | $0.00–$2.00 |
| **Total, Task 1** | | | **≈ $25/month ≈ ₹2,200/month at ₹88 = US$1** |

The FX figure is the assumption already used in `docs/PRIMEMET_STAGE_2_ARCHITECTURE.md` §30.6 — an
illustration, not a rate. GST/VAT is additional and is the CA's call. Spend caps stay on.

**Why not the Free plan ($0)?** It pauses after one week of inactivity and has no daily backups. A staging
database that has to be woken is not a staging database that CI can prove anything about, and the first
"why is the migration check red" incident costs more than $25.

**Cost to stop everything:** deleting the project ends the charge. Nothing else in Task 1 is billable.

---

## 7. Owner actions — exact

Numbered, in order. Nothing below is performed by the agent.

| # | Action | Detail |
|---|---|---|
| **A1** | **Approve or amend D9-a** | Provider **Supabase**, region **`ap-south-1` (Mumbai)**, plan **Pro**, compute **Micro**, PostgreSQL **17**. This is the gate: no other action starts until it is approved |
| **A2** | Create the organisation and project | Supabase dashboard → New project → name `primemet-staging`, region `ap-south-1`, generate a 32+ character database password, store it **only** in your password manager |
| **A3** | Enable Pro and the spend cap | Billing → Pro; keep the spend cap **on**. Do **not** enable PITR, HA or log drains |
| **A4** | Confirm backups | Database → Backups: daily, 7-day retention. Record the date you confirmed it |
| **A5** | Decide network restrictions | **Recommended for staging:** allowlist your own IP only, and leave job C (staging rehearsal) manual. Alternative: no IP restriction, relying on TLS + a 32-character password, which lets the rehearsal job reach staging from GitHub runners. **Do not** allowlist `0.0.0.0/0`. Whichever you choose, it is recorded here and revisited before production |
| **A6** | Run the identity SQL | SQL editor → paste `prisma/sql/roles/001-roles.sql`, replace `:'owner_password'` and `:'app_password'` **in the editor only**, run once. Expected: one `CREATE ROLE` per identity, then grants. If a role already exists, use the `ALTER ROLE … PASSWORD` form documented in §3.2 instead of re-running |
| **A7** | Create the shadow database | SQL editor → `CREATE DATABASE primemet_shadow;` (owner `postgres`). It stays empty; `migrate diff` populates and truncates its own objects |
| **A8** | Create the GitHub environment | Repository → Settings → Environments → `staging-database`, required reviewers = you. Secrets: `PG_OWNER_URL` (direct 5432, `primemet_owner`), `PG_APP_URL` (direct 5432, `primemet_app`). No secret goes in `prisma/.env`, `.env.example`, or any tracked file |
| **A9** | Send back the non-secret facts | project ref, region, PostgreSQL version, pooler hostname, confirmation that §3.2 ran without error, and the output of the §3.5 assertion block. **Never** send a password or a connection string with credentials in it |
| **A10** | Do not pre-empt the checks | Do not run `prisma migrate deploy` against staging by hand before the CI job exists — a manual apply creates history that CI then reports as drift, and that argument is expensive |
| **A11** | Confirm the data rule | Staging receives reference seeds and synthetic fixtures only. No Atlas dump, no production extract (D9 item 8) |

Also required, and cheap: **A0** — confirm whether `github.com/daulatrao123/PRIMEMET` is private or public
(it determines whether Actions minutes are billable at all).

### What the agent creates on approval (no infrastructure, no credentials)

| File | Purpose |
|---|---|
| `scripts/check-pg-drift.mjs` | `db:drift` wrapper: reads `SHADOW_DATABASE_URL`, passes through Prisma's 0/1/2 exit codes |
| `prisma/sql/roles/001-roles.sql` | §3.2, executed by the owner and by CI |
| `prisma/sql/grants/post-migrate.sql` | §3.2, applied after every deploy |
| `prisma/sql/checks/assert-identities.sql` | §3.5 |
| `prisma/sql/checks/deny-*.sql` (5 files) | §3.6 |
| `scripts/check-pg-migrations.mjs`, `scripts/check-pg-identities.mjs`, `scripts/check-mongodb-freeze.mjs`, `scripts/check-secrets.mjs` | §4.2 |
| `db/FREEZE.manifest.json` | digests of the frozen Mongo surface |
| `.github/workflows/pg-staging-verify.yml` | §5 |
| `package.json` scripts | §4.2 |
| `.env.example` correction | it currently says "DEPRECATED — PostgreSQL. No longer read by the application". After D9 that sentence is false. Replaced with the three-URL contract of §2.3 and the two-identity rule |

---

## 8. Task 1 acceptance criteria

Task 1 is verified — not "done by assertion" — when every line below is observed:

| # | Check | Expected observation |
|---|---|---|
| 1 | Project attributes | `primemet-staging`, `ap-south-1`, PostgreSQL 17, Pro, Micro, daily backups, spend cap on |
| 2 | Migrations applied | `prisma migrate deploy` reports **7 migrations applied, no failures** |
| 3 | Ledger | `SELECT count(*) FILTER (WHERE finished_at IS NULL), count(*) FILTER (WHERE rolled_back_at IS NOT NULL) FROM _prisma_migrations;` → `0, 0`, 7 rows |
| 4 | Status | `prisma migrate status` → "Database schema is up to date!" |
| 5 | Drift | `db:drift` exits **0**; a schema edit without a migration exits **2** (proved on a scratch copy) |
| 6 | Identities | `assert-identities.sql` exits 0 against `PG_APP_URL` |
| 7 | Negative tests | all five `deny-*.sql` statements exit non-zero, with `permission denied` |
| 8 | Production-identity test | `migrate deploy` run **as `primemet_owner`** succeeds; run as `primemet_app` fails |
| 9 | CI | jobs A, B, D, E green on a pull request; job A red when a model is added to `schema.prisma` with no migration |
| 10 | Freeze | `check:mongodb-freeze` green; no file under `db/` or any Mongo script differs from HEAD |
| 11 | Secrets | `check:secrets` green; `prisma/.env` host is `127.0.0.1`; no credential in any tracked file |
| 12 | Git | `git status --porcelain -uall` staged count **0**; HEAD still `7863743`; no push, no deploy |

---

## 9. Rollback and stop conditions

| Failure | Response |
|---|---|
| Project creation is misconfigured (wrong region) | Delete the project; region is not changeable. Small cost, no data |
| `CREATE EXTENSION btree_gist` is refused on Supabase | Run it once in the SQL editor as the project owner, then re-run `migrate deploy`. It is the only extension any migration needs, and it is the most likely first-run refusal |
| `migrate deploy` fails midway | Staging is disposable: drop and recreate the database, re-run. Never hand-patch `_prisma_migrations` |
| A migration is found to be wrong after being applied | Write a new corrective migration (the D-1/D-2 pair is the existing precedent). Never edit the applied file |
| Cost grows unexpectedly | Delete the project. The only recurring charge in Task 1 is the $25 plan |
| Any step needs a production credential, a production database, or a deploy | **Stop.** Out of Task 1 scope; return to the owner |

---

## 10. Two problems this plan surfaces, which D9 did not enumerate

1. **`prisma/.env` is deliberately not git-ignored.** The comment in `.gitignore` explains why (the CLI needs a
   parseable URL), and the file currently contains a fake one. The rule that keeps the comment true is a
   check, not a convention — hence `check:secrets` in §4.2. If you would rather remove the un-ignore, that is a
   one-line `.gitignore` change, but then clean-checkout `prisma validate` needs another URL source.
2. **Append-only parity is incomplete in PostgreSQL.** Only the two material-alias tables are immutable there;
   MongoDB has seven append-only collections. Task 1 deliberately does not dress this up as parity: `audit_logs`,
   `audit_log_failures` and `auth_events` receive ordinary DML rights until Task 2 adds the triggers and
   privileges that make them append-only. It is recorded here so the gap is owned rather
   than discovered later.

This document changes nothing by itself. On D9-a approval, the first action is A2 — creating the project — and
the agent's first action is the file list at the end of §7.