# PRIMEMET — PostgreSQL → MongoDB Migration Plan

**Status:** design + implementation delivered. **No production database exists yet.** Nothing has been
pushed, and no Atlas cluster has been created.

**Decision recorded here:** MongoDB Atlas is the primary production database; Vercel hosts the
application.

---

## 1. What existed before this migration

| Item | State at the start of this work |
|---|---|
| Application | Next.js 15.5.28 App Router, TypeScript, Tailwind v4. 81 prerendered pages, 58 routes |
| Runtime database use | **One** code path: `src/lib/db.ts` → `src/app/api/health/route.ts`. Every other page is static preview content |
| Schema | `prisma/schema.prisma` — 46 models, 67 enums, 2,082 lines |
| Migrations | **7** PostgreSQL migrations, 61 CHECK constraints, 41 unique indexes, 1 `EXCLUDE` (btree_gist), 3 triggers, 67 foreign keys |
| Production database | **None had ever been connected.** `/api/health` returned `database: "not_configured"` |

That inventory shaped the plan: the risky part was never the application code (three files), it was
**re-expressing 112 database-enforced rules** in a database that has no CHECK constraints, no foreign
keys, no exclusion constraints and no triggers.

---

## 2. Incompatibility analysis

Each PostgreSQL mechanism, what replaces it, and what is genuinely lost.

| # | PostgreSQL feature | Used for | MongoDB replacement | Enforcement | Residual gap |
|---|---|---|---|---|---|
| 1 | Column types + `NOT NULL` | 45 tables | `$jsonSchema` `bsonType` + `required` | **Server** | none |
| 2 | Enum types (67) | coded values | `$jsonSchema` `enum`, generated from the Prisma schema | **Server** | new values need a migration (by design — §5.1 says enums are append-only) |
| 3 | CHECK — simple predicate (61) | e.g. "code not blank", "rate 0–100" | query operators inside the validator | **Server** | none |
| 4 | CHECK — cross-field, same row | `normalised_alias = lower(btrim(alias))` | `$expr` inside the validator | **Server** | none |
| 5 | CHECK — refers to another row | "VERIFIED needs an APPROVED decision for this alias" | transactional re-read in `verifyAlias()` + reconciliation in `db:verify` (§2.1) | **Application** (write path) + **detection** (reconciliation) | a collection validator can only see the document being written, so no MongoDB validator can hold this rule at all; a bypassing write is *detected*, not prevented |
| 6 | UNIQUE INDEX (41) | identity | unique index | **Server** | none |
| 7 | partial UNIQUE `WHERE …` | gstin only when present; one primary form per material; one ACTIVE rule set | unique index + `partialFilterExpression` | **Server** | `$exists: false` is unsupported in a partial filter — expressed as `deletedAt: null` instead |
| 8 | `EXCLUDE USING gist … daterange &&` | two ACTIVE tax rules must not overlap | unique index on (scope, `effectiveFrom`) **+** transactional overlap check (`db/tax.mjs`) | **Server** for scope + start day; **application** for range | a writer bypassing the DAO can create overlapping ranges; `TAX_RULE_AMBIGUOUS` at rate-resolution time is the backstop |
| 9 | FOREIGN KEY (67) | referential integrity | reference by `_id` + `assertReferences()` inside the write transaction | **Application**, one choke point | direct DB writes bypass it; see §11 |
| 10 | `BEFORE UPDATE/DELETE` triggers (3) | append-only verification + audit history | no write method in the DAO **+** collection-level privilege separation (`db/roles.mjs`) | **Application** + **server privileges** | requires the Atlas user to be provisioned with the restricted role (manual step M‑4) |
| 11 | `numeric(18,2/3/4)` | money, rates, weights | BSON **`Decimal128`**; `bsonType: "decimal"` rejects a double | **Server** refuses floats | Decimal128 carries 34 digits; the *scale* (2 vs 4 vs 3) is a write-path rule, not a validator rule |
| 12 | `gen_random_uuid()` | primary keys | application-generated UUID in `_id` | Application | none |
| 13 | `timestamptz` | all timestamps | BSON `date` (UTC) | **Server** | none |
| 14 | Prisma migrate + ledger | schema versions | `_schema_migrations` + checksummed versioned migrations (`db/ledger.mjs`) | Runner | replaces Prisma's migrator entirely |

### 2.1 The one rule MongoDB cannot hold

