# PRIMEMET — M2a authentication: implementation plan and blocking decisions

**Planning only. No authentication is implemented, and nothing here may be read as approval.**

This document assumes the authorization foundation is now safe: `docs/PRIMEMET_C3_SUPER_ADMIN_CONTINUITY.md`
records the C1/C2/C3 repairs, `docs/PRIMEMET_TIER_MATRIX.md` settles the permission counts, and
`docs/PRIMEMET_ORGANISATION_BOOTSTRAP.md` covers the first operator identity. It does not re-derive them.

The full prerequisity analysis, the runtime-compatibility measurements and the boundary of what may be
changed live in `docs/PRIMEMET_M2A_BOUNDARY.md` and `docs/PRIMEMET_M2A_DECISION_REGISTER.md`. This document
is the *sequence*, and the list of what must be answered before each step can start.

---

## 1. Status of the three blocking decisions

| ID | Decision | Current state | What it blocks |
|---|---|---|---|
| **D-M2a-1** | Add `@node-rs/argon2` (pinned) as the password-hashing dependency | **NOT APPROVED.** No hashing library exists in the project (0 matches for `argon2`/`bcrypt`). | Every line of password code. Nothing in M2a can be written without it. |
| **D-M2a-2** | Session lifetime: 12 h absolute / 30 min idle | **NOT APPROVED** | Session tests; the `sessions.lastSeenAt` field already exists, so it is a policy decision, not a schema one |
| **D-M2a-3** | `AUTH_SECRET` required in production, scoped to CSRF signing only | **NOT APPROVED** | The CSRF tests and the production build gate |

None is approved, and no work in this pass assumed otherwise. **M2a implementation must not begin until
D-M2a-1 is answered**; the other two may be answered in parallel but must be settled before the suite can
pass.

---

## 2. What is verifiably absent today

| Probe | Result |
|---|---|
| Hashing library in `package.json` | 0 matches for `argon2`, `bcrypt`, `scrypt` wrappers |
| Files under `src/app/api/` | **1** (`health`) |
| Route handlers exporting `POST`/`PUT`/`PATCH`/`DELETE` in `src/` | **0** |
| `"use server"` server actions | **0** |
| Cookie or session helpers | none |
| `src/middleware.ts` | present, but it runs on the Edge runtime and cannot open a MongoDB connection |

So "authentication is implemented" cannot be said of any part of the system, and any claim that a route is
protected is, today, unverifiable by construction: there are no routes.

---

## 3. Build order

Each step is independently testable and each ends in a check that exists (or is named to be written).

### Step 1 — hashing (blocked by D-M2a-1)

`src/lib/auth/password.ts` — `hash()`, `verify()`, `needsRehash()`. Argon2id with parameters pinned in one
constant, and a version prefix in the stored hash so parameters can change without a migration.
Tests: `scripts/check-auth.mjs` — round-trip, wrong password, timing sanity, rehash on parameter change,
and the same 20-sequential / 20-concurrent split the Argon2 runtime harness already uses
(`scripts/verify-argon2-runtime.mjs`). **Linux native binding** is proven only by the CI job in
`.github/workflows/m2a-argon2-gate.yml`; it has not been executed on Linux from this machine (no Linux
runtime is reachable here), so its status stays **unverified until the workflow runs**.

### Step 2 — session primitives (blocked by D-M2a-2)

`sessions` already carries everything needed: opaque `tokenHash`, `roleAtIssue`, `issuedAt`, `lastSeenAt`,
`expiresAt`, `revokedAt`, `ipHash`, `userAgentHash`. No schema change.
- Token: 32 random bytes, base64url, returned to the client **once**; only a SHA-256 of it is stored.
- Idle timeout is enforced by comparing `lastSeenAt` on read and writing back at most once per minute, so a
  read-heavy page does not become a write-heavy one.
- Revocation is a single `updateOne({_id}, {$set: {revokedAt}})`. `sessions` is **mutable** by design, so
  this is the one write path that may amend a document — the append-only collections are `auth_events`,
  `audit_logs` and the permission log, and they are untouched by session handling.

