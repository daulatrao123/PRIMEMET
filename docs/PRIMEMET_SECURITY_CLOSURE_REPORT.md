# PRIMEMET — Remediation Evidence and Security Closure Report

**Prepared by the implementing agent. This is not independent acceptance.** Every test below was
written and run by the same agent that wrote the remediation, so a result here means "the suite I
authored observes this behaviour", not "a second engineer agrees". Section 7 states which claims that
distinction affects.

Date: 2026-11-01 · Repository: `C:\Users\Admin\Documents\PRIMEMET` · Branch: `main` ·
HEAD: `7863743f20f9938ba1fd2548409ca05cbab0e471` (unchanged from the start of the work).

No commits, pushes, merges or deployments were performed. No production system, managed Atlas cluster
or credential was contacted. M2 authentication was not started.

## 0. How the evidence was produced

Two postures are used, and the difference matters for every finding:

| Posture | Command | What it can prove |
| --- | --- | --- |
| Unauthenticated mongod (all other suites) | `npm run check:permissions`, `check:mongodb`, … | What the code does with rows that exist. Proves nothing about who may create them. |
| Authenticated replica set | `npm run check:authz` | What each database *identity* may do. The only posture in which W2/W3 privilege questions are answerable. |

The authenticated run starts an isolated single-node replica set (`mongodb-memory-server`, mongod
7.0.14, wiredTiger) with `--auth` and a keyfile, in a temporary data directory, with credentials
generated per run and discarded with the process. `--auth` being genuinely on is asserted before any
question is asked (`server.servers[0].instanceInfo.instance.instanceOpts.auth === true`); without that
assertion every refusal below would be vacuous.

Identities are created from the project's own `db/roles.mjs` (`buildRoleDefinitions()`), inside the
`primemet` database, not copied by hand:

| Identity | Role | Purpose |
| --- | --- | --- |
| `primemet_owner_user` | `primemet_owner` | structural change, migration ledger, seeding |
| `primemet_app_user` | `primemet_app` | the runtime identity |
| `primemet_readonly_user` | `primemet_readonly` | reporting (`find` only) |
| `primemet_intruder_user` | *(none)* | a credential that exists and may do nothing |

### The privileges actually tested

`primemet_app`, verbatim from `db/roles.mjs`:

- `{ db: "", collection: "" }` → `find` (read the whole database)
- each of the **38 mutable** collections → `find`, `insert`, `update`
- each of the **7 append-only** collections → `find`, `insert`
- `_schema_migrations` → `find`
- `_permission_guards` → `find`, `update`

`primemet_owner` adds `createCollection`, `collMod`, `createIndex`, database-wide `insert`, `update`
on the mutable collections **by name**, and `find`/`insert`/`update` on `_schema_migrations` and
`_permission_guards`. `primemet_readonly` holds `find` and nothing else. **No role holds `delete`,
`dropCollection`, `dropIndex`, `dropDatabase` or `renameCollection`.**

### The two sentences this report refuses to blur

1. **MongoDB rejected it** — the server refused the operation for lack of privilege or a validator.
2. **The application accepted the document but refused to honour it** — the write succeeded and a
   later read declined to act on it.

The permission log (`admin_permission_grants`) is where the difference is decisive: `primemet_app`
holds `insert` on it, so MongoDB accepts a hand-written grant row. What stops it is the resolver's
HMAC integrity tag — application-level checking. **No database-level prevention is claimed for that
collection anywhere in this report.**

## 1. W1 — the permission resolver

Exact command and output:

```
$ npm run check:permissions
145 passed, 0 failed
```

Supporting suites: `npm run check:adversarial` → `97 passed, 0 failed`;
`npm run check:acceptance` → `93/93 assertions passed`;
`npm run check:remediation` → `130/130 assertions passed`.

