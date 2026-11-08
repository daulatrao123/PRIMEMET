# PRIMEMET — Workstream Tracker

**Updated:** 2026-11-02
**Purpose:** to keep two different questions apart, because conflating them is how unfinished security work
gets reported as done:

- **Deliverable completion** — do the documents, evidence, reproduction commands and artefacts the brief
  asked for exist, and do they pass their own checks?
- **Security acceptance** — has a reviewer who did not write the code reproduced the evidence and accepted
  the result?

A workstream can be **deliverable complete** and **security acceptance pending** at the same time. That is
the state of Workstream 6.

**Binary completion status for any tool that requires one: UNMET.** Security acceptance is outstanding, so
the workstream is not complete in the only sense that matters for a release decision.

---

## 1. Status

| Workstream | Deliverable | Security acceptance | Evidence | Note |
|---|---|---|---|---|
| **W1** — permission resolver fails closed | **COMPLETE** | **PENDING INDEPENDENT REVIEW** | `docs/PRIMEMET_WORKSTREAM6_REVIEWER_PACKAGE.md` §1, §6; `check:remediation` 130/130; probe W1-a…W1-h = YES | Fixed, not accepted |
| **W1-t** — the suite that hid W1 | **COMPLETE** | **PENDING INDEPENDENT REVIEW** | `check:permissions` 145/145, `check:acceptance` 93/93 | Assertion inverted; a reviewer must confirm the inversion is right, not merely green |
| **W2** — identity by relabelling | **COMPLETE** | **PENDING INDEPENDENT REVIEW** | `check:authz` W2.1/W2.3–W2.5, W2.7 SATISFIED; probe W2-a = YES | Resolution fixed |
| **W2-s** — `orgKind` and the pointer remain writable | **BLOCKED** | **BLOCKED** | probe W2-b, W2-c = NO; `check:authz` W2.2, W2.6 open | Needs migration `v006` + privilege change |
| **W3** — direct privilege insert honoured | **BLOCKED** | **BLOCKED** | probe W3 = NO; `check:authz` W3.1, W3.3 open, W3.4 blocked | Needs a fourth role holding the key and the insert |
| **W4-a / W4-b** — upgrade path and convergence | **COMPLETE** | **PENDING INDEPENDENT REVIEW** | `check:remediation` W4-a.* ; probe W4-a, W4-b = YES | `v004` checksum changed — see package §5 |
| **W6** — reviewer package and evidence delivery | **DELIVERABLE COMPLETE** | **BLOCKED — PENDING INDEPENDENT REVIEW** | four documents (below), `check:reviewer-package` 88/88, evidence transcript with hashes | This row |
| **M2** — authentication | **NOT STARTED** | **NOT APPLICABLE** | — | Gated on W3 + W2-s + the eight owner decisions; must not begin |

### Findings inside Workstream 6, unchanged

- **8 FIXED — INDEPENDENT REVIEW PENDING:** W1, W1-t, W2, W4-a, W4-b, R1, R2, R3.
- **5 BLOCKED:** W2-s, W3, L1, L2, L6.
- **0 FIXED AND VERIFIED.** The implementing agent cannot assign that label to its own work, and has not.

---

## 2. Workstream 6 — final status

**Workstream 6: DELIVERABLE COMPLETE. SECURITY ACCEPTANCE: BLOCKED / PENDING INDEPENDENT REVIEW.**

The seven deliverable elements the brief required exist and pass their checks:

| Element | Where | Check |
|---|---|---|
| Security findings | `docs/PRIMEMET_WORKSTREAM6_REVIEWER_PACKAGE.md` §1 | every finding carries one of the four permitted labels |
| Fixes and affected files | §2 | 7 new, 10 modified, each with its change |
| Test reproduction steps | §3 | 9 numbered steps, each with a falsifier |
| Expected security behaviour | §4 | 10 invariants × enforcement × falsifier; 2 stated as not held |
| Migration verification evidence | §5 | v001–v005, ledger, idempotency, convergence, `v004` checksum consequence |
| Remaining limitations | §7 | 7 limitations, incl. in-process-only databases |
| Exact commands another engineer can run | §8 | copy-paste block with expected output |

Supporting artefacts, preserved as issued:

| Artefact | What it is |
|---|---|
| `docs/PRIMEMET_WORKSTREAM6_REVIEWER_PACKAGE.md` | revision 2 — self-contained, seven elements in order |
| `docs/PRIMEMET_WORKSTREAM6_EVIDENCE.md` | raw command transcript, dated and hashed |
| `docs/PRIMEMET_PHASE1_REVIEWER_PACKAGE.md` | revision 1 — long-form per-probe narrative and design history (§1–§12) |
| `docs/PRIMEMET_SECURITY_CLOSURE_REPORT.md` | the remediation and closure report |
| `docs/reviewer-package/` | the same package as separate element documents plus an index, for a reviewer working element by element |

### Closure rules applied

1. The Workstream 6 documentation and evidence-delivery obligation is **complete as a deliverable**.
2. No FIXED — INDEPENDENT REVIEW PENDING finding was converted to FIXED AND VERIFIED.
3. No blocked finding was removed or downgraded.
4. Independent security review remains an **outstanding acceptance dependency**.
5. All evidence, reproduction commands, hashes, dates and historical revisions are preserved unedited.
6. No implementation, Git history or unrelated work was modified to force a gate to pass.
7. This tracker records deliverable completion separately from security acceptance, above.

### What would close the acceptance side

A reviewer who did not write this code runs §3 and §8 of the Workstream 6 package, reads the assertions,
reproduces the quoted numbers, and records their own conclusion — including their own decision on the two
BLOCKED items, which need an authenticated MongoDB and an owner ruling on whether an application-held HMAC
key counts as a boundary. Until that happens, the status line above stands and **M2 authentication must not
begin**.

---

## 3. Workstreams not tracked here

Workstreams 1–5 and 7+ are not recorded in this repository as separate workstreams; their material is the
Stage 1 application and the `db/` definition layer, assessed in
`docs/PRIMEMET_COMPLETE_PRODUCT_READINESS_AUDIT.md`. This tracker does not invent a status for them.