PostgreSQL enforced "a VERIFIED alias needs an approved equivalence decision" with a **composite
foreign key** — which proved only that *a* decision row existed with a matching alias id, not that it
was approved. The PostgreSQL trigger `pm_require_approved_equivalence` did read the decision and did
refuse a PENDING one.

MongoDB cannot express this rule anywhere in a collection validator. `$jsonSchema` and `$expr` see one
single document; there is no `$lookup`, no subquery and no trigger inside validation. This is a hard
property of the engine, not a modelling choice.

**First attempt (rejected by independent audit).** The decision's outcome was **copied onto the alias**
as `equivalenceGate { decisionId, aliasId, status, basis }` and the validator required that copy to be
`APPROVED`, bound to *this* `_id`, and matching the alias's own basis. The reasoning was that a copy of
an immutable value cannot go stale — true, but beside the point: the copy is written by whoever writes
the alias, so it can be **forged**. The audit demonstrated exactly that: a direct write with a
self-asserted `APPROVED` gate was accepted while the referenced decision was `REJECTED` and belonged to
a different alias. Nothing read the decision.

**Current design.** The copy is deleted — a field that cannot be trusted should not exist, and
`additionalProperties: false` means it cannot be written back. The rule is then enforced where it can
actually be enforced, and each layer is named:

| Layer | Mechanism | What it gives |
|---|---|---|
| Write path | `verifyAlias()` in `db/refs.mjs`, one transaction | Reads the real decision; refuses rejected, pending, borrowed, relabelled-basis, reviewer-less and evidence-free approvals. This is the **only** supported route to `VERIFIED` |
| Detection | `reconcileVerifiedAliases()` in `db/verify.mjs`, run by `db:verify` and every `db:init` | Re-reads the decision behind every stored `VERIFIED` alias. A write that bypassed the write path is reported as a verification failure instead of being trusted |
| Privileges | `db/roles.mjs` + `db/provision-roles.mjs` | The runtime role cannot write history collections, and cannot create collections, modify validators or write the ledger |

Detection is weaker than prevention, and this document says so rather than implying otherwise. What it
means operationally: a bypassed write is caught on the next verification run, and it is caught
*against the real decision*, so a forged copy would not have helped anyway.

### 2.2 What is genuinely weaker

Cross-collection referential integrity, the alias-approval link and trigger-enforced immutability are
**not** enforceable by MongoDB itself. Referential integrity and the approval link are enforced by a
single guard in the write path plus a reconciliation pass that detects anything the guard missed;
immutability is enforced by database privileges. A person with cluster credentials and a shell can
bypass all three, and no design on this engine can stop that.

What each residual gap actually costs is stated in the code (`db/refs.mjs`, `db/verify.mjs`), in §2.1,
in §11 and in the owner steps (§12). The one thing this document will not do is call a detection
control a prevention control.

---

## 3. Why the native driver, not Prisma's MongoDB connector

| Requirement | Prisma MongoDB connector | Native `mongodb` driver |
|---|---|---|
| `$jsonSchema` collection validators | not expressible | yes |
| Partial unique indexes | not expressible | yes |
| Migration ledger / versioned DDL | **no migration system at all** (`db push` only) | own ledger (§7) |
| `Decimal128` | supported | supported |
| Tests against a real server | needs generate + engine | direct |
| Extra build step | `prisma generate` | none |

The deciding factor is requirement 2 of the brief: *preserve the business rules*. Prisma cannot express
the validators or partial indexes, so choosing it would have demoted ~100 database-enforced rules to
convention. The driver was chosen for enforcement, and the seven PostgreSQL migrations are retained
untouched as the historical reference.

---

## 4. Model mapping — all 46 Prisma models

45 collections: `MigrationRun` maps to the ledger `_schema_migrations` rather than a second collection,
because two ledgers can disagree and only one can be authoritative.

