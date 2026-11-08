# PRIMEMET — Phase 1 Independent Acceptance Review

**Status:** review complete. Two defects found and fixed; six findings recorded, none approved.
**Scope:** documentation and test code only. Nothing staged, committed, pushed, deployed, migrated or
applied to production. No credential created, no infrastructure provisioned.

---

## 1. What this review is, and what it is not

`check-permissions.mjs`, `check-adversarial.mjs` and `check-bootstrap.mjs` were written by the same work
they verify. Their assertions encode the behaviour the implementation intended. Re-running 229 of them
and calling the result "independent acceptance" would be circular, so this review did not do that.

Instead it adds `scripts/check-acceptance.mjs` (91 assertions, `npm run check:acceptance`), written from
the *claims* rather than from the code, sharing no harness, helpers or fixtures with the existing suites,
and hostile in three specific ways:

1. **It seeds states the product's own helpers cannot produce** — a suspended user behind an active
   SUPER_ADMIN profile, a soft-deleted user holding an active profile, a legacy permission row outside
   the current validator.
2. **It asserts the invariant, not the refusal code.** Where the claim is "a way back in always survives",
   the assertion counts *usable holders after the operation*, so an implementation that refuses the wrong
   thing still fails.
3. **It labels its own evidence class** per section: pure function, real mongod, or static reading.

The result is not third-party acceptance in the sense the project's AC-1…AC-9 require — one author wrote
both the implementation and this review. It is *independent of the implementation's own assumptions*,
which is a weaker and precisely stated claim.

---

## 2. Baseline and final Git state

| | Baseline (turn start) | Final |
|---|---|---|
| Branch / HEAD | `main` / `7863743f20f9938ba1fd2548409ca05cbab0e471` | **unchanged** |
| Changed paths (`-uall`) | **90** (84 untracked, 6 modified, 0 staged) | **91** (85 untracked, 6 modified, 0 staged) |
| Staged / deleted | 0 / 0 | **0 / 0** |
| Commits / pushes / deployments | 0 | **0** |

The single added path is `scripts/check-acceptance.mjs`. The six tracked modifications are the six that
were already modified at turn start; two of them (`src/lib/permissions/store.ts`,
`src/lib/permissions/resolve.ts`) now carry the defect fixes described in §4, and `package.json` gains one
script.

---

## 3. Findings and severity

| ID | Severity | Finding | Status |
|---|---|---|---|
| **A-1** | **High** | The continuity guard counted *active profiles*, not *usable identities*, so a super admin whose user was suspended or soft-deleted still counted as "a way back in". | **Fixed** |
| **A-6** | Low | An unknown tier returned an empty permission set beside per-permission records that still said `allowed: true`. | **Fixed** |
| **S-2** | Medium | `orgKind` is validated but **not immutable**: a direct `updateOne` can relabel a BUYER organisation as PRIMEMET, and `loadAdminActor` resolves every admin against the single PRIMEMET row. | Open |
| **A-2** | Medium | A row whose `effect` is unrecognised is skipped and the *next* row down decides, so a corrupted DENY is weaker than no DENY. | Open, accepted |
| **M-1** | Low | v003 and v004 are no-ops on a fresh database, because v001 applies the current definitions. Their pre-flights cannot fire. | Open, documented |
| **A-7** | Low | The PRIMEMET organisation is exempt from its own `accountStatus`, so suspending it does not revoke staff access. Deliberate; previously untested. | Open, by design |
| **R-1** | Medium | A direct insert into `admin_permission_grants` that satisfies the validator bypasses delegation and sequence allocation entirely — and takes effect. | Residual, by design |

### A-1, in detail — the one that mattered

`countRemainingGrantHolders` selected `{ tier: "SUPER_ADMIN", isActive: true }` from `admin_profiles` and
then probed each profile's log with a **synthetic actor** whose user was always
`{ role: "ADMIN", status: "ACTIVE", deletedAt: null }`. The gate that decides whether a person can sign in
at all was therefore never consulted — the count measured profiles, not people.

Reproduced by execution:

