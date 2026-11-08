# PRIMEMET — P-1 Implementation Plan (post-approval, pre-execution)

**Status: PLAN ONLY. Nothing in this document has been implemented.**
Written 2026-11-01 against `main` @ `aec0f1b77879b9145d4197032c27bd1729a79e97`.

**Revision 4 — 2026-11-01.** The five open questions in §7 are now resolved; see §7 below and §19 of
the decision record. Nothing has been implemented: this file is still a plan.

**Revision 5 — 2026-11-01 (final consistency review).** Six internal inconsistencies were corrected:
stale enum counts (§1.1/§3/§5.1), an incomplete `BOUNDARIES` correction (§7.4.3), duplicate and
mis-ordered v002 actions (§2.2), PostgreSQL migration numbering (§7), the boundary-snapshot ordering
in the execution sequence (§8), and a `§7.4.3` cross-reference to a subsection that did not exist.
No owner decision changed and nothing was implemented; the corrections are listed in §10.

**Revision 6 — 2026-11-01 (final readiness gaps).** Three gaps closed and three premises corrected;
no owner decision changed and nothing was implemented. The M2 identity dependency for listing
approval is now specified (§11, decision record §20.1); G-1 is resolved with measured hashes and a
reproducible boundary check (§5.8, decision record §20.2); G-3 is re-specified, because
`listing_approvals` has **no** PostgreSQL table and the trigger §1.2 promised had nothing to attach
to (§5.7, decision record §20.3). Two of the corrections are in this file: §1.2's migration-9
description and §5.6's G-1 verification command, which named a git reference that does not exist.
See §10 rows 8–12.

**Revision 7 — 2026-11-01 (OD-14 and OD-15).** The owner-role scoping, the corrected audit gate and the
self-approval rule were folded in (§1.1, §1.3, §4.2, §4.3, §5.9, §9.1, §11.1); two findings were raised
that this revision did not resolve — the audit's wildcard blind spot and the missing privilege for
`dropIndex` (decision record §21.5). See §10 rows 13–18.

**Revision 8 — 2026-11-01 (OD-14 findings resolved).** The three findings of decision record §21.5 are
now specified: the corrected permission algorithm (§4.4), the narrowly scoped `dropIndex` exception
(§4.5), and one canonical append-only definition (§4.6). v002's sequence gains a preflight and a
conditional drop (§2.2), the audit fix and the role scoping are scheduled as **one** step (§8 step 1),
and the AU/DX/AP test series is added (§5.10). Two owner items are raised (decision record §22.6).
Nothing has been implemented.

**Revision 9 — 2026-11-01 (OD-16: `dropIndex` rejected).** The owner **rejected** the scoped
`dropIndex` exception proposed in revision 8, because MongoDB grants `dropIndex` per **collection**,
not per index: granting it on `organisations` would also permit dropping the new
`ix_organisations_orgKind_u_p` and that collection's three other indexes. v002 therefore drops
nothing — action 6 is removed, the remaining actions are renumbered (nine, each once), and
`primemet_owner` gains **no** `dropIndex` in any form. `ix_organisations_orgType_u_p` is retained as
documented **technical debt** for a future, separately authorised maintenance operation (§4.5,
decision record §23). The replacement `orgKind` index is created in action 5 and verified
independently (§5.10 DX). Everything else in revision 8 stands, including the corrected
effective-permission audit (§4.4) and the canonical append-only set (§4.6). Nothing has been
implemented.

This plan turns the thirteen owner decisions recorded in
[`PRIMEMET_P1_DECISION_RECORD.md` §18](./PRIMEMET_P1_DECISION_RECORD.md) into an executable
sequence. It names exact files, line anchors and measured counts, all re-verified from the
repository during this pass. Where a decision's premise did not match the code, the plan follows
the **code**, and the mismatch is stated (§18.2 of the decision record).

## 0. Hard boundaries carried by every step

| Boundary | Source | Effect on this plan |
|---|---|---|
| No enquiry write endpoint before M2 | OD-1 | Steps produce **schema + guards**, not routes. Zero new `POST` handlers. |
| Wizards stay preview-only | OD-1 | `src/components/enquiry/*` untouched; disabled submits and "nothing is sent" copy preserved. |
| No aggregate supply counts published | OD-6 | No count field, no count route, no public number. |
| Rating = design only | OD-9 | No `ratings` collection in v002. |
| O-27.1 / O-14.1 out of scope | OD-13 | Not touched. |
| No Atlas, no credentials, no commit/push/deploy | execution restriction | Every verification below runs against throwaway in-memory `mongod`, never a project database. |
| Enums are append-only [C] | architecture §5.1 | `EnquiryStatus` gains nothing (OD-4 confirms). |
| Migration identity = own file bytes only | F-1 fix | v002 must not alter `v001`'s checksum. Verified as test V-F1. |
| **Listing approval is not operational before M2** | OD-10 + §11 | P-1 ships storage, a validator invariant and guards that *take* an actor; it ships no route, no server action and no `POST` handler, so there is nothing to call. Measured: 0 non-GET handlers in `src/`. |

## 1. Exact files to change

### 1.1 Modified — 11 files

| File | Anchor (measured now) | Change | Decisions |
|---|---|---|---|
| `db/define.mjs` | `:89` `enumOf`, `:91` `enumOpt` | Both call one new `resolveEnum(name, ENUMS)` that throws on unknown **or empty**; attach `__enumName` to the returned spec | OD-8 |
| `db/collections/core.mjs` | `:160-161` notes text; `:169-170` `gstin`/`pan`; `:179` `orgType`; `:187` partial index | Add `orgKind` field; repoint the PRIMEMET partial unique index onto `orgKind` instead of `orgType`; correct the note at :160-161 which currently asserts `orgType` does the job | OD-12, §18.2(a) |
| `db/collections/core.mjs` | `:334-356` `supplier_listings` | Add `approvalState`, `approvedById`, `approvedAt`; add validator invariants; add indexes | OD-10 |
| `db/refs.mjs` | `:99-107` `APPEND_ONLY` | **Become a re-export, not a list:** `export { IMMUTABLE_COLLECTIONS as APPEND_ONLY } from "./collections/index.mjs"`. No call site changes; `assertAppendOnly()` behaviour is preserved, and `listing_approvals` then needs no second edit (§4.6) | OD-10, OD-14 |
| `db/roles.mjs` | `:55-68` owner privileges; `:79-112` `auditRoleDefinitions()` | **OD-14.** Replace the owner’s database-wide privilege with an explicit per-collection set: `find`+`insert` on the 7 append-only collections, `find`+`insert`+`update` on the 38 mutable, ledger write retained, **no `delete` anywhere**, structural actions retained and **`dropIndex` granted in no form** (§4.5, OD-16). Then replace the per-privilege loop with the six-step effective-permission algorithm (§4.4), which expands wildcards **before** the append-only test | OD-14 (§21.2, §22.2, §22.3) |
| `scripts/check-mongodb.mjs` | `:751` the 2-name append-only loop; `:1137` a second copy of the structural list | Iterate the **canonical** append-only set instead of two hardcoded names (7 today, not 2); import the structural action list rather than re-declaring it (§4.6, decision record §22.4.6) | OD-14 (§22.4) |
| `db/migrations/index.mjs` | `:106` `MIGRATIONS` | Register `V002` after `V001` | all |
| `scripts/db-verify.mjs` | `:163` (`if (!spec \|\| !Array.isArray(spec.enum)) continue;`) | Replace the silent skip with: if `__enumName` present but `enum` is not an array → **fail**. Add a dead-partial-index rule (§16.4) | OD-8, §16.4 |
| `db/enums.mjs` | generated header states **67 enums** | Regenerated; becomes **74** (+7: `EnquiryJourney`, `EnquiryOutcome`, `EnquiryHoldState`, `ListingApprovalState`, `QualificationScope`, `QualificationMethod`, `QualificationOutcome`). Never hand-edited | OD-2, OD-3, OD-4, Q-1, Q-2 |
| `prisma/schema.prisma` | after `:968` (end of `Organisation`); near `:922` model start | Three new enums + fields on `Organisation` (`orgKind` stays `String` — see §1.4) and `SupplierListing` | OD-2/3/4/10/12 |
| `scripts/check-schema.mjs` | `:197-261` `BOUNDARIES` (two existing entries) | **Two** changes, not one: repoint the existing **D-1** entry's `to:` from `SCHEMA` to `scripts/m1-baseline/schema-d1.prisma`, **and** add the P-1 entry from `schema-d1.prisma` to `SCHEMA`. The repoint is mandatory — the D-1 entry currently compares against the live `prisma/schema.prisma` (`:43`), so any P-1 edit breaks step 3b before the new entry helps (§7.4.3) | Q-1 |

### 1.2 New — 8 files

| Path | Purpose |
|---|---|
| `prisma/migrations/<ts>_p1_enquiry_catalogue_governance/migration.sql` | Additive PostgreSQL counterpart: the P-1 tables **and all seven new enums** (§8 step 3); `organisations.org_kind` unchanged in type; `supplier_listings` approval columns. Revision 4's "7 tables, 3 enums" is stale — re-derive the table count at step 4 and record it in the file header |
| `prisma/migrations/<ts>_p1_constraints/migration.sql` | Hand-written: CHECKs and partial unique indexes (**no** `listing_approvals` trigger — see §5.7; that collection has no PostgreSQL table) |
| `db/migrations/v002-p1-enquiry-and-governance.mjs` | The MongoDB migration (§2) |
| `db/collections/enquiries.mjs` | Seven enquiry/case collections, kept separate from `core.mjs` so a reviewer sees one domain per file |
| `scripts/check-enum-fail-closed.mjs` | E-series regression tests (§5.2) |
| `scripts/check-listing-approval.mjs` | L-series + OD-10/OD-11 enforcement tests |
| `db/collections/supplier_qualifications.mjs` | Q-2: the append-only qualification collection and its document-link child (OD-7-consistent, no array refs) |
| `scripts/m1-baseline/schema-d1.prisma` | Q-1: frozen **pre-P-1** schema snapshot, copied from `prisma/schema.prisma` **before** any P-1 edit. `check:schema` step 3b compares each engine-generated migration with the delta between two frozen snapshots (`scripts/check-schema.mjs:197-261`), and the existing D-1 entry must be repointed here too — see §7.4.3 |

### 1.3 Explicitly NOT changed