| Prisma model | Collection | Fields | Refs | Indexes | Unique | Append-only |
|---|---|---|---|---|---|---|
| User | `users` | 18 | 0 | 2 | 1 |  |
| Session | `sessions` | 11 | 1 | 2 | 1 |  |
| AuthEvent | `auth_events` | 10 | 1 | 2 | 0 | yes |
| AdminProfile | `admin_profiles` | 11 | 1 | 2 | 2 |  |
| AdminPermissionGrant | `admin_permission_grants` | 8 | 2 | 2 | 0 | yes |
| PortalInvitation | `portal_invitations` | 10 | 2 | 2 | 1 |  |
| Organisation | `organisations` | 19 | 0 | 4 | 3 |  |
| OrganisationAddress | `organisation_addresses` | 13 | 1 | 1 | 0 |  |
| OrganisationContact | `organisation_contacts` | 11 | 2 | 2 | 0 |  |
| OrganisationVerification | `organisation_verifications` | 12 | 3 | 1 | 0 |  |
| ReferenceSequence | `reference_sequences` | 4 | 0 | 1 | 1 |  |
| SupplierProfile | `supplier_profiles` | 19 | 2 | 2 | 1 |  |
| BuyerProfile | `buyer_profiles` | 18 | 2 | 2 | 1 |  |
| SupplierListing | `supplier_listings` | 12 | 3 | 3 | 0 |  |
| LocationState | `location_states` | 8 | 0 | 1 | 1 |  |
| PricingRuleSet | `pricing_rule_sets` | 12 | 1 | 2 | 2 |  |
| TaxComponentRef | `tax_components_ref` | 8 | 0 | 1 | 0 |  |
| TaxRule | `tax_rules` | 21 | 3 | 3 | 1 |  |
| TaxTreatment | `tax_treatments` | 14 | 1 | 1 | 1 |  |
| Document | `documents` | 18 | 3 | 4 | 1 |  |
| DocumentAccessLog | `document_access_logs` | 9 | 3 | 2 | 0 | yes |
| AuditLog | `audit_logs` | 13 | 1 | 3 | 0 | yes |
| AuditLogFailure | `audit_log_failures` | 6 | 0 | 1 | 0 | yes |
| Category | `categories` | 11 | 1 | 2 | 1 |  |
| ProductFamily | `product_families` | 9 | 1 | 2 | 1 |  |
| Product | `products` | 17 | 1 | 3 | 1 |  |
| ProductSpecification | `product_specifications` | 8 | 1 | 1 | 0 |  |
| ProductCompatibility | `product_compatibility` | 9 | 1 | 1 | 0 |  |
| ScrapGrade | `scrap_grades` | 16 | 2 | 5 | 2 |  |
| CompositionAttributeDef | `composition_attribute_defs` | 9 | 0 | 1 | 1 |  |
| GradeCompositionAttribute | `grade_composition_attributes` | 15 | 2 | 2 | 1 |  |
| GradeReferenceSource | `grade_reference_sources` | 9 | 2 | 2 | 0 |  |
| InspectionMethodRef | `inspection_method_refs` | 7 | 0 | 1 | 1 |  |
| MaterialFamily | `material_families` | 10 | 1 | 2 | 2 |  |
| MaterialGrade | `material_grades` | 15 | 1 | 4 | 2 |  |
| Material | `materials` | 11 | 1 | 3 | 2 |  |
| ProductType | `product_types` | 8 | 0 | 1 | 1 |  |
| MaterialProductType | `material_product_types` | 8 | 3 | 3 | 2 |  |
| MaterialAlias | `material_aliases` | 17 | 3 | 4 | 1 |  |
| MaterialAliasVerification | `material_alias_verifications` | 10 | 3 | 2 | 0 | yes |
| MaterialAliasEquivalenceDecision | `material_alias_equivalence_decisions` | 11 | 4 | 3 | 0 | yes |
| SpecTemplate | `spec_templates` | 8 | 1 | 2 | 1 |  |
| SpecAttribute | `spec_attributes` | 9 | 0 | 1 | 1 |  |
| SpecTemplateAttribute | `spec_template_attributes` | 9 | 2 | 1 | 1 |  |
| SearchIntentMapping | `search_intent_mappings` | 11 | 2 | 2 | 1 |  |

### 4.1 Relationships preserved

| Relationship | PostgreSQL | MongoDB |
|---|---|---|
| Category → ProductFamily → Product | FK | `categoryId` / `familyId` + guard |
| MaterialFamily → MaterialGrade → **Material** | FK | `familyId` / `gradeId` (unique) |
| Material → MaterialProductType → ProductType | FK | join rows, `(materialId, productTypeId)` unique |
| Material → MaterialAlias → EquivalenceDecision | FK | `materialId` / `aliasId` + gate |
| SpecTemplate ↔ SpecAttribute | join table | `spec_template_attributes` |
| ScrapGrade → Material | nullable FK | `materialId`, absent on legacy rows |