```
three SUPER_ADMIN profiles; users 1 and 2 set to SUSPENDED
usable holders before: 1
setAdminProfileAccess(self, isActive: false)  ->  { ok: true, changed: true }
usable holders after:  0
```

The platform is then locked out with no in-application path back: the log is append-only, so the next
event must be written by somebody who can already write one.

The fix requires the user row to satisfy the same conditions the resolver's first gate applies —
`role: ADMIN`, `status: ACTIVE`, `deletedAt: null` — before a profile counts. The suite now asserts the
*invariant* (`usable holders >= 1 after the operation`), and passes.

### S-2 — the one that is still open

```
insert organisation { orgKind: "BUYER" }
updateOne  ->  { $set: { orgKind: "PRIMEMET" } }   // accepted
```

The validator constrains `orgKind` to five values; nothing makes it immutable. Because the resolver
resolves staff against *the* PRIMEMET organisation, relabelling a counterparty row silently changes which
organisation governs every admin's access. It needs a write path that can reach the collection — which at
present is only a direct database write or a future admin route — but it is a control gap, not a
hypothetical: the first admin route that lets a user edit `orgKind` inherits it.

Recommended: an invariant that refuses a change of `orgKind` once the row exists (compare against `$set`
in the same document is not expressible in a validator, so this belongs in the write path plus a
`db:verify` reconciliation), or a dedicated migration that pins the value. **Not implemented here** — it
is a schema decision, not a defect with an obvious local fix.

---

## 4. Defects fixed in this turn

| File | Change | Evidence |
|---|---|---|
| `src/lib/permissions/store.ts` | `countRemainingGrantHolders` now requires a usable user row, and documents why | suite B1 goes from fail to pass; `check:permissions`, `check:adversarial`, `check:bootstrap`, `check:mongodb` all still pass |
| `src/lib/permissions/resolve.ts` | `UNKNOWN_TIER` rewrites per-permission `allowed` to `false`, keeping the provenance | suite A6 goes from fail to pass |

Both changes are small, local, and covered by the new suite. Neither changes a public interface.

---

## 5. The fourteen required scenarios

| # | Scenario | Verdict | How it was exercised |
|---|---|---|---|
| 1 | Two concurrent cross-denials cannot remove all super-admin holders | **Pass** | two clients, `Promise.allSettled`, invariant asserted on usable holders (B4) |
| 2 | Profile deactivation and demotion cannot bypass the guard | **Pass** | self-deactivation (B1, B2) and self-demotion (B3) |
| 3 | Concurrent `eventId` collision with different payloads is rejected | **Pass** | one GRANT and one DENY under one key, in parallel (C3) |
| 4 | 1,000 simultaneous duplicate deliveries create one logical event | **Pass** | 1000 × `Promise.all`, row count = 1 (C4) |
| 5 | Counter/log consistency survives failed writes and retries | **Pass** | counter deleted, append still succeeds, positions distinct (D3); burnt position produces a gap, never a duplicate (D4) |
| 6 | Sequence ordering correct across instances | **Pass, limited** | two independent `MongoClient` connections (D2). Two *hosts* were not available |
| 7 | Fence creation and migration replay cannot reset the fence | **Pass** | `$inc` by 7, re-run v003, value still 7 (E1) |
| 8 | Invalid historical permission documents stop migration before validator modification | **Pass** | legacy `effect: "OWN"` row; migration throws; validator byte-identical before and after (E5) |
| 9 | v002–v004 handle interrupted execution and retry | **Pass** | every `up()` run twice; collection list and document counts identical (E2) |
| 10 | A second live PRIMEMET organisation is rejected | **Pass** | duplicate insert → 11000; soft-deleted row frees the slot (E3) |
| 11 | Missing or unknown `orgKind` fails closed | **Pass** | insert without `orgKind` refused; `orgKind: "PLATFORM"` refused (E4) |
| 12 | Buyer/seller organisations cannot become platform organisations | **Fail — S-2** | a BUYER row *can* be relabelled PRIMEMET by direct update (E4) |
| 13 | Permission provenance complete and immutable | **Partial** | completeness passes (74/74, event named); immutability is a privilege property and this server has no auth |
| 14 | No direct operation bypasses the store or guard | **Fail — R-1** | a validator-conforming direct insert bypasses delegation and takes effect (F5) |

