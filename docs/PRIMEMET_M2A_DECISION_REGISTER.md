# PRIMEMET — M2a Owner Decision Register

**Status: nothing in this register is approved.**
Every row below is open. A recommendation is not an approval, and no decision here has been
implemented in code.

Prepared from: `docs/PRIMEMET_M2A_BOUNDARY.md` (§11, §12, §13), `docs/PRIMEMET_M2_AUTH_DESIGN.md`,
`docs/PRIMEMET_M2_READINESS.md`, and the live definitions in `db/collections/*.mjs` and `db/roles.mjs`.

**Evidence class for every measured claim below:** read from the repository on 2026-11-01. No database
was contacted; no credential was created; no infrastructure was touched.

---

## 1. How to read the blocking column

| Column | Meaning |
|---|---|
| **Blocks implementation** | No M2a code should be written until this is answered. |
| **Blocks testing** | Code could be written, but the acceptance test cannot pass or cannot be trusted. |
| **Blocks merge** | Code and tests could exist, but the change must not reach `main`. |

A decision can block none of these and still matter later; that is stated explicitly rather than
left blank.

---

## 2. Group A — Dependency and cryptographic policy

### D-M2a-1 — Add `@node-rs/argon2`

| Field | Value |
|---|---|
| **Exact decision required** | May the project take a **native** dependency (`@node-rs/argon2@2.2.2`) for password hashing, rather than a pure-JS library or Node's built-in `scrypt`? |
| **Recommended choice** | **Approve `@node-rs/argon2@2.2.2`**, pinned exactly (no caret). It is the only choice that gives Argon2id, the algorithm OWASP recommends for new work, without a WASM runtime or a compile step on the deploy host. |
| **Consequence if deferred** | M2a cannot start. There is **no** hashing library in `package.json` today (0 matches for `argon2`/`bcrypt`), so password storage has no implementation path. |
| **Blocks implementation** | **Yes — the only true blocker in this register** |
| **Blocks testing** | Yes (nothing to test) |
| **Blocks merge** | Yes |
| **Evidence already gathered** | Windows x64 / Node 26.13.0: 19/19 assertions pass. N-API addon with no `NODE_MODULE_VERSION` pin; `linux-x64-gnu` prebuilt present; GLIBC floor 2.14. **Linux execution pending — see C-M2a-4.** |
| **What approval does not cover** | It does not approve Linux compatibility (that is C-M2a-4) and it does not approve the hash parameters (policy, not dependency). |

### P-M2a-5 — Argon2 parameters

| Field | Value |
|---|---|
| **Exact decision required** | Fix the hash policy: algorithm `argon2id`, `memoryCost 19456` (19 MiB), `timeCost 2`, `parallelism 1`, 16-byte salt, 32-byte hash. |
| **Recommended choice** | Approve as proposed — it is the OWASP-recommended minimum for Argon2id and is what the harness already asserts. |
| **Consequence if deferred** | The harness's group 6 asserts a specific policy; an unapproved policy means that assertion proves nothing about intent. Password hashes are effectively unchangeable later without a rehash-on-login path, which exists but needs the target set. |
| **Blocks implementation** | No (a constant can be changed) |
| **Blocks testing** | Yes — group 6's assertion has no agreed target |
| **Blocks merge** | No |

---

## 3. Group B — Session lifetime

### D-M2a-2 — Absolute TTL and idle timeout

| Field | Value |
|---|---|
| **Exact decision required** | Fix **12 hours absolute** expiry and **30 minutes idle**. |
| **Recommended choice** | Approve both. 12 h absolute caps a stolen token's useful life; 30 min idle matches an operations desk that leaves a screen open between calls. |
| **Consequence if deferred** | A session with no agreed lifetime cannot be tested (T-SESS-9 asserts expiry), and a default chosen by the implementer becomes policy by accident. |
| **Blocks implementation** | No — a constant can be introduced and changed |
| **Blocks testing** | **Yes** — T-SESS-9 and the idle test need a number |
| **Blocks merge** | Yes, if any lifetime shipped without approval |
| **Schema impact** | **None.** `sessions.lastSeenAt`, `expiresAt` and `revokedAt` already exist (measured). The idle timeout is a comparison, not a column. |
| **Design note still open** | Whether `lastSeenAt` is written on **every** request (a DB write per protected page view) or throttled to, say, once a minute. Not an owner decision, but it changes write load and must be settled before coding. |