### 4.2 Indexes created

94 indexes across 45 collections, deterministically named `ix_<collection>_<columns>[_u][_p]`. Full
list: `db/collections/*.mjs` (the source of truth) — verified against the live database by
`npm run db:verify`, which compares key, uniqueness and partial filter in both directions.

---

## 5. Collections and the rules they carry

| Collection | Rules enforced by the server |
|---|---|
| `material_grades` | `(familyId, code)` unique — **6061 and 6063 are distinct and neither can be created twice**; `slug` unique; code not blank |
| `materials` | `gradeId` unique — one canonical material per grade |
| `material_product_types` | `(materialId, productTypeId)` unique; **at most one primary** per material (partial unique) |
| `material_aliases` | `normalisedAlias = lower(trim(alias))`; alias not blank; unique `(normalisedAlias, language)`; retired needs a real date; VERIFIED needs verifier + timestamp + basis + decision + a self-consistent APPROVED gate |
| `material_alias_verifications` | append-only; VERIFIED entry needs a decider |
| `material_alias_equivalence_decisions` | append-only; decided reviews need reviewer + date + non-blank note; APPROVED needs a technical reference **or** evidence |
| `organisations` | `gstin` unique when present; `pan` unique when present; exactly one live PRIMEMET org |
| `pricing_rule_sets` | one ACTIVE per key; `(key, version)` unique |
| `tax_rules` | `invoiceRole` never null; rate 0–100 as decimal; ACTIVE needs approval; `effectiveTo` not before `effectiveFrom`; `(scope, effectiveFrom)` unique among ACTIVE |
| `tax_treatments` | `(code, model, invoiceRole)` unique |
| `documents` | `storageKey` unique; checksum is 64 hex; CLEAN scan needs a result |
| `users` | `email` unique **and** lower-case |
| `sessions` | `tokenHash` unique |
| append-only (7) | no update/delete in the DAO; role grants `find`+`insert` only |

---

## 6. Seed policy

Only two kinds of seed exist, and neither is a business record:

- `tax_components_ref` — **names only** (GST, CGST, IGST, …). No rate, no treatment, no legal
  conclusion. Tax policy remains pending CA confirmation (decisions O-15.4a-P / O-15.5).
- nothing else. No material, grade, alias, organisation, price or listing is seeded. The verification
  suite asserts `tax_treatments` is empty and that no component beyond its own fixture exists.

---

## 7. Initialization and the migration ledger

```
_schema_migrations          -- exactly ONE document per version (unique index on version)
  _id           objectId
  version       int          unique
  name          string
  checksum      sha256 of the migration's OWN file — never of a shared definition module (F-1)
  definitionsDigest sha256 of the declared schema at apply time (db/collections + define + enums)
  appliedAt     date
  appliedBy     "github-actions" | "local"
  status        "applied" | "failed"
  attempts      int          how many times this version has been attempted
  durationMs    int
  collections   [string]
  appVersion    string
  error         string       (present only while the current attempt has failed)
  failedAt      date         (present only while the current attempt has failed)
```

**Properties**

1. **Ledger-gated** — an applied version is skipped, so a second push does nothing.
2. **Retry-safe** — one row per version. A failure updates that row (`status: "failed"`, `attempts`
   incremented, `error` set) and re-throws; the next attempt **transitions the same row** to `applied`.
   Because the version is never consumed by a failure, a transient connection loss cannot brick
   initialization.
3. **Drift-detecting** — if a migration file changes after it was applied, the runner **refuses** with
   an explicit drift error instead of silently diverging. The checksum covers that migration's own
   file only, so `v002` — or any future edit to the shared definitions — cannot disturb `v001`'s
   identity.
4. **Idempotent** — every operation is create-if-absent, `collMod`, or `createIndexes`.
5. **Non-destructive** — no `drop`, `dropDatabase`, `deleteMany` or rename exists anywhere in `db/` or
   `scripts/db-init.mjs`. A re-run leaves existing data untouched (asserted by test).
6. **Read commands do not write** — `--status`, `--dry-run` and `--verify-only` create no collection,
   no index and no ledger. A virgin database is left byte-for-byte unchanged (asserted by test).
7. **Reconcilable** — `--reconcile` re-runs the idempotent `up()` of applied migrations so a database
   that drifted (a hand `collMod`, a dropped index) converges back to the definition. It changes no
   checksum and writes no ledger row; a changed file is still refused.
