# PRIMEMET — Workstream 6 Reviewer Package

**Prepared:** 2026-11-02
**Prepared by:** the implementing agent (Exvisit), at owner request
**Status:** **NOT INDEPENDENT ACCEPTANCE.** This document was written by the agent that made the
changes. A separate reviewer must execute §3 and judge the result.
**Revision:** 2 — self-contained. Revision 1 (`docs/PRIMEMET_PHASE1_REVIEWER_PACKAGE.md`) retains the
long-form per-probe narrative and the design history; this document carries the seven elements the
brief requires, in order, and stands on its own.
**Scope:** the Phase 1 security findings (W1, W1-t, W2, W2-s, W3, W4-a, W4-b and the related rows
R1–R3, L1, L2, L6) in the MongoDB permission and identity layer. It does not cover product features;
that assessment is in `docs/PRIMEMET_COMPLETE_PRODUCT_READINESS_AUDIT.md`.

---

## 0. What this package does not claim

1. It does **not** claim that any finding is accepted, independently verified or production-proven.
2. It does **not** claim the platform is operational. There is no authentication in the application, no
   write endpoint and no database connection; the layer reviewed here is a tested database design plus
   an unwired library.
3. It does **not** substitute for a reviewer. Every command in §8 is reproducible; none of them has
   been executed by anyone other than the implementing agent.
4. It does **not** cover M2 authentication. M2 has not started and must not start on the strength of
   this document.

---

## 1. Security findings

| ID | Finding | Classification |
|---|---|---|
| **W1** | An unrecognised or malformed permission `effect` did not fail closed: the row was skipped and an older GRANT — or the tier default — decided. | **FIXED, INDEPENDENT REVIEW PENDING** |
| **W1-t** | The project's own suite asserted that behaviour as correct, so a green run could not detect the defect. | **FIXED, INDEPENDENT REVIEW PENDING** |
| **W2** | Platform identity could be transferred by relabelling an ordinary organisation, because administrator resolution keyed on a mutable marker. | **FIXED, INDEPENDENT REVIEW PENDING** |
| **W2-s** | `organisations.orgKind` is still editable by any identity holding `update` on `organisations`, and the pointer can be re-pointed by the same grant. Measured against an authenticated server: the application identity can relabel and re-point. | **BLOCKED** — needs a privilege change and a new collection, not a patch |
| **W3** | A validator-conforming direct insert into `admin_permission_grants` is accepted *and honoured*, bypassing delegation; `primemet_app` also holds the HMAC key, so the tag is tamper-evidence, not authorisation. | **BLOCKED** — needs a fourth role that alone holds key and insert; measured against an authenticated server |
| **W4-a** | The upgrade path from a pre-`v004` database refused to proceed with no report, no dry run and no backfill. | **FIXED, INDEPENDENT REVIEW PENDING** |
| **W4-b** | Fresh and upgraded databases converge to the same collections, validators and indexes. | **FIXED, INDEPENDENT REVIEW PENDING** |
| **R1** | A non-enumerated `effect` cannot be *written* through the application path (validator, error 121). | **FIXED, INDEPENDENT REVIEW PENDING** |
| **R2** | `v004` restores `orgKind` and the single-PRIMEMET partial unique index. | **FIXED, INDEPENDENT REVIEW PENDING** |
| **R3** | `v002` pre-flight refuses to relax a collection holding non-conforming rows. | **FIXED, INDEPENDENT REVIEW PENDING** |
| **L1** | Field immutability is not expressible as a MongoDB validator. | **BLOCKED** (structural; unchanged) |
| **L2** | Role and privilege enforcement is unobservable without an authenticated server. | **BLOCKED** (unchanged) |
| **L6** | `resolve.ts` is not called from any request path; no route guard exists. Measured in the audit: 35 portal URLs return HTTP 200 to an anonymous client. | **BLOCKED** (M2 scope; unchanged) |

**Why the author labels nothing FIXED AND VERIFIED.** That label means a reviewer reproduced the
evidence and accepted it. Applied by the author it would mean "the agent checked its own work", which is
the failure this package exists to prevent. Where a claim is mechanical — a string is gone, a suite
prints a number — the command is given and the observed output quoted.