---

## 4. Group C — `AUTH_SECRET` requirement and scope

### D-M2a-3 — Make `AUTH_SECRET` required in production, scoped to CSRF only

| Field | Value |
|---|---|
| **Exact decision required** | Should `AUTH_SECRET` become **required in production** (it is optional today), and is its scope **CSRF-token signing only** — never session tokens? |
| **Recommended choice** | **Approve both.** Required in production, optional in development. Session tokens are 32 random bytes stored as a SHA-256 hash; nothing is signed, so `AUTH_SECRET` can neither forge a session nor log everyone out when rotated. Its only job is CSRF and the `ipHash`/`userAgentHash` peppering. |
| **Consequence if deferred** | CSRF protection has no key. In production with the variable unset, either the app must refuse to start (safe) or CSRF tokens silently degrade (unsafe) — and the second is what happens by default today. |
| **Blocks implementation** | No for sessions; **yes for any CSRF-protected write endpoint** |
| **Blocks testing** | Yes for the CSRF tests |
| **Blocks merge** | Yes for any write endpoint |
| **Explicitly not decided by this** | That `AUTH_SECRET` signs sessions. It does not and must not. |

---

## 5. Group D — Linux native binding execution

### C-M2a-4 — Execute the binding on a Linux x64 glibc runtime

| Field | Value |
|---|---|
| **Exact decision required** | Accept that a **Linux execution** is required before merge, and authorise running `.github/workflows/m2a-argon2-gate.yml` (which requires pushing that workflow file to GitHub first). |
| **Recommended choice** | **Approve.** Binary inspection is not execution; the brief and the prior report both say compatibility must not be claimed from inspection. The workflow is `workflow_dispatch`-only and uses no secrets. |
| **Consequence if deferred** | M2a can be written but **not merged**. If the Linux binding fails at deploy time instead, the failure surfaces in production rather than in a gate. |
| **Blocks implementation** | No |
| **Blocks testing** | No (Windows evidence exists for the code path) |
| **Blocks merge** | **Yes** |
| **Current state** | Harness written and passes **on Windows only** (20/20 after the §10 corrections). Workflow written, schema-validated, never executed. **Linux evidence: PENDING — no Linux execution has been claimed or performed.** |
| **What approval does not authorise** | It does not authorise a deploy, does not authorise changes to any runner, and does not authorise running the workflow on a branch other than the one reviewed. |

---

## 6. Group E — Privilege model

### OD-A — Removal of `delete` from `primemet_app`

| Field | Value |
|---|---|
| **Exact decision required** | Confirm that `primemet_app` should hold **no `delete` action**, now and long-term, so that records can only be retired by setting `deletedAt`. |
| **Recommended choice** | **Confirm.** Measured: no role in `db/roles.mjs` grants `delete` — app, owner and readonly all lack it. Removing the ability is the only enforcement MongoDB can give, because it has no `DELETE` trigger. |
| **Consequence if deferred** | If a future feature "needs" a hard delete, the model has no answer and the likely outcome is a wide grant that silently re-opens history rewriting. Deciding now fixes the constraint while it is cheap. |
| **Blocks implementation** | No |
| **Blocks testing** | No |
| **Blocks merge** | No — already true in code |
| **Status** | Already true; needs confirmation as policy, not a code change |
| **Related measured facts** | Owner effective privileges on all 7 append-only collections: **0** `update`/`delete`. Audit reports **0** problems. Corrected in `db/roles.mjs` after the wildcard-`update` defect. |

---

## 7. Group F — Hosting, retention and organisation status

### O-27.7 — Hosting provider and region