| Required property | Regression assertions (file `scripts/check-permissions.mjs`) | Observed |
| --- | --- | --- |
| Unknown effects never grant | P-R13 family: `an unrecognised effect above a REVOKE denies rather than restoring the tier default`; `the corrupt effect is not silently reinterpreted as REVOKE` | PASS |
| Missing or malformed effects never grant | `a malformed record (effect …) denies`; `an unordered malformed record does not decide and does not deny`; `an expired corrupt record is inert, not decisive` | PASS |
| GRANT / DENY / REVOKE semantics | `REVOKE restores the tier default`; `REVOKE where the tier grants nothing restores the denial`; `DENY followed by REVOKE restores the tier default`; `REVOKE alone must restore the tier default` | PASS |
| Expiry and ordering deterministic | `an expired GRANT is ignored`; `an expired DENY is ignored`; `an expired newest event falls through to the preceding applicable event`; `an expiry exactly at now has lapsed`; the `seq` tiebreaker within one millisecond | PASS |

The resolver's rule, measured rather than asserted: a row whose `effect` is not one of
`GRANT | DENY | REVOKE` is *inert*. It is not read as a GRANT, and — the case that would otherwise
hide — it is not read as a REVOKE either, because a REVOKE restores a tier default that may itself be
permissive. `scripts/check-permissions.mjs` builds exactly that case by placing a corrupt row above a
REVOKE on a permission whose `READ_ONLY_ADMIN` default is *true*.

**Classification: W1.1–W1.4 — FIXED, INDEPENDENT REVIEW PENDING.** The implementation and its
regressions are green; only a separate reviewer can call them accepted.

## 2. W3 — the permission write boundary

Exact command and output:

```
$ npm run check:authz
  properties held : 52
  measured gaps   : 6
  failures        : 0
  ✔ authenticated authorisation: 52 properties held, 6 gaps recorded
  brief matrix    : 14 questions — 9 satisfied, 4 open, 1 blocked
```

Each of the brief's seven questions, with the enforcement locus stated explicitly. "Locus" is the
answer to *who refused*: `MONGODB` means the server refused; `APPLICATION` means the document was
written and the resolver declined to honour it; `NONE` means nothing refused.

### W3.1 — ordinary identity inserts an effective grant directly

| | |
| --- | --- |
| Credential | `primemet_app_user` (`primemet_app@primemet`) |
| Operation | `db.admin_permission_grants.insertOne(<validator-conforming GRANT>)` |
| Outcome | **ACCEPTED by MongoDB** |
| Enforcement | **APPLICATION only** (integrity tag) |
| Verdict | **OPEN** |

The row is inserted with a real `adminId`, a real `permission`, a `seq`, an `eventId` and a plausible
`grantedById`, and the document validator accepts it because it is well-formed. The resolver then
refuses to honour it (`INVALID_EVENT`) because the row carries no HMAC tag over
`adminId, permission, effect, seq, eventId, grantedById, reason, expiresAt, createdAt`.

That is tamper-evidence, not authorisation. The tag works only while the writer does not hold the key
— and the runtime identity does hold it (`PERMISSION_LOG_KEY` is read by the same process that serves
requests). A compromised application can therefore produce a *correctly tagged* forged grant. Nothing
in the database stops it.

### W3.2 — ordinary identity updates or replaces an existing grant

| | |
| --- | --- |
| Credential | `primemet_app_user` |
| Operation | `updateOne({ $set: { effect } })` and `replaceOne(<whole document>)` |
| Outcome | **both refused by MongoDB** (`not authorized on primemet to execute command`) |
| Enforcement | **MONGODB** — no `update` privilege on the append-only collection |
| Verdict | **FIXED, INDEPENDENT REVIEW PENDING** |

### W3.3 — ordinary identity bypasses the trusted writer

| | |
| --- | --- |
| Credential | `primemet_app_user` |
| Operation | `db.admin_permission_grants.insertMany([...])` |
| Outcome | **ACCEPTED by MongoDB (2 rows)** |
| Enforcement | **NONE** — there is no separate writer identity to bypass |
| Verdict | **OPEN** |

This is the root finding. The boundary the brief presumes does not exist: `db/roles.mjs` declares
three roles (`primemet_app`, `primemet_owner`, `primemet_readonly`) and no permission-writer role. The
runtime identity that serves HTTP requests is the identity that holds `insert` on the permission log.
`insertMany`, `bulkWrite` and `insertOne` are all the same privilege, so no code-level wrapper is a
boundary — only the grant is.

### W3.4 — privileged writer performs a valid delegated grant

