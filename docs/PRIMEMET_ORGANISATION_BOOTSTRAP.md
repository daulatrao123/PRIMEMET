# PRIMEMET — organisation bootstrap and the first SUPER_ADMIN

**Design only.** No account, credential, token or organisation was created by this work, and no bootstrap
script is implemented. Nothing here is committed, pushed or deployed. Any step that would touch a real
database is marked as an operational action for the owner.

---

## 0. Why this exists

Admin authorization cannot work without the platform organisation. `loadAdminActor()` resolves the staff
member's organisation, and `resolve.ts` refuses every permission when it is absent
(`NO_ORGANISATION`). So the first deployment has a circular dependency: the operator identity is needed
before the operator can grant anything, and there is no route that may create it without authentication.

The bootstrap is the deliberate exception. It is a **one-time, owner-run, out-of-band** procedure — not a
route, not a seed, not a default account.

Two defects found while designing it, both now fixed in code (see §1):

- **S-1** `organisations` had no field that could hold `PRIMEMET`, so the platform organisation was
  unstorable and every admin resolved to nothing.
- **C3** the last super admin could be removed by profile deactivation, which no event-log guard covered.

---

## 1. What the schema now provides

| Need | Where it lives | Enforced by |
|---|---|---|
| Exactly one live platform organisation | `organisations.orgKind = "PRIMEMET"` | partial unique index `{orgKind:"PRIMEMET", deletedAt:null}` (migration **v004**) |
| The operator can be distinguished from a counterparty | `orgKind` (5 values) vs `orgType` (BUYER/SELLER/BOTH) | validator enum on both fields |
| A staff identity | `users` (`role: ADMIN`, `status`) + `admin_profiles` (`tier`, `staffCode`) | unique `users.email`, unique `admin_profiles.userId`, unique `staffCode` |
| Access changes cannot empty the platform | `_permission_guards` + `withContinuityGuard` | migration **v003**, transactional fence |
| Every bootstrap action is on the record | `audit_logs` (append-only) | `immutable: true`; `primemet_app` holds no update/delete |

`orgKind` is required, so an organisation cannot be created without stating which kind it is. That is the
change that makes a silent second platform organisation impossible rather than merely unlikely.

---

## 2. The bootstrap procedure

**Status: designed, not implemented.** The script described here does not exist yet; implementing it is an
owner decision (§5, D-BOOT-1).

### 2.1 Prerequisites

1. Migrations `v001`–`v004` applied by the owner identity, and `npm run db:verify` clean.
2. `primemet_owner` credentials available **only** as the GitHub Actions secret or in a local, unscoped
   shell session. They are never placed in Vercel, never in `.env.local`, and never in the application.
3. `primemet_app` provisioned but **not** used for this step. The runtime identity must not be able to
   create the organisation, the first user or the first admin profile — that is the whole point of the
   split.
4. A human decision recorded of: the platform legal name, country code, and the email address of the first
   super admin. Nothing in the repository may supply a default for any of them.

### 2.2 The steps

```text
bootstrap-organisation --apply
    --legal-name "<registered name>"      required, no default
    --country-code <ISO-3166 alpha-2>     required, no default
    --admin-email <address>               required, no default
    --confirm "<legal-name>"              must equal --legal-name, so a mis-pasted command fails
```

1. **Refuse to run against anything but an owner identity.** Read back `connectionStatus().authInfo` and
   abort unless the authenticated user holds a structural action. A bootstrap run with app credentials is
   a finding, not a shortcut.
2. **Organisation: insert-or-verify, never overwrite.**
   - No live `orgKind: "PRIMEMET"` row → insert one with `orgType: "BOTH"`, `accountStatus: "ACTIVE"`,
     `verificationStatus: "VERIFIED"`, `deletedAt: null`.
   - A row exists → compare its `legalName` and `countryCode`. Equal: **skip, report "already bootstrapped"**.
     Different: **abort** and print both values. Silently rewriting the operator's legal identity is how an
     invoice ends up under the wrong entity.
   - More than one live row → abort. The unique index should have prevented it; if it did not, the database
     is in a state that needs a human.
3. **First admin user: `INVITED`, never `ACTIVE`.** Insert with `status: "INVITED"`, `emailVerifiedAt: null`,
   **no `passwordHash`**, `mfaEnabled: false`, `failedLoginCount: 0`. The account cannot authenticate until
   the invitation is accepted and a password is set through the normal M2 flow, so the bootstrap never
   creates a usable credential — and never a shared or default one.
   - Existing user with that email: if `role: ADMIN`, continue; otherwise abort (an email is one identity).
4. **Admin profile: `SUPER_ADMIN`.** Insert `admin_profiles` with `tier: "SUPER_ADMIN"`, `isActive: true`,
   `mfaRequired: true`, and a `staffCode` derived from the operator's own numbering (`PM-0001` here is an
   example, not a default).
   - Existing profile for that user: leave it alone unless its tier is not `SUPER_ADMIN`, in which case
     abort — the operator has to look at why an admin profile already exists.
