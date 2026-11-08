# PRIMEMET — database schema (M1)

The schema is the source of truth for the database. This file records how it is versioned, what it
deliberately does not contain, and the three places where running it taught us something the
architecture document could not have told us by reading.

Read `docs/PRIMEMET_STAGE_2_ARCHITECTURE.md` §28.1 (M1 scope), §5 and §8 (tables) and §15.5 (tax)
alongside this file.

## Files

| Path | What it is |
|---|---|
| `prisma/schema.prisma` | The declarative schema. Every M1 table, enum and relation. |
| `migrations/20261031000000_m1_initial_schema/` | Generated from the schema by `prisma migrate diff --from-empty`. Never hand-edited. |
| `migrations/20261031000100_m1_constraints/` | Hand-written: `btree_gist`, the `EXCLUDE` constraint, CHECK constraints, partial unique indexes, index renaming. |
| `migrations/20261031000200_m1_reference_seeds/` | Reference lists only: tax component names, inspection methods. **No business record.** |
| `../scripts/check-schema.mjs` | `npm run check:schema` — applies all three migrations to a real PostgreSQL 17 (PGlite/WASM) and asserts the constraints on live inserts. |

`prisma/migrations/migration_lock.toml` pins the provider. Do not delete it; `migrate diff` needs it.

## Scope of M1, and what is deliberately absent

Created (34 tables): identity and access (users, sessions, auth_events, admin_profiles, grants,
invitations, organisations, addresses, contacts, verifications, reference_sequences); catalogue
(categories, families, products, specifications, compatibilities, scrap grades, composition
attributes, grade limits, grade sources, inspection methods); parties (supplier/buyer profiles,
supplier listings); pricing rule sets; tax (components, rules, treatments); location_states; documents
and their access log; audit logs and failures; migration runs.

Not created, on purpose — each belongs to a later milestone:

| Absent | Milestone |
|---|---|
| enquiries and lines | M3 (migration 4) |
| supplier matches, supplier quotes | M4 (migration 5) |
| buyer quotes, versions, approvals, quotation snapshots | M5, M6 |
| scrap_lots, lot quantity estimates, lot composition declarations | M6 (migration 8) |
| inspections, versions, measurements, buyer approvals | M6 (migrations 9–10) |
| dispatch, consignments, weighments, rejections, disputes, settlements | M7 (migrations 11–12) |
| orders, invoices, payments, `v_invoice_classification` | M7 (migration 13) |
| districts, cities, industrial areas, coverage, SEO tables, redirects | M8 (migration 17) |
| stock_positions, stock_movements | deferred until `STOCK` is authorised (D6, migration 20) |
| `pricing_components` | §24.2 names the table but no section defines its columns. Not invented; arrives with the engine in M5. |

Their **enums are created now**, because §24.2 puts every enum in migration 1 and an enum value is
append-only. That is why `invoice_role`, `inventory_mode` and forty others exist before their tables.

## Three findings from executing the schema

These are not style notes. Each one would have produced a migration that fails, or a rule that does
not hold, in production.

### 1. The documented `EXCLUDE` expression is not executable

§15.5.2 prints:

```sql
COALESCE("transaction_model"::text, 'ALL') WITH =
```

PostgreSQL rejects it: **`functions in index expression must be marked IMMUTABLE`**. An exclusion
constraint's expression may only use `IMMUTABLE` functions, and the enum-to-text cast resolves through
`enum_out()`, which is `STABLE`. The constraint as written could never have been created.

The migration uses an `IMMUTABLE` SQL wrapper, `pm_tax_scope_model(transaction_model)`, which is safe
because enum labels change only by a committed migration. The alternative — adding an `ALL` label to
`transaction_model` — was rejected: it would put a wildcard token into the business enum that
enquiries, lots and orders all use.

**The architecture document still shows the original expression and should be corrected to match.**

### 2. The date range is inclusive, so back-to-back periods collide

The constraint uses `daterange(effective_from, COALESCE(effective_to, 'infinity'), '[]')`, exactly as
the document specifies. `'[]'` includes both ends, which means:

- a rule ending **31 March** and the next starting **31 March** overlap by one day, and the database
  rejects the pair.

`check-schema.mjs` asserts this behaviour explicitly, so it cannot be changed by accident. If the CA
confirms that consecutive financial years must be expressible without a one-day gap or overlap, the
constraint must switch to `')'` — a decision, not a silent edit.

### 3. Prisma's generated index names collide at 63 bytes

PostgreSQL truncates identifiers to 63 bytes. Prisma generated
`tax_rules_component_code_transaction_model_invoice_role_jur_idx` and a second index whose names differ
only beyond that limit; both truncate onto the same identifier. The constraints migration renames every
index into the document's `ix_<table>_<cols>` convention (§8.1), which removes the collision and makes
later diffs readable. `check-schema.mjs` asserts no index name exceeds 63 bytes.

## One reconciliation inside M1

`buyer_profiles` and `supplier_profiles` are defined twice: §5.3 makes them 1:1 with a **user**, each
carrying `organisation_id`; §8.4 makes them 1:1 with an **organisation**, adding the sourcing and demand
attributes. Migration 3 in §24.2 references the §8.4 shape.

M1 therefore creates **one** table of each name in the §8.4 shape (`organisation_id` unique), and keeps
`user_id` as a **nullable unique** link to the portal user who represents that party — nullable because
an organisation is verified before its first invitation is accepted. No field from either definition is
dropped. This is noted in the schema next to the models.

## Verification

```bash
npm run check:schema   # 46 assertions against PostgreSQL 17 + btree_gist, in-memory, no server needed
npm run db:validate    # prisma validate (needs any DATABASE_URL string; it does not connect)
```

`check:schema` covers: `prisma validate` clean; the committed initial migration matching the schema
byte for byte; all three migrations applying in order; exactly 34 tables and no later-milestone table;
no float or double column; every numeric column carrying an explicit precision; every index name within
63 bytes; the `EXCLUDE` constraint rejecting duplicate `ACTIVE` tax scopes while allowing a different
invoice role, a different transaction model, a different state, and non-overlapping dates; the partial
unique indexes (one PRIMEMET organisation, GSTIN uniqueness only where present, one `ACTIVE` rule set per
key); the CHECK constraints; the reference seeds (11 components, 10 inspection methods, **no** tax
treatment and **no** location); and the absence of `updated_at` on insert-only tables.

The test asserts **why** each rejection happened. A statement rejected for an unrelated reason is a
failure, not a pass.

## Working with the schema later

- **Never** `prisma db push`. Schema change is a committed migration applied by the controlled runner
  (§29.3, §29.5).
- After editing `schema.prisma`, regenerate the diff and compare: `check:schema` fails the moment the
  committed migration and the schema diverge.
- `prisma migrate diff` will always report the hand-written objects (CHECKs, partial indexes, the
  `EXCLUDE` constraint, the function) as drift from the schema. That is expected. Reconcile by keeping
  them, never by dropping the constraint or recreating the table.
- `prisma generate` requires Prisma's engine download. It is a deployment-pipeline step, not a build
  prerequisite: `npm run build` succeeds without a generated client, because `src/lib/db.ts` loads the
  client lazily.

## Runtime behaviour with no database

Unchanged and asserted:

| Condition | `/api/health` | HTTP |
|---|---|---|
| No `DATABASE_URL` | `{"status":"ok","database":"not_configured"}` | 200 |
| `DATABASE_URL` set, `SELECT 1` works | `{"status":"ok","database":"connected"}` | 200 |
| `DATABASE_URL` set, `SELECT 1` fails or times out (2 s) | `{"status":"degraded","database":"unavailable"}` | 503 |

The failure body reports a fixed reason (`connection_failed`, `timeout`, `not_configured`) and never the
connection string.