`next.config.ts` · `src/**` entirely (no page, component, lib or API route) · `db/tax.mjs` ·
`db/ledger.mjs` · `.github/workflows/db-init.yml` · `package.json` dependencies · the seven PostgreSQL
migrations · `docs/PRIMEMET_STAGE_2_ARCHITECTURE.md` except a status pointer.

**`db/roles.mjs` moved out of this list in revision 7, because of OD-14.** Revision 5 argued it needed
no edit: `primemet_app` already holds `insert`+`find` on append-only collections and full CRUD on
mutable ones, and `listing_approvals` is a *new* collection that inherits the correct app grant
automatically once declared. **That reasoning still holds for `primemet_app` and is unchanged.** It was
silent on `primemet_owner`, which carries a database-wide `update` that overrides every
collection-scoped grant — measured in decision record §21.2.2. OD-14 requires that fixed before any
role is provisioned, so the file is now listed in §1.1.

### 1.4 One deliberate deviation from OD-12's wording

OD-12 says mirror PostgreSQL with `orgKind`. Prisma's `orgKind` is a **`String`**
(`schema.prisma:947`), not an enum — there is no `enum OrgKind` in the schema (grep-confirmed).
`db/enums.mjs` is **generated from Prisma**, so declaring a MongoDB `OrgKind` enum would be erased
by the next `npm run db:enums`. The plan therefore mirrors faithfully:

- MongoDB `orgKind`: `f.str` with a validator pattern restricting to `PRIMEMET|BUYER|SELLER|PARTNER|OTHER` — matching Prisma's string + the SQL CHECK `orgs_org_kind_known` (`migration.sql:186-187`).
- Upgrading Prisma to a real `enum OrgKind` is logged as **follow-up FU-1**, needing its own additive migration; it is *not* folded into P-1.

## 2. Proposed migration version and contents

### 2.1 Identity safety first (this is what F-1 was about)

`db/migrations/index.mjs:100-104` derives each migration's `source` from **its own file only**.
Adding `V002` therefore cannot move `v001`'s checksum — but editing any collection definition
**does** move `DEFINITIONS_DIGEST` (`index.mjs:76-89`), which is intended: apply and reconcile
refuse when the digest moves without a version to carry it. So the order is fixed:

1. Write `db/collections/enquiries.mjs` and edit `core.mjs` **before** registering v002.
2. Register v002 whose `up()` converges the *whole* current definition set.
3. After applying, `--status` shows `definitionsDigest` matching, and verify passes clean.

Doing it in the reverse order produces `DEFINITIONS_DRIFT` on the next run — a loud failure, not a
silent one, which is exactly the behaviour F-1 was designed to give.

### 2.2 `v002-p1-enquiry-and-governance.mjs` — contents

```js
export const V002 = {
  version: 2,
  name: "v002_p1_enquiry_and_governance",
  description: "Add the seven enquiry/journey collections; add listing approval and organisation orgKind",
  async up(db, { log = () => {} } = {}) { /* idempotent convergence */ },
};
```

`up()` performs, in order, all idempotently:

| # | Action | Idempotency mechanism |
|---|---|---|
| 1 | Create the seven enquiry/journey collections with validators (`enquiries`, `enquiry_lines`, `enquiry_clarifications`, `enquiry_events`, `enquiry_parties`, `sourcing_cases`, `serviceable_states`) | existence check via `listCollections`, same as v001 |
| 2 | Create `supplier_qualifications` + `supplier_qualification_documents` with validators (Q-2) | as 1 |
| 3 | Create `listing_approvals` with validator (Q-1, OD-10) | as 1 |
| 4 | Ensure the indexes on all **ten** new collections | `createIndex` is idempotent by key pattern |
| 5 | **Preflight** (read-only): if more than one live `orgKind: "PRIMEMET"` row exists, abort naming the `_id`s and drop nothing. Then `collMod` `organisations` to add `orgKind` (regex pattern `^(PRIMEMET\|BUYER\|SELLER\|PARTNER\|OTHER)$`), **then create** `ix_organisations_orgKind_u_p` | collMod is a replace; createIndex idempotent; the preflight prevents a `DuplicateKey` (11000) that would make every retry fail identically (decision record §22.3.5). The created index is verified **independently of the obsolete one** — present with its exact key, unique, with its exact partial filter, and proven to reject a second live `orgKind: "PRIMEMET"` row (§5.10 DX-2/DX-3; OD-16 req 6) |
| 6 | `collMod` `supplier_listings` for `approvalState`, `approvedById`, `approvedAt` + its `$expr` invariant + approval index (Q-1, OD-10) | as 5 |
| 7 | Re-ensure every other declared index — including `ix_organisations_orgType_accountStatus` — and confirm the **retained, undeclared** `ix_organisations_orgType_u_p` is neither declared nor dropped (OD-16) | catches drift that reconcile would repair; the obsolete index is left exactly as found |
| 8 | Confirm `sourcing_cases.destinationCity` carries **no** `ref` marker (Q-4) | definition-only |
| 9 | Confirm `enquiries` declares `idempotencyToken` + `dedupeKey` with their partial unique index (Q-5) | definition + index |

Each action appears **once**. Revision 4 listed thirteen, of which two were duplicates of the same
drop (`listing_approvals` created twice, `organisations` and `supplier_listings` each `collMod`ed
twice) — and, worse, its action 4 dropped the `orgType` index *before* the `orgKind` index it
depends on was ever created. Revision 9 removes the drop entirely (OD-16): creation is explicit in
action 5 and nothing destroys the obsolete index, so the ordering hazard cannot recur. The table is
**nine actions, 1..9, each exactly once**.

**Nothing in `up()` deletes a document, a field or an index.** No action destroys anything: the
obsolete `ix_organisations_orgType_u_p` is retained (§4.5). It is harmless because the value it
protects can never match — `OrgType = ["BUYER","SELLER","BOTH"]` (`db/enums.mjs:49`), measured, not
assumed. It is also **invisible to `db:verify`**, which checks the indexes a definition *declares* and,
for collections, reports extras without failing (`db/verify.mjs:112-144`): an undeclared extra index
is silently tolerated. That is exactly why retention needs the explicit record in §4.5 and decision
record §23 instead of assuming a checker would notice it.

### 2.3 The seven collections (design summary; fields specified in the proposal §3)

| Collection | Journey relevance | Key rules |
|---|---|---|
| `enquiries` | all three | `journey` **required**, one of 3 values; party-less allowed only when `source = ADMIN_ENTRY` **and** actor + reason present (OD-11) |
| `enquiry_lines` | buyer + mixed | quantity/UoM per line; FK-guarded to `enquiries` |
| `enquiry_clarifications` | all | unknown-field flags; SLA clock deferred (O-27.3) |
| `enquiry_events` | all | append-only lifecycle journal; **not** current state (Option B) |
| `enquiry_parties` | all | requester/contact links, journey-scoped roles |
| `sourcing_cases` | `DIRECT_SOURCING_REQUEST` | target state + city text (OD-7 child collection for serviced states) |
| `serviceable_states` | reference | child collection linking `location_states` to coverage status |

Plus **three** collections outside the enquiry domain: `listing_approvals` (append-only, OD-10) and
`supplier_qualifications` + `supplier_qualification_documents` (append-only, Q-2). Ten new collections
in total: seven enquiry, three governance.

**Serviced-state child collection (OD-7)** replaces the array-of-references option, so
`arrayOfRef` is **not** built and §13.4's ~6-line guard is dropped from scope.

## 3. Backwards-compatibility impact

| Surface | Impact | Evidence / mitigation |
|---|---|---|
| Existing 45 collections | **None removed, none renamed.** 43 untouched; `organisations` and `supplier_listings` gain fields only | Count assertion in `scripts/db-verify.mjs`; measured 45 now |
| `EnquiryStatus` | **Unchanged — 13 values, no additions** | OD-4. Any code or copy citing it keeps working |
| New required field on an *existing* collection | Risk: a pre-existing row without `orgKind` fails the updated validator | Mitigated exactly as D-1 grandfathering did: MongoDB validators apply on insert/update, not retroactively to stored rows, and the field carries a default in the Prisma model (`@default("OTHER")`, `schema.prisma:947`). The migration must therefore **back-fill nothing** and must not add a `$jsonSchema.required` entry that would break future updates of legacy rows — instead `orgKind` is required-with-default at write time |
| `journey` mandatory | Only affects **new** collections; no historical enquiry data exists (no database has been initialised) | Measured: `db/migrations/` holds v001 only; zero live rows anywhere |
| Health endpoint | Unchanged in shape — still the four documented keys (`status`,`version`,`timestamp`,`database`). Two further keys appear **only on a misconfigured environment**: `database_detail` when the connection fails, and `config_errors` carrying a **count**, never the messages (`route.ts:79-80`) | `src/app/api/health/route.ts:71-80`; OD-1 forbids new public write surfaces |
| SEO surface | Unchanged — sitemap 27 URLs, robots, canonicals all preserved | `npm run check:seo` gate |
| PostgreSQL path | Additive migration only; seven existing migrations byte-frozen | Checksums verified each step (§5.4) |
| Generated enums | `db/enums.mjs` regenerated 67 → 74; every existing set must come out identical | `npm run check:enums` compares against Prisma source; E-series asserts comment words never become values |

**No breaking change exists for any consumer**, because there are no consumers yet: grep confirms
zero `POST`/`PUT`/`PATCH` handlers in `src/` and the only database-touching route is the read-only
health probe. That is why this plan can be additive by construction rather than by migration of
live data.

## 4. Permission and validator changes

### 4.1 Validators

| Collection | New invariant | Enforced by | Decision |
|---|---|---|---|
| `define.mjs` helpers | unknown or empty enum name → **throw at import** | code, before any DB contact | OD-8 |
| `organisations` | `orgKind` ∈ five known values; exactly one live `PRIMEMET` row | pattern + partial unique index on `orgKind` | OD-12 |
| `supplier_listings` | `status = ACTIVE` requires `approvalState = APPROVED` **and** `approvedById` **and** `approvedAt` | same-document `$expr` invariant | OD-10 |
| `listing_approvals` | decision ∈ {APPROVED, REJECTED, REVOKED}; approver + timestamp + non-blank reason required for APPROVED | validator + append-only grant | OD-10 |
| `enquiries` | party-less ⇒ `source = ADMIN_ENTRY` ∧ actor ∧ non-blank reason; supply journey ⇒ supplier party mandatory; buyer journey ⇒ requester mandatory | rules A-1…A-6 (§14.2) | OD-11 |
| `enquiries` | stage / outcome / hold are three independent fields; outcome terminal; no forward stage move while held | cross-field CHECK-equivalents; legality of transitions stays in the write path (MongoDB cannot see the old document) | OD-3 |
| `serviceable_states` | coverage status ≠ free text; FK-guarded to `location_states` | `refs.mjs` scalar guard (unchanged machinery) | OD-7 |