5. **Audit every step.** One `audit_logs` row per object created or verified:
   `action: "BOOTSTRAP_ORGANISATION" | "BOOTSTRAP_ADMIN_USER" | "BOOTSTRAP_ADMIN_PROFILE"`,
   `entityType`/`entityId` of the affected document, `severity: "CRITICAL"`, `actorUserId: null`,
   `actorRole: "ADMIN"` **only if** the Bootstrap itself runs under a user identity (otherwise null),
   `beforeState`/`afterState`, and a `requestId` shared by the whole run so the three rows are one event.
   `actorIpHash` is the hash of the operator's address, never the address.
6. **Be idempotent, and prove it.** A second run with identical arguments performs zero inserts, writes one
   `BOOTSTRAP_VERIFIED` audit row, and exits 0. A second run with different arguments aborts at step 2.
7. **Never touch `_permission_guards`.** The guard document is seeded by migration v003. Bootstrap creates
   no access events: the first super admin holds `ACCESS_GRANT_PERMISSION` from the tier default, which is
   evaluated, not stored.

### 2.3 What the bootstrap deliberately does not do

| Not done | Because |
|---|---|
| Create a password, or any credential | M2 has no password policy approved yet, and a bootstrap-chosen password is a shared secret by definition |
| Send the invitation itself | Email delivery is an M2 concern with its own provider decision |
| Grant any permission explicitly | A super admin's tier default already includes all 74; an explicit GRANT would be a second source of truth |
| Create a second admin | One human is enough to start; the second is granted through the application, which exercises the real path |
| Run from a request handler | No unauthenticated admin-creation endpoint exists in the design, and none is planned |
| Enable the `db-init` GitHub workflow | Out of scope for this phase; the workflow stays inactive |

---

## 3. Requirement-by-requirement

| Requirement | How it is met |
|---|---|
| No default public admin account | Nothing is seeded at build time or on first request. The email is an argument; there is no fallback value anywhere in the repository. |
| No hardcoded credentials | The bootstrap writes no `passwordHash`. Credentials for the operator identity come from GitHub secrets or a local session, never from the repository. |
| No unauthenticated admin-creation endpoint | The mechanism is a CLI run by a human with owner credentials. No route exists or is proposed. |
| Explicitly controlled | `--apply` plus `--confirm "<legal-name>"`; refuses to run under the app identity; aborts on any identity mismatch. |
| Idempotent | Insert-or-verify at every step; a repeated run performs no writes and records `BOOTSTRAP_VERIFIED`. |
| Does not overwrite an existing organisation | A differing `legalName`/`countryCode` aborts with both values printed. |
| Every action auditable | One `audit_logs` row per object, sharing a `requestId`, `severity: CRITICAL`, append-only. |
| Runtime identities lack owner privileges | The script asserts the connected identity is not `primemet_app`; `auditRoleDefinitions()` independently proves the app role holds no structural action, and `check:mongodb` proves it against a real server. |

---

## 4. Operational sequence for the first deployment

1. Provision the cluster, roles (`npm run db:provision`), then apply migrations with the owner identity
   (`npm run db:init -- --apply` once the init workflow is authorised; it is **not** authorised now).
2. `npm run db:verify` — the guard document must be present and seeded.
3. Run the bootstrap (once implemented) with the three arguments and the confirmation.
4. Confirm: one `orgKind: "PRIMEMET"` row, one `INVITED` admin user, one `SUPER_ADMIN` profile, three
   `audit_logs` rows under one `requestId`.
5. Deploy the application with **app** credentials only. Accept the invitation, set a password, enrol MFA.
6. Every later admin is created through the application, which routes through
   `appendPermissionEvent` / `setAdminProfileAccess` and therefore through the C3 guard.

**Recovery.** If the last super admin is lost anyway (for example a direct database edit that bypassed the
store — the residual risk recorded in `docs/PRIMEMET_C3_SUPER_ADMIN_CONTINUITY.md` §1.5), the only safe
recovery is re-running the bootstrap in *repair* mode under owner credentials, which restores a
`SUPER_ADMIN` tier and writes a `CRITICAL` audit row. Repair mode is not designed in detail here because it
is an owner decision (§5, D-BOOT-2): the alternative is to treat it as a data-loss incident and restore
from backup.

---

## 5. Open decisions

| ID | Question | Recommendation | Blocks |
|---|---|---|---|
| **D-BOOT-1** | Implement the bootstrap as a CLI under owner credentials (recommended), or as a GitHub Actions `workflow_dispatch` job with a typed confirmation? | CLI. It runs once per environment, it keeps owner credentials out of CI logs, and it cannot be triggered by a pull request. | Implementing the bootstrap at all |
| **D-BOOT-2** | Is there a supported *repair* path for a lost super admin, or is it a restore-from-backup incident? | Treat it as a backup/restore event until M2 has a tested break-glass procedure. A repair mode that exists is a repair mode that gets used. | The recovery section of the runbook |
| **D-BOOT-3** | `staffCode` format for the operator's own admins (`PM-0001`?) | Operator's numbering; the field is unique and free-form, so no schema decision is needed — only an operational convention. | Cosmetic |
| **D-BOOT-4** | Who may accept the first invitation — must MFA enrolment complete before the account can act? | Yes: `mfaRequired: true` on the first profile, enforced at first login. | M2 login flow |