| | |
| --- | --- |
| Credential | **NONE DECLARED** (roles: `primemet_app`, `primemet_owner`, `primemet_readonly`) |
| Operation | delegate `ENQUIRY_ASSIGN` to a `READ_ONLY_ADMIN` through a writer identity |
| Outcome | **NOT TESTABLE**: no writer role exists |
| Enforcement | **NONE** — `primemet_app` holds insert and holds the signing key |
| Verdict | **BLOCKED** |

The nearest positive evidence available is that the application identity *can* append through the
delegation path (`store.appendPermissionEvent` → `ok: true` for an authorised super-admin actor), and
that this path refuses a self-target. That proves the delegation rules work. It does not prove a
writer boundary, because the credential is the same one.

### W3.5 — privileged writer attempts an invalid delegation

| | |
| --- | --- |
| Credential | `primemet_app_user` (nearest existing writer) |
| Operation | 7 delegation refusals via `store.appendPermissionEvent`; raw `insertOne` with `effect: "SUPERUSER"` |
| Outcome | **7/7 refused by the application**; raw insert refused by MongoDB |
| Enforcement | **APPLICATION** (delegation rules); **MONGODB** for enum shape only (validator) |
| Verdict | **FIXED, INDEPENDENT REVIEW PENDING** |

The seven refusals, each measured under a real credential:

| Probe | Refusal |
| --- | --- |
| unknown permission `NOT_A_PERMISSION` | `UNKNOWN_PERMISSION` |
| unknown effect `SUPERUSER` | `UNKNOWN_EFFECT` |
| target is the actor's own profile | `SELF_TARGET` |
| `AUDIT_EXPORT` (protected) delegated by a non-super delegate | `NON_DELEGABLE` |
| inactive target | `TARGET_NOT_ACTIVE` |
| expiry already in the past | `EXPIRY_NOT_IN_FUTURE` |
| actor user id that does not exist | `ACTOR_UNRESOLVED` |

`NON_DELEGABLE` needed a seeded delegate to be exercised at all: rule 4 of `mayGrant` applies only to a
non-super actor, so a super admin is allowed to redistribute `ACCESS_GRANT_PERMISSION`. The suite
therefore has a super admin seed a delegate first, and the delegate is the identity that is refused.

### W3.6 — revoked or expired authority cannot be reused

| | |
| --- | --- |
| Credential | `primemet_app_user` |
| Operation | GRANT with +1h expiry → resolve at +1m and +2h; REVOKE → resolve at +3m; append a grant already expired |
| Outcome | live **true**, expired **false**, revoked **false**, past-expiry write **refused** |
| Enforcement | **APPLICATION** (expiry evaluated at authorisation time; the writer refuses a past expiry) |
| Verdict | **FIXED, INDEPENDENT REVIEW PENDING** |

### W3.7 — forged actor identity and forged event payloads are rejected

| | |
| --- | --- |
| Credential | `primemet_app_user` |
| Operation | insert a row attributing the grant to a super admin; insert a second row with a fabricated integrity tag |
| Outcome | unsigned row **accepted by MongoDB → `INVALID_EVENT`**; forged tag **accepted by MongoDB → `INVALID_EVENT`** |
| Enforcement | **APPLICATION** (tag covers actor, permission, effect, seq, eventId, reason and both instants) |
| Verdict | **FIXED, INDEPENDENT REVIEW PENDING** — application-level only |

Both rows are measured at their own resolution instant, so the forged row is genuinely the newest
applicable event when it is judged rather than being masked by a legitimate later row.

## 3. W2 — organisation identity

Same command (`npm run check:authz`), section 7. The security requirement is narrower than "this field
may never change": it is **that ordinary application credentials cannot change the organisation that
governs administrator access**. The pointer (`_permission_guards/platform-identity`) is what
`loadAdminActor()` reads; `organisations.orgKind` is now a label.