Two rules **cannot** live in a validator and are assigned deliberately:

1. **Self-approval ban** — needs the acting identity, which a document does not contain. Server-side
   check in the write path, tested by L-series.
2. **Transition legality** — validators see one document, not old-vs-new. Write-path guard plus
   append-only `enquiry_events` journal, mirroring how D-1 was handled.

### 4.2 Permissions

No additions to `AdminPermission` are strictly required by the enquiry collections (measured: **74**
entries, including `ENQUIRY_VIEW/CREATE/EDIT/CANCEL/ASSIGN/CLOSE` and `PARTY_VIEW/EDIT/VERIFY/SUSPEND`).
Listing approval, however, has no home: grep over all 74 values finds nothing matching `LISTING_*`.
Conflating it with `PARTY_VERIFY` would mix verifying an organisation with approving its inventory.
**Resolved by Q-1 (§19.2 of the decision record): append `LISTING_APPROVE`.** The rejected options are kept for the record:

- **Option 1:** reuse `CATALOGUE_APPROVE_COMPOSITION` semantics — rejected, wrong domain.
- **Option 2:** append `LISTING_APPROVE` to the Prisma `AdminPermission` enum (append-only, permitted
  by [C]) and grant it to `SOURCING_OPS_ADMIN`. **Recommended.** It is one enum value plus one grant,
  and it makes the self-approval rule expressible as "actor must hold `LISTING_APPROVE` and must not
  be the listing's owner".

Because this appends a PostgreSQL enum value it needs a PostgreSQL migration. §7.4 establishes, against the PostgreSQL 17 documentation and the Prisma generator, that the value **can share the P-1 migration** — the "cannot run inside a transaction block" objection applies only to PostgreSQL 11 and earlier. It remains a recommendation; no permission or grant was changed.

### 4.3 Owner role privilege scoping and effective-permission audit (OD-14)

Approved direction, nothing changed. Full analysis: decision record §21.2.

**The defect this closes.** `primemet_owner` holds a database-wide privilege carrying `update`
(`db/roles.mjs`), which applies to all 45 collections — including the 7 append-only ones. A narrower
collection-scoped grant cannot override a broader one, so the owner can rewrite `audit_logs` and
approval history today. Worse, `auditRoleDefinitions()` discards any privilege whose
`resource.collection` is empty **before** the append-only test (`if (!collection) continue`), so the
suite reports clean while the violation is present. Both halves are OD-14 requirements 1 and 5.

**Scoped set (specification):**

| Resource | Actions | Rationale |
|---|---|---|
| 38 mutable collections, each explicit | `find`, `insert`, `update` | seeding, validator repair, backfill |
| 7 append-only collections, each explicit | `find`, `insert` | insert is the only legal mutation (D-2) |
| `_schema_migrations` | `find`, `insert`, `update` | the runner records and retries the ledger |
| database structure | `createCollection`, `collMod`, `createIndex`, `listCollections`, `listIndexes` | what v002 actually performs |
| **`delete`** | **granted nowhere** | no migration performs a delete (`db/README.md:51`); stricter than OD-14 asks |

**Audit fix — resolved by §4.4.** Expanding wildcards before the append-only test is necessary but
not sufficient: the test must run against a **computed effective set per collection**, because MongoDB
grants are additive and a union cannot be judged one privilege at a time (decision record §22.2.1).

**Drift hazard — resolved by §4.6.** `APPEND_ONLY` (`db/refs.mjs:99`) duplicates
`IMMUTABLE_COLLECTIONS` (derived from `immutable: true`); they agree today (7 = 7) as two independent
literals, and the DAO test at `scripts/check-mongodb.mjs:751` holds a **third**, partial copy of two
names. One canonical definition plus three assertions replaces all three.

**Live conflict this surfaced (not caused by OD-14) — resolved by OD-16, §4.5.** §2.2's old action 6
dropped the dead `ix_organisations_orgType_u_p`, but the owner has no `dropIndex`, so it would have
failed on Atlas. The owner **rejected** the scoped grant: MongoDB cannot scope `dropIndex` to a single
index, so it would equally permit dropping `ix_organisations_orgKind_u_p`. §4.5 therefore specifies
retention instead of removal.


### 4.4 Corrected permission audit — effective permissions, not isolated grants (OD-14 req 1 and 5)

Full analysis: decision record §22.2. Nothing changed.

| Step | Requirement | Key point |
|---|---|---|
| A1 | Read collection-level grants | keep role + action list |
| A2 | Expand database-wide grants | a `collection: ""` privilege applies to all 45 collections, the ledger and `system.js`; expansion is **derived**, never written out as literals |
| A3 | Evaluate the effective set per collection | additive union, no deny: a narrower grant never overrides a broader one |
| A4 | Reject UPDATE/DELETE on append-only | neither `update` nor `delete` (nor any structural action) may appear; `find`+`insert` are the only legal mutations |
| A5 | Check every collection, now and future | a collection with **no** applicable policy is a problem, not a default-permit; a wildcard `find` **is** a policy once expanded (guards the `primemet_readonly` false positive) |
| A6 | Fail closed on an unknown permission | any action outside the per-role-class allow-list is a problem, not a warning |

**Return shape unchanged** — an array of problem strings — because `provisionPlan()`
(`db/provision-roles.mjs:35-39`) throws on a non-empty result. The audit is therefore a hard gate on
provisioning, not a report, and under the current definitions it must **fail** (AU-11).

**Scheduling consequence:** the moment the corrected audit exists, the **current** owner definition
fails it and `db:provision` refuses to run. The audit fix and the owner-scope change must therefore
ship in the **same** step — see §8 step 1 (decision record §22.2.6).

### 4.5 The obsolete `orgType` index is retained — `dropIndex` rejected (OD-16)

Full analysis: decision record §23. Nothing changed in code. Revision 8 proposed a collection-scoped
`dropIndex` exception; the owner **rejected** it and chose retention.

| Item | Value |
|---|---|
| Collection | `organisations` |
| Obsolete index | `ix_organisations_orgType_u_p` — `{orgType:1}`, unique, partial `{orgType:"PRIMEMET", deletedAt:null}` |
| **Retained** | yes — v002 drops nothing; **there is no action 6 and no replacement drop step** |
| Replacement index | `ix_organisations_orgKind_u_p` — `{orgKind:1}`, unique, partial `{orgKind:"PRIMEMET", deletedAt:null}`, created in **action 5** |
| Not touched | `ix_organisations_orgType_accountStatus` (non-unique lookup) |
| `primemet_owner` | **no `dropIndex` in any scope** — not collection-level, not database-wide, and no `dropIndexes` |
| Why retention is harmless | the filter can never match: `OrgType = ["BUYER","SELLER","BOTH"]` (`db/enums.mjs:49`), measured |
| Why the rejection stands | MongoDB grants `dropIndex` per **collection**, so a grant on `organisations` would also permit dropping `ix_organisations_orgKind_u_p` — the index that enforces the one-live-PRIMEMET invariant. Removing a dead index does not justify an ability to remove a live one |

**Technical debt, recorded deliberately (OD-16 req 7).** `ix_organisations_orgType_u_p` remains on
`organisations` in every environment and is **not** part of any migration. Removing it requires a
future, separately authorised maintenance operation, not a schema migration, and that operation must
meet all four conditions: its own change record and owner approval; `dropIndex` granted only for the
duration of that operation and revoked afterwards; a pre- and post-operation `listIndexes` capture
proving which index went and that `ix_organisations_orgKind_u_p` survived; and its own test, written
before the change, that fails if the `orgKind` index is absent afterwards.

**It is invisible to the automated checks, which is why this record exists.** `db:verify` checks the
indexes a definition *declares* (`db/verify.mjs:112-137`) and, for collections only, reports extras
without failing (`:139-144`). After step 5 stops declaring the `orgType` index, nothing in the tooling
will mention it again — DX-13 asserts that tolerance explicitly so the silence is a documented
property, not an unnoticed gap.

**No owner confirmation is outstanding.** Decision record §22.6 item 4 (Atlas `dropIndex` spelling) is
withdrawn together with the privilege.

### 4.6 One canonical append-only definition (OD-14 req 7)

Full analysis: decision record §22.4. Nothing changed.

| Source | Today | After |
|---|---|---|
| `db/collections/index.mjs:24` `IMMUTABLE_COLLECTIONS` | derived from `immutable: true` | **canonical** |
| `db/refs.mjs:99-107` `APPEND_ONLY` | hand-written literal, 7 names | `export { IMMUTABLE_COLLECTIONS as APPEND_ONLY } from "./collections/index.mjs"` |
| `scripts/check-mongodb.mjs:751` | **2** hardcoded names drive the DAO refusal loop | iterates the canonical set (7) |
| `scripts/check-mongodb.mjs:1137` | second copy of the structural action list | imports one `STRUCTURAL_ACTIONS` constant |

A literal → re-export is chosen over "recompute the same filter" so a future edit cannot quietly
reintroduce a second source. Registration becomes one act: a collection declared with `immutable: true`
is protected at the DAO layer and at both role layers with no second edit — exactly what
`listing_approvals` needs.

**Assertions (offline):** AP-1 `APPEND_ONLY === IMMUTABLE_COLLECTIONS` · AP-2 every member exists in
`COLLECTIONS_BY_NAME` · AP-3 `db/refs.mjs` holds no string array of collection names, so a hand-written
list fails the check.

## 5. Regression and independent acceptance tests

Every suite below runs against a throwaway in-memory `mongod` replica set and is discarded. No
project database is contacted at any point.

### 5.1 Implementation-authored regression (must stay green)

