# PRIMEMET — B2 Migration Remediation: v006 Backfill Without `bypassDocumentValidation`

**Scope.** M6 production-readiness blocker **B2** only. B3 and B1 were deliberately not started.
**Date.** 2026-11-05. **Repository.** live tree (branch `main`, HEAD `7863743`, 149 uncommitted paths, 0 staged).
**Status.** B2 RESOLVED — verified locally (55/55 properties). Nothing was staged, committed, pushed or deployed;
no production database was contacted (there is no configured `MONGODB_URI`); Workstream 6 and its reviewer
package were not touched; MongoDB remains the only application database.

**Workstream 6 disposition (owner decision, 2026-11-05).** The W6 reviewer package stays exactly as delivered
in the live repository (`docs/reviewer-package/`, 9 files, 2026-11-02): not copied, not duplicated, not modified,
not rerun. Independent reviewer sign-off remains **pending** and security acceptance is **not granted**; this
report does not represent it as complete. This turn is recorded as **delivered with W6 pending**.

---

## 1. Root cause

**Exact failing operation.** `npm run check:authz` (`scripts/check-authz-authenticated.mjs`, line ~199) applies
every migration as `primemet_owner` against an isolated `--auth` replica set. Migration **v006** ran:

```js
db.collection("supplier_listings").updateMany(
  { reviewStatus: { $exists: false } },
  [{ $set: { reviewStatus: "PENDING", submittedAt: {...}, title: {...} } }],
  { bypassDocumentValidation: true },          // <-- the failing option
);
```

MongoDB refused it:

```
not authorized on primemet to execute command { update: "supplier_listings", updates: [ ... ] }
```

**Why it was refused.** `bypassDocumentValidation` is an **administrative** privilege. `db/roles.mjs` gives
`primemet_owner` 43 privileges whose actions are exactly `find`, `insert`, `createCollection`, `collMod`,
`createIndex`, `listCollections`, `listIndexes` and per-collection `update` — `supplier_listings` holds only
`find, insert, update`. The action is **not** in `KNOWN_ACTIONS`, and `scripts/check-mongodb.mjs:1210`
deliberately pushes it onto a rogue owner role and asserts the audit **flags** it. The role was therefore
correct; the migration was asking for an authority the design forbids.

**Why the migration needed it.** Ordering, not data. Each affected migration backfilled **first** and converged
the validator with `collMod` **second**. The pre-migration validator declares `additionalProperties: false`, so a
document carrying the new fields could not be written under it — the write could only succeed by skipping
validation. Three migrations had this shape:

| file | backfilled field(s) | collection |
| --- | --- | --- |
| `db/migrations/v006-phase1-portal.mjs` | `reviewStatus`, `submittedAt`, `title` (required) | `supplier_listings` |
| `db/migrations/v007-catalogue-media.mjs` | `images: []` (optional) | `products` |
| `db/migrations/v008-seller-portal.mjs` | `images: []` (optional) | `supplier_listings` |

**Could the document be made valid without bypassing?** Yes. The current validator **accepts** the post-update
document; the old one rejected it. The blocker was the sequence, not the shape of the data.

## 2. Changes

| File | Change | Why |
| --- | --- | --- |
| `db/migrations/v006-phase1-portal.mjs` | Convergence (`collMod` / `createCollection` + `createIndexes`) moved **before** the backfill; `{ bypassDocumentValidation: true }` removed; `title` now `$substrCP`-truncated to its declared `maxLength: 200`; header documents the ordering rule | The backfill now writes a document the current validator accepts, as `primemet_owner`, with no extra privilege. Truncation guarantees validity for a long legacy `notes` value instead of failing the migration. |
| `db/migrations/v007-catalogue-media.mjs` | Same reorder; bypass removed | `images` is declared optional, so the update validates under the converged validator. |
| `db/migrations/v008-seller-portal.mjs` | Same reorder; bypass removed | Same; all v008 listing fields are optional. |
| `scripts/verify-b2-migration.mjs` (**new**) | B2 evidence harness, 55 properties | Runs the real migrations, through the real ledger, as the real roles, on three isolated in-memory databases. |
| `package.json` | `"verify:b2"` script | Makes the evidence re-runnable. |
| `docs/PRIMEMET_B2_MIGRATION_REMEDIATION.md` (**new**) | This report | Brief §7. Not a general audit. |

**Not changed, deliberately.** No validator was relaxed (`validationLevel: strict`, `validationAction: error`
everywhere). No privilege was granted to `primemet_owner`, `primemet_app` or `primemet_readonly`. No
`bypassDocumentValidation` was added to `KNOWN_ACTIONS` or to any role. No index, collection or document was
dropped. No application (`src/`) code was touched. `db/roles.mjs` is unchanged.