**Counts:** 8 findings FIXED, INDEPENDENT REVIEW PENDING · 5 BLOCKED · **0 FIXED AND VERIFIED**.

---

## 2. Fixes and affected files

**New (7):**

| File | Purpose |
|---|---|
| `src/lib/permissions/integrity.ts` | the tag: canonicalisation, signing, verification, `assertSignable` |
| `db/organisation-identity.mjs` | classification, dry run, apply, seeding, consistency reporting |
| `db/migrations/v005-platform-identity.mjs` | guards converged, pointer seeded, log validator and indexes converged |
| `scripts/check-remediation.mjs` | the proof suite, 130 assertions |
| `scripts/check-reviewer-package.mjs` | asserts the package is complete and every command it names resolves |
| `scripts/backfill-organisations.mjs` | operator CLI: dry run by default, `--apply`, `--both-as=PARTNER\|OTHER` |
| `scripts/audit-permission-integrity.mjs` | read-only report: which log rows verify under the current key |

**Modified (10):**

| File | Change |
|---|---|
| `src/lib/permissions/resolve.ts` | fail-closed decision branch, `IntegrityDiagnostic`, `ResolveOptions.integrityKey` |
| `src/lib/permissions/store.ts` | reads the pointer; narrowed marker fallback; signs rows; verifies on read |
| `db/guards.mjs` | `PLATFORM_IDENTITY` kind, `organisationId` field, third `$expr` branch |
| `db/collections/core.mjs` | optional `integrity` field on `admin_permission_grants` |
| `db/migrations/v004-organisation-kind.mjs` | runs the shared classification before converging the validator |
| `db/migrations/index.mjs` | registers `v005` |
| `scripts/check-permissions.mjs` | the contradicting assertion inverted; five new effect cases |
| `scripts/check-acceptance.mjs` | A1 rewritten as the W1 regression |
| `package.json` | `check:remediation`, `audit:permission-integrity`, `db:backfill-organisations` |
| `docs/PRIMEMET_PHASE1_REVIEWER_PACKAGE.md` | revision 1 of this package |

**Documentation added since, changing no behaviour:** `docs/PRIMEMET_COMPLETE_PRODUCT_READINESS_AUDIT.md`,
`docs/PRIMEMET_IMPLEMENTATION_ROADMAP.md`, and this file.

---

## 3. Test reproduction steps

Run in the order given; each step states what a reviewer should see and what would falsify the claim.

1. **Confirm the tree.** `git rev-parse HEAD` → `7863743f20f9938ba1fd2548409ca05cbab0e471`;
   `git status --porcelain -uall | wc -l` → **119** at the time of writing; `git status --porcelain -uall | grep -c '^ M'` → **6**; nothing staged, nothing deleted, no stashes.
   *Falsified if* HEAD differs, or a path is staged, or a modified file has disappeared.
2. **Database definitions.** `npm run db:validate:offline` → **549 passed, 0 failed (45 collections,
   98 indexes)**. *Falsified if* any collection, validator or index is missing.
3. **Database behaviour, in-process.** `npm run check:mongodb` → **105/105**; `npm run check:migrations`
   → **74/74**; `npm run check:enums` → **40/40**; `npm run check:bootstrap` → **23/23**.
4. **The three proofs, in-process.** `npm run check:permissions` → **145/145**;
   `npm run check:remediation` → **130/130**; `npm run check:acceptance` → **93/93**.
5. **The adversarial suite.** `npm run check:adversarial` → **97/97**.
6. **The probe, which reports rather than judges.** `node scripts/reviewer-probe.mjs` executes 14 probes.
   W1-a … W1-h and W4-a must print `MATCHES REQUIRED BEHAVIOUR: YES`; W2-b, W2-c and W3 must print
   `NO`, and §4 explains why those three are expected to fail. *Falsified if* a W1 probe prints NO (the
   fix regressed) or if W2-b, W2-c or W3 prints YES (then the blocker changed and §1 is stale).