| # | Question | Credential | Outcome | Locus | Verdict |
| --- | --- | --- | --- | --- | --- |
| W2.1 | orgKind modification | `primemet_app` | relabel **accepted** (`$set orgKind: "PRIMEMET"`, after the competing marker was moved aside so the unique index could not mask the result); resolution still names the pointer's organisation | APPLICATION — pointer, not marker | **FIXED, INDEPENDENT REVIEW PENDING** |
| W2.2 | identity-pointer replacement | `primemet_app` | **accepted**; resolution immediately names the attacker's organisation | **NONE** — same `update` grant that increments the continuity fence | **OPEN** |
| W2.3 | referenced organisation deletion | `primemet_app` | soft delete accepted → resolution returns `NO_ORGANISATION`; hard delete refused by MongoDB | APPLICATION (fail closed) + MONGODB | **FIXED, INDEPENDENT REVIEW PENDING** |
| W2.4 | identity recreation | `primemet_app` | `insertOne` **refused**; `deleteOne` **refused**; `updateOne(..., {upsert:true})` **refused**; governing organisation unchanged | MONGODB | **FIXED, INDEPENDENT REVIEW PENDING** |
| W2.5 | duplicate platform identity | `primemet_owner` (the app cannot insert) | second `PLATFORM_IDENTITY` document accepted; resolution unchanged | APPLICATION — fixed document id | **FIXED, INDEPENDENT REVIEW PENDING** |
| W2.6 | concurrent identity changes | `primemet_app` | **2/2 accepted**; final pointer is whichever write landed last | **NONE** — no sequence, no `createdAt` ordering | **OPEN** |
| W2.7 | administrator resolution after each attack | read | after relabel → pointer org; after re-point → attacker org; after deletion → `NO_ORGANISATION`; restored → pointer org, super-admin permissions intact | APPLICATION | **FIXED, INDEPENDENT REVIEW PENDING** |

Notes a reviewer needs:

- **W2.2 is the whole of W2-s.** The identity moved out of a mutable business document into a guard
  document, and the move is real: W2.1 now *succeeds as a write and changes nothing about authority*.
  But the guard document is writable by the runtime identity because `primemet_app` needs `update` on
  `_permission_guards` to increment the continuity fence. The pointer and the fence share one grant, so
  the pointer is replaceable. Closing this needs a privilege change (a separate guard/pointer writer),
  not a code change.
- **W2.6 is the same defect observed under concurrency.** Two pointer writes in parallel are both
  authorised, and the surviving value is decided by timing. There is no atomic sequence and no
  `createdAt` ordering on the guard document, so the outcome is not deterministic — which the owner's
  D-ARCH-12 semantics require for permission events and which the identity pointer does not get.
- **W2.3's soft delete is by design** (retirement is soft), and the important half is what happens
  next: resolution fails closed with `NO_ORGANISATION` instead of promoting a second marker.
- **W2.5 was run as the owner** because the application identity cannot insert a guard document at
  all — that refusal is itself the W2.4 result.

**Root classification: W2-s — OPEN.** W2.2 and W2.6 remain measurable, reproducible defects at the
privilege layer.

## 4. W4 — migration

Exact commands and outputs:

```
$ npm run check:migrations
74 passed, 0 failed

$ npm run check:mongodb
105 passed, 0 failed

$ npm run db:validate:offline
Offline validation: 549 passed, 0 failed (45 collections, 98 indexes)
```

The W4 assertions live in `scripts/check-remediation.mjs` (W4-a.1 … W4-a.8, inside the 130/130 run)
and run against a real mongod 7 replica set.

| Requirement | Assertion(s) | Observed |
| --- | --- | --- |
| Fresh installation from the earliest supported migration | W4-a.1: `every migration applies on an empty database` → `[[1,"applied"] … [5,"applied"]]`; `the ledger records versions 1..5`; `no platform identity is invented on an empty database` | PASS |
| Upgrade from a genuine pre-v004 database | database `w4upgrade` is written with `bypassDocumentValidation` and legacy rows that have **no** `orgKind`, exactly as a pre-v004 deployment would hold them | PASS |
| Dry-run backfill | W4-a.3: `the dry run reports the derivable rows` (2), `… the ambiguous rows` (1), `the dry run writes nothing` (0), rows untouched | PASS |
| Successful controlled backfill | W4-a.4: `the backfill writes the derivable and ambiguous rows` (3); `the ambiguous row takes the operator's decision`; `the buyer keeps its counterparty kind` | PASS |
| Ambiguous legacy organisation rejection | W4-a.2: the migration refuses with `PREFLIGHT_FAILED` and **names** the ambiguous organisation; `the ledger records no version 4 after the refusal`; `no row was written by the refusal`. W4-a.8: an ambiguous row without a decision is refused | PASS |
| Re-running the backfill safely | W4-a.5/W4-a.6/W4-a.7: a second run is a no-op; a new organisation without `orgKind` is refused after the upgrade (code 121) | PASS |
| Final schema, indexes, validators, ledger convergence | `check:mongodb` 105/0 (195 collection/index checks, mistyped field rejected, append-only guard on all 7 collections, 38 mutable collections exempt); `db:validate:offline` 549/0 over 45 collections and 98 indexes; `a second reconcile is idempotent`; v001's checksum unchanged | PASS |

