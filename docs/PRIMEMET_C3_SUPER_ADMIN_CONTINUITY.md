# PRIMEMET — C1/C2/C3: concurrency defects, their repair, and the evidence

Scope: the concurrency and idempotency findings raised against the Phase 1 D-ARCH-12 implementation.
Nothing in this document is added to the owner decision register as approved. Where a question is a
policy choice it is marked **OPEN** and left for the owner.

Status of the code: implemented in `src/lib/permissions/store.ts`, `db/guards.mjs`, `db/preflight.mjs`,
migration `v003`, with tests in `scripts/check-adversarial.mjs` and `scripts/check-permissions.mjs`.
Nothing is committed, pushed or deployed.

---

## 0. What was wrong, in one table

| ID | Defect | Consequence if left | State |
|---|---|---|---|
| **C1** | Sequence numbers were `max(seq)+1` under a bounded retry, with no atomic allocator | Correct but not viable under load: a 1000-way burst against one admin applied **18 of 1000** within a 4 s budget (162 with the original 20 attempts). Every loser was refused explicitly, so nothing was silently lost — but a 98% failure rate on an access change is a defect, not a characteristic. | **fixed** |
| **C2** | A repeated `eventId` was treated as a retry **without comparing the payload** | A second, contradictory request wearing the first one's idempotency key was answered "already applied". A `DENY` could be reported as done while the row said `GRANT`. | **fixed** |
| **C3** | The last-super-admin guard counted holders and then inserted, in two steps | Two instances, each denying a *different* super admin, both read the same remaining count and both committed: a classic write skew that leaves the platform with no identity able to write another access event. | **fixed** |
| C3-D2 | The guard covered `effect: "DENY"` only, and profile deactivation/demotion bypassed it entirely | Removing a super admin's access by deactivating their profile was unguarded while the more obscure event path was guarded. | **fixed** |
| F-v002 | v002's header claimed an existing document that violates the new validator "fails here, loudly" | It does not. `collMod` applies a validator to **future writes only**; the migration reported success over a row it could not have written itself. Reproduced against a real mongod. | **fixed** |

---

## 1. C3 — the write skew, and why a count cannot fix it

### 1.1 The scenario

Two super admins, A and B. Both hold `ACCESS_GRANT_PERMISSION`, which is what lets an admin append an
access event at all. Instance 1 handles `A denies B`; instance 2 handles `B denies A`, simultaneously.

For `A denies B`, the guard counts super admins that still hold the permission **other than the target**
— that is, A — and finds 1, so it allows the event. For `B denies A`, symmetrically, it counts B and
finds 1. Both are correct readings of the database at the instant they were taken. Both then insert.

`admin_permission_grants` is append-only and the two transactions insert **different documents** (one row
per target). Snapshot isolation permits exactly this: two transactions that write disjoint documents both
commit, and neither sees the other's write. The unique indexes on `{adminId, seq}` and
`{adminId, eventId}` do not collide, because the two rows have different `adminId`s. The result is a
state with **zero** holders of `ACCESS_GRANT_PERMISSION`, and because the log is append-only there is no
in-application path back: the next event must be written by someone who can already write one.

Retrying the count does not help. The count was not stale when it was read; it was stale when it was
acted on.

### 1.2 The mechanism that fixes it

Every guarded change must write **one shared document**. MongoDB's WiredTiger storage engine admits one
writer per document at a time, so the second transaction is refused with `WriteConflict`, the driver
replays it, and the replay opens a snapshot that already contains the first transaction's committed
change. The count taken during the replay is therefore the truth, and the second denial is refused.

That is the whole design: no leader election, no advisory-lock service, no shared memory. One document,
`_permission_guards/_id: "last-super-admin"`, whose `fence` field is incremented by every guarded
transaction. Its value is never read to make a decision — the decision still comes from the event log —
so a stale fence cannot produce a wrong answer. Its only job is to be written by everyone.