7. **Authenticated authorisation.** `npm run check:authz` against a single-node replica set started with
   `--auth` and a keyfile, using per-run credentials: **52 properties held, 6 gaps, 0 failures**; brief
   matrix **14 questions — 9 satisfied, 4 open, 1 blocked**. The four open are `W3.1`, `W3.3`, `W2.2`,
   `W2.6`; the blocked one is `W3.4`. Setup is in revision 1 §9.5 (three roles created from
   `buildRoleDefinitions()`, not copied by hand).
8. **The package's own completeness.** `npm run check:reviewer-package` → **88/88**.
9. **Judgement.** Read the assertions, not the summary lines. A green run of an assertion that checks
   the wrong thing is precisely the failure W1-t recorded.

---

## 4. Expected security behaviour

| Invariant | Enforced by | How a reviewer falsifies it |
|---|---|---|
| An unknown, missing or malformed `effect` never grants | `resolve.ts` fail-closed branch; `IntegrityDiagnostic` returned instead of a decision | Probe W1-a…W1-h; add a row with `effect: "GRANT_ALL"` and check the decision is deny, not the older GRANT |
| An expired or future-dated event does not decide | resolver's instant comparison | Probe W1-f, W1-g |
| Ordering is deterministic at the same millisecond | `seq`, then event id, asserted in W1-h | Probe W1-h with both input orders |
| Relabelling an ordinary organisation does not move authority | protected pointer + `PLATFORM_IDENTITY` guard kind | Probe W2-b: must now be refused, not "UPDATE SUCCEEDED" |
| Authority cannot be re-pointed by deleting the original | `v003` continuity guard + `v005` pointer | Probe W2-c |
| A direct, validator-conforming insert is not honoured | integrity tag verified on read; untagged rows are inert when a key is configured | Probe W3 with `PERMISSION_LOG_KEY` set: must not be honoured |
| Every permission event is append-only | DAO guard refuses update/delete; app role holds `find`/`insert` only | `check:adversarial`; a manual `updateOne` as the app role |
| One PRIMEMET identity only | partial unique index + `$expr` invariant | Insert a second PRIMEMET row: must be refused |
| Upgrade refuses rather than mangles | `PREFLIGHT_FAILED` with the ambiguous id, no ledger row | Set an ambiguous state, run `db:apply`; expect refusal |
| Fresh and upgraded databases converge | W4-a.5/W4-a.6, probe W4-b | Compare collection/validator/index inventories across both paths |