| Field | Value |
|---|---|
| **Exact decision required** | Which managed MongoDB host and which region? Proposal on the table: **MongoDB Atlas, AWS Mumbai `ap-south-1`**. |
| **Recommended choice** | Approve Atlas + `ap-south-1`, dedicated tier (custom database roles are required by this design and are unavailable on shared tiers). |
| **Consequence if deferred** | Design and local in-process testing can proceed; **live testing cannot**. Nothing in M2a needs a hosted database, but nothing in M2a can be proven against one either. |
| **Blocks implementation** | No |
| **Blocks testing** | No for M2a (in-process replica set is sufficient) — **yes for any integration test against a managed server** |
| **Blocks merge** | No |
| **Blocks deploy** | Yes |

### O-27.5 — Document retention and legal hold

| Field | Value |
|---|---|
| **Exact decision required** | Adopt the proposed internal retention periods per document class, with all statutory periods **pending CA/legal confirmation**. |
| **Recommended choice** | Adopt the internal periods as policy now; leave every statutory cell marked pending. |
| **Consequence if deferred** | No M2a impact — M2a stores no documents. It matters at document upload, and retro-fitting a retention job to existing rows is harder than starting with one. |
| **Blocks implementation** | No |
| **Blocks testing** | No |
| **Blocks merge** | No |
| **Blocks anything soon** | Not M2a. Relevant at the document-storage milestone. |

### D-C4 — `organisations.accountStatus` permitted values

| Field | Value |
|---|---|
| **Exact decision required** | Close the value set to **`PENDING \| ACTIVE \| SUSPENDED \| REJECTED`** and enforce it as an enum, rather than the current open string. |
| **Recommended choice** | Approve the four values and make them a validator enum. |
| **Consequence if deferred** | M2a's organisation-suspension check (`accountStatus != ACTIVE` → refuse) works on a literal. Measured today: the field is `{bsonType: "string", maxLength: 40}` with **no enum**, so `active`, `Active` or `ACTVE` are all storable. The check fails **closed** (an unknown value refuses the session), which is the safe direction — but a wrong value silently locks out a paying customer with no error telling anyone why. |
| **Blocks implementation** | No |
| **Blocks testing** | No — T-SESS-6 can write the literal `SUSPENDED` |
| **Blocks merge** | No |
| **Blocks the approval workflow** | Yes — organisation approval cannot be automated over an open string |

---

## 8. Summary — what actually blocks M2a

| Question | Answer |
|---|---|
| Can M2a implementation begin today? | **No.** D-M2a-1 (the dependency) is unanswered, and there is no hashing library in the project. |
| Is one decision enough to start? | **Yes** — D-M2a-1 alone unblocks writing code. D-M2a-2 and D-M2a-3 are needed before the tests can pass. |
| Can M2a merge without C-M2a-4? | **No.** Linux execution is the merge gate. The gate harness now reports sequential and concurrent verification separately (§10); it has still run **only on Windows**. |
| Does anything here need a database? | **No.** Every measured claim in this register was read from the repository; M2a's own tests run against an in-process replica set. |
| Is any decision already satisfied in code? | **OD-A** (no role grants `delete`) — true today, needs policy confirmation only. |

**Blocking order:** D-M2a-1 → (D-M2a-2, D-M2a-3) → C-M2a-4 → merge.
Non-blocking but open: P-M2a-5, OD-A, O-27.7, O-27.5, D-C4.

---

## 9. What this register deliberately does not do

- It does not mark any decision approved, including the ones with firm recommendations.
- It does not assume a recommendation was accepted because it was previously *reported*. Anything
  approved must be approved explicitly, and this file would then be amended with the date and approver.
- It does not merge the Argon2 dependency decision with the Linux compatibility decision. They are
  separate: one is "may we depend on this", the other is "does it work where we deploy".
- It does not treat "already true in code" as approval. OD-A is a policy confirmation, not a change.

---

## 10. Harness and workflow corrections (2026-11-01)

Applied to `scripts/verify-argon2-runtime.mjs` and `.github/workflows/m2a-argon2-gate.yml`.
**These are tooling corrections. They change no decision and approve nothing** — every row in §2–§7
remains open exactly as written above.