`classifyLegacyRow()` never mints `PRIMEMET` — asserted directly (`classification never proposes
PRIMEMET for a legacy row`), which is the property that stops the backfill creating a second platform
identity.

**Classification: W4-a.1–W4-a.7 — FIXED, INDEPENDENT REVIEW PENDING.**

## 5. Full regression

Run on the final tree, in this order. Every command below is copied from the run that produced the
number beside it.

| # | Command | Exact result |
| --- | --- | --- |
| 1 | `npm run typecheck` | exit 0, no diagnostics |
| 2 | `npm run lint` | exit 0, no problems |
| 3 | `npm run build` | exit 0, `✓ Compiled successfully` (Next.js 15.5.28), 82/82 static pages |
| 4 | `npm run check:permissions` | 145 passed, 0 failed |
| 5 | `npm run check:adversarial` | 97 passed, 0 failed |
| 6 | `npm run check:acceptance` | 93/93 assertions passed |
| 7 | `npm run check:migrations` | 74 passed, 0 failed |
| 8 | `npm run check:mongodb` | 105 passed, 0 failed |
| 9 | `npm run check:remediation` | 130/130 assertions passed |
| 10 | `npm run check:bootstrap` | 23 passed, 0 failed |
| 11 | `npm run check:enums` | 40 passed, 0 failed |
| 12 | `npm run check:routes` | `routes: 59  required: 56  source files scanned: 119`, 0 problems |
| 13 | `npm run check:reviewer-package` | 88/88 assertions passed |
| 14 | `npm run db:validate:offline` | 549 passed, 0 failed (45 collections, 98 indexes) |
| 15 | `npm run check:authz` | 52 properties held, 6 gaps, 0 failures; brief matrix 14 questions — 9 satisfied, 4 open, 1 blocked |
| 16 | `npm run build` (production site URL) | covered by #3; `next.config.ts` validates `NEXT_PUBLIC_APP_URL` before any page is generated |

### Skipped tests and environment limitations

- **No managed MongoDB / Atlas was used.** `check:authz` is the only suite that exercises privileges,
  and it runs `mongodb-memory-server` 7.0.14 as a single-node replica set with a temporary data
  directory. Cluster-level differences (Atlas network rules, `authSource` conventions for Atlas users,
  serverless connection limits, backup roles) are **not** covered.
- **The production database identity split was not exercised in a deployed environment.** The claim
  "owner credentials are never deployed" is a deployment convention checked by
  `npm run db:check-role`; it is not observable from this workspace.
- **No end-to-end browser tests exist in Phase 1**, and none were added. Route and link integrity is
  static (`check:routes`).
- **Windows-specific warnings, non-fatal:** `@next/swc-win32-x64-msvc … is not a valid Win32
  application` appears during `next build` while the fallback compiles successfully, and
  `MODULE_TYPELESS_PACKAGE_JSON` appears when Node imports the `.ts` store module directly.
- **No test was skipped, filtered or marked pending** to reach the totals above; `check:authz` has no
  skip path, and a refused connection or missing dependency exits non-zero rather than passing.

## 6. Git and preservation

```
$ git rev-parse --abbrev-ref HEAD
main
$ git rev-parse HEAD
7863743f20f9938ba1fd2548409ca05cbab0e471
$ git reflog -1 --format=%H
7863743f20f9938ba1fd2548409ca05cbab0e471
$ git diff --cached --name-only | wc -l
0
```