8. **Self-verifying** — after applying, the CLI runs the same verification used by CI; an
   initialization that cannot prove its result exits non-zero.

Commands: `npm run db:init` · `db:status` · `db:verify` · `db:init -- --dry-run` · `--reconcile` ·
`db:provision` (roles) · `db:check-role` · `check:migrations` (architecture regression).

### 7.1 Migration identity — the F-1 remediation

An independent audit reproduced a structural defect: `v001`'s checksum was computed over its own
file **plus** every collection definition, `define.mjs` and `enums.mjs`. Correcting any shared
definition therefore changed the checksum of an already-applied `v001`, so `v001` failed the drift
check, `v002` was never reached, and reconciliation failed for the same reason. Any legitimate schema
change was blocked, and the only escape was hand-editing the ledger — which nothing sanctions.

**The fix separates three things that were conflated.**

| Question | Answered by | Stored as |
| --- | --- | --- |
| Has this applied migration been edited? | sha256 of **its own file only** | `checksum` |
| Has the declared schema moved on? | digest of all definitions | `definitionsDigest` |
| Does the live database match the declarations? | `db/verify.mjs` | — |

A migration's `source` is now read from its own file and nothing else, so its identity is immutable
by construction: adding or editing shared definitions cannot change it. `DEFINITIONS_DIGEST`
(`db/migrations/index.mjs`) summarises `db/collections/*.mjs` + `define.mjs` + `enums.mjs` and is
recorded on the ledger row **when a row is written** — never inside a checksum.

**Why `v002` cannot disturb `v001`.** Registering `v002` adds a new registry entry with its own
file-derived source; `v001`'s entry, and therefore its checksum, is untouched. Applying skips `v001`
(checksum matches) and applies `v002`, which records the digest current at that moment. Editing a
shared definition still changes `DEFINITIONS_DIGEST` — but that is a *different* control, and it is
the one that now enforces discipline:

- **apply** refuses with `DEFINITIONS_DRIFT` when the declarations have moved and **no** version is
  pending — otherwise nothing would ever converge the database;
- **reconcile** refuses the same condition, because reconciliation restores applied migrations and
  must not become a channel for introducing undeclared schema;
- **`--verify-only`** reports it as a failure with the remedy named, instead of reporting the same
  validator mismatch on dozens of collections;
- **`--status`** states whether the declarations match the applied migrations.

A row with no `definitionsDigest` (written before this change) is treated as *unknown*, not as a
mismatch, so upgrading the runner never rewrites or invalidates history.

**No rebaseline mechanism was added.** With per-file identity, rebaselining is not required: the only
sanctioned way to change the schema is a new version, which the ledger records normally. Adding an
escape hatch would have created the very bypass this fix removes.

**The one-time consequence, stated plainly:** `v001`'s checksum changed from `f15e07fe…` (file +
shared definitions) to the hash of its own file. No database has been initialized, so no ledger row
exists anywhere that records the old value — there is nothing to migrate and nothing to rewrite.

---

## 8. GitHub Actions workflow

`.github/workflows/db-init.yml`

| Property | Implementation |
|---|---|
| Trigger | push to `main` **limited to `db/**`, `scripts/db-init.mjs`, `prisma/schema.prisma`, manifests, the workflow itself**, plus `workflow_dispatch` |
| Approval gate | `environment: production-database` — configure required reviewers in repository settings |
| Concurrency | `group: mongodb-initialization` — two runs can never race |
| Secret | `secrets.MONGODB_URI`; presence is checked, the value is never echoed, and the CLI masks scheme+host |
| Ledger first | `--status` runs before anything is written |
| Only unapplied versions | the runner's ledger skip |
| Verify | `--verify-only` after applying; failure fails the job |
| Destructive work | none exists to run |
| Vercel | never touches the database: no initialization code path exists in the Next.js app |

Inputs: `dry_run` (report only) and `reconcile` (re-apply validators/indexes).

---

## 9. Verification results

`npm run check:mongodb` — **81 assertions, 0 failures**, against a **real `mongod` 7.0.14** replica set
(mongodb-memory-server), not a mock:

- all migrations apply on a fresh database; a second run skips every version
- a changed migration file is refused as drift
- 45 collections + 94 indexes + validators verified in both directions, including that each stored
  validator **matches the definition** rather than merely existing
