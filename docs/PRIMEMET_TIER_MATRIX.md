# PRIMEMET — permission matrix, measured

**Generated.** `node scripts/report-tier-matrix.mjs` — do not hand-edit. The table below is read from
`src/lib/permissions/tiers.ts`, `types.ts` and `delegation.ts`, which is the code the resolver executes.

Status: **measurement, not a decision.** One item in it (D-TIER-1, below) is an owner policy question and
is left open deliberately. Nothing in this document approves it.

---

## 1. The discrepancy, resolved arithmetically

| Figure | Where it came from | Reproducible? |
|---|---|---|
| **74** permissions in the vocabulary | `ADMIN_PERMISSIONS`, §2.2/§2.8 | yes — `74` |
| **45** SOURCING_OPS_ADMIN defaults | §2.8 table and the contractual matrix | yes — `45` |
| **14** CATALOGUE_MANAGER defaults | §2.8 | yes — `14` |
| **20** READ_ONLY_ADMIN defaults | §2.8 (VIEW minus CONTENT_REVIEW) | yes — `20` |
| **62** ordinary admin permissions / **12** super-only | this run | yes — `62` / `12` |

The two disputed readings are not a counting error — both are arithmetically self-consistent, and they
differ by exactly three permissions:

```
with LOT_OVERRIDE_GATE, PARTY_SUSPEND, ORDER_CANCEL in SOURCING_OPS_ADMIN
    SOURCING_OPS_ADMIN = 45   union = 62   super-only = 12
with those three removed from SOURCING_OPS_ADMIN
    SOURCING_OPS_ADMIN = 42   union = 59   super-only = 15
```

So the previous authentication design's **59 / 15** is the same matrix with those three treated as
super-only, and **62 / 12** is the matrix where they are ordinary. The contractual **45** is only
reachable if all three are included: excluding them yields 42, which contradicts the contract in three
places. That makes **62 / 12** the figure consistent with the contractual matrix, and it is what the code
implements.

**What is NOT resolved by arithmetic:** whether denying those three to SOURCING_OPS_ADMIN is the right
policy. `PARTY_SUSPEND` suspends a party, `ORDER_CANCEL` cancels an order and `LOT_OVERRIDE_GATE` overrides
a quality gate — each is both an operational necessity and a control worth restricting. The counts
(62/12) and the policy are separate questions, and only the first one is settled by the arithmetic.
Recorded as **D-TIER-1**, open.

## 2. Where the documents now say what

| Document | Before this pass | Now |
|---|---|---|
| `docs/PRIMEMET_PHASE_1A_CONTRACTS.md` §2.8 | "Union … = 59, so 15 permissions are SUPER_ADMIN-only" — while the same section's table states 45 | corrected to 62/12, with the arithmetic shown |
| `docs/PRIMEMET_M2_AUTH_DESIGN.md` §3.4 | listed 15 super-only permissions (the twelve plus the three) | corrected to the twelve, with the three marked disputed |
| `docs/PRIMEMET_M2_READINESS.md` | already 62/12 with the arithmetic rationale | unchanged |
| `docs/PRIMEMET_M2A_DECISION_REGISTER.md` | noted the correction | records D-TIER-1 as open |
| `scripts/check-adversarial.mjs` §C | — | asserts 74 / 45 / 14 / 20 / 62 / 12 and reproduces 59/15 as the same matrix minus three |

## 3. The matrix

`Super-only` is derived, not declared: it means **no non-super tier holds it**, so no admin below
SUPER_ADMIN can exercise it without an explicit grant. `Delegation` describes who may *grant* it
(§2.5/§2.6): the four non-delegable permissions cannot be granted by a non-super tier at all, and never
to oneself by anyone.