```text
BEGIN (snapshot, w:majority)
  read guard "last-super-admin"        -> absent? refuse GUARD_UNAVAILABLE
  count remaining holders (same txn)   -> unsafe? refuse LAST_SUPER_ADMIN
  $inc guard.fence                     <- the rendezvous: the second writer conflicts here
  perform the change (append / update)
COMMIT
```

### 1.3 Measured

`scripts/check-adversarial.mjs` §F builds **12 isolated databases**, each with exactly two super admins,
and issues both cross-denials through `Promise.all` — the genuine race, not a simulation:

| Assertion | Result |
|---|---|
| Both cross-denials commit in any round | **0 of 12** |
| A round ends with zero holders | **0 of 12** |
| Rounds where the guard was what stopped the loser (`LAST_SUPER_ADMIN`) | **12 of 12** |

`check:permissions` additionally proves the sequential rule still holds — after B is denied, B can no
longer write an access event at all (`ACTOR_NOT_PERMITTED`) — and that a missing guard document refuses
the change (`GUARD_UNAVAILABLE`) rather than proceeding unguarded.

### 1.4 Why not the alternatives

| Alternative | Why it was rejected |
|---|---|
| Count, then insert, with a retry | This is the defect. The two transactions never conflict, so no retry happens. |
| A unique index as the guard | The invariant is about a *set* of rows, not one row. There is no single document whose uniqueness encodes "at least one holder remains". |
| Application-level mutex / leader | Correct only within one process. The brief requires correctness across instances, and Vercel runs several. |
| Make `ACCESS_GRANT_PERMISSION` undeniably non-delegable and forbid every DENY against a super admin | Over-restrictive: it would forbid a legitimate denial while four other super admins remain, and it silently removes a control the design documents. The lockout invariant is "at least one remains", not "none may ever be removed". |
| `findOneAndUpdate` on the target profile | The two transactions touch *different* targets, so no conflict arises. Serialising on shared state is the point. |

### 1.5 The other route into the same hole (C3-D2)

A super admin's ability to write an event also ends when their profile is **deactivated** or their tier is
**lowered** — neither of which appends an event, so the event-level guard could not see it. Both now go
through `setAdminProfileAccess()`, which shares the same guard, the same fence and the same predicate, and
requires `ACCESS_ASSIGN_ROLE` (itself non-delegable below SUPER_ADMIN). Tested at every step: refusing
deactivation of the last holder, refusing demotion of the last holder, leaving the profile untouched when
refused, and allowing either change while another holder remains.

**Residual risk, stated rather than hidden.** MongoDB cannot refuse a direct `updateOne` on
`admin_profiles`, and `primemet_app` legitimately holds `update` there (M2 needs it). The guard is a choke
point only for code that calls it. The suite therefore asserts the *shape* of the module: the only profile
mutator exported by `src/lib/permissions/store.ts` is `setAdminProfileAccess`, and the module exports no
history mutator at all. **M2's admin routes must route profile and access changes through these two
functions.** That is an implementation requirement, not a convention.

---

## 2. C1 — sequence allocation, and the Prisma constraint the brief asked about

### 2.1 What changed and why

`seq` gives the resolver a total order that `createdAt` alone cannot (two appends can share a
millisecond). The old allocation read `max(seq)+1` and relied on the unique index to turn a race into a
retry. It was *correct* — no duplicate ever reached the log — but every contention event was a lost round
trip, so throughput collapsed under a burst.

Allocation is now an atomic `$inc` on a per-admin counter document in `_permission_guards`
(`_id: "seq-<adminId>"`, `kind: "PERMISSION_SEQUENCE"`, `value`). `$inc` on one document is atomic in
MongoDB, so each caller receives a distinct position and no caller has to lose before it can win.