- unknown field, wrong type, invalid enum and non-lower-case email all rejected
- **a floating-point value is rejected** where money is expected; Decimal128 accepted
- 6061 and 6063 created as distinct grades; duplicate 6061 in one family rejected; same code in another family allowed
- second canonical material per grade rejected; second *primary* product form rejected; non-primary allowed
- alias normalisation rule, blank alias, retirement without timestamp — all rejected
- **D-1**: an alias cannot store a forged approval field; a VERIFIED alias with no decision, an
  APPROVED decision with no reviewer, and one with no evidence are all refused by the database; a
  direct write that borrows another alias's approval, claims a PENDING decision, relabels the basis, or
  points at an approval with no reviewer and no evidence is **detected by reconciliation**
- `verifyAlias` refuses PENDING and borrowed approvals; succeeds only with an APPROVED decision that
  names a reviewer and carries evidence for that alias, then writes history
- **B**: a failing migration throws, records ONE failed row at attempt 1, is retried successfully on the
  same row at attempt 2, is skipped on the third run, and still refuses a changed checksum
- **D**: `--status`, `--dry-run` and `--verify-only` leave a virgin database byte-for-byte unchanged
- **E**: a hand `collMod` is detected by verification, reconciled back to the definition, and reconcile
  changes no checksum, writes no ledger row and still refuses a changed file
- append-only collections: DAO refuses update/delete; role definition grants only find+insert
- `primemet_owner` and `primemet_app` are both defined; the app role cannot change structure
- dangling reference refused before the write; valid reference accepted
- legacy `scrap_grades` row with no `materialId` accepted and never backfilled
- tax: same scope+start rejected by the index; overlapping range refused by the guard; non-overlapping allowed; different invoice role is a different scope
- re-run preserves an existing collection, its document, and existing catalogue state

Offline: `npm run db:validate:offline` **539 assertions, 0 failures**; `npm run check:enums` **24, 0**.

CLI, against a standalone `mongod`: `--status` (0/45, and creates nothing) → apply → second run
*skipped* → `--verify-only` passes. HTTP probe: no `MONGODB_URI` → `200 {"database":"not_configured"}`;
unreachable URI → `503 {"database":"unavailable"}` with no host in the body.

Application gate: `typecheck` 0 errors · `lint` 0 problems · `build` **81/81 pages with no `MONGODB_URI`** · `check:routes` 58 routes · `check:seo` 654/0 · `check:content` 105/0 · `check:wizard` 100/0 · PostgreSQL suites `check:schema` 61/0, `check:catalogue` 55/0, `check:equivalence` 48/0.

---

## 10. Vercel environment variables

| Variable | Value | Scope | Purpose |
|---|---|---|---|
| `MONGODB_URI` | secret | **server only** | primary database connection |
| `NEXT_PUBLIC_APP_URL` | `https://primemet.in` | public | canonical URLs, sitemap, robots — the build **fails** without it in production |
| `MONGODB_DB` | `primemet` (optional) | server only | database name; defaults to `primemet` |

Deliberately **not** used: `DATABASE_URL` / `DIRECT_URL`. The driver needs no particular variable name,
so putting the MongoDB URI in `DATABASE_URL` would have been misleading. They remain accepted-and-ignored
so an existing environment does not fail validation.

Genuinely required later, not now: `AUTH_SECRET` (M2), `ZOHO_SMTP_*` + `MAIL_FROM` (M3).

---

## 11. Remaining risks

1. **Never run against Atlas.** `mongod` 7.0.14 community was used. Atlas is a replica set with its own
   auth and network controls — connection, TLS and `withTransaction` behaviour must be confirmed on the
   real cluster (owner step M‑5).
2. **Referential integrity is application-enforced.** A direct DB write bypasses `db/refs.mjs`.
   Mitigation: least-privilege user, no console access in production, D8 reconciliation checks.
3. **Append-only history depends on the provisioned role.** If the Atlas user is created with
   `readWrite` instead of the `primemet_app` role, history becomes mutable at DB level. Owner step M‑4.
4. **Tax range overlap** is application-enforced; `TAX_RULE_AMBIGUOUS` remains the engine-level backstop.
5. **Decimal scale** (2/3/4 places) is a write-path rule. A writer could store more precision than the
   PostgreSQL column allowed.
6. **`$expr` validators are evaluated per write**, which costs a little throughput on hot collections;
   none of the affected collections is expected to be hot.