| Command | Current baseline | Expected after |
|---|---|---|
| `npm run db:validate:offline` | **539 passed, 0 failed** (45 collections, 94 indexes) | ≥ 600 passed, 0 failed; counts rise with 7+1 collections |
| `npm run check:mongodb` | **81 passed, 0 failed** | unchanged result, extended assertions |
| `npm run check:migrations` | **74 passed, 0 failed** | +V-F1 assertions below |
| `npm run check:enums` | **24 passed, 0 failed** | 67 → 74 enums, all matching Prisma |
| `npm run check:schema` | **61 passed, 0 failed** | +P-1 tables/indexes |
| `npm run typecheck` / `lint` / `build` | 0 errors / 0 problems / 81 pages | unchanged |

### 5.2 E-series — enum fail-closed (OD-8)

E-1 unknown name throws · E-2 empty set throws · E-3 valid name returns the same spec shape as today
· **E-4 behaviour-preserving across all current call sites** (measured this revision: 46 `enumOf` + 4 `enumOpt` = 50 uses; the "54" in decision-record §13.1/§13.2 was an unverified recount, corrected in §19.7)
· E-5 `__enumName` stripped before the validator reaches the server · E-6 offline checker fails on an
unresolved enum · E-7 regeneration produces byte-identical output · E-8 capitalised words in `///`
comments cannot become values.

### 5.3 Independent acceptance (written from the decisions, not from the implementation)

| ID | Proves | Decision |
|---|---|---|
| V-F1 | Applying v002 leaves `v001.checksum` byte-identical | F-1 |
| V-A1 | A forged `VERIFIED` alias still detected after all P-1 changes | D-1 |
| V-J1 | An enquiry with no `journey` is refused; each of the three journeys enforces its own party rule | OD-2, OD-11 |
| V-L1 | All 13 original `EnquiryStatus` values still accepted; none added | OD-3, OD-4 |
| V-L2 | Stage/outcome/hold vary independently; outcome is terminal; forward move blocked while held | OD-3 |
| V-G1 | `ACTIVE` listing without approval rejected; with approval accepted; self-approval rejected | OD-10 |
| V-G2 | `listing_approvals` rejects update and delete (privilege + append-only guard) | OD-10 |
| V-O1 | Second live `PRIMEMET` organisation rejected on `orgKind`; two non-PRIMEMET allowed; `OrgType` still exactly 3 values | OD-12 |
| V-S1 | No route renders a supplier aggregate count | OD-6 |
| V-R1 | No `ratings` collection exists | OD-9 |
| V-M1 | `/api/health` still returns four keys; no new public write route appears | OD-1 |

### 5.4 Freeze checks executed before and after every step

```
git rev-parse HEAD                     -> must remain aec0f1b…
git status --porcelain -uall | wc -l   -> recorded, compared
sha256sum prisma/migrations/*/migration.sql -> the seven values below must not move
db/migrations/                         -> v001 file bytes must not change
```

Baseline PostgreSQL checksums: `14b112ac1c37 · 666529830086 · 535763a2867c · 715b04559595 ·
9be041e60ba0 · 61efe699f6f1 · 3d6cf4762925`.

### 5.5 M-series — migration structure (closes the Q-1 claim corrected in §7.4)

| ID | Test | Expectation |
|---|---|---|
| M-1 | The new migration applies to a fresh PostgreSQL 17 harness database | schema matches afterwards; the file is applied as one implicit transaction |
| M-2 | `ALTER TYPE … ADD VALUE` **then use the value in the same transaction** (negative test) | fails with `55P04` "unsafe use of new value" — this is the reason no statement in the P-1 migration may use `LISTING_APPROVE` |
| M-3 | The value is usable in a **subsequent** transaction | writing a row carrying `LISTING_APPROVE` after that commit succeeds |
| M-4 | `check:schema` step 3b with the new `BOUNDARIES` entry; and with a stale `schema-d1.prisma` | passes when the snapshot matches; fails when it does not |
| M-5 | The seven frozen migration checksums | unchanged: `14b112ac1c37 · 666529830086 · 535763a2867c · 715b04559595 · 9be041e60ba0 · 61efe699f6f1 · 3d6cf4762925` |
| M-6 | `npm run db:enums` then `npm run check:enums` | 74 → 75 permissions; generated mirror matches Prisma |

M-2 and M-3 are the only tests here that need a PostgreSQL engine; they run in the existing PGlite
harness alongside `check:schema`. M-4, M-5 and M-6 are offline.

### 5.6 Test gaps identified by the final review (documented, not written)

M-1…M-6 cover the six cases the review brief names. Three further gaps have no test today. They are
listed rather than closed, because this pass writes no tests:

| # | Gap | Why it matters | Suggested form |
| --- | --- | --- | --- |
| G-1 | Nothing proves `scripts/m1-baseline/schema-d1.prisma` equals the pre-P-1 schema | It is a *copy*, and `schema-phase1.prisma` was already once a reconstruction; a wrong snapshot makes step 3b pass against the wrong delta | **RESOLVED — §5.8.** The suggested command here (`git show HEAD:prisma/schema.prisma`) was impossible: the file is not in `HEAD`. Replaced with a boundary regeneration that is enforced by step 3b. |
| G-2 | M-2 proves the *rule* synthetically; nothing scans the committed P-1 migration for a *use* of `LISTING_APPROVE` | §7.4.4's safety rests on that file not using the value; a later hand-edit could reintroduce it | static assertion: the literal appears only in the `ALTER TYPE` line (and its header comment) |
| G-3 | No PostgreSQL-side test of the `listing_approvals` immutability trigger | **The premise was wrong.** `listing_approvals` is a MongoDB collection; there is no `ListingApproval` model in `prisma/schema.prisma`, so no trigger can exist for it | **RE-SPECIFIED — §5.7.** The five required cases are specified against MongoDB (MG-series) and against the PostgreSQL immutable tables that do exist (PG-series). |