### Step 3 — HTTP surface

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/login` | POST | credential check → session + cookie |
| `/api/auth/logout` | POST | revoke by `tokenHash`, clear cookie |
| `/api/auth/verify-email` | POST | consume a single-use token |
| `/api/auth/password/reset/request` | POST | always 202, never reveals whether the address exists |
| `/api/auth/password/reset/complete` | POST | consume a single-use token, set password, revoke all sessions |
| `/api/auth/session` | GET | the caller's own identity and permissions |

Cookie attributes: `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, `__Host-` prefix.
CSRF: double-submit token signed with `AUTH_SECRET` (D-M2a-3) — a cookie alone is not a control.

### Step 4 — authorization integration (the step that makes the rest meaningful)

`src/lib/auth/require-permission.ts`:

```ts
const gate = await requirePermission("LOT_OVERRIDE_GATE");
if (!gate.ok) return gate.response;      // 401 unauthenticated, 403 denied — never a silent pass
const { actor, permissions } = gate;
```

Contract, in order and fail-closed at every step:
1. Read the session cookie; absent → `401`.
2. `sessions.findOne({ tokenHash })`; absent, revoked, expired (absolute or idle) → `401` and revoke.
3. Load the user; deleted, non-`ACTIVE`, locked → `401`.
4. `resolveActorPermissions(db, userId)` — the **same** function the tests exercise, resolving the event
   log against the tier default.
5. Permission absent → `403`, and an `auth_events` row.
6. Only then the handler runs.

**Middleware limitation, stated plainly.** `src/middleware.ts` runs on the Edge runtime and the MongoDB
native driver does not. It cannot resolve a session or a permission. It may only do cheap, cookie-shaped
work — redirect an unauthenticated visitor away from `/admin/*`, set security headers — and it is **not** an
authorization control. Every server-side enforcement point is `requirePermission` inside the route or the
server component. A page that renders admin data must call it; a middleware match is not a substitute.

### Step 5 — rate limiting

Counters in `auth_events` per `ipHash`/`emailHash` window, with the lockout fields already on `users`
(`failedLoginCount`, `lockedUntil`). No new collection. Tests must prove the counter cannot be reset by a
failed request.

### Step 6 — the suite

`scripts/check-auth.mjs` (+ a browser-level pass for the cookie attributes): login, logout, expired
session, revoked session, idle expiry, CSRF rejection, rate-limit lockout, password reset revoking all
sessions, email verification single-use, and `requirePermission` refusing on every route that needs it —
asserted by iterating the route table so a new route without a gate fails the test rather than shipping.

---

## 4. What must not happen

| Shortcut | Why it is refused |
|---|---|
| Authorizing in middleware "for now" | It cannot work: no database on the Edge runtime. An authorization check that never runs reads exactly like one that always passes. |
| Reading permissions from the JWT/cookie | The permission set must be resolved server-side from the log, or a stale token becomes a privilege-escalation path (this is the same defect C2 closed for forged payloads). |
| Reusing `AUTH_SECRET` for session signing | D-M2a-3 scopes it to CSRF; signing sessions with it would turn a key rotation into a mass logout. |
| Creating the first admin from a route | See `docs/PRIMEMET_ORGANISATION_BOOTSTRAP.md` — the bootstrap is a CLI, not an endpoint. |
| Declaring M2a done when the routes exist | "Done" requires a demonstration that an unauthenticated request and a low-privilege request are both refused on each protected route. |

---

## 5. Readiness verdict

| Question | Answer |
|---|---|
| Is the authorization foundation safe to build authentication on? | **Yes.** The write path is single, guarded and fail-closed; the invariant is proven under genuine concurrency; the permission counts are settled. |
| Can M2a implementation start today? | **No.** D-M2a-1 is unanswered and there is no hashing library. |
| Is anything in M2a blocked on the schema? | **No.** `sessions`, `auth_events`, `users` and `audit_logs` already carry the fields the plan needs. |
| Is the Linux native binding proven? | **No.** The harness runs on Windows here; the Linux job exists but has not been executed. |
| Is authentication implemented? | **No.** There are no auth routes and no request path that enforces a permission. Nothing in this document changes that. |