| ID | Was | Now |
|---|---|---|
| **D-H1** | An assertion named "20 concurrent verifications" ran `argon2.verifySync` inside `Array.from(...)` — a serialised loop. The label claimed a property the code did not exercise. | Split into two assertions: **"20 sequential verifications (baseline, serialised)"** and **"20 concurrent verifications (overlapped, Promise.all)"**, the second through the async `verify()`. The concurrent result is reported as a ratio against the sequential baseline. Measured on Windows: **215 ms serialised vs 184 ms overlapped (1.17×)** — a real, visible difference, which the old single assertion could not have produced. |
| **D-H2** | The header comment said the temp directory is "deleted on exit". On Windows it was **not**: the loaded native addon holds it open and `rmSync` raises `EPERM`. | The comment now states the actual behaviour — cleanup is attempted, fails on Windows with `EPERM`, and the directory is deliberately left behind with a printed note. Exit code reflects assertions only. Confirmed by this run: `note: temp workspace left behind (EPERM)`. |
| **D-W4** | Neither job set a `timeout-minutes`; a hung `npm install` would hold a runner for the 360-minute default. | Both jobs now set **`timeout-minutes: 30`**. Parsed and confirmed on both `ubuntu` and `debian-container`. |

**Job configuration re-confirmed after the edit** (parsed from the YAML, not read by eye):

| Property | `ubuntu` | `debian-container` |
|---|---|---|
| `runs-on` | `ubuntu-24.04` | `ubuntu-24.04` |
| `container` | — | `node:26-bookworm` |
| `timeout-minutes` | **30** | **30** |
| Node 26 setup | `actions/setup-node@v4` with `node-version: "26"` | image-provided (`node:26-bookworm`) |
| Gate shell / pipefail | `bash` / `set -o pipefail` | `bash` / `set -o pipefail` |
| Artifact | `argon2-gate-ubuntu` ← `argon2-gate.log` | `argon2-gate-debian` ← `argon2-gate.log` |

**Unchanged and re-verified:** triggers are `workflow_dispatch` **only** (auto triggers: NONE) ·
`permissions: {contents: read}` only · **0** `secrets.` references · artifact path is the log file,
not the workspace.

**Windows harness after the corrections:** **20 passed, 0 failed, 0 skipped** (was 19 passed; the
sequential/concurrent split adds one assertion). **This is not Linux evidence for C-M2a-4** and is not
presented as such.

**Still unverified:** `actions/setup-node` availability of Node 26, and `git` inside
`node:26-bookworm` for `actions/checkout`. Both surface as a job setup failure, not a silent pass.


---

## 11. Phase 1A update (2026-11-01)

**Status of every row in §2–§10 is unchanged: open.** This section adds entries found while preparing
`PRIMEMET_PHASE_1A_CONTRACTS.md`. **One entry is now owner-approved — D-ARCH-12 (§11.1), recorded 2026-11-01.**
No other row in this register is approved, and this section closes nothing else.

### 11.1 New blocking entry — D-ARCH-12, the resolver conflict

| Field | Value |
|---|---|
| **Exact decision required** | Which resolution rule governs admin permissions: **deny-wins** (as written in `PRIMEMET_M2_AUTH_DESIGN.md` §3.3) or **latest-event-wins** (as written in `PRIMEMET_ARCHITECTURE_CLOSURE.md` §1)? |
| **Recommended choice** | **Latest-event-wins with a deterministic `(createdAt, seq)` tiebreaker** (Phase 1A §2.3). |
| **Why it cannot be deferred** | The resolver is the function every protected screen calls. The bootstrap, tier seeds, audit emission and 17 acceptance tests are written against one semantic. |
| **Why deny-wins is the weaker option** | Combined with an append-only grant log, a `DENY` can never be reversed: a later `GRANT` is still discarded, and the `DENY` row cannot be deleted (`immutable: true`). A temporary suspension becomes permanent with no supported recovery path — which pushes operators to edit the database or hand out `SUPER_ADMIN`, both worse. |
| **What approval does not cover** | The `seq` tiebreaker field (a small additive field), the delegation ceiling, or the non-delegable set. |
| **Consequence if deferred** | M2b cannot start. No permission code may be written. |
| **Blocks implementation** | **Yes** |
| **Blocks testing** | Carry-over — P-R4, P-R9 and the new P-R18…P-R21 in the contracts document carry the discriminating answers |
| **Blocks merge** | **No** — cleared for permission code, subject to `effect` carrying `REVOKE` |