One case is deliberately **not** tested: re-running a PostgreSQL migration. There is no mechanism to
re-apply one (unlike MongoDB's retryable ledger), so idempotency is `N/A` for migrations 8 and 9 —
a whole-file transaction either applies once or rolls back.

### 5.7 Immutability acceptance — MG-series (MongoDB, where approvals live) and PG-series (the PostgreSQL trigger that exists)

**Correction that produced this section.** Revision 5 had §1.2's constraints migration installing a
`listing_approvals` immutability trigger, and G-3 asking for it to be tested. Measured:
`grep -nE '^model (SupplierListing|ListingApproval|Enquiry|SupplierQualification)' prisma/schema.prisma`
returns `SupplierListing` **only**. `listing_approvals` exists only as a MongoDB collection (§2.2
action 3, §2.3), so a PostgreSQL trigger for it would have no table. The requirement is therefore
specified twice: where approvals actually live, and against the PostgreSQL tables the D-2 trigger really
protects.

#### 5.7.1 MG-series — `listing_approvals` under the MongoDB role model

Roles from `db/roles.mjs`. These are the five cases the readiness brief names, applied to reality.

| ID | Case | Expected | Assertion detail |
|---|---|---|---|
| MG-1 | INSERT a valid approval under `primemet_app` | permitted, document present | distinguishes immutable from unwritable |
| MG-2 | UPDATE that approval under `primemet_app` | refused by the server (`Unauthorized`) **and** by `assertAppendOnly` in the DAO | assert both layers, in that order |
| MG-3 | DELETE that approval under `primemet_app` | refused by the server | the privilege is absent, not merely unused |
| MG-4 | Application role cannot bypass | the role grants `find, insert` only on the collection; no code path can escalate | valid **only once the Atlas user is bound to `primemet_app`** — an owner step, still outstanding |
| MG-5 | Owner and maintenance roles consistent with the model | `primemet_owner` must not be able to UPDATE history | **expected to FAIL today** — measured, see decision record §20.3.4 and §20.5.1: the owner's database-wide `update` covers append-only collections, and `auditRoleDefinitions()` skips database-wide grants |

MG-5 is written as a failing test on purpose. It is the only assertion in this plan whose expected
result is a defect, so that the defect cannot be forgotten.

#### 5.7.2 PG-series — the trigger on `material_alias_verifications` and `material_alias_equivalence_decisions`

These tables exist and their `BEFORE UPDATE OR DELETE` trigger
(`..._d2_constraints_and_immutability/migration.sql` 194-200) routes through
`pm_reject_history_mutation()` into the unfillable `pm_history_guard` table, whose
`CHECK (false)` is named `pm_append_only_history_rejects_update_and_delete`.

| ID | Case | Expected | Assertion detail |
|---|---|---|---|
| PG-1 | INSERT a valid row as the runtime role | succeeds; row present | proves the table is writable but not mutable |
| PG-2 | UPDATE one inserted row | fails, SQLSTATE `23514`, constraint `pm_append_only_history_rejects_update_and_delete` | assert the **named** constraint, not "an error occurred" |
| PG-3 | DELETE the same row | fails identically; the row still exists afterwards | the row is re-read to prove nothing changed |
| PG-4 | Multi-row UPDATE matching all rows | fails; **zero** rows changed | a row trigger fires on the first row and the statement rolls back |
| PG-5 | Application/runtime role cannot bypass | same rejection for the role the application connects as | the trigger is privilege-independent for DML |
| PG-6 | Owner / maintenance role consistency | **documented residual, not a pass:** a table owner or superuser can `ALTER TABLE … DISABLE TRIGGER` or `DROP TRIGGER`. Closed by not deploying DDL rights to the runtime role (D8), not by SQL | `grep -rniE 'CREATE ROLE\|GRANT\|REVOKE ' prisma/migrations/` → none, so migrations define no roles and no role is exempt from the triggers |

PG-6 is recorded as a residual rather than a test that passes, because "the application role cannot
bypass" is true for DML and false for DDL. The status of these six cases: **specified, not written.**
They belong in `scripts/check-schema.mjs` as a new section after step 3, since that is where PGlite is
already open and the migrations already applied.

### 5.8 G-1 resolved — the frozen baseline, proven rather than asserted

The pre-P-1 datamodel still exists as the working `prisma/schema.prisma`, because P-1 has not started.
Measured this pass: it contains **none** of the P-1 identifiers
(`grep -nic 'listing_approvals\|ListingApproval\|supplier_qualifications\|EnquiryOutcome\|EnquiryHoldState\|LISTING_APPROVE\|enum OrgKind\|sourcing_cases' prisma/schema.prisma` → `0`).

| File | SHA-256 | Lines | Bytes |
| --- | --- | --- | --- |
| `prisma/schema.prisma` (live, pre-P-1) | `1594429609c57e567c52ac152746cdf15ea4a6a3df9222b2471889e00d4acf31` | 2,082 | 81,308 |
| `scripts/m1-baseline/schema.prisma` (frozen M1) | `58a1bbd7e6ee00f7a11291bf8a296b86aabf9b8c7c5ed330d801de0aa225d977` | 1,670 | 58,286 |
| `scripts/m1-baseline/schema-phase1.prisma` (frozen post-Phase-1) | `c918a92632302b0728827bd2b7e321fa173b56e581f84d08b21e20fd9cafe0aa` | 2,003 | 76,010 |
| `scripts/m1-baseline/schema-d1.prisma` | **does not exist yet** — step 3 copies the live file; it must hash to `1594429609c5…4acf31` | | |

**Why a copy taken at step 3 is a baseline and not a reconstruction.** Take a byte copy as the *target*
of the D-1 boundary and regenerate the D-1 migration from it. Measured this pass: the generated body is
**identical** to the committed
`prisma/migrations/20261031140000_d1_equivalence_governance/migration.sql` body. A frozen file with a
recorded checksum reproduces from `schema-phase1.prisma` to the copy exactly, so the copy *is* the D-1
datamodel.

**The one command to re-run after step 3:**

```
node node_modules/prisma/build/index.js migrate diff \
  --from-schema-datamodel scripts/m1-baseline/schema-phase1.prisma \
  --to-schema-datamodel scripts/m1-baseline/schema-d1.prisma \
  --script
```

Its body must equal the committed D-1 migration's body ignoring `--` comment lines and blank lines —
which is exactly what `check:schema` step 3b asserts once boundary 2 is repointed at the snapshot
(§7.4.3). **A wrong snapshot fails the gate; it cannot pass silently.**

**The limitation that does not go away.** `git cat-file -e HEAD:prisma/schema.prisma` →
`fatal: path 'prisma/schema.prisma' exists on disk, but not in 'HEAD'`. No schema or migration file is
version-controlled at `aec0f1b`, so there is no external authority for the chain — only the internal
equalities in decision record §20.2.4 (step 2 for migration 1, boundary 1 for the Phase-1 snapshot,
boundary 2 for the D-1 snapshot) plus the seven recorded migration checksums. Migrations 5 and 7 are
hand-written constraints that no datamodel diff can express, so their only evidence is the checksum.

### 5.9 Append-only negative acceptance — owner cases (RG-1…RG-3, MG-6…MG-10)

OD-14 requirement 6. The MG-series above tests `primemet_app`; these test the **owner**, which is where
the current defect lives (decision record §21.2.6). All are specified, not written.

| ID | Case | Expected | Testable now? |
|---|---|---|---|
| RG-1 | static audit: no wildcard privilege carries `update`, `delete` or any `drop*` | none for any role | only **after** the expansion fix — otherwise the test inherits the blind spot |
| RG-2 | static audit: all 7 append-only collections appear as explicit `find, insert` for the owner | 7 present | yes, offline |
| RG-3 | static audit: `delete` appears in no privilege of any role | none | yes, offline |
| MG-6 | owner **UPDATE** an `audit_logs` row | refused by the server | needs a bound owner credential |
| MG-7 | owner **DELETE** an `audit_logs` row | refused; row re-read and still present | needs a bound owner credential |
| MG-8 | owner **UPDATE/DELETE** a `listing_approvals` row | refused | only after v002 creates the collection |
| MG-9 | `assertAppendOnly()` refuses both, independently of the server | throws | yes |
| MG-10 | app role still cannot (MG-2/MG-3) | unchanged | yes — guards against a fix that loosens the app identity |

MG-6/MG-7 cannot pass until the owner credential is provisioned against the scoped role and bound to a
user; that is an owner step, still outstanding. Until then the assertions are recorded as unverified
rather than assumed green.


### 5.10 AU · DX · AP — the OD-14 finding series (proposed; none written)

Decision record §22.2.7, §22.3.7 and §22.4.5. AU and AP need no server; DX-4…DX-6 and DX-10 need the
owner credential bound to the scoped role, which is still an outstanding provisioning step.

**AU — corrected audit**

| ID | Case | Expectation |
|---|---|---|
| AU-1 | Database-wide **UPDATE** on append-only collections | problem naming collection and action |
| AU-2 | effective set for `audit_logs` | no `update` once fixed; the wildcard's return is caught |
| AU-3 | database-wide DELETE on append-only | problem |
| AU-4 | explicit level UPDATE on a **mutable** collection | **no** problem (no false positive) |
| AU-5 | explicit level INSERT on an **append-only** collection | **no** problem |
| AU-6 | new collection, no policy | problem |
| AU-7 | same collection after registration | clean |
| AU-8 | unknown/unsupported grant | problem |
| AU-9 | `primemet_readonly` wildcard `find` | clean |
| AU-10 | owner ledger privilege | clean |
| AU-11 | `provisionPlan()` under the **current** definitions | throws — the regression proof that the blind spot is closed |
| AU-12 | expansion completeness | equals `COLLECTIONS ∪ {_schema_migrations, system.js}` exactly |

**DX — the replacement index, and the absence of any drop (OD-16)**

| ID | Kind | Case | Expectation |
|---|---|---|---|
| DX-1 | positive | before v002 | `ix_organisations_orgType_u_p` present with its documented filter — the baseline retention preserves |
| DX-2 | positive | after action 5 | `ix_organisations_orgKind_u_p` present with key `{orgKind:1}`, `unique: true`, partial filter exactly `{orgKind:"PRIMEMET", deletedAt:null}` — **verified independently of the obsolete index** (OD-16 req 6) |
| DX-3 | positive | `db:verify` after action 5 | the new index is reported **by name** as verified, not inferred from the survival of the old one |
| DX-4 | negative | insert a second live `orgKind:"PRIMEMET"` row after action 5 | refused, `DuplicateKey` (11000) — uniqueness proven behaviourally, not only structurally |
| DX-5 | positive | after a full apply | `ix_organisations_orgType_u_p` **still present and unchanged**; the lookup index still present; nothing dropped |
| DX-6 | negative | owner attempts `dropIndex` on `organisations` | refused — the owner holds no `drop*` action in any scope |
| DX-7 | negative | owner attempts `dropIndexes` (plural) on `organisations`, or `dropIndex` on any other collection | refused, same reason |
| DX-8 | positive | `--reconcile` twice in a row | both succeed; no drop path is taken, so the `IndexNotFound` (27) retry-failure class cannot occur |
| DX-9 | positive | force failure at action 6, then retry | retry succeeds on the same version |
| DX-10 | negative | two live `orgKind:"PRIMEMET"` rows before action 5 | preflight fails with the `_id`s, creates nothing and drops nothing |
| DX-11 | static | revised role definitions | `dropIndex`, `dropIndexes`, `dropCollection`, `dropDatabase` appear **nowhere** for `primemet_owner` or `primemet_app`; no wildcard privilege carries a `drop*` action (reinforces RG-1) |
| DX-12 | static | `db/collections/core.mjs` after step 5 | `ix_organisations_orgType_u_p` is no longer **declared** (the definition points at `orgKind`), which is why the retained physical index is tolerated rather than reported |
| DX-13 | positive | `db:verify` with the retained obsolete index present | passes — declared indexes are checked and undeclared extras tolerated (`db/verify.mjs:112-144`), so this asserts that the technical debt is tracked by documentation, not by tooling (§4.5) |

**AP — one append-only source**

| ID | Case | Expectation |
|---|---|---|
| AP-1 | set equality | `APPEND_ONLY === IMMUTABLE_COLLECTIONS` |
| AP-2 | membership | every member exists in `COLLECTIONS_BY_NAME` |
| AP-3 | no literal | `db/refs.mjs` contains no string array of collection names |
| AP-4 | `assertAppendOnly` over **all** members | refuses update and delete for all 7 (replaces the 2-name loop) |
| AP-5 | a mutable name | not refused |
| AP-6 | role definitions | both roles hold explicit `find, insert` for every member |
| AP-7 | mutation test — name added to one source only | AP-1 fails; drift cannot be silent |
| AP-8 | new `immutable: true` definition (fixture) | appears in `APPEND_ONLY` with no edit to `db/refs.mjs` |
| AP-9 | `listing_approvals` registration | one declaration protects both layers |
| AP-10 | role audit after AP-8 | missing explicit owner grant is rejected (ties §4.4 A5 to §4.6) |

## 6. Rollback and recovery

**Governing constraint inherited from D-2:** history is immutable, so *rollback means forward-fix,
not rewind*. `reconcile` repairs structure (validators, indexes); it never rewrites ledger history
and never deletes data.

| Failure mode | Recovery | Tested by |
|---|---|---|
| v002 fails mid-apply | Ledger row stays `failed` with error; retry succeeds on the **same version** (defect B fix) | `check:migrations` retry group |
| v002 applied, definitions later found wrong | Register **v003** that converges them; never edit v002 (drift check refuses) | V-F1 + drift tests |
| Validator too strict, blocks legitimate writes | `collMod` via a new version; existing rows are unaffected because validators do not re-check stored documents | fresh-DB + upgrade-path pair |
| Index created wrongly | v003 creates the correct one; the wrong one is left in place and noted (dropping is destructive) | reconcile idempotency |
| Accidental edit to an applied migration | Apply **and** reconcile both refuse with `already applied but its file changed` | defect-E group |
| Definitions moved without a version | `DEFINITIONS_DRIFT` at apply and reconcile; `--verify-only` reports it | digest group |
| Database partially converged | `db:verify` enumerates every mismatch; `--reconcile` heals to the declared state, ledger untouched | defect-E repair group |
| **A PostgreSQL enum value was added, then found wrong** | Enum values are append-only in PostgreSQL: there is no `ALTER TYPE … DROP VALUE`. The value stays and is simply never granted; removing it needs a new type plus a column rewrite — which is why Q-1 adds one value, not three | review before step 4 |
| **The `orgKind` index is never created** | Nothing is dropped, so no index can be lost — but the one-live-PRIMEMET invariant would be unenforced, which is the failure that matters. `db:verify` reports the absent declared index, `--reconcile` re-creates it, and DX-2/DX-4 prove both its structure and its behaviour | DX-2, DX-4 |
| **The obsolete `orgType` index survives indefinitely** | Intended (OD-16): it is retained technical debt. Harmless because its filter can never match (`OrgType` has three values, none `PRIMEMET`). Removing it is a future separately authorised maintenance operation under the four conditions in §4.5 — **never** a migration | DX-5, DX-13 |
| **An operator wants the obsolete index removed anyway** | It cannot be done by a migration: the owner holds no `dropIndex`, and neither does anything else. It requires the four §4.5 conditions (own change record and owner approval; a temporary grant revoked afterwards; before/after `listIndexes`; a test that fails if the `orgKind` index is gone). **Never** widen the standing grant to make a drop work | review before any maintenance window |
| **A wrong index is created on `organisations`** | v002 only creates. The wrong index is left in place and superseded by a later version; removing it would need the same separately authorised operation as the `orgType` debt (§4.5) | `check:mongodb` reconcile group |
| Need to abandon P-1 entirely | Forward-fix only. Collections may exist empty; **no drop path is provided by design** (`primemet_owner` holds no `drop*`) | role audit |

**Recovery rehearsal before production use:** restore a backup into a separate project and run
`db:verify` against it (Atlas setup §8). Not performed here — no Atlas exists yet.

## 7. Q-1 … Q-5 — RESOLVED (recommendations, not implemented)

Resolved from repository evidence on 2026-11-01. Full rationale, anchors and per-question tests are in
`PRIMEMET_P1_DECISION_RECORD.md` **§19**; this section is the operational summary the rest of this plan
now follows. Nothing was changed in `db/`, `prisma/`, `src/` or `scripts/` to match them, and no
database was contacted.

| ID | Question (verbatim) | Resolution | Status |
|---|---|---|---|
| Q-1 | Append `LISTING_APPROVE` to `AdminPermission`, or reuse an existing value? | **Append it.** 74 → 75 values. Granted to `SUPER_ADMIN` and `SOURCING_OPS_ADMIN` only. | DECIDED — recommendation |
| Q-2 | Where does qualification metadata live, given MongoDB has none today (§18.2b)? | **New append-only `supplier_qualifications`** plus a document-link child, separate from enquiries and listings. | DECIDED — recommendation |
| Q-3 | Should `orgKind` become a real Prisma enum (FU-1) in P-1 or after? | **After P-1.** P-1 mirrors it as a pattern-constrained string; FU-1 gets its own additive migration. | DECIDED — recommendation |
| Q-4 | Does `sourcing_cases` need city text until location collections exist? | **Yes** — `destinationCity` free text beside a real `destinationStateId` reference. | DECIDED — recommendation |
| Q-5 | Which milestone owns the M2 intake controls (§14.4 list)? | **M2 owns all ten.** P-1 declares the idempotency and dedupe fields so M2 needs no new migration. | DECIDED — recommendation |

None of the five is a design choice left open, and none is implemented. One consequence still needs
the owner, because it is a schema act rather than a label:

> **OWNER DECISION REQUIRED — expanding the PostgreSQL `admin_permission` enum.**
> Q-1 cannot be implemented without `ALTER TYPE "public"."admin_permission" ADD VALUE 'LISTING_APPROVE';`
> in a new PostgreSQL migration. It is additive and legal on the project's PostgreSQL 17 target, and
> (§7.4) it **may share the P-1 migration**: the "cannot run inside a transaction block" restriction
> ended with PostgreSQL 11. The seven existing migrations stay byte-frozen.
> **Recommendation: authorise it as PostgreSQL migration 8 of nine, merged into the additive P-1
> migration rather than as a separate file.** The only condition is that no statement in that same
> file *uses* the value — verified: nothing does (§7.4.4).
>
> **Migration numbering.** Migration 8 of nine is the engine-generated additive P-1 migration and
> carries the value; migration 9 of nine is the hand-written constraints file. The seven frozen
> migrations are 1–7 and are untouched. **MongoDB `v002` is an unrelated system** with its own ledger;
> it has no numbering relationship with PostgreSQL 8 and its success proves nothing about it (§7.4.5).
>
> Smallest alternatives: **(a)** defer Q-1 and ship listings unapprovable until M2; **(b)** reuse
> `CATALOGUE_PUBLISH` — rejected in §19.2.2, because its tier default includes `CATALOGUE_MANAGER`,
> whom §17.3 defines as holding "no commercial figures", and a listing carries `quantityKg` and the
> supplier's commercial offer.

### 7.1 What each resolution changes in this plan

| Resolution | §1 file list | §2 v002 contents | §5 tests |
|---|---|---|---|
| Q-1 | + `LISTING_APPROVE` in Prisma; + `scripts/m1-baseline/schema-d1.prisma`; + **two** `BOUNDARIES` edits in `scripts/check-schema.mjs` (§7.4.3); + `listing_approvals`; the enum value goes **inside** the P-1 migration (§7.4) | actions 3 and 7 | M-1…M-6, P-1…P-7 |
| Q-2 | + `db/collections/supplier_qualifications.mjs` and a document-link child | action 2 | Q2-1…Q2-6 |
| Q-3 | — (Prisma deliberately untouched in P-1) | actions 5 and 6 | V-O1…V-O3 + the dead-partial-index rule |
| Q-4 | — | action 9 | V-C1, V-C2 |
| Q-5 | — | action 10 | S-7 becomes M2; field presence asserted now |

### 7.2 Acceptance tests added by the resolutions

| ID | Proves | Milestone |
|---|---|---|
| V-C1 | `destinationCity` is absent from `referenceFields("sourcing_cases")`, while `destinationStateId` is present | P-1 |
| V-C2 | A city string equal to a `location_states` name still inserts — no accidental FK attempt | P-1 |
| V-O1 | A second live `PRIMEMET` organisation is rejected on `orgKind`; two non-PRIMEMET rows are allowed; `OrgType` still holds exactly three values | P-1 |
| V-O2 | `orgKind` outside the five permitted values is rejected by the pattern | P-1 |
| V-O3 | The dead `orgType` partial index is gone and the `orgKind` index is present | P-1 |
| V-Q1 | `supplier_qualifications` and its link child reject update and delete under the app role | P-1 |
| V-Q2 | A superseding qualification row leaves the superseded row readable and unchanged | P-1 |
| V-Q3 | `validUntil` in the past yields an expired display state and does **not** clear any listing's `approvalState` | P-1 |

### 7.3 Dependencies left after the resolutions (no owner input needed)

| Dependency | Needed by | Note |
|---|---|---|
| M2 authentication | all ten intake controls (§14.4) | Q-5 |
| M2 | Q-1 requirements 1, 2 and 6 (session, permission check, audit of the actor) | no code reads grants today |
| P-2 | city reference upgrade and any aggregate supply count (OD-6) | Q-4 binds the text field now |
| P-5 | any use of the word "verified" in public copy | §19.3.6 |
| O-27.1 / O-14.1 | contact-share expiry, dispatch override | out of P-1 (OD-13) |
| FU-1 | `String` → `enum OrgKind` on the PostgreSQL side | P-5, before invoicing |
| Schema reconciliation | `admin_permission_grants`: MongoDB allows `GRANT\|DENY`, Prisma documents `GRANT\|REVOKE`; `grantedById` references `users` in one schema and `admin_profiles` in the other | M2, before the first grant is written |

### 7.4 Q-1 migration structure — verified against PostgreSQL 17 and Prisma

**Revision 4 stated this claim wrongly and it is corrected here.** It said an enum value addition
"cannot run inside a transaction block, so it must be its own migration step". That is true of
PostgreSQL **11 and earlier** only.

**Verified 2026-11-01** against the documentation *source* of three branches
(`raw.githubusercontent.com/postgres/postgres`, `doc/src/sgml/ref/alter_type.sgml`), so the wording is
the shipped text rather than a summary:

| Branch | `Notes` |
|---|---|
| `REL_11_STABLE` | "`ALTER TYPE ... ADD VALUE` … **cannot be executed inside a transaction block**." |
| `REL_12_STABLE` | "…is executed inside a transaction block, the new value **cannot be used until after the transaction has been committed**." |
| `REL_17_STABLE` | same wording as 12 |

From **PostgreSQL 12** the statement is legal inside a transaction. The surviving restriction is on
*use* of the value, not on the `ALTER` itself.

**The repository's compatibility target.** `scripts/check-schema.mjs:11` names "PostgreSQL 17 (PGlite,
the WASM build)"; `@electric-sql/pglite` 0.3.16 is pinned; the Prisma datasource is
`provider = "postgresql"` with no version pin.