7. **mongodb-memory-server downloads a ~590 MB binary** on first run; CI without a cache will be slow.
8. **Phase 2+ tables** (enquiries, lots, orders, invoices, SEO pages, locations) do **not** exist yet —
   this migration covers the 45 collections the schema currently defines.

---

## 12. Manual steps the owner must perform

1. **Create the Atlas cluster** (Mumbai / `ap-south-1`), database `primemet`.
2. **Create two database users** in Atlas → Database Access:
   - the **application** user (used by Vercel) — bound to the `primemet_app` custom role: read/write on
     business collections, **find+insert only** on the 7 append-only ones, no ledger writes and no
     structural actions.
   - the **owner** user (used only by the `db:init` workflow) — bound to `primemet_owner`.
   Run `npm run db:provision -- --apply` with owner credentials to create/update both roles; it is
   idempotent (`createRole` then `updateRole`). Afterwards run `npm run db:check-role` against the
   **application** connection string: it fails if the deployed identity holds an owner role. Owner
   credentials must never be configured in Vercel.
3. **Network access** — allow Vercel's egress (or `0.0.0.0/0` initially), and the GitHub runner.
4. **Add GitHub secrets/vars** — `MONGODB_URI` (**owner** credentials), optional `MONGODB_DB`; create
   the `production-database` environment with required reviewers.
5. **Add Vercel env vars** (§10) and redeploy.
6. **Run the workflow once** (`workflow_dispatch`, `dry_run` first), confirm 45/45 + 188 checks, then
   confirm `/api/health` returns `"database": "connected"`.
7. **Confirm** no Vercel deployment can create or reset the database (it has no code path to do so).

---

## 13. What was deliberately not done

- No commits, no pushes, no Atlas project, no Vercel change.
- No deletion of the Prisma schema, the seven migrations, or the PGlite-based PostgreSQL test suites —
  they remain as the historical reference and still pass.
- No SEO, UI or business-code changes.
- No Phase 2 tables, no authentication, no enquiries.

---

## 14. Corrections after the independent audit

An independent audit of this implementation found five defects and two documentation gaps. All seven are
corrected and covered by regression tests; none is deferred.

| # | Defect | Correction |
|---|---|---|
| **B** | A failed migration inserted a *second* ledger row, permanently occupying the unique `version` key — the next attempt died with `E11000` and initialization was unrecoverable | One document per version. Failure updates the row (`status: "failed"`, `attempts`, `error`); a retry transitions the same row to `applied`. Tests: first attempt fails, retry succeeds, third run skips, changed checksum still refused, a failed attempt does not brick later runs |
| **C** | `scripts/gen-mongo-enums.mjs` harvested uppercase words out of Prisma `///` comments, so `EquivalenceBasis` carried `SAME, AISI, ISRI, A` alongside its three real values | Parsing moved to `scripts/lib/prisma-enums.mjs`, shared by the generator and `npm run check:enums`, which ignores comment lines, trailing comments and attributes, and proves no comment word can become a value |
| **A** | The `equivalenceGate` copy on an alias could be forged: a direct write asserting `APPROVED` was accepted while the real decision was `REJECTED` and belonged to another alias | The copy is deleted — nothing left to assert — and the rule is enforced by `verifyAlias()` (write path) plus `reconcileVerifiedAliases()` (detection, run by `db:verify`). Adversarial tests cover rejected, pending, cross-alias, relabelled basis, missing reviewer, missing evidence and a valid approval |
| **D** | `--status` and `--dry-run` created the ledger collection and its indexes on a virgin database | Every read path goes through `readLedger()`, which never creates. A virgin database is asserted byte-for-byte unchanged after `--status`, `--dry-run` and `--verify-only` |
| **E** | `--reconcile` appended `\u0000reconcile` to each migration's source, changing its checksum and failing the drift check it was meant to respect | `reconcileMigrations()` re-runs the idempotent `up()` of applied migrations, changing no checksum and writing no ledger row. Verification now also compares validator *content*, so the drift it repairs is observable |
| — | `db/provision-roles.mjs` was cited in two code comments but did not exist | Implemented: `npm run db:provision` (plan / `--apply`), `npm run db:check-role`. Roles renamed to the two that matter: `primemet_owner` and `primemet_app` |
| — | `.env.example` claimed every variable was unread, and the migration plan claimed the approval rule had got *stronger* | Both corrected; §2.1 now states which layer enforces what, and that detection is not prevention |