#### Owner decision — recorded 2026-11-01: **APPROVED**

**Resolution: latest-event-wins.** The mandatory semantics and safeguards are recorded in
`PRIMEMET_PHASE_1A_CONTRACTS.md` §1.3a; this register records the closure only.

| Field | Value |
|---|---|
| **Status** | **OWNER APPROVED** (2026-11-01) — the only approved row in this register |
| **Decision** | The latest applicable non-expired event overrides the tier default: `GRANT` allows, `DENY` denies, `REVOKE` removes the override and restores the tier default. Expired events are ignored and the preceding applicable event is evaluated. With no applicable event, the tier default decides. |
| **Mandatory safeguards** | Authorised delegation only · no privilege escalation · deterministic `(createdAt, seq)` ordering · immutable event history · actor, target, permission, reason and timestamp recorded · expiry evaluated at authorisation time · concurrency and revocation tests |
| **Supersedes** | `PRIMEMET_M2_AUTH_DESIGN.md` §3.3 (deny-wins) — **edited 2026-11-01**: the section now carries a SUPERSEDED banner, a rule-by-rule mapping to the approved semantics, and the old pseudocode folded into a collapsed historical block. §3.1's tier table and the two mermaid/pseudocode mentions of "deny-wins" were corrected in the same pass. |
| **Not covered** | D-ARCH-1 (the vocabulary must now carry `REVOKE`), the `seq` field, the `eventId` index, the `adminId` discriminator, the delegable ceiling and the non-delegable set. **Implemented since:** §12 records what landed and what remains open. |
| **Blocks implementation** | **No** — cleared; `REVOKE` now exists in `effect` and the resolver is implemented and tested (§12) |

### 11.2 Cross-reference, so the registers do not diverge

| Register | Scope | Relationship |
|---|---|---|
| This file (§2–§10) | M2a: hashing, sessions, `AUTH_SECRET`, Linux binding, privilege model, hosting/retention | unchanged |
| `PRIMEMET_PHASE_1A_CONTRACTS.md` §1 | Consolidated view: D-ARCH-1…12, D-M2a-*, D-C4, O-15.4a-P, O-17.4, O-27.1…8 | **superset for reading, not for approval** — it adds no approval the rows above lack |

Where the two overlap, the Phase 1A table adds four fields the M2a register lacks: data-migration
implication, security implication, dependent work, and the blocking milestone.

### 11.3 Two defects recorded while preparing Phase 1A

| # | Defect | Evidence | Effect |
|---|---|---|---|
| 1 | `admin_permission_grants.adminId` has **no discriminator** — the resolver iterates `grants where g.adminId == profile._id` while `grantedById` references `users`, and nothing in the definitions ties `adminId` to `admin_profiles._id` | `db/collections/core.mjs` (`admin_permission_grants`), `M2_AUTH_DESIGN` §3.3 | one collection, two id namespaces; a grant can be written against the wrong one and resolve silently to nothing |
| 2 | `supplier_listings` has **no invariants at all** and `organisations` has **none** | measured via the collection definitions | the two collections most likely to carry business rules are the two with no database enforcement |

Both are additive fixes (a validator invariant and, for defect 1, a supported `adminId` contract); neither
requires a schema change, and neither is implemented.

### 11.4 What this update does not do

No decision is marked approved. No code, collection, validator, index, enum, migration, workflow, role or
credential was created or modified. `db-init.yml` remains inactive. Nothing was staged, committed or pushed.

---

## 12. Phase 1 implementation record — D-ARCH-12 (2026-11-01)

This section records what was built against §11.1. It marks **no other decision approved**, and it does not
claim that M2 has started.

### 12.1 What landed