**How migrations are actually executed here.** There is **no** `prisma migrate` script in
`package.json`, and `.github/workflows/db-init.yml` contains no Prisma step — deployment initialises
**MongoDB**. The only executor of `prisma/migrations/*/migration.sql` is the harness, which applies
each file whole (`scripts/check-schema.mjs:185`: `await db.exec(readFileSync(path, "utf8"))`). A
multi-statement simple-query script is one implicit transaction, so **one file = one transaction** —
precisely the condition the restriction would bite in. No migration file contains `BEGIN`/`COMMIT`
(verified: zero matches across all seven).

**What Prisma actually generates.** `prisma migrate diff` (6.16.2) over a two-value → three-value enum
delta emits exactly one statement, with no `IF NOT EXISTS` and no transaction control:

```sql
ALTER TYPE "public"."admin_permission" ADD VALUE 'LISTING_APPROVE';
```

Hand-adding `IF NOT EXISTS` would break `check:schema` step 3b, which compares the committed migration
body against the generated delta (`scripts/check-schema.mjs:241-261`). Do not hand-edit it.

**Conclusion — the value may share the P-1 migration.** Nothing in the P-1 PostgreSQL migration *uses*
`LISTING_APPROVE`: the rows that carry permissions live in `admin_permission_grants`, a **MongoDB**
collection, and P-1 seeds no grants. The PostgreSQL objects are the enum type and the columns typed
with it; neither assigns a new value here. The one thing that must never appear in that file is a
statement that *uses* the value — a `DEFAULT`, a `CHECK` or partial index naming the literal, or a
seed row. If a later step needs that, it belongs in the next migration (M-2/M-3 prove both halves).

**Why merging is also the cheaper structure.** `check:schema` step 3b needs one frozen snapshot per
engine-generated boundary. A separate one-line migration would add a whole extra snapshot and
boundary entry for a single statement, and the snapshot must be taken from `prisma/schema.prisma`
**before** any P-1 edit (afterwards it would be a reconstruction, which is weaker evidence).