Scenario 12 and 14 are reported as failures because they *are* failures of the stated claim, not because
the suite malfunctioned. Neither is exploitable from the application today: there is no admin write route,
and `primemet_app` is the only runtime identity.

---

## 6. Real mongod versus in-memory evidence

Every group B–G assertion ran against a **real `mongod` 7.0.14**, single-node replica set, `wiredTiger`,
started by `mongodb-memory-server` on this machine. Transactions, `WriteConflict`, snapshot reads and
`$inc` atomicity are therefore the real engine's, not a simulation.

**What that does not establish:**

- It is not a managed deployment. No TLS, no SCRAM, no network latency, no failover, no Atlas role binding.
- It runs **without authentication**, so no privilege is exercised. Every claim about
  `primemet_app` being unable to update the log, or `primemet_owner` holding no `drop*`, is asserted
  **statically** from `db/roles.mjs` and reported as a definition, not as an observed refusal.
- Scenario 6 used two client pools on one host, not two hosts.

---

## 7. Verification of the permission matrix (evidence for D-TIER-1)

Measured from `TIER_DEFAULTS` by the suite itself, not read from documentation:

| Tier | Permissions |
|---|---|
| Vocabulary | **74** |
| SUPER_ADMIN | 74 |
| SOURCING_OPS_ADMIN | **45** |
| CATALOGUE_MANAGER | 14 |
| READ_ONLY_ADMIN | 20 |
| Union of the three non-super tiers | **62** |
| Super-only | **12** |

The 59/15 interpretation is the same matrix with `LOT_OVERRIDE_GATE`, `PARTY_SUSPEND` and `ORDER_CANCEL`
excluded from SOURCING_OPS — which would make that tier 42, contradicting its contractual 45. So
**62/12 is the arithmetically consistent reading of the current code**, and 59/15 is a policy change that
requires three explicit removals. Neither is approved. See `PRIMEMET_M2_OWNER_DECISIONS.md` §1.

---

## 8. Linux Argon2

**NOT VERIFIED.** No Linux runtime exists on this machine: `wsl.exe` is present but reports *"The Windows
Subsystem for Linux is not installed"*, and there is no `docker` and no `podman`. Installing WSL requires
administrator rights and a reboot, and is outside this task.

Windows results (`19/19` on `win32/x64`, Node 26.13.0) **do not** establish Linux compatibility and are not
offered as evidence for it. The gate remains open; `.github/workflows/m2a-argon2-gate.yml` has never run.
See `PRIMEMET_M2_IMPLEMENTATION_READINESS.md` §7.

---

## 9. Test results (final tree; nothing run after these except the report)

| Check | Result |
|---|---|
| `npm run typecheck` | **0 errors** |
| `npm run lint` | **0 problems** |
| `npm run build` | **82/82 pages**, compiled 3.5 s |
| `npm run check:acceptance` *(new)* | **91 passed, 0 failed** |
| `npm run check:permissions` | 133 passed, 0 failed |
| `npm run check:adversarial` | 97 passed, 0 failed |
| `npm run check:bootstrap` | 23 passed, 0 failed |
| `npm run check:enums` | 40 passed, 0 failed |
| `npm run db:validate:offline` | 549 passed, 0 failed (45 collections, 98 indexes), no database contacted |
| `npm run check:migrations` | 74 passed, 0 failed |
| `npm run check:mongodb` | 105 passed, 0 failed |
| `node scripts/check-routes.mjs` | 59 routes, 56 required, 118 files, 0 problems |

Total: **1,112 passing assertions** across nine suites, plus typecheck, lint, build and the route check.
Every one is authored by this project — see §1.

---

## 10. What this review does not establish

- **Production readiness.** No hosted database, no credential, no deployment.
- **Privilege enforcement.** The local server has no authentication; role separation is a definition.
- **Third-party acceptance.** One author wrote the code and this review.
- **Linux binary compatibility.**
- Any behaviour under real network conditions, failover or Atlas-specific limits.