| File | Change |
|---|---|
| `db/enums-local.mjs` | **new** — declares `GrantEffect = [GRANT, DENY, REVOKE]`, the one value set Prisma does not declare |
| `scripts/lib/mongo-enums.mjs` | **new** — one assembly/render implementation shared by the generator and its checker; refuses a local enum that shadows a Prisma one, or that is empty, duplicated or malformed |
| `scripts/gen-mongo-enums.mjs` | merges the local set; fails closed |
| `scripts/check-enums.mjs` | asserts the merge, the disjointness, the rejection rules and that `REVOKE` is reachable — 40 assertions |
| `db/define.mjs` | `f.enumOf` / `f.enumOpt` **throw** on an unknown or empty enum name. Previously an unknown name silently produced an unconstrained `{bsonType:"string"}`, because `JSON.stringify` drops an `undefined` `enum` key |
| `db/collections/core.mjs` | `admin_permission_grants`: `effect` → `GrantEffect`; adds `seq` (long), `eventId`, required `grantedById` and non-blank `reason`; adds a unique `{adminId, eventId}`, a unique `{adminId, seq}` and the resolver index; adds three invariants |
| `db/migrations/v002-permission-grant-effects.mjs` | **new** — converges the validator and indexes; drops nothing (OD-16) |
| `db/migrations/index.mjs` | registers `v002`; `v001`'s checksum is untouched (its identity is its own file) |
| `src/lib/permissions/{types,tiers,resolve,delegation,store}.ts` | **new** — vocabulary, tier matrices, the resolver, the delegation rules, and the only module that reads or appends the log |
| `scripts/check-permissions.mjs` | **new** — the evidence |

### 12.2 The safeguards, and where each is proven

| Safeguard (§11.1) | Mechanism | Test |
|---|---|---|
| Authorised delegation only | `mayGrant` requires a resolved `ACCESS_GRANT_PERMISSION` | unit + integration |
| No privilege escalation | transitive ceiling, self-target refusal, non-delegable set, super-admin protection | unit |
| Deterministic ordering | `(createdAt DESC, seq DESC)` with a unique `{adminId, seq}` | unit tiebreaker + 10 concurrent appends |
| Immutable event history | `immutable: true`; no role holds update/delete/drop on the collection | privilege audit in the suite |
| Actor, target, permission, reason, timestamp | all five are required validator fields | rejection tests |
| Expiry at authorisation time | expiry compared to `now` in the resolver, not at write time | 6 expiry cases, including instant-of-expiry |
| Concurrency, revocation, expiry, SUPER_ADMIN | see above, plus the lockout guard | unit + integration |

### 12.3 What this record does not claim

- **M2 has not started.** No session, cookie, Argon2 usage, login route or `requirePermission` guard exists.
  The resolver is a library with tests; nothing calls it from a request path yet.
- **The organisation gate needed a decision, and got one.** `users` has no `organisationId` — that column
  belongs to `portal_invitations` — so reading it would have returned `NO_ORGANISATION` and refused every
  admin. `loadAdminActor` now resolves the **platform** organisation (`orgKind: "PRIMEMET"`) for staff, which
  is what the contracts' "suspension must reach the staff too" is about, and still honours a per-user
  `organisationId` if a deployment adds one. Covered by a test that unsets the field. **Consequence for M2:**
  a `PRIMEMET` organisation row must exist before the guard is wired, or every admin is refused — fail-closed,
  but it must be seeded deliberately.
- **The lockout guard is not transactional** (§2.10 of the contracts): two simultaneous cross-denials could in
  principle both pass. Bounded, stated, not fixed.
- **The tier union figure was corrected**, not merely copied: §3.1 of the auth design said 59 / 15 super-only,
  and the implemented matrices measure 62 / 12. The arithmetic of the contractual 45-value
  `SOURCING_OPS_ADMIN` default is only consistent with the second figure.
- **No production database was contacted.** Every integration assertion ran against an in-memory replica set.

---

## 13. Phase 1 closure pass — 2026-11-01

**Nothing in this section is approved.** It records what the closure audit found, what was repaired in code,
and what is now waiting on the owner. The header of this register still holds: a recommendation is not an
approval.

### 13.1 Three claims in §12.3 are now superseded by code