## 3. Migration evidence

`npm run verify:b2` → **55/55 properties held, 0 failures, exit 0.** Both `primemet_owner` and the pre-existing
migration identities were used for the migrations themselves; the root credential was used only to provision roles
and seed fixture documents.

| # | Required test | Result |
| --- | --- | --- |
| 1 | Fresh database through v006 (and to v009) | all 9 versions `applied`; 46 collections, none unexpected, none missing; `verifyDatabase` 0 failures |
| 2 | v005 database upgraded to v006 | v001–v005 applied first, then **only** `6,7,8,9` applied; 2 pre-v006 listings, 2 pre-v007 products, 1 organisation present throughout |
| 3 | Re-run without duplicates | every version `skipped`; one ledger row per version; backfilled document byte-identical; no count drift |
| 4 | Interrupted migration recovery | crash injected at the v006 backfill: validator converged, document un-backfilled, ledger row `failed`; re-run reuses the same row, completes the backfill, `applied`, database reconciles |
| 5 | Existing records intact | listing `notes` (500 chars), `status`, `supplierId`, `categoryLabel`, `createdAt` unchanged; `reviewStatus: "PENDING"`; `title` exactly 200 chars (truncated); `submittedAt` = the document's own `createdAt`; a listing without `notes` gets `"Supplier listing"`; products keep `title`/`slug` and gain `images: []`; organisation unchanged |
| 6 | Validators remain active | every collection `strict` + `error` and equal to the declared schema; writes refused (code 121) for a missing required field, an undeclared property, and `reviewStatus: "BOGUS"` |
| 7 | Indexes remain present | all declared indexes on all 46 collections (`verifyDatabase`) |
| 8 | Intended least-privilege identity | every migration applied as `primemet_owner` under `--auth`; no migration source contains `bypassDocumentValidation:` |
| 9 | App identity refused privileged operations | see §4 |
| 10 | No unintended modification | business document counts identical before/after the upgrade (ledger excluded); no collection created or dropped |

Additional: applying a **changed** already-applied migration is still refused as drift, so the ledger continues to
guard migration history.

## 4. Security evidence

Measured from the live server (`rolesInfo … showPrivileges`), not from the source file:

* `primemet_owner` holds **no** `bypassDocumentValidation` privilege; every action it holds is in `KNOWN_ACTIONS`;
  it still holds `createCollection`, `collMod`, `createIndex`; it holds no `anyResource` and no `admin`-database
  privilege.
* `primemet_owner` is **refused** `updateMany(..., { bypassDocumentValidation: true })` with code **13**
  (Unauthorized) — the fix cannot be "grant the privilege", because the identity is denied it by design.
* `primemet_app` holds no structural or destructive action and is refused (code 13): `createCollection`, `collMod`
  (including `validationLevel: "off"`), `createIndex`, `dropCollection`, `deleteMany` on `audit_logs`, `insertOne`
  into `_schema_migrations`, and `bypassDocumentValidation` on a collection it may otherwise update.
* `primemet_app` **can** still read and write the business collections it exists for; `primemet_readonly` still
  cannot write.
* Migration and runtime identities remain separate; validators are never disabled globally; no credential or URI
  was printed by any command run for this report.

## 5. Regression results

