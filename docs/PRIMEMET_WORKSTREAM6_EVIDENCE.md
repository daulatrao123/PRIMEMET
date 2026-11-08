# PRIMEMET — Workstream 6 evidence transcript

Generated: 2026-11-02T05:13:14Z  ·  Tree: main @ 7863743f20f9938ba1fd2548409ca05cbab0e471

This transcript is raw output from this tree, captured by the implementing agent. It is evidence
for a reviewer, not a verdict. Security acceptance remains pending an independent reviewer; see
docs/PRIMEMET_WORKSTREAM_TRACKER.md and the packaged form in docs/reviewer-package/.

```
package file : docs/PRIMEMET_WORKSTREAM6_REVIEWER_PACKAGE.md
sha256       : f3130dca45d75744744e183c00e7fbb96d55b7b6b5f04e4b7781f8031569061f
lines        : 300
status lines : 119 (modified 6, untracked 113, staged 0)
```

## `npm run check:mongodb`

```
  ✔ the audit rejects delete for primemet_owner
  ✔ the audit rejects dropCollection for primemet_owner
  ✔ the audit rejects dropIndex for primemet_owner
  ✔ the audit rejects dropDatabase for primemet_owner
  ✔ the audit fails closed on an unclassified action
  ✔ primemet_owner can still amend all 38 mutable collections
  ✔ primemet_owner can still read and append every append-only collection
  ✔ primemet_owner keeps the structural actions a migration needs, including on future collections
  ✔ the application role cannot change structure (owner credentials are not deployable)
  ✔ all 7 append-only collections are find/insert only for the app role
  ✔ the provisioning plan covers primemet_owner and primemet_app
  ✔ the plan states which identity each role binds to
  ✔ the connected identity is not an owner role
105 passed, 0 failed
exit=0
```

## `npm run check:migrations`

```
  ✔ a subsequent apply skips it
F. Read-only commands
  ✔ the database starts empty
  ✔ --status exits 0
  ✔ --status created nothing
  ✔ --dry-run exits 0
  ✔ --dry-run created nothing
  ✔ --verify-only fails because nothing is initialized
  ✔ --verify-only created nothing
  ✔ no ledger was created
  ✔ the ledger row count is zero
  ✔ the database is still byte-for-byte empty
  ✔ 45 collections, 45 names cross-checked
74 passed, 0 failed
exit=0
```

## `npm run check:permissions`

```
  ✔ a super admin cannot deny their own kind the way back in
  ✔ a repeated eventId with a different payload is refused, not reported as applied
  ✔ the conflicting request wrote nothing
  ✔ the conflicting request did not rewrite the stored effect
  ✔ a missing guard document refuses the change instead of proceeding unguarded
  ✔ the refused change wrote no event
  ✔ a super admin may deny another super admin while another holder remains
  ✔ a super admin who has been denied can no longer write an access event
  ✔ deactivating the last super admin is refused by the continuity guard
  ✔ demoting the last super admin is refused by the same guard
  ✔ the refused changes left the last super admin untouched
  ✔ reactivating an admin is not a removal and is not blocked
  ✔ deactivating a super admin is allowed while another holder remains
145 passed, 0 failed
exit=0
```

## `npm run check:adversarial`

```
  ✔ v002 adds its indexes and keeps the unrelated one — _id_, ix_unrelated_preserved, ix_admin_permission_grants_adminId_permission, ix_admin_permission_grants_expiresAt, ix_admin_permission_grants_adminId_eventId_u, ix_admin_permission_grants_adminId_seq_u, ix_admin_permission_grants_adminId_permission_createdAt_seq
  ✔ after v002 the validator accepts REVOKE
  ✔ a partial state (a lost index) is repaired by re-running v002 — _id_, ix_unrelated_preserved, ix_admin_permission_grants_adminId_permission, ix_admin_permission_grants_expiresAt, ix_admin_permission_grants_adminId_eventId_u, ix_admin_permission_grants_adminId_permission_createdAt_seq, ix_admin_permission_grants_adminId_seq_u
  ✔ v002 refuses a collection holding rows the new definition would reject — PREFLIGHT_FAILED: admin_permission_grants contains documents the new definition would refuse: 1 document(s) fail "seq is
  ✔ and it did not change the validator it refused to vouch for — {"$jsonSchema":{"bsonType":"object","required":["_id","adminId","permission","effect","createdAt"],"properties":{"effect
  ✔ and the offending row is still there, not silently deleted — 1
L. The platform organisation
  ✔ a live PRIMEMET organisation exists (seeded from the real definition) — 1
  ✔ a second live PRIMEMET organisation is refused
  ✔ a soft-deleted one is allowed, so the platform row can be replaced deliberately
  ✔ an organisation with no operator marker is refused
  ✔ an operator marker outside the five kinds is refused
  ✔ orgType still refuses PRIMEMET, which is the defect this pair of columns exists to avoid
97 passed, 0 failed
exit=0
```