| Earlier statement | Now |
|---|---|
| "The lockout guard is not transactional … two simultaneous cross-denials could in principle both pass. Bounded, stated, not fixed." | **Fixed.** The guard is a transaction that writes a shared fence document, so the second transaction conflicts and replays against a snapshot containing the first. 12 isolated two-super-admin worlds, simultaneous denials, zero survivals of the defect (`check:adversarial` §F). |
| "A `PRIMEMET` organisation row must exist before the guard is wired" | Still true, and it was **worse than stated**: `organisations` had no field that could hold `PRIMEMET` (`orgType` is BUYER \| SELLER \| BOTH), so the row could not exist at all and every admin resolved to `NO_ORGANISATION`. Defect **S-1**, repaired by migration **v004** (`orgKind` restored, single-PRIMEMET index moved onto it). |
| "The tier union figure was corrected … 62 / 12" | Correct, and now **generated**: `docs/PRIMEMET_TIER_MATRIX.md` is produced from `tiers.ts` by `scripts/report-tier-matrix.mjs`, and the two documents that still said 59/15 have been corrected. |

### 13.2 Decisions taken in code this pass (owner review requested)

| ID | Change | Reversible by |
|---|---|---|
| **D-C3** | A new infrastructure collection `_permission_guards` (migration **v003**), holding the continuity fence and the per-admin sequence counter. No Prisma model, by the same reasoning as `_schema_migrations`. | Dropping the collection and reverting `store.ts`; the append-only log is unaffected |
| **D-C1** | Sequence allocation moved from `max(seq)+1` to an atomic `$inc` counter, with the log as fallback. `seq`'s type, range and meaning are unchanged. | Reverting `allocateSequence`; the unique index remains the guarantee either way |
| **D-C2** | A repeated `eventId` with a different payload is refused (`EVENT_ID_CONFLICT`) instead of answered "already applied" | Reverting one comparison |
| **D-F** | `db/preflight.mjs`, used by v002 and v004: a migration refuses to change a validator when stored documents already contradict it. v002's header claimed this behaviour and did not have it. | Removing the pre-flight calls |
| **D-S1** | `organisations.orgKind` added (required, five enumerated values); the single-PRIMEMET partial unique index moved onto it. The superseded `{orgType:"PRIMEMET"}` index stays (OD-16 forbids `dropIndex`). | v004 is additive; the old index is dead structure |

Editing v002's file was safe for one reason only: **no database has ever applied it**, so no ledger row
records its old checksum. Its identity is now `7b9b566feede…`, v001 is unchanged at `58f130c4cc3c…`.

### 13.3 Open owner decisions arising from this pass

| ID | Question | Recommendation | Blocks |
|---|---|---|---|
| **D-TIER-1** | Should `LOT_OVERRIDE_GATE`, `PARTY_SUSPEND` and `ORDER_CANCEL` be super-only (matrix 59/15, `SOURCING_OPS_ADMIN` 42)? | Keep 62/12 as implemented; the counts are arithmetically settled, the policy is not. | Nothing technically; it changes who can operate |
| **D-BOOT-1** | Bootstrap as an owner-run CLI, or a `workflow_dispatch` job? | CLI — one run per environment, no owner credentials in CI logs | Implementing the bootstrap |
| **D-BOOT-2** | Is a lost super admin a break-glass repair, or a restore-from-backup incident? | Backup/restore until a tested procedure exists | The runbook |
| **D-M2a-1/2/3** | Unchanged: hashing dependency, session lifetimes, `AUTH_SECRET` scope | As recorded in §2 | M2a implementation, testing, merge |

### 13.4 Independent acceptance

**PENDING, not claimed.** Both `check:permissions` (133 assertions) and `check:adversarial` (96 assertions)
were written by the implementer. They are adversarial in *content* — forged payloads, self-grants,
cross-organisation writes, concurrent cross-denials, conflicting idempotency keys, malformed documents — but
they are not third-party verification, and this register does not record them as such. The earlier
independent passes (F-1, Phase 1 acceptance) remain the only actual second-party reviews in the record.