**Backwards compatibility.** The value is append-only; no existing row, default or check references
it; `db/enums.mjs` is regenerated from Prisma, so the MongoDB mirror gains it in the same step and
`check:enums` asserts parity. Nothing becomes invalid, and the seven frozen migrations are untouched.

#### 7.4.3 The `BOUNDARIES` change is two edits, not one

`scripts/check-schema.mjs:197-261` keeps frozen snapshots under `scripts/m1-baseline/`. The D-1
entry's `to:` currently points at `SCHEMA`, which `:43` defines as the live `prisma/schema.prisma`.
That is correct only while D-1 is the newest boundary: the moment P-1 edits `schema.prisma`, the
D-1 delta changes and step 3b fails **before** the new P-1 entry can be reached. So:

| Edit | From | To |
| --- | --- | --- |
| repoint the existing **D-1** entry | `to: SCHEMA` | `to: scripts/m1-baseline/schema-d1.prisma` |
| add the **P-1** entry | `from: scripts/m1-baseline/schema-d1.prisma` | `to: SCHEMA` |

The snapshot `schema-d1.prisma` must be a **copy of `prisma/schema.prisma` taken before any P-1
edit**. Taken afterwards it is a reconstruction, which is weaker evidence — the same objection
recorded against `schema-phase1.prisma` in §18.2.

#### 7.4.4 The value must not be *used* in the same migration

Proven by M-2 rather than assumed: a statement that *uses* the value (`DEFAULT`, a `CHECK`, a
partial index naming the literal, or a seed row) fails in the same transaction with `55P04`
`unsafe use of new value`. Nothing in the P-1 migration needs to; if a later step does, it belongs
in migration 9 or a later version.

#### 7.4.5 PostgreSQL migration 8 ≠ MongoDB `v002`

They are separate systems with separate ledgers and separate identity rules, and success in one
proves nothing about the other:

| | PostgreSQL migration 8 | MongoDB `v002` |
| --- | --- | --- |
| Ledger | `prisma/migrations/` + `_prisma_migrations` | `db/migrations/` + `_schema_migrations` |
| Identity | file bytes, compared by `check:schema` step 3b | own file bytes + `DEFINITIONS_DIGEST` (F-1) |
| Executor | the PGlite harness (`check-schema.mjs:185`); no `prisma migrate` in CI | `db-init.mjs` / `db:verify --reconcile` |
| Content | the `AdminPermission` value + P-1 tables/enums | validators, indexes, `orgKind`, approval fields |
| Failure mode | a whole-file transaction rolls back | ledger row `failed`, retryable on the same version |


## 8. Execution order (to be run only after approval)

Revised in revision 4 to carry the Q-1…Q-5 resolutions. Steps 1–2 are independent of everything else
and provably behaviour-preserving, so they go first: a later failure cannot then be blamed on them.

1. **Enum fail-closed hardening** (`db/define.mjs`) + the offline `__enumName` rule + E-series. No
   signature change; all 50 current call sites unaffected. **In the same step:** the append-only
   canonicalisation (§4.6, AP-1…AP-3) and the corrected audit (§4.4) **together with** the owner
   scoping (§4.3, §4.5). They cannot be split: once the audit is effective-permission based it fails
   the current owner definition, so `db:provision` would refuse to run in the gap (decision record
   §22.2.6). Run AU-11 here: it must now throw.
2. **Dead-partial-index checker rule** (`scripts/db-verify.mjs`) — a pure test addition. Without it the
   inert `orgType` index stays invisible.
3. **Prisma enum additions** (`EnquiryJourney`, `EnquiryOutcome`, `EnquiryHoldState`,
   `ListingApprovalState`, `QualificationScope`, `QualificationMethod`, `QualificationOutcome`) **and
   `LISTING_APPROVE` appended to `AdminPermission`** → `npm run db:enums` → `npm run check:enums`
   (expect 67 → 74 enums and 74 → 75 permissions). **Before the first `schema.prisma` edit**, copy it
   to `scripts/m1-baseline/schema-d1.prisma`: the boundary snapshot must be the pre-P-1 state, not a
   reconstruction (§7.4.3).
4. **PostgreSQL migrations 8 and 9** — the permission value goes **inside** the engine-generated
   additive migration 8 (§7.4); no statement in that file may use the value (§7.4.4). Migration 9 is
   the hand-written constraints file and needs no boundary entry (the D-2 precedent). Apply **both**
   `BOUNDARIES` edits from §7.4.3, then verify the seven frozen checksums are unchanged (M-1…M-5).
5. **Collection definitions**: `db/collections/enquiries.mjs` (new), `supplier_qualifications.mjs` (new),
   and `core.mjs` edits for `organisations.orgKind`, the `supplier_listings` approval fields and the
   index repoint.
6. **Register and apply v002** on a throwaway database, then run the upgrade path over seeded data.
7. **Append-only registration needs no list edit** (§4.6): the three new collections carry
   `immutable: true` in their definitions, and `APPEND_ONLY` follows. Run AP-4 (all 7 members, plus the
   3 new = 10) and AP-6, then re-run the role audit and AU-12. If AP-4 still sees a literal list, step 1
   was not completed.
