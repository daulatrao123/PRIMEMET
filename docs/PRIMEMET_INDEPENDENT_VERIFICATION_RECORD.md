# PRIMEMET — Independent verification record (UNSIGNED)

**Obligation:** Workstream 6 — Independent verification readiness
**Prepared:** 2026-11-02 · **Status:** AWAITING REVIEWER — no verdict entered

This document is the execution record a reviewer fills in. It is intentionally blank in every verdict
column. The implementing agent must not complete it: doing so would be self-certification, which the
owner prohibited and which the package's own status forbids.

- [ ] Reviewer is a different engineer from the implementing agent
- [ ] Reviewer has read `docs/reviewer-package/06-remaining-limitations.md` before forming a view
- [ ] Reviewer executed the commands in `docs/reviewer-package/07-exact-commands.md`
- [ ] Every verdict below was entered by the reviewer, not transcribed from the package

## Readiness prerequisites (verified by the agent, not a verdict)

| Prerequisite | State |
|---|---|
| Package complete (7 required elements + classification) | present, 9 files in `docs/reviewer-package/` |
| Package completeness check | `npm run check:reviewer-package` → 88/88 assertions |
| Reproduction commands resolve | all commands in `07-exact-commands.md` exist in `package.json` |
| Migration evidence | `docs/reviewer-package/05-migration-verification-evidence.md` |
| Environment for `check:authz` | single-node replica set with `--auth` + keyfile; roles from `db/roles.mjs` |
| Node | 22.x; `mongodb-memory-server` downloads a mongod binary on first use |
| Production contact | none; no production data or credential is used by any command |

## Verdict record — to be completed by the reviewer

Permitted labels only: **FIXED AND VERIFIED** · **FIXED, INDEPENDENT REVIEW PENDING** · **OPEN** · **BLOCKED**.

| Finding | Claim | Reproduction | Expected behaviour | Reviewer verdict | Reviewer / date |
|---|---|---|---|---|---|
| W1 | Malformed `effect` fails closed | `npm run check:permissions`; `node scripts/reviewer-probe.mjs` | `04-expected-security-behaviour.md` W1 | | |
| W1-t | Suite no longer asserts the defect | `npm run check:permissions` | W1-t | | |
| W2 | Platform identity not transferable by relabelling | `npm run check:adversarial` | W2 | | |
| W2-s | `orgKind` and identity pointer not editable by a grant holder | `npm run check:authz` (expect **gap**) | W2-s | | |
| W3 | Direct grant insert cannot bypass delegation | `node scripts/reviewer-probe.mjs` (expect **NO**) | W3 | | |
| W4-a | Pre-`v004` upgrade path reports and dry-runs | `npm run check:migrations` | W4-a | | |
| W4-b | Fresh and upgraded databases converge | `npm run db:validate:offline`; `npm run check:migrations` | W4-b | | |
| R1 | Non-enumerated `effect` rejected by the validator (error 121) | `npm run check:mongodb` | R1 | | |
| R2 | `v004` restores `orgKind` and the single-PRIMEMET index | `npm run check:migrations` | R2 | | |
| R3 | `v002` refuses to relax a collection with non-conforming rows | `npm run check:acceptance` | R3 | | |
| L1 | Field immutability not expressible in a validator | review only | L1 | | |
| L2 | Role enforcement unobservable without an authenticated server | `npm run check:authz` | L2 | | |
| L6 | `resolve.ts` is not called from any request path | `npm run check:authz`; anonymous request to `/admin/dashboard` | L6 | | |

## Recorded agent-side outcome (not a verdict)

Nothing in the register carries **FIXED AND VERIFIED** today: 8 findings are *FIXED, INDEPENDENT REVIEW
PENDING*, 5 are *BLOCKED* (W2-s, W3, L1, L2, L6), 0 are *OPEN*. That distribution is the claim under
test, not its confirmation.

## Sign-off block (reviewer completes)

```
Reviewer name:      ______________________________
Date:               ______________________________
Commit reviewed:    ______________________________
Findings verified:  ______ of 13
Verdict:            [ ] ACCEPTED   [ ] ACCEPTED WITH CONDITIONS   [ ] REJECTED
Conditions / notes: ______________________________
```

While this block is empty, security acceptance is **NOT GRANTED** and M2 authentication must not begin.