## `npm run check:remediation`

```
(node:10400) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///C:/Users/Admin/Documents/PRIMEMET/src/lib/permissions/resolve.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to \\?\C:\Users\Admin\Documents\PRIMEMET\package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
W1 — unknown and malformed effects fail closed (pure resolver)
W2 — administrator resolution reads the protected identity pointer
W3 — integrity tags make an unauthorised insert inert
W4-a — legacy organisation backfill: refusing, reported, convergent
  ✔ remediation: 130/130 assertions passed
exit=0
```

## `npm run check:acceptance`

```
(node:3608) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///C:/Users/Admin/Documents/PRIMEMET/src/lib/permissions/resolve.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to \\?\C:\Users\Admin\Documents\PRIMEMET\package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
A. Resolver — challenging the assumptions
B. Super-admin continuity
C. Event idempotency
D. Sequence ordering
E. Migrations v002–v004
F. Bypass surface
G. Provenance and role separation
  ✔ independent acceptance: 93/93 assertions passed
exit=0
```

## `npm run check:bootstrap`

```
6. The runtime identity cannot bootstrap anything
  ✔ primemet_app is defined
  ✔ primemet_app holds no structural action in any scope it can reach — none
  ✔ the role definitions audit clean
7. The design states the controls it claims
  ✔ the design addresses: no default public admin account
  ✔ the design addresses: no hardcoded credentials
  ✔ the design addresses: no unauthenticated admin-creation endpoint
  ✔ the design addresses: idempotency
  ✔ the design addresses: does not overwrite an existing organisation
  ✔ the design addresses: every action auditable
  ✔ the design addresses: runtime identities lack owner privileges
  ✔ the design marks itself as design-only
23 passed, 0 failed
exit=0
```

## `npm run check:reviewer-package`

```
Reviewer package — completeness
  ✔ reviewer package: 88/88 assertions passed
exit=0
```

## `npm run check:authz`

```
    W3.5 SATISFIED
    W3.6 SATISFIED
    W3.7 SATISFIED
    W2.1 SATISFIED
    W2.2 OPEN
    W2.3 SATISFIED
    W2.4 SATISFIED
    W2.5 SATISFIED
    W2.6 OPEN
    W2.7 SATISFIED
  properties held : 52
  measured gaps   : 6
  failures        : 0
  ✔ authenticated authorisation: 52 properties held, 6 gaps recorded
exit=0
```

## `node scripts/reviewer-probe.mjs`

```
W1 — An unrecognised permission effect must never grant access (fail closed)
W1-a. Unknown effect newer than a valid GRANT (the reported finding)
   MATCHES REQUIRED BEHAVIOUR: YES
W1-b. Unknown effect newer than a valid DENY
   MATCHES REQUIRED BEHAVIOUR: YES
W1-c. Only an unknown-effect event, tier default = grant
   MATCHES REQUIRED BEHAVIOUR: YES
W1-d. Event with effect missing entirely (malformed stored row)
   MATCHES REQUIRED BEHAVIOUR: YES
W1-e. Mixed valid and invalid: GRANT, unknown, DENY across three instants
   MATCHES REQUIRED BEHAVIOUR: YES
W1-f. Expired DENY above a live GRANT (expiry must be inert)
   MATCHES REQUIRED BEHAVIOUR: YES
W1-g. Future-dated DENY above a live GRANT (not yet in force)
   MATCHES REQUIRED BEHAVIOUR: YES
W1-h. Deterministic ordering: same millisecond, differing seq, either input order
   MATCHES REQUIRED BEHAVIOUR: YES
W2 — Organisation identity immutability     W3 — Delegation bypass     W4 — Migration convergence
W4-a. Upgrade path WITHOUT backfill: legacy organisations carry no orgKind
   MATCHES REQUIRED BEHAVIOUR: YES
W4-b. Upgrade path WITH an operator backfill of orgKind (as the preflight instructs)
   MATCHES REQUIRED BEHAVIOUR: YES
W2-a. Relabel a BUYER organisation to PRIMEMET when a platform org ALREADY exists
   MATCHES REQUIRED BEHAVIOUR: YES
W2-b. Relabel a SELLER organisation to PRIMEMET when NO platform org exists
   MATCHES REQUIRED BEHAVIOUR: NO
W2-c. Delete the platform org, then relabel another organisation to PRIMEMET
   MATCHES REQUIRED BEHAVIOUR: NO
W3. Direct insert of a validator-conforming event, bypassing the delegation guard
   MATCHES REQUIRED BEHAVIOUR: NO
probes run: 14
```