8. **Guard functions, not routes**: transition legality, self-approval **rule A** (actor ≠ the
   supplier's `userId`), declarer ≠ assessor, admin-entry rules A-1…A-6. Each is a function that
   **takes an actor** and is unit-tested with a synthetic actor; none is wired to HTTP, because there is
   no session layer until M2 (§11). Rule C and the org-level rule B are M2 items — decision record
   §20.1.4 and §20.5.2.
9. **Full gate**: typecheck, lint, build, `db:validate:offline`, `check:mongodb`, `check:migrations`,
   `check:enums`, `check:schema`, `check:routes`, `check:seo`, `check:content`, `check:wizard`.
10. **Independent acceptance suite** (V-series, including V-C1, V-C2, V-O1…V-O3, V-Q1…V-Q3).
    **Stop.** No Atlas, no initialization, no commit.

## 9. What this plan explicitly does not authorise

Creating an Atlas cluster, user, role or API key · running `db:init` against anything persistent ·
adding credentials anywhere · committing, pushing or deploying · enabling any enquiry write endpoint
(before M2) · publishing any aggregate count · building rating storage.

### 9.1 Production initialisation gate

Added in revision 7. Each item must hold **before** the first `db:init` runs against a persistent
cluster, and each is an owner action, not a code change:

| # | Gate | Why it must precede initialisation |
|---|---|---|
| 1 | OD-14 role scoping implemented **and** the role provisioned from it | provisioning the current owner grant embeds a database-wide `update` over append-only history in the live cluster; fixing it later means re-provisioning and re-binding sessions |
| 2 | RG-1…RG-3 pass against the amended `auditRoleDefinitions()` | an audit with an expansion blind spot cannot certify anything |
| 3 | `listing_approvals` registered in the definition, `IMMUTABLE_COLLECTIONS` **and** `APPEND_ONLY` | a half-registered collection is protected in one layer and writable in the other |
| 4 | v002 contains **no** `dropIndex` step (OD-16) and `primemet_owner` holds no `drop*` action in any scope | a migration that needs a privilege the owner does not have aborts mid-run against a live cluster; retention removes that dependency entirely rather than widening the grant to meet it |
| 5 | `db:check-role` wired into the workflow or the deploy | nothing currently proves the runtime identity is the app role |
| 6 | The seven PostgreSQL checksums re-verified and `schema-d1.prisma` in place | §7.4.3; a boundary silently repointed invalidates every later comparison |
| 7 | Platform/region decision recorded (O-27.7) and retention policy (O-27.5) | both remain formally unapproved; neither is a P-1 artifact |

Gate 1 is the substantive one: **the database must not be initialised with a role model that OD-14 has
already superseded.**



## 10. Final consistency review — corrections (revision 5)

Seven documentation defects were corrected against the repository, all found by re-reading the files
rather than by assuming revision 4 was self-consistent. **No design decision changed.**

| # | Defect | Evidence | Correction |
| --- | --- | --- | --- |
| 1 | §1.1/§3/§5.1 said `db/enums.mjs` goes **67 → 70** (+3 enums), while §8 step 3 adds **seven** | step 3 lists `EnquiryJourney`, `EnquiryOutcome`, `EnquiryHoldState`, `ListingApprovalState`, `QualificationScope`, `QualificationMethod`, `QualificationOutcome` | all three sites now read **67 → 74** |
| 2 | The `BOUNDARIES` change was described as "one new entry" | `check-schema.mjs:43` (`SCHEMA`) and `:197-261`; the D-1 entry's `to:` is the live schema, so it breaks the moment P-1 edits it | §1.1, §1.2 and the new §7.4.3 require the repoint **and** the new entry |
| 3 | §2.2 listed 13 v002 actions: `listing_approvals` created twice, two collections `collMod`ed twice, and action 4 dropped the `orgType` index **before** its replacement was created | reading the table | one ordered 10-action sequence; create is action 5, drop is action 6, each action once |
| 4 | "Migration 8" singular vs **two** new PostgreSQL migration files in §1.2 | §1.2 file list | migrations **8 and 9**, stated in §7, §7.4.5 and §8 step 4; only 8 gets a boundary entry |
| 5 | §8 step 4 told the reader to take the snapshot "before editing `schema.prisma`" — but step 3 already edits it | step order | snapshot moved into step 3 |
| 6 | `§7.4.3` was cited twice but **did not exist**; §7.4 had no subsections | grep | §7.4.3–§7.4.5 added (boundary edits, no-use rule, PostgreSQL ≠ MongoDB) |
| 7 | §5.2's E-4 had unbalanced bold; §2.2's `orgKind` pattern contained unescaped pipes inside a table cell | markdown | both fixed; the pattern is now `^(PRIMEMET\|BUYER\|SELLER\|PARTNER\|OTHER)$` |

### Revision 6 corrections (rows 8–12)

| # | Defect | Evidence | Correction |
| --- | --- | --- | --- |
| 8 | §5.6's G-1 verification named `git show HEAD:prisma/schema.prisma` | `git cat-file -e HEAD:prisma/schema.prisma` → `fatal: path … exists on disk, but not in 'HEAD'` | replaced by the boundary-regeneration check in §5.8, which step 3b enforces |
| 9 | §1.2 had the PostgreSQL constraints migration installing a `listing_approvals` immutability trigger | `grep -nE '^model (SupplierListing\|ListingApproval)' prisma/schema.prisma` → `SupplierListing` only | §1.2 now says CHECKs and partial indexes only; §5.7 explains why |
| 10 | G-3's premise (a PostgreSQL trigger for approvals) was void | as row 9 | re-specified as MG-series (MongoDB) plus PG-series (the trigger that exists) |
| 11 | §8 step 8 implied P-1 ships a write path with a self-approval ban | `grep -rnE 'export (async )?function (POST\|PUT\|PATCH\|DELETE)' src/` → 0; `"use server"` → 0 | step 8 now ships guard **functions** taking an actor, unwired until M2 |
| 12 | Nothing stated that `primemet_owner` can UPDATE append-only collections | `db/roles.mjs` database-wide `update`; `auditRoleDefinitions()` skips it via `if (!collection) continue` | MG-5 written as an expected-failing test; decision record §20.3.4, owner decision §20.5.1 |

### Revision 7 corrections (rows 13–18) — OD-14 and OD-15

| # | Defect | Evidence | Correction |
| --- | --- | --- | --- |
| 13 | §1.3 listed `db/roles.mjs` privilege sets as explicitly **not** changed, contradicting OD-14 | OD-14 requires scoped owner privileges | moved to §1.1 (10 files); §1.3 explains that revision 5's reasoning covered only `primemet_app` |
| 14 | §2.2 action 6 drops an index the owner has no privilege to drop | owner actions lack `dropIndex`; `grep dropIndex` → audit lists and one test only | new §4.3 records the conflict and recommends a `dropIndex` grant scoped to `organisations` |
| 15 | Nothing required `listing_approvals` in `APPEND_ONLY` **and** `IMMUTABLE_COLLECTIONS` | `db/refs.mjs:99` is a second literal beside `db/collections/index.mjs:24`; both hold 7, agreeing by coincidence | §1.1 (`db/refs.mjs` row) now requires derivation + equality assertion; §4.3, §9.1 gate 3 |
| 16 | §11 row 4 described rule C as an open data-model question | resolved by OD-15 | row 4 rewritten; §11.1 added |
| 17 | No stated gate between these decisions and a production `db:init` | OD-14 fixes a role that initialisation would provision | new §9.1, seven gates |
| 18 | The self-approval residual could be read as full protection | OD-15 says explicitly it is not | §11.1 states the residual, a scenario table, permitted and **forbidden** wording |

**Boundary check after revision 7:** OD-1…OD-13 unchanged (13 rows); Q-1…Q-5 unchanged (5 rows);
OD-14/OD-15 recorded in decision record §21 and not implemented; no statement claims implementation;
the seven frozen PostgreSQL checksums are unchanged; the MongoDB `v001` file is unchanged.

### Revision 8 corrections (rows 19–24) — the OD-14 findings resolved

| # | Defect | Evidence | Correction |
| --- | --- | --- | --- |
| 19 | The audit fix was described as "expand wildcards before the append-only test", which is insufficient | `auditRoleDefinitions()` tests one privilege at a time; MongoDB grants are additive, so a union cannot be judged that way | §4.4: six-step effective-permission algorithm (A1–A6), per decision record §22.2 |
| 20 | The audit fix and the owner scoping were scheduled as separate steps | `provisionPlan()` throws on a non-empty audit result, so the corrected audit alone makes provisioning refuse to run | §8 step 1 now lands audit + scoping + canonicalisation **together** |
| 21 | v002 action 6 used an unconditional `dropIndex`, so reconcile and retry would fail with `IndexNotFound` (27) on the second run | `reconcileMigrations()` re-runs `up()` (`db/ledger.mjs:311-353`); defect B already showed this failure shape | §2.2 action 6 is now conditional on `listIndexes` |
| 22 | Action 5 could fail permanently on pre-existing duplicate `orgKind:"PRIMEMET"` rows | `createIndex` on a unique index validates existing documents (`DuplicateKey`, 11000) | §2.2 action 5 gains a read-only preflight that names the `_id`s and drops nothing |
| 23 | The `dropIndex` recommendation did not state that MongoDB cannot scope a privilege to one index | privileges are per collection | §4.5 records the limitation, the mitigating controls and the fallback (leave the index; do not widen) |
| 24 | §1.1 omitted `scripts/check-mongodb.mjs`, whose DAO loop tests 2 of 7 append-only names | `scripts/check-mongodb.mjs:751` hardcodes two names | §1.1 row added; AP-4 replaces the loop with the canonical set |

**Boundary check after revision 8:** OD-1…OD-15 unchanged; Q-1…Q-5 unchanged; nothing marked
implemented; decision record §20 and §21 preserve their text and statuses; §22 is additive; the seven
frozen PostgreSQL checksums are unchanged; `db/migrations/` still holds `v001` only; no test was
written or executed; no database was contacted.

### Revision 9 corrections (rows 25–30) — OD-16, `dropIndex` rejected

| # | Defect | Evidence | Correction |
| --- | --- | --- | --- |
| 25 | Revision 8 recommended granting `dropIndex` scoped to `organisations` so that action 6 could run | MongoDB grants `dropIndex` per **collection**, so the grant also covers `ix_organisations_orgKind_u_p` and the three other `organisations` indexes — the limitation §4.5 itself recorded | owner rejected it (OD-16); §2.2 action 6 removed, actions renumbered to **nine**; §4.5 rewritten for retention |
| 26 | Action 6's conditional-drop machinery existed only to make a forbidden operation safe | `IndexNotFound` (27) on a second `up()` run was the reason for the `listIndexes` guard | guard and drop removed together; §4.5, §5.10 DX-8 note that the retry-failure class cannot occur |
| 27 | The obsolete index was described as an artefact to retry removing "in the next version" | `db/verify.mjs:112-137` checks declared indexes only; `:139-144` reports extra **collections** without failing, so an undeclared extra index is reported by nothing | §4.5 records it as technical debt with four removal conditions; DX-13 asserts the tooling tolerance explicitly |
| 28 | The DX series tested a drop that will now never happen (DX-3…DX-9) | OD-16 | DX rewritten: independent verification of the new index (structure **and** behavioural uniqueness, DX-2/DX-4), retention asserted (DX-5), negative tests proving no `drop*` grant exists (DX-6/DX-7/DX-11), tooling tolerance (DX-13) |
| 29 | §9.1 gate 4 required the drop privilege to be "resolved" before initialisation | retention removes the dependency | gate 4 now requires the **absence** of any drop step and of any `drop*` action |
| 30 | Decision record §22.6 left two owner items open (approve the exception, confirm the Atlas action name) | OD-16 rejects the privilege, so there is no name to confirm | both closed in decision record §23.6; §22.6 items annotated as answered, its text preserved |

**Boundary check after revision 9:** OD-1…OD-16 recorded and none marked implemented; Q-1…Q-5
unchanged; no step in this plan requires `dropIndex`, and no role definition it specifies grants one;
`ix_organisations_orgKind_u_p` is created in action 5 and verified independently (DX-2/DX-3/DX-4);
the seven frozen PostgreSQL checksums are unchanged; `db/migrations/` still holds `v001` only; no code,
schema, permission, migration, test or script was changed; no database was contacted.


## 11. Prerequisites before listing approval can operate (M2 identity dependency)

Short form; the analysis, the twelve acceptance tests and the two owner decisions live in
**decision record §20.1** and are not duplicated here.

| # | Prerequisite | Supplied by | Status |
| --- | --- | --- | --- |
| 1 | A session that resolves to a `users` row | M2 | absent — no auth dependency in `package.json`, `src/middleware.ts` passes every request through |
| 2 | An active `admin_profiles` row for that user | M2 | absent — `AdminProfile` exists in both stores, nothing creates one |
| 3 | `LISTING_APPROVE` resolved from `admin_permission_grants`, latest-event-wins (D-ARCH-12), expiry-aware | M2 | the enum value is P-1 (§8 step 3); **nothing reads grants today** (`grep -rn 'admin_permission_grants\|AdminPermissionGrant' src/` → 0) |
| 4 | Self-approval detection — **rule A only** in P-1 | P-1 (rule A) + M2 (rule C, OD-15) | rule A ships as a guard function; **rule C is now decided**: one nullable `submittedByUserId` captured at submission in M2. Rule B remains deferred — no affiliation model exists |
| 5 | An auditable refusal path | M2 | `audit_logs` recording is wired to the write path, which does not exist |

**Why P-1 cannot be bypassed in the meantime**: there is no route, no server action and no `POST`
handler (measured, 0), the validator refuses `ACTIVE` without approver, timestamp and reason, and G-4 —
new, added in step 7 — reports any `ACTIVE` listing that has no `APPROVED` row in `listing_approvals`
as a verification failure. That is prevention where possible and detection everywhere else, the same
posture as D-1.

**What P-1 does not claim**: that unauthorised approval is impossible. `primemet_app` retains `update`
on `supplier_listings`, a mutable collection, so a raw write can still set an approval field. Only M2,
which puts the write behind the guard, removes that.

### 11.1 Residual risk — organisation affiliation is NOT enforced (OD-15)

**This must not be overclaimed anywhere.** OD-15 approves rule A now and rule C at M2, and defers rule B.
Consequently:

> A supplier's employee who also holds administrator privileges can still approve that supplier's
> listings. Rule A compares users; rule C catches only a listing the same administrator personally
> submitted. A colleague's submission passes both rules.

| Scenario | Rule A | Rule C (M2) | Outcome |
|---|---|---|---|
| Administrator owns the supplier profile | blocks | — | prevented |
| Administrator submitted the listing | — | blocks | prevented |
| Colleague at the same supplier submits; administrator approves | passes | passes | **not prevented** |
| Administrator is a director/shareholder, no profile link | passes | passes | **not prevented** |

Permitted wording: *"the approving administrator cannot approve their own supplier profile, nor a
listing they personally submitted (from M2); organisation-level affiliation is not currently modelled
or enforced."* Forbidden wording: "self-approval is prevented", "conflicts of interest are controlled",
"approvals are independent". The same constraint applies to any future admin UI copy.

Rule C's field is `submittedByUserId` — nullable, because historic and admin-entered listings have no
submitter. Null means **unattributable, not automatically permitted**: the guard must state that
explicitly rather than fall through (acceptance SA-C2, decision record §21.3.6).