| Command | Result |
| --- | --- |
| `npm run verify:b2` | **55 passed, 0 failed** (exit 0) |
| `npm run check:authz` | **52 properties held, 6 gaps, 0 failures** (exit 0) — was 50/6/**2 failures** |
| `npm run check:migrations` | 74 passed, 0 failed |
| `npm run check:schema` | 61 passed, 0 failed |
| `npm run check:permissions` | 145 passed, 0 failed |
| `npm run check:adversarial` | 97 passed, 0 failed |
| `npm run check:mongodb` | 105 passed, 0 failed (incl. the rogue-role audit that flags `bypassDocumentValidation`) |
| `npm run check:acceptance` | 93/93 assertions |
| `npm run check:remediation` | 130/130 assertions |
| `npm run verify:phase1` | 13 passed, 0 failed — PHASE 1 VERIFIED LOCALLY |
| `npm run verify:m5` | 32 passed, 0 failed — VERIFIED LOCALLY |
| `npm run verify:m1` / `m2` / `m3` / `m4` | 42 / 41 / 28 / 55 passed, 0 failed |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run check:env-blank` | pass |

The 6 `check:authz` gaps are the pre-existing W2.2/W2.6/W3.1/W3.3/W3.4 measurements (application-enforced
controls), unchanged by this work; they are not B2 and not new. `check:content` / `check:wizard` were **not** run:
they are stale assertions against preview copy (49 and 12 known failures), unrelated to migrations, and also need
a production server on port 3100.

## 6. Remaining limitations

1. **No real database exists to test against.** `.env.local` sets no `MONGODB_URI`; every database used here was an
   in-memory single-node replica set (mongod 7.0.14) that died with the process. A managed cluster, its TLS/SCRAM
   configuration and its own role provisioning were not exercised.
2. **The "v005 database" is simulated.** Every migration calls `plansFor()` on the *current* definitions, so a
   database built by applying v001–v005 already carries the newest validator. Pre-v006 documents were therefore
   seeded through the root credential with validation bypassed, to represent rows written before the rule. What is
   proven is that the **migration's own writes** need no bypass — not that some historical snapshot validates.
3. **Migration files are checksums.** Editing v006–v008 changes their hashes, so a database that had already
   applied them with the old files would now be refused as `drift` and would need a new migration version. No such
   database exists in this workspace (no URI configured, all runs in-memory), and the drift guard is proven to
   still fire.
4. **Not tested:** interrupted runs *during* `createIndexes`, concurrent migration runners, oplog/backup/restore,
   Atlas-specific behaviours, `SCRAM-SHA-1`/x.509 authentication, and migrations against a database larger than
   the fixtures (a very large backfill's runtime was not measured).
5. The title truncation is deliberate data normalisation: a legacy `notes` longer than 200 characters becomes a
   200-character `title`. `notes` itself is preserved in full.

## 7. Recommendation

**B2 is resolved.** Migrations v006–v008 no longer request `bypassDocumentValidation`; they converge the validator
first and then backfill under it, so they apply as `primemet_owner` — the least-privilege migration identity — with
no privilege granted, no validator weakened and no documented history rewritten. Fresh install, upgrade from v005,
re-run, interruption recovery and the negative security tests all pass, and M1–M5 plus every affected static check
stay green.

**The migration is safe for controlled staging use** on a fresh database or a database that has not yet applied
v006–v008. Limitations 1–3 should be carried into the staging runbook: apply with the owner identity, on a database
whose ledger has not recorded the previous v006–v008 checksums, and take a backup first.

---

## Appendix — B3 (recorded, NOT started)

Owner instruction, 2026-11-05: **do not begin B3 and do not change build-gate behaviour** until it is
explicitly authorised. The findings are recorded here so they survive this turn; no file outside this
document was touched for B3.

**The defect.** A production build is handed `NEXT_PUBLIC_APP_URL=https://primemet.example` from the local
`.env.local`, and every absolute URL in the rendered output is derived from it. `primemet.example` is a
reserved example TLD: it resolves nowhere and can never be verified, so today's build publishes URLs that
are wrong for any real deployment.

**Where the value comes from.** `src/lib/site-url.ts` (`resolveSiteUrl`) is the single validator and
already enforces https, no credentials, origin-only and no loopback in production; `next.config.ts` calls
it for `PHASE_PRODUCTION_BUILD`/`PHASE_PRODUCTION_SERVER`, and `src/lib/seo.ts` (`SITE_URL`,
`absoluteUrl`) is the only consumer. The weakness is that the validator accepts *any* non-loopback https
origin, so a reserved example domain passes and is baked into the build.

**Observed effect on the built site** (measured earlier this session, build served on :3100):

| Surface | Observed |
| --- | --- |
| Canonical tags | `rel="canonical" href="https://primemet.example…"` on every page |
| Open Graph / metadata | `og:url`, `og:image` and `metadataBase` all resolve to the same origin |
| `robots.txt` | `Host:` and `Sitemap:` lines point at `https://primemet.example/sitemap.xml` |
| `sitemap.xml` | 28 `<loc>` entries, all under `https://primemet.example` |
| Structured data | `Organization`/`WebSite` `@id` anchors built from the same origin |

**What a fix will have to do (not done).** Require the real origin at build time, reject reserved/example
and placeholder hosts in production, keep the build failing when the value is missing or invalid, and leave
a documented local-only path so `verify:phase1`, `check:seo` and the M1–M5 gates can still build without
pretending to be a deployment. `scripts/test-site-url.mjs`, `scripts/check-seo.mjs` and `.env.example`
are all in scope for that change.

**Constraint confirmed twice by the owner:** no file, configuration, test or build gate related to B3 may be
modified before explicit authorisation.