`HEAD` equals the reflog tip, so the branch has not moved: **no commit, merge, rebase or tag was
created** during this work. Nothing was pushed and no deployment was triggered.

| Measure | Count |
| --- | --- |
| staged | 0 |
| modified (tracked) | 6 |
| untracked | 99 |
| deleted | 0 |
| **total changed paths** | **105** |

The six modified tracked files:

- `PROJECT_SUMMARY.md`
- `docs/PRIMEMET_STAGE_2_ARCHITECTURE.md`
- `package.json`
- `src/app/admin/layout.tsx`
- `src/app/api/health/route.ts`
- `tsconfig.json`

### No previous uncommitted work was lost

The working tree held **104 changed paths before this task began and 105 after it finished**. The
difference is this report itself: 6 modified and 0 staged and 0 deleted are unchanged, and the one
pre-existing file this task touched is `scripts/check-authz-authenticated.mjs`, which was already
untracked and was extended, not replaced.
No `git checkout`, `reset`, `stash`, `clean` or file deletion was run against the working tree, and no
scratch file remains in the repository.

### Prisma history and the v001 identity

- `prisma/` contains `schema.prisma`, seven `migration.sql` files and `migration_lock.toml`. **It is
  untracked at this `HEAD`** — the branch has never committed Prisma history, so "unchanged" can only
  be asserted against the start of this task (the files show no `M` status and no modification
  timestamp from this task) rather than against a blob in `HEAD`. That is a property of the branch,
  not of this task, and a reviewer should treat it as a preservation caveat.
- MongoDB `v001` identity is unchanged and asserted twice: `npm run check:migrations` reports
  `v001's checksum did not change`, `v001.source is byte-identical to its own file` and
  `v001's checksum is still untouched`; `npm run check:mongodb` reports `v001's checksum did not
  change`. The migration file was not edited.

## 7. Security classification

Exactly one label per finding, using only the four the brief permits.

| ID | Finding | Classification |
| --- | --- | --- |
| W1.1 | Unknown effects never grant access | FIXED, INDEPENDENT REVIEW PENDING |
| W1.2 | Missing or malformed effects never grant access | FIXED, INDEPENDENT REVIEW PENDING |
| W1.3 | GRANT / DENY / REVOKE semantics correct, including REVOKE restoring the tier default | FIXED, INDEPENDENT REVIEW PENDING |
| W1.4 | Expiry and event ordering deterministic (ms tiebreaker, strict expiry) | FIXED, INDEPENDENT REVIEW PENDING |
| W3.1 | Ordinary identity can insert an effective grant directly | **OPEN** |
| W3.2 | Ordinary identity cannot update or replace an existing grant | FIXED, INDEPENDENT REVIEW PENDING |
| W3.3 | Ordinary identity can bypass the trusted writer | **OPEN** |
| W3.4 | Privileged writer performs a valid delegated grant | **BLOCKED** |
| W3.5 | Invalid delegation is refused (7 shapes) | FIXED, INDEPENDENT REVIEW PENDING |
| W3.6 | Revoked or expired authority cannot be reused | FIXED, INDEPENDENT REVIEW PENDING |
| W3.7 | Forged actor identity and forged payloads are rejected | FIXED, INDEPENDENT REVIEW PENDING |
| W2.1 | `orgKind` modification does not move governing authority | FIXED, INDEPENDENT REVIEW PENDING |
| W2.2 | Identity-pointer replacement by the runtime identity | **OPEN** |
| W2.3 | Referenced organisation deletion fails closed | FIXED, INDEPENDENT REVIEW PENDING |
| W2.4 | Identity recreation (insert / delete / upsert) | FIXED, INDEPENDENT REVIEW PENDING |
| W2.5 | Duplicate platform identity is inert | FIXED, INDEPENDENT REVIEW PENDING |
| W2.6 | Concurrent identity changes are ordered and deterministic | **OPEN** |
| W2.7 | Administrator resolution after each attempted attack | FIXED, INDEPENDENT REVIEW PENDING |
| W4-a.1 | Fresh installation through every shipped migration | FIXED, INDEPENDENT REVIEW PENDING |
| W4-a.2 | Upgrade from a genuine pre-v004 database | FIXED, INDEPENDENT REVIEW PENDING |
| W4-a.3 | Dry-run backfill | FIXED, INDEPENDENT REVIEW PENDING |
| W4-a.4 | Controlled backfill | FIXED, INDEPENDENT REVIEW PENDING |
| W4-a.5 | Ambiguous legacy organisation refused, nothing written | FIXED, INDEPENDENT REVIEW PENDING |
| W4-a.6 | Backfill re-run is safe and idempotent | FIXED, INDEPENDENT REVIEW PENDING |
| W4-a.7 | Schema, indexes, validators and ledger converge | FIXED, INDEPENDENT REVIEW PENDING |
| W2-s / W3 root | No privilege separation between the runtime identity and the permission writer; the guard document that carries the identity pointer shares a grant with the continuity fence | **OPEN** |