| 1000 concurrent distinct events, one admin | Applied | Refused (`SEQ_CONTENTION`) |
|---|---|---|
| `max(seq)+1`, 20 attempts | 162 | 838 |
| `max(seq)+1`, deadline-bounded, flat backoff | 18 | 982 |
| **atomic counter** | **1000** | **0** |

The unique index on `{adminId, seq}` is unchanged and remains the guarantee. The counter is an
optimisation: if the collection or document is unreachable, allocation falls back to the log and the
append is merely slower. A counter that has fallen behind the log (a restore that lost the guard
collection, a hand-deleted document) is repaired with `$max` on the position the log proves is taken, and
the append retries.

### 2.2 The historical Prisma constraint — analysed, as required

The brief is explicit: do not replace the design with a counter document without analysing the historical
Prisma constraint and migration implications. The analysis:

1. **`admin_permission_grants.seq` does not change.** It remains `f.long({ minimum: 0 })` in
   `db/collections/core.mjs`, backed by the frozen Prisma model's `BigInt` column, and the validator's
   required list is untouched. The counter is a *source* of numbers, not a change to their type, range or
   meaning. Nothing in the append-only log gains a mutable field, which was the one outcome that would
   have broken its immutability guarantee.
2. **The counter is not a Prisma model, deliberately.** `prisma/schema.prisma` is frozen at the
   PostgreSQL M1 datamodel: `check:schema` proves the cumulative PostgreSQL migrations equal it, so adding
   a model without a PostgreSQL migration would fail that check, and adding a migration would revive a
   path that is deprecated for new work. The guard collection therefore follows the precedent already in
   the repository: `_schema_migrations` is infrastructure with its own hand-written validator in
   `db/ledger.mjs`, outside `COLLECTIONS`, and it needs no Prisma model. `_permission_guards` is
   declared the same way, in `db/guards.mjs`.
3. **No PostgreSQL migration is required or implied.** The counter exists to allocate positions in a
   MongoDB collection; it has no PostgreSQL counterpart and no data to migrate. `check:schema`,
   `check:schema:m1` and the seven frozen migration checksums are unaffected by this change — verified.
4. **It is a new collection, so it travels as a new version.** `v003` creates it, seeds the guard
   document, and re-converges the validator on `--reconcile`. `v001`'s and `v002`'s identities are
   untouched (`58f130c4cc3c…`, `7b9b566feede…`).
5. **Privileges.** `primemet_app` gets `find` + `update` on the guard collection (update is what
   increments the fence and the counter) and **not** `insert`: the document is seeded by the migration,
   and an identity that could create it could also replace the rendezvous point with one nobody else
   touches. A missing document therefore fails closed. `primemet_owner` additionally holds `insert` to
   seed it. No role holds any `drop*` action, and `auditRoleDefinitions()` now asserts both identities can
   reach the guard — verified by `check:mongodb` and `check:adversarial` §A.

### 2.3 The rest of C1

| Case the brief named | Behaviour now | Evidence |
|---|---|---|
| Concurrent writers, same admin | Distinct positions; a contested idempotency key resolves to one row | §H 1000/1000 authentic; §G one row |
| Concurrent writers, different admins | Independent counters; no cross-admin coupling | §H, `check:permissions` 10-way run |
| Duplicate `eventId` | One row; identical payload → idempotent success; different payload → `EVENT_ID_CONFLICT` | §G |
| Retry after an ambiguous write | The pre-transaction key lookup finds the row and answers idempotently | §G, §I |
| Sequence collisions | Repaired via `$max` + retry; never a duplicate row | §H |
| Retry exhaustion | Explicit `SEQ_CONTENTION`; never a silent loss | §H (0 in the final run) |
| Process crash during append | The row either exists or does not. The counter may run ahead of the log, which is harmless: positions are never reused and the resolver orders by `createdAt` first. | reasoning + §D replay |
| Ordering after concurrent writes | Total, because positions are unique and compared with `createdAt` | §H, `check:permissions` order-independence |