| Permission | SUPER_ADMIN | SOURCING_OPS_ADMIN | CATALOGUE_MANAGER | READ_ONLY_ADMIN | Delegation | Super-only | Source |
|---|---|---|---|---|---|---|---|
| `ENQUIRY_VIEW` | yes | yes | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `ENQUIRY_CREATE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `ENQUIRY_EDIT` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `ENQUIRY_CANCEL` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `ENQUIRY_ASSIGN` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `ENQUIRY_CLOSE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `QUOTE_VIEW` | yes | yes | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `QUOTE_PREPARE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `QUOTE_SUBMIT_FOR_APPROVAL` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `QUOTE_APPROVE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `QUOTE_SEND` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `QUOTE_REVISE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `SUPPLIER_QUOTE_REQUEST` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `SUPPLIER_QUOTE_VIEW` | yes | yes | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `SUPPLIER_QUOTE_COMPARE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `LOT_VIEW` | yes | yes | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `LOT_CREATE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `LOT_EDIT_DECLARATION` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `LOT_SCHEDULE_INSPECTION` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `LOT_RECORD_INSPECTION` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `LOT_AUTHORISE_DISPATCH` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `LOT_OVERRIDE_GATE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary; **disputed — D-TIER-1 open** |
| `LOT_CLOSE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `APPROVAL_REQUEST` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `APPROVAL_RECORD` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `REJECTION_RAISE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `REJECTION_RESOLVE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `REJECTION_MANAGE_DISPUTE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `REJECTION_PREPARE_SETTLEMENT` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `REJECTION_APPROVE_SETTLEMENT` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `CONTACT_VIEW_RESTRICTED` | yes | yes | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `CONTACT_APPROVE_SHARE` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `CATALOGUE_VIEW` | yes | no | yes | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `CATALOGUE_EDIT` | yes | no | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `CATALOGUE_PUBLISH` | yes | no | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `CATALOGUE_EDIT_COMPOSITION` | yes | no | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `CATALOGUE_APPROVE_COMPOSITION` | yes | no | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `PRICING_EDIT` | yes | no | no | no | delegable (ceiling applies) | **yes** | §2.8 vocabulary; super-only by arithmetic |
| `PRICING_APPROVE` | yes | no | no | no | delegable (ceiling applies) | **yes** | §2.8 vocabulary; super-only by arithmetic |
| `PRICING_VIEW_INTERNAL` | yes | yes | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `TAX_EDIT` | yes | no | no | no | delegable (ceiling applies) | **yes** | §2.8 vocabulary; super-only by arithmetic |
| `TAX_APPROVE` | yes | no | no | no | delegable (ceiling applies) | **yes** | §2.8 vocabulary; super-only by arithmetic |
| `TAX_VIEW_SNAPSHOT` | yes | yes | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `INVOICE_VIEW` | yes | yes | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `INVOICE_ISSUE` | yes | no | no | no | delegable (ceiling applies) | **yes** | §2.8 vocabulary; super-only by arithmetic |
| `DOCUMENT_VIEW_INTERNAL` | yes | yes | yes | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `DOCUMENT_UPLOAD` | yes | yes | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `AUDIT_VIEW` | yes | no | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `AUDIT_EXPORT` | yes | no | no | no | SUPER_ADMIN only (non-delegable) | **yes** | §2.8 vocabulary; super-only by arithmetic; §2.6 non-delegable |
| `REPORT_VIEW` | yes | yes | yes | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `USER_VIEW` | yes | no | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `USER_INVITE` | yes | no | no | no | delegable (ceiling applies) | **yes** | §2.8 vocabulary; super-only by arithmetic |
| `USER_SUSPEND` | yes | no | no | no | delegable (ceiling applies) | **yes** | §2.8 vocabulary; super-only by arithmetic |
| `ACCESS_ASSIGN_ROLE` | yes | no | no | no | SUPER_ADMIN only (non-delegable) | **yes** | §2.8 vocabulary; super-only by arithmetic; §2.6 non-delegable |
| `ACCESS_GRANT_PERMISSION` | yes | no | no | no | SUPER_ADMIN only (non-delegable) | **yes** | §2.8 vocabulary; super-only by arithmetic; §2.6 non-delegable |
| `SEO_EDIT` | yes | no | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `SEO_PUBLISH` | yes | no | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `CONTENT_GENERATE` | yes | no | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `CONTENT_REVIEW` | yes | no | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `REDIRECT_MANAGE` | yes | no | yes | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `PARTY_VIEW` | yes | yes | yes | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `PARTY_EDIT` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `PARTY_VERIFY` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `PARTY_SUSPEND` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary; **disputed — D-TIER-1 open** |
| `ORDER_VIEW` | yes | yes | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `ORDER_EDIT` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary |
| `ORDER_CANCEL` | yes | yes | no | no | delegable (ceiling applies) | no | §2.8 vocabulary; **disputed — D-TIER-1 open** |
| `NOTIFICATION_VIEW` | yes | no | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `NOTIFICATION_RETRY` | yes | no | no | no | delegable (ceiling applies) | **yes** | §2.8 vocabulary; super-only by arithmetic |
| `DATABASE_VIEW_STATUS` | yes | no | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `DATABASE_VIEW_MIGRATIONS` | yes | no | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `DATABASE_VIEW_HISTORY` | yes | no | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |
| `DATABASE_APPLY_MIGRATION` | yes | no | no | no | SUPER_ADMIN only (non-delegable) | **yes** | §2.8 vocabulary; super-only by arithmetic; §2.6 non-delegable |
| `DATABASE_VIEW_BACKUP_STATUS` | yes | no | no | yes | delegable (ceiling applies) | no | §2.8 vocabulary |

**Totals.** SUPER_ADMIN 74 · SOURCING_OPS_ADMIN 45 · CATALOGUE_MANAGER 14 · READ_ONLY_ADMIN 20 · union 62 · super-only 12.

## 4. The twelve super-only permissions

- `PRICING_EDIT`
- `PRICING_APPROVE`
- `TAX_EDIT`
- `TAX_APPROVE`
- `INVOICE_ISSUE`
- `AUDIT_EXPORT`
- `USER_INVITE`
- `USER_SUSPEND`
- `ACCESS_ASSIGN_ROLE`
- `ACCESS_GRANT_PERMISSION`
- `NOTIFICATION_RETRY`
- `DATABASE_APPLY_MIGRATION`

## 5. Open decisions recorded by this measurement

| ID | Question | Recommendation | Status |
|---|---|---|---|
| **D-TIER-1** | Should `LOT_OVERRIDE_GATE`, `PARTY_SUSPEND` and `ORDER_CANCEL` be super-only, making the matrix 59/15 and SOURCING_OPS_ADMIN 42? | Keep 62/12 as implemented until the operation has enough staff to absorb the controls: removing three day-to-day operational actions from the sourcing desk is a process change, not a permission tidy-up. The alternative is a one-line edit in `tiers.ts` plus a migration-free redeploy, so it stays cheap to reverse. | **OPEN — owner decision** |