**Two invariants this package explicitly says are NOT held:** W2-s (the app role can still update the
pointer's collection) and W3 (the app role can still insert a conforming, correctly-tagged row). Both are
BLOCKED, both are measured, and both require a role/collection change rather than a code fix.

---

## 5. Migration verification evidence

Migrations: `v001-initial-collections`, `v002-permission-grant-effects`,
`v003-super-admin-continuity-guard`, `v004-organisation-kind`, `v005-platform-identity` — contiguous
1–5 and unique (`db/migrations/index.mjs`, `assertUniqueVersions`).

| Property | Evidence |
|---|---|
| A migration's identity is its own file bytes | `source: migrationFileSource("<file>")`; `DEFINITIONS_DIGEST` recorded separately by `db/ledger.mjs` |
| Fresh install applies 1→5 and records all five | `check:remediation` W4-a.1: ledger contains `[1,2,3,4,5]` |
| A fresh install invents no platform identity | W4-a.1: pointer absent with no organisations, no error |
| The upgrade refuses rather than mangling data | W4-a.2: `PREFLIGHT_FAILED`, ambiguous id in the message, no ledger row |
| The upgrade completes once the state is decidable | W4-a.5: `PRIMEMET_BACKFILL_BOTH_AS=OTHER`, versions 4 and 5 recorded |
| Both paths converge | W4-a.5/W4-a.6 plus probe W4-b: 46 collections, 0 structural differences |
| `up()` is idempotent | W4-a.7: re-running `v004` and `v005` neither duplicates a ledger row nor moves the pointer |
| `v005` converges the log's validator and indexes | `collMod` + `createIndexes` on `admin_permission_grants`; `integrity` optional so pre-`v005` rows stay readable |
| `v001` unchanged this round | the registry reads its own bytes, so its checksum is a function of that file alone; the file is untracked, so Git cannot show a diff — hash it before and after any change |
| Historical Prisma migrations untouched | `git status --porcelain -uall prisma/ \| grep -v '^??'` returns nothing (11 entries, all untracked additions) |

**Deployment consequence, stated rather than glossed.** `v004-organisation-kind.mjs` was **edited** in
this round, so its checksum changed. `db:status`/`applyMigrations` compare checksums: **a database that
has already applied `v004` will fail the drift check and refuse to proceed** — loudly, which is
intended, but an operator must know it. No database in this workspace has applied `v004`. A real
deployment that has must either restore `v004`'s original bytes before the first apply or treat the
change as a new version.

**Also true, and outside this workstream:** no migration in `db/migrations/` defines a down path
(measured: 0 matches for `rollback|revert|down`), so rollback is a redeploy-and-restore operation, not a
`down()` call.

---

## 6. Measured results on this tree (2026-11-02)

| Command | Result |
|---|---|
| `npm run db:validate:offline` | 549 passed, 0 failed — 45 collections, 98 indexes |
| `npm run check:mongodb` | 105 passed, 0 failed |
| `npm run check:migrations` | 74 passed, 0 failed |
| `npm run check:enums` | 40 passed, 0 failed |
| `npm run check:permissions` | 145 passed, 0 failed |
| `npm run check:adversarial` | 97 passed, 0 failed |
| `npm run check:remediation` | 130/130 assertions passed |
| `npm run check:acceptance` | 93/93 assertions passed |
| `npm run check:bootstrap` | 23 passed, 0 failed |
| `npm run check:reviewer-package` | 88/88 assertions passed |
| `npm run check:authz` | 52 properties held, 6 gaps, 0 failures; matrix 14 = 9 satisfied / 4 open / 1 blocked |
| `node scripts/reviewer-probe.mjs` | 14 probes; W1-a…W1-h and W4-a = YES; W2-b, W2-c, W3 = NO |
| `npm run audit:permission-integrity` | exit 1 — `MONGODB_URI is not set. Nothing was read; nothing was changed.` (correct refusal) |
| `npm run typecheck` / `npm run lint` / `npm run build` | exit 0 / exit 0 / exit 0, Next.js 15.5.28, 82/82 static pages |

These were run by the implementing agent. **They are evidence for a reviewer, not a verdict.**

---

## 7. Remaining limitations

1. **No managed cluster.** Every database suite above runs against `mongodb-memory-server` (mongod
   7.0.14) on this machine, or against a local single-node replica set with `--auth`. No Atlas, no TLS
   termination, no SCRAM against a managed cluster, no proxy, no latency.
2. **W2-s and W3 are BLOCKED, not fixed.** Closing them changes roles and collections: a fourth role
   holding the key and the insert grant; the pointer moved to a collection the app role cannot update
   (migration `v006`).
3. **L1, L2, L6 remain BLOCKED.** Field immutability is not expressible as a MongoDB validator; role
   enforcement is only observable on an authenticated server; `resolve.ts` has no caller in a request
   path.
4. **The suites are author-written.** They are self-consistent, not independently validated. No
   external reviewer has executed any command in §3.
5. **No production verification of any kind.** Nothing is deployed; no production data or credentials
   were contacted.
6. **No migration rollback path** exists (§5).
7. **No application-level security surface to test**: no session, no CSRF token, no rate limiter, no
   security headers, and no endpoint that returns a record. Those are M2 scope and are listed as
   findings in the product audit, not here.

---

## 8. Exact commands another engineer can run

```bash
# 0. Environment (Windows: use npm.cmd / npx.cmd)
git rev-parse HEAD                 # expect 7863743f20f9938ba1fd2548409ca05cbab0e471
git status --porcelain -uall | wc -l   # expect 108 at the time of writing; 6 lines start with " M"

# 1. Definitions and schema
npm run db:validate:offline        # expect 549 passed, 0 failed (45 collections, 98 indexes)
npm run check:mongodb              # expect 105 passed, 0 failed
npm run check:migrations           # expect 74 passed, 0 failed
npm run check:enums                # expect 40 passed, 0 failed
npm run check:bootstrap            # expect 23 passed, 0 failed

# 2. The permission and identity proofs
npm run check:permissions          # expect 145 passed, 0 failed
npm run check:remediation          # expect 130/130 assertions passed
npm run check:acceptance           # expect 93/93 assertions passed
npm run check:adversarial          # expect 97 passed, 0 failed

# 3. Behaviour probe (reports; does not judge)
node scripts/reviewer-probe.mjs    # W1-a..W1-h, W4-a => YES; W2-b, W2-c, W3 => NO

# 4. Authenticated authorisation against a replica set started with --auth + keyfile,
#    roles created from buildRoleDefinitions() (see revision 1, §9.5)
npm run check:authz                # expect 52 properties held, 6 gaps, 0 failures; matrix 9/4/1

# 5. Package completeness and the application gate
npm run check:reviewer-package     # expect 88/88 assertions passed
npm run typecheck && npm run lint && npm run build   # expect 0/0/0, 82/82 static pages

# 6. Operator CLIs (read-only unless --apply is passed)
npm run db:backfill-organisations  # dry run by default; prints the classification
npm run audit:permission-integrity # refuses when MONGODB_URI is unset — by design
```

A reviewer who gets a different number has found something; that is the point of the package.

---

## 9. Recommendation

**Ready to be handed to a separate engineer** for review of W1, W1-t, W2 (resolution), W4-a and W4-b.
**Not ready for any claim** that W3 is solved, that `orgKind` is immutable, or that Phase 1 is
security-complete.

The review is complete only when a reviewer who did not write this code has executed §3, read the
assertions, and reached their own conclusion about the two BLOCKED items. Until then every finding here
keeps the label **FIXED, INDEPENDENT REVIEW PENDING** or **BLOCKED** — and **M2 authentication must not
begin**.

---

## 10. What would change each classification

| From | To | Required evidence |
|---|---|---|
| FIXED, INDEPENDENT REVIEW PENDING | **FIXED AND VERIFIED** | An independent reviewer runs §3, reproduces the quoted numbers and records their own sign-off |
| BLOCKED (W2-s) | FIXED, INDEPENDENT REVIEW PENDING | Migration `v006` moves the pointer to a collection the app role cannot update; `check:authz` W2.2/W2.6 flip to SATISFIED |
| BLOCKED (W3) | FIXED, INDEPENDENT REVIEW PENDING | A fourth role alone holds `PERMISSION_LOG_KEY` and `insert` on `admin_permission_grants`; `primemet_app` loses `insert`; W3.1/W3.3 flip and W3.4 becomes testable |
| BLOCKED (L6) | FIXED, INDEPENDENT REVIEW PENDING | `middleware.ts` guard plus a session; the anonymous probe returns non-200 for all 35 portal URLs |
| Any FIXED | **OPEN** (regression) | A probe or suite prints the pre-fix behaviour; the failure is recorded before any fix is attempted |

---

## 11. Closure record (2026-11-02)

**Workstream 6: DELIVERABLE COMPLETE. SECURITY ACCEPTANCE: BLOCKED / PENDING INDEPENDENT REVIEW.**

Owner decision, recorded 2026-11-02. The seven deliverable elements in §1–§8 exist and pass their checks.
The findings keep the classifications in §1 unchanged:

- **8 FIXED — INDEPENDENT REVIEW PENDING:** W1, W1-t, W2, W4-a, W4-b, R1, R2, R3.
- **5 BLOCKED:** W2-s, W3, L1, L2, L6.
- **0 FIXED AND VERIFIED.**

Independent security review remains an outstanding acceptance dependency, and M2 authentication must not
begin. The two-axis status — deliverable completion versus security acceptance — is maintained in
`docs/PRIMEMET_WORKSTREAM_TRACKER.md`, which keeps the binary completion status **UNMET** because the
acceptance criteria are not satisfied, and the packaged form of this package is in
`docs/reviewer-package/` — one document per required element plus an index.

No classification was changed, no blocked finding was removed or downgraded, and no evidence, reproduction
command, hash, date or historical revision was edited to produce this record.