---

## 3. C2 — idempotency compared, not merely found

The retry path used to answer "already applied" for **any** row found under the key. It now compares
`adminId`, `permission`, `effect`, `grantedById`, `reason` and `expiresAt` against the request:

- identical → `{ ok: true, seq_idempotent: true }`, so the client stops retrying;
- different → `{ ok: false, refusal: "EVENT_ID_CONFLICT" }`, and **nothing is written**.

Measured at 1000 concurrent deliveries of one request: **1000 successes, exactly 1 writer, exactly 1 row,
0 conflicts**. Measured with 200 simultaneous deliveries split between two payloads under one key:
**100 winners, 100 conflicts, one row**, and every winner agrees on the stored effect.

---

## 4. F-v002 — a migration that could not have detected its own hazard

v002's header said a document violating the new validator "fails here, loudly, before any index is built".
It does not. MongoDB applies a validator to future writes only, so `collMod` succeeds over rows that
contradict it, and the migration records `applied` while the resolver is about to read data that the new
rules describe as impossible. Reproduced against a real mongod: a row with `effect: "OWN"` survived the
convergence unchanged.

The repair is `db/preflight.mjs`: before the validator is touched, v002 now runs six queries over the
documents as they are stored — the effect set, `seq` presence/type/sign, `eventId` presence and length,
`grantedById` presence, non-blank `reason`, and expiry after the event instant. Any violation throws
`PREFLIGHT_FAILED` with the rule, the count and the remedy, **before** `collMod`, so the ledger records
`failed`, the version stays reusable and the validator was never changed. Tested with a v001-shaped
collection holding a row the new definition refuses: the migration throws, the old validator is still in
place, and the offending row is still there rather than deleted.

Editing v002 is safe here and only here: no database has ever applied it (there is no database), so no
ledger row anywhere records the old file. Once a version is applied, its identity is frozen and the remedy
is a new version.

---

## 5. Operational consequences

1. **Apply v003 before deploying this code.** Without the guard document, every access change that could
   remove the last super admin is refused (`GUARD_UNAVAILABLE`) — fail-closed by design, and an outage of
   that one operation if the migration is skipped.
2. **The guard document is a singleton and must not be deleted.** Deleting it disables access changes; it
   does not disable ordinary appends (sequence allocation falls back to the log).
3. **`fence` is diagnostic.** Its value counts guarded decisions since the document was seeded. It is
   never an input to a decision.
4. **Backups.** Restoring the log without the guard collection is safe (the counter self-repairs); the
   guard document must be restored or re-seeded, or guarded changes are refused.

---

## 6. Evidence index

| Suite | Section | Covers |
|---|---|---|
| `check:adversarial` §A | definitions | guard names agree across modules; v001/v002 identities frozen; role privileges |
| §B | pure rule | the lockout truth table, including REVOKE and non-super targets |
| §C | tier matrix | 74/45/14/20/62/12, and the 59/15 alternative reproduced |
| §D | v003 | create-if-absent, seeded once, idempotent, fence never reset, ledger `applied` |
| §E | validator | the guard document shape is enforced by the server, not by code |
| §F | **write skew** | 12 isolated two-super-admin worlds, simultaneous cross-denials |
| §G | idempotency | 1000 concurrent deliveries of one request; conflicting payload |
| §H | contention | 1000 concurrent distinct events |
| §I | failure/retry | a held fence forces a real `WriteConflict`; the append still lands once |
| §J | attacks | forged payload, self-grant, escalation, cross-organisation, concurrent revocations, malformed input, mutator surface |
| §K | v002 | legacy rows preserved, unrelated index kept, partial state repaired, **fail-closed pre-flight** |
| `check:permissions` | integration | the same behaviour through the ordinary suite, plus the sequential rules |

Both suites are implementation-authored. Independent acceptance is **pending** — see §G of the final
report; nothing in this document claims otherwise.