# `db/` — MongoDB schema, initialization and guards

Everything the database enforces lives here as version-controlled code. Nothing is created by hand in
a console, and nothing is created by a Vercel deployment.

```
db/
  define.mjs                     DSL: field types → $jsonSchema, index naming, reference vocabulary
  enums.mjs                      GENERATED from prisma/schema.prisma (npm run db:enums)
  collections/
    index.mjs                    the ordered list of all 45 collections + append-only set
    catalogue.mjs                categories, parties' catalogue, canonical identity, aliases, specs
    core.mjs                     identity, organisation, pricing, tax, documents, audit
  migrations/
    index.mjs                    ordered registry; each version's identity is its OWN file only (F-1)
    v001-initial-collections.mjs create collections, converge validators, ensure indexes
  ledger.mjs                     _schema_migrations + applyMigrations + ledgerReport
  verify.mjs                     structural verification against the live database
  refs.mjs                       referential guard, append-only assertion, verifyAlias (D-1)
  tax.mjs                        ACTIVE tax-rule overlap guard (D7)
  roles.mjs                      least-privilege roles + effective-privilege audit (replaces PG triggers)
```

## Commands

| Command | Effect |
|---|---|
| `npm run db:init` | apply pending migrations, then verify |
| `npm run db:status` | print the ledger and collection count; changes nothing |
| `npm run db:verify` | verify the live database against the definitions |
| `npm run db:init -- --dry-run` | report what would be applied |
| `npm run db:init -- --reconcile` | re-apply validators and indexes even if the ledger is current |
| `npm run db:enums` | regenerate `db/enums.mjs` from `prisma/schema.prisma` |
| `npm run db:validate:offline` | validate the DEFINITIONS with no database (539 checks) |
| `npm run check:mongodb` | the full verification suite against a real `mongod` |
| `npm run check:migrations` | migration-architecture regression: identity, evolution, drift, retry |

`MONGODB_URI` is required for the first five; the two `check:*` suites start their own throwaway
server and need nothing.

## Rules that govern changes here

1. **Never edit an applied migration.** The ledger stores a checksum of that migration's own file; an
   edited file is reported as drift and refused by both apply and reconcile. Add a new version to
   `db/migrations/index.mjs`.

   A migration's identity deliberately excludes the shared definitions (`collections/*.mjs`,
   `define.mjs`, `enums.mjs`), so **changing the schema is a two-part act**: edit the definitions and
   add a version whose `up()` converges them. Changing the definitions alone is refused with
   `DEFINITIONS_DRIFT` rather than silently applied by reconcile (F-1; migration plan §7.1).
2. **Never add a destructive operation.** No `drop`, `dropDatabase`, `deleteMany` or rename belongs in
   this directory. Retention is a product concern, not an initialization concern.
3. **A new business rule goes into a validator or an index**, not into a comment. If MongoDB cannot
   express it (cross-document, range overlap), add it to `refs.mjs` or `tax.mjs` and state the residual
   gap in the migration plan.
4. **Optionality is `optional: true`.** `required` is reserved for the JSON-Schema keyword used inside
   nested objects; conflating them silently deleted nested required lists.
5. **Money is `f.decimal()`.** A BSON double is refused by the server. Never `f.int()` for a rate.

## Why the rules live in validators

PostgreSQL enforced ~112 rules with CHECK constraints, partial indexes, an EXCLUDE constraint, foreign
keys and triggers. MongoDB has none of those. Each one is re-expressed in the strongest form MongoDB
offers, and the mapping table is in `docs/PRIMEMET_MONGODB_MIGRATION_PLAN.md` §2.

Two controls are deployment concerns rather than code, and are therefore **manual**:

- the `primemet_app` role from `roles.mjs` must actually be attached to the Atlas user (otherwise
  append-only history becomes mutable);
- the cluster must not be reachable with an admin credential from the application.

### How the privilege split is verified

MongoDB grants are **additive** and a grant naming no collection applies to the whole database, so the
question "can this identity write this collection?" can only be answered by the union of every matching
grant. `auditRoleDefinitions()` therefore expands each role into `effectivePrivilegesFor(role,
collection)` before judging, and every role is checked against all seven append-only collections. A
database-wide `update` is thereby caught rather than skipped.

Consequences worth knowing before editing `roles.mjs`:

- `update` is granted **by collection name** on the mutable set only. Never add it to the wildcard.
- No role holds `delete`, `dropCollection`, `dropIndex`, `dropDatabase` or `renameCollection`.
  Records are retired with `deletedAt`, so no identity needs to remove a document.
- `APPEND_ONLY` in `refs.mjs` is **derived** from `immutable: true` in the collection definitions.
  Declare a collection append-only in one place only; the suite fails if the two disagree.
- The audit fails on an action it cannot classify, so a new MongoDB action must be added to
  `KNOWN_ACTIONS` deliberately rather than silently passing.

## The PostgreSQL past

`prisma/` and its seven migrations are retained unchanged as the historical reference. They still run
under PGlite (`npm run check:schema`, `npm run check:schema:m1`, `npm run check:catalogue`,
`npm run check:equivalence`). The application no longer reads `DATABASE_URL`; see `prisma/README.md`.
## Seeding the platform identity pointer (v010) — required before deploying the app

Migration v010 creates `_platform_identity` and seeds the one document that names the organisation
governing **every** administrator's access. Only one source is authoritative: an organisation id the
owner running the migration supplies explicitly.

```bash
PLATFORM_ORGANISATION_ID=<organisation-id> node scripts/db-init.mjs          # apply + verify
PLATFORM_ORGANISATION_ID=<organisation-id> node scripts/db-init.mjs --reconcile
node scripts/db-init.mjs --platform-organisation <organisation-id>          # same, as a flag
```

The id must name an existing organisation with `orgKind: "PRIMEMET"` that is not soft-deleted. It is
validated before anything is written, so a typo fails the migration instead of anchoring a bad pointer.

**Why it is not derived automatically.** The two obvious sources are both writable by the *application*
identity: the legacy pointer in `_permission_guards` (the runtime holds `update` there to increment the
continuity fence) and the `orgKind` marker on `organisations` (an app-writable column, and W3.1 — a
relabel is still accepted when no competing marker exists — remains open). Nothing the application can
write may decide who administers the platform, so v010 reports both as *hints* in its refusal message and
never adopts either.

### Recovery procedure

1. Run the migration. If it refuses, the message lists the claims it observed and names the failing
   reason: `UNSEEDED` (no id supplied), `NOT_FOUND`, `NOT_OPERATOR`, `RETIRED`, `INVALID_ID`.
2. Establish the operator organisation if it does not exist yet (owner identity), then re-run with
   `PLATFORM_ORGANISATION_ID` set to its id.
3. The failed attempt left version 10 pending and wrote no pointer, so a retry applies cleanly — the
   collection the failed attempt created is converged by `collMod`, nothing is dropped.
4. `node scripts/db-init.mjs --verify-only` must report `protected platform identity names …`. A run that
   says *unseeded (bootstrap pending)* is a database that has no operator claim yet — acceptable on a
   fresh install, never acceptable before deploying the application.
5. Re-anchoring later is an owner action: `updateOne({_id: "platform-identity"}, {$set: {organisationId}})`
   on `_platform_identity`. The runtime identity holds `find` only there and cannot do it.

**Deployment order is not optional:** provision roles → apply migrations (with the id) → `db:verify` →
deploy the application. v010 is a deployment prerequisite: after F1 there is no legacy fallback, so an
application started against a database without a seeded pointer resolves no administrator and refuses
every admin request with `NO_ORGANISATION`.