### Why no finding is labelled FIXED AND VERIFIED

The brief permits that label, and it is the one a *reviewer* should apply after reproducing the
commands in this report. Applied by the author it would mean "the agent checked its own work", which
is the failure mode the label exists to prevent — so it is used nowhere here, and the count of findings
carrying it is **0**.

W1 is nonetheless the strongest evidence in the report: its four properties are pure functions of the
resolver, so the suite feeds rows and reads decisions over the input space the resolver defines, rather
than sampling database states. Every other finding is either a privilege measurement in one topology
or a behavioural test whose input space is not enumerable. Even where the measurement is a hard refusal
from `mongod`, `FIXED, INDEPENDENT REVIEW PENDING` is the honest ceiling.

### Recommendation

**Phase 1 is ready for a separate engineer's security review. It is not ready for external acceptance
as security-complete, and should not be presented as such.**

- The evidence a reviewer needs now exists and is reproducible: one authenticated topology, identities
  built from the repository's own role definitions, and 14 brief questions each answered with its
  enforcement locus recorded.
- Two root findings remain **OPEN** and one is **BLOCKED**. Both open findings are privilege-layer
  defects that no application change can close: `primemet_app` holds `insert` on
  `admin_permission_grants` (and holds `PERMISSION_LOG_KEY`), and it holds `update` on
  `_permission_guards`, which is where the platform identity pointer lives.
- Closing them requires a design decision the reviewer should assess before M2 begins: a distinct
  privileged-writer identity that alone may insert permission events and reconcile the pointer, with
  the runtime identity reduced to `find` on the log and `find` on the guard, and the continuity fence
  moved to a document the runtime identity may update but the pointer may not share.
- **M2 authentication must not begin on the strength of this report.** The completion gate stands.

### Exact commands for an independent run

```
npm ci
npm run typecheck
npm run lint
npm run build
npm run check:permissions
npm run check:adversarial
npm run check:acceptance
npm run check:migrations
npm run check:mongodb
npm run check:remediation
npm run check:bootstrap
npm run check:enums
npm run check:routes
npm run check:reviewer-package
npm run db:validate:offline
npm run check:authz
```

`check:authz` downloads the mongod 7.0.14 binary on first run (cached afterwards), needs free loopback
ports, and writes only to a temporary directory. It returns 0 with gaps recorded by design: a gap is a
measured unmet requirement, not a harness failure. The harness fails only when a property it asserts
as `HOLDS` does not hold.

## Appendix — exact changed-path list (105 paths)

```
.gitattributes
.github/workflows/db-init.yml
.github/workflows/m2a-argon2-gate.yml
ROJECT_SUMMARY.md
db/README.md
db/collections/catalogue.mjs
db/collections/core.mjs
db/collections/index.mjs
db/define.mjs
db/enums-local.mjs
db/enums.mjs
db/guards.mjs
db/ledger.mjs
db/migrations/index.mjs
db/migrations/v001-initial-collections.mjs
db/migrations/v002-permission-grant-effects.mjs
db/migrations/v003-super-admin-continuity-guard.mjs
db/migrations/v004-organisation-kind.mjs
db/migrations/v005-platform-identity.mjs
db/organisation-identity.mjs
db/preflight.mjs
db/provision-roles.mjs
db/refs.mjs
db/roles.mjs
db/tax.mjs
db/verify.mjs
docs/PRIMEMET_ARCHITECTURE_CLOSURE.md
docs/PRIMEMET_ATLAS_SETUP.md
docs/PRIMEMET_C3_SUPER_ADMIN_CONTINUITY.md
docs/PRIMEMET_DOMAIN_ARCHITECTURE.md
docs/PRIMEMET_M2A_BOUNDARY.md
docs/PRIMEMET_M2A_DECISION_REGISTER.md
docs/PRIMEMET_M2A_IMPLEMENTATION_PLAN.md
docs/PRIMEMET_M2_AUTH_DESIGN.md
docs/PRIMEMET_M2_IMPLEMENTATION_READINESS.md
docs/PRIMEMET_M2_OWNER_DECISIONS.md
docs/PRIMEMET_M2_READINESS.md
docs/PRIMEMET_MONGODB_MIGRATION_PLAN.md
docs/PRIMEMET_ORGANISATION_BOOTSTRAP.md
docs/PRIMEMET_P1_DECISION_RECORD.md
docs/PRIMEMET_P1_ENQUIRY_ARCHITECTURE.md
docs/PRIMEMET_P1_IMPLEMENTATION_PLAN.md
docs/PRIMEMET_PHASE1_INDEPENDENT_ACCEPTANCE.md
docs/PRIMEMET_PHASE1_REVIEWER_PACKAGE.md
docs/PRIMEMET_PHASE_1A_CONTRACTS.md
docs/PRIMEMET_SECURITY_CLOSURE_REPORT.md
docs/PRIMEMET_SECURITY_REMEDIATION.md
docs/PRIMEMET_STAGE_2_ARCHITECTURE.md
docs/PRIMEMET_TASK_A_TASK_B_AUDIT.md
docs/PRIMEMET_TIER_MATRIX.md
package.json
prisma/.env
prisma/README.md
prisma/migrations/20261031000000_m1_initial_schema/migration.sql
prisma/migrations/20261031000100_m1_constraints/migration.sql
prisma/migrations/20261031000200_m1_reference_seeds/migration.sql
prisma/migrations/20261031130000_m1_phase1_canonical_catalogue/migration.sql
prisma/migrations/20261031130100_m1_phase1_constraints/migration.sql
prisma/migrations/20261031140000_d1_equivalence_governance/migration.sql
prisma/migrations/20261031140100_d2_constraints_and_immutability/migration.sql
prisma/migrations/migration_lock.toml
prisma/schema.prisma
scripts-manifest-count.mjs
scripts/audit-permission-integrity.mjs
scripts/audit-unique-indexes.mjs
scripts/backfill-organisations.mjs
scripts/check-acceptance.mjs
scripts/check-adversarial.mjs
scripts/check-authz-authenticated.mjs
scripts/check-bootstrap.mjs
scripts/check-catalogue.mjs
scripts/check-enums.mjs
scripts/check-equivalence.mjs
scripts/check-migration-architecture.mjs
scripts/check-mongodb.mjs
scripts/check-permissions.mjs
scripts/check-remediation.mjs
scripts/check-reviewer-package.mjs
scripts/check-schema-m1.mjs
scripts/check-schema.mjs
scripts/db-init.mjs
scripts/db-verify.mjs
scripts/gen-mongo-enums.mjs
scripts/lib/mongo-enums.mjs
scripts/lib/prisma-enums.mjs
scripts/m1-baseline/make-phase1-baseline.mjs
scripts/m1-baseline/schema-phase1.prisma
scripts/m1-baseline/schema.prisma
scripts/report-tier-matrix.mjs
scripts/reviewer-probe.mjs
scripts/verify-argon2-runtime.mjs
scripts/verify-tax-rule-index.mjs
scripts/verify-unique-index-semantics.mjs
src/app/admin/layout.tsx
src/app/admin/page.tsx
src/app/api/health/route.ts
src/lib/content/admin-nav.ts
src/lib/db.ts
src/lib/permissions/delegation.ts
src/lib/permissions/integrity.ts
src/lib/permissions/resolve.ts
src/lib/permissions/store.ts
src/lib/permissions/tiers.ts
src/lib/permissions/types.ts
tsconfig.json
```
