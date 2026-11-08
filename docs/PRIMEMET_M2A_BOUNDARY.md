# PRIMEMET — M2a Implementation Boundary (Task D)

**Status: PROPOSAL. Nothing in this document is implemented.**
No session code, cookie, endpoint, dependency or migration exists. This defines exactly what M2a
would touch, so the change can be reviewed before a single line is written.

Scope: **identity and session only** — prove who is making the request. Authorisation rules
(permission resolution, admin tiers), registration, password reset, email delivery and the first
Super Admin are all **out of scope** and blocked on later milestones.

---

## 1. What M2a is responsible for

| # | Responsibility | Evidence it is missing today |
|---|---|---|
| 1 | Session creation (login) | 0 `POST` handlers in `src/` |
| 2 | Session revocation (logout, role change, org suspension) | no session code, no cookie code |
| 3 | Cookie security attributes | 0 occurrences of `cookies()` in `src/` |
| 4 | Server-side session validation on every protected request | `src/middleware.ts` returns `NextResponse.next()` unconditionally |
| 5 | Role-change invalidation | `sessions.roleAtIssue` exists in the schema; nothing reads it |
| 6 | Organisation-suspension invalidation | `organisations.accountStatus` exists as a **free string (`maxLength: 40`, no enum)** and nothing reads it. The closed value set is **not yet decided** — see D-C4 in §11 |
| 7 | Protected layouts and APIs | every `/admin`, `/buyer`, `/seller` route returns 200 to an anonymous request |

M2a does **not** decide *what a role may do* — only *who the caller is*. That separation matters:
a session that resolves correctly but a permission check that is missing is a different bug from a
session that can be forged, and conflating them makes both harder to test.

---

## 2. Exact proposed file manifest

### 2.1 New files (9)

| Path | Purpose | ~lines |
|---|---|---|
| `src/lib/auth/password.ts` | Argon2id hash/verify/rehash wrapper; the only place the native binding is imported | 70 |
| `src/lib/auth/session.ts` | `createSession`, `readSession`, `revokeSession`, `revokeAllForUser`; token generation and SHA-256 hashing | 180 |
| `src/lib/auth/cookie.ts` | Cookie name selection (once, at module load), `setSessionCookie`, `clearSessionCookie` | 60 |
| `src/lib/auth/actor.ts` | `resolveActor(request)` → `{userId, role, sessionId} \| null`; the server-side gate used by layouts and APIs | 90 |
| `src/lib/auth/guards.ts` | `requireActor`, `requireRole` — throw or return a typed failure for API routes | 70 |
| `src/app/api/auth/login/route.ts` | `POST` — the only public writer | 110 |
| `src/app/api/auth/logout/route.ts` | `POST` — revokes the current session | 45 |
| `src/app/api/auth/session/route.ts` | `GET` — returns the caller's own identity, never another's | 40 |
| `scripts/check-auth-session.mjs` | Unit + integration assertions against an in-process replica set | 260 |

### 2.2 Modified files (7)

| Path | Change | Risk |
|---|---|---|
| `src/middleware.ts` | Presence/route-class check only; still **cannot** authenticate (see §8) | low |
| `src/app/admin/layout.tsx` | `await requireActor("ADMIN")` before rendering | **medium** — a bug here locks out every admin |
| `src/app/buyer/layout.tsx` | `await requireActor("BUYER")` | medium |
| `src/app/seller/layout.tsx` | `await requireActor("SELLER")` | medium |
| `src/lib/env.ts` | `AUTH_SECRET` becomes **required in production** (currently optional) | medium — misconfiguration becomes a hard failure |
| `src/app/api/health/route.ts` | unchanged behaviour; add a `session` capability flag | low |
| `package.json` | add `@node-rs/argon2` (one dependency) | low |

### 2.3 Deliberately **not** touched in M2a

`src/app/(auth)/login/page.tsx` keeps its disabled submit until the endpoint is proven; the portals
keep their preview labels for every screen that reads business data; `prisma/` is untouched (M2a
needs **no** PostgreSQL migration); `db/collections/*.mjs` is untouched except one optionality change
in §9.

---

## 3. API contracts

All three return `Cache-Control: no-store` and never include a password hash, a token, or another
user's data in any response body.

### 3.1 `POST /api/auth/login`

```jsonc
// request
{ "email": "string", "password": "string" }
```

| Outcome | Status | Body | Cookie |
|---|---|---|---|
| success | `200` | `{ "ok": true, "role": "ADMIN" \| "BUYER" \| "SELLER" }` | `Set-Cookie` session |
| bad credentials | `401` | `{ "ok": false, "error": "INVALID_CREDENTIALS" }` | none |
| account not active | `403` | `{ "ok": false, "error": "ACCOUNT_INACTIVE" }` | none |
| organisation suspended | `403` | `{ "ok": false, "error": "ORGANISATION_SUSPENDED" }` | none |
| malformed body | `400` | `{ "ok": false, "error": "INVALID_REQUEST" }` | none |
| rate limited | `429` | `{ "ok": false, "error": "TOO_MANY_ATTEMPTS" }` + `Retry-After` | none |

Rules that are part of the contract, not implementation detail:

- **One indistinguishable failure.** `INVALID_CREDENTIALS` covers unknown email and wrong password.
  Timing is equalised by verifying against a dummy hash when the user is absent, so a fast 401 does
  not reveal that the address is unregistered.
- **`AUTH_SECRET` has no role in session tokens.** The token is 32 random bytes; it is not a JWT and
  is not signed. Changing `AUTH_SECRET` therefore must not log everyone out by accident — and it
  cannot be used to *forge* a session, because there is nothing to sign. This follows the readiness
  report's finding that the variable is currently optional and unused.
- **Rehash on login.** If the stored hash's parameters are weaker than current policy, the password is
  re-hashed during a successful login. The library exports **no** `needsRehash` (verified in the Task C
  experiment), so this is derived by parsing the PHC string — see §4.3.

### 3.2 `POST /api/auth/logout`

`200 { "ok": true }`. Revokes the current session server-side **and** clears the cookie. A logout that
only deletes the cookie is not a logout: the token would remain valid until expiry.

### 3.3 `GET /api/auth/session`

| Outcome | Status | Body |
|---|---|---|
| valid | `200` | `{ "authenticated": true, "userId": "...", "role": "BUYER" }` |
| none/expired/revoked | `200` | `{ "authenticated": false }` |

`200` rather than `401` for the anonymous case: this endpoint is also used by the client to decide
what to render, and a 401 would log a browser-console error on every public page load.

---

## 4. Session lifecycle

### 4.1 Creation

1. Look up `users` by lower-cased email. Always run a verify against a dummy hash if absent.
2. Verify the password (§4.3).
3. Refuse unless `users.status = ACTIVE` **and** — for BUYER/SELLER — the linked
   `organisations.accountStatus = ACTIVE`. (ADMIN has no organisation; this is by design.)
4. Mint a token: 32 bytes from `crypto.randomBytes`, base64url. Store **only**
   `sha256(token)` in `sessions.tokenHash` — the unique index on that field is already defined.
5. Insert with `roleAtIssue` = the user's current role, `expiresAt`, and hashed IP/user agent.

A fast hash is correct here precisely because the token is 256 bits of entropy: there is no low-entropy
secret to brute-force, and an expensive hash would add latency to every request without adding
security. This is the one place SHA-256 is the right choice.

### 4.2 Validation (every protected request)

```ts
readSession(request):
  token   = cookie
  hash    = sha256(token)
  row     = sessions.findOne({ tokenHash: hash })
  if !row                      -> null
  if row.revokedAt             -> null
  if row.expiresAt <= now      -> null
  if row.roleAtIssue != user.role          -> revoke(row); null   // role changed
  if org.accountStatus != ACTIVE           -> null               // org suspended
  return { userId, role, sessionId: row._id }
```

The cookie is a **lookup key, never a claim**. No role, user id or expiry is read from the cookie, so
altering it can only produce a different (or no) row.

### 4.3 Rehash without `needsRehash`

The Task C experiment established that `@node-rs/argon2@2.2.2` exports `hash`, `verify`,
`Algorithm`, `parseOptions`, `hashRaw`, `hashSync`, `verifySync`, `Version` and the task classes — and
**no** `needsRehash`. Rehash detection must therefore be written:

```
parse PHC → { algorithm, version, memoryCost, timeCost, parallelism }
needsRehash = algorithm !== "argon2id"
           || memoryCost < POLICY.memoryCost
           || timeCost   < POLICY.timeCost
           || parallelism !== POLICY.parallelism
```

Raising the policy re-hashes on next login; lowering it does not, so a credential is never silently
weakened. Asserted by the experiment (28/28 passing).

### 4.4 Revocation

| Trigger | Mechanism |
|---|---|
| Logout | set `revokedAt` on the current session, clear the cookie |
| Password change / reset | revoke **all** sessions for the user except optionally the current one |
| Role change | `roleAtIssue` mismatch on the next request (§4.2) — plus an explicit bulk revoke at the moment of change |
| Account suspended/archived | revoke all; the per-request status check is the second line |
| Organisation suspended | no revoke needed: the per-request check reads the organisation every time, so suspension takes effect on the next request without touching sessions |

Revoking is an `update`, which the app role holds on `sessions` (mutable). Nothing here needs a
privilege the roles do not already grant — verified against `db/roles.mjs`.

---

## 5. Cookie security

| Attribute | Production | Development | Why |
|---|---|---|---|
| Name | `__Host-primemet_session` | `primemet_session` | `__Host-` is **browser-enforced**: the browser refuses the cookie unless `Secure`, `Path=/`, and **no** `Domain`. A domain-scoping mistake then becomes impossible rather than merely discouraged |
| `Secure` | on | off | `__Host-` is impossible over plain http; the dev name drops the prefix so local work is not a special case in the code |
| `HttpOnly` | on | on | the token is never readable from JavaScript |
| `SameSite` | `Lax` | `Lax` | `Lax` permits top-level navigation back into the portal (an email link that lands on `/admin/dashboard` still carries the cookie) while blocking cross-site `POST` |
| `Path` | `/` | `/` | required by `__Host-` |
| `Domain` | omitted | omitted | required by `__Host-` |
| `Max-Age` | = session TTL | same | the cookie and the row expire together; the row is the authority |

**Evaluated once at module load**, not per request: if `NODE_ENV` were read per call, a misconfigured
process would silently drop the `__Host-` prefix and emit a cookie the browser accepts — a downgrade
with no error. Both names are asserted in the test suite.

`SameSite=Lax` is chosen over `Strict` deliberately: with `Strict`, following a link from an email
into `/admin/dashboard` arrives unauthenticated and looks like a broken login.

---

## 6. Protected layouts and APIs

**The check must live in layouts, not pages.** There are **35 protected pages** (20 admin, 7 buyer,
8 seller) behind three layouts. A per-page check means the 36th page someone adds is unprotected and
nothing fails. A layout wraps every current and future child, so the default is deny.

```tsx
// src/app/admin/layout.tsx
const actor = await requireActor("ADMIN");   // redirects to /admin/login?next=… when absent
```

Every route under that layout inherits the gate because Next.js cannot render a child without
rendering its layout.

**API routes** call `requireActor`/`requireRole` explicitly — layouts do not wrap route handlers, so
an API route has no inherited protection. This asymmetry is the single most likely place to forget a
check, which is why `scripts/check-auth-session.mjs` asserts that **every** route file under
`src/app/api/**` except the explicitly public list imports a guard.

---

## 7. Invalidation, stated as testable rules

| Rule | Test |
|---|---|
| A role change invalidates existing sessions | issue session as BUYER, change role to ADMIN, next request → anonymous |
| A suspended organisation loses access on the next request | issue session, set `accountStatus = SUSPENDED`, next request → anonymous |
| Revoked sessions fail immediately | revoke, next request → anonymous even though the cookie is intact |
| Expired sessions fail | TTL in the past → anonymous |
| A cookie for another user's token cannot be fabricated | altering one byte of the token → anonymous |
| Logout is server-side | after logout the *old* cookie value is still rejected if replayed |

---

## 8. No bypass through middleware

**Middleware must not be treated as the control**, and this is why:

`src/middleware.ts` runs on the **Edge runtime**, which cannot load the native `mongodb` driver — the
same reason `src/lib/db.ts` is server-only. Middleware therefore cannot read the `sessions`
collection, and can only check that a cookie is *present*. A present-but-forged cookie passes it. The
actual authorisation happens in `requireActor`, in Node, in every layout and API route.

So the middleware's job is limited to a redirect convenience: no cookie on a protected path →
`/admin/login?next=…`. That check is a UX optimisation. If it were removed entirely, the system would
still be secure — and that property is asserted (T-GUARD-3: bypass middleware, request a protected
layout, still redirected by the layout).

Two things middleware **must not** do, because either would create a false sense of security:

1. attempt to verify the session (it has no database access, so it would either fail or be lied to);
2. be the *only* place a redirect is issued.

---

## 9. Schema delta M2a requires

M2a needs the `sessions` collection, which already exists with `tokenHash` (unique), `roleAtIssue`,
`expiresAt`, `lastSeenAt` and `revokedAt`. **One** addition is proposed:

> **Confirmed present, no action needed:** `sessions.lastSeenAt` (date) already exists in
> `db/collections/core.mjs`, alongside `ipHash`, `userAgentHash`, `createdAt`, `expiresAt` and
> `revokedAt`. The 30-minute idle timeout (D-M2a-2) therefore needs **no schema change** — it is
> enforced by comparing `lastSeenAt` on each request. What the design must still state is whether
> `lastSeenAt` is written on every request (a write on every read of a protected page) or on a
> throttle; that is a design note, not a schema delta.

| Change | Reason |
|---|---|
| ~~`sessions.revokedReason`~~ — **already present**, nothing is added | "why was this session ended" is the first question in any incident review. **Corrected:** `revokedReason` already exists in `db/collections/core.mjs`; this row previously proposed adding a field that is already there |
| `users.status` values confirmed `INVITED \| ACTIVE \| SUSPENDED \| DISABLED \| ARCHIVED` | login must distinguish "wrong password" from "account disabled". **Corrected:** the field already carries all five values as a validator enum; `DISABLED` was missing from this table |

No index changes. No PostgreSQL migration — the Prisma schema is a historical record and is not
extended for MongoDB work.

---

## 10. Tests proposed (not written)

**Status: nothing in this table has ever been executed, because M2a does not exist.**
No session code, cookie, endpoint or dependency is present. These are acceptance targets, not evidence.

`scripts/check-auth-session.mjs`, against an in-process replica set:

| ID | Assertion |
|---|---|
| T-SESS-1 | login with correct credentials issues a cookie and stores only a hash |
| T-SESS-2 | the stored value is not the token (sha256(token) ≠ token) |
| T-SESS-3 | wrong password → 401, no cookie, no session row |
| T-SESS-4 | unknown email → 401 with the **same** body and status as T-SESS-3 |
| T-SESS-5 | suspended user → 403, no session row |
| T-SESS-6 | suspended organisation → 403 for BUYER/SELLER, 200 for ADMIN |
| T-SESS-7 | logout revokes the row **and** clears the cookie |
| T-SESS-8 | a replayed pre-logout cookie is rejected |
| T-SESS-9 | expired session rejected |
| T-SESS-10 | tampered token rejected |
| T-SESS-11 | role change invalidates the session |
| T-SESS-12 | organisation suspension invalidates without touching the session row |
| T-SESS-13 | cookie name/TTL unit-testable via injected NODE_ENV (both branches) |
| T-GUARD-1 | each of the 3 layouts redirects an anonymous request |
| T-GUARD-2 | each layout admits the matching role and rejects a mismatched one |
| T-GUARD-3 | bypassing middleware still redirects (layout is the control) |
| T-GUARD-4 | every `src/app/api/**/route.ts` except the public list imports a guard |

---

## 11. Open decisions for the owner

| ID | Decision | Recommendation |
|---|---|---|
| D-M2a-1 | Add `@node-rs/argon2` (native dependency, one package + its platform binary) | **Approve.** Task C passed 28/28; N-API, GLIBC 2.14 floor |
| D-M2a-2 | Session TTL and idle timeout | 12 h absolute, 30 min idle |
| D-M2a-3 | Make `AUTH_SECRET` required in production | **Approve**, for CSRF-token signing only — not for sessions |
| C-M2a-4 | Execution of the Linux binding on the deploy runtime | **Required before merge** — see §12. A runnable harness (`scripts/verify-argon2-runtime.mjs`) and a manual workflow (`.github/workflows/m2a-argon2-gate.yml`) now exist; **neither has been executed on Linux**. Linux evidence is still pending |
| D-C4 (was D-M2-3) | `organisations.accountStatus` permitted values — the design proposes `PENDING \| ACTIVE \| SUSPENDED \| REJECTED`, but the field is currently an open string | **Approve `PENDING, ACTIVE, SUSPENDED, REJECTED`** and make it an enum in `db/collections/core.mjs`. Until it is closed, M2a can only test `accountStatus = SUSPENDED` as a literal, and a typo such as `active` would pass the login check |

---

## 12. What the Task C experiment could not prove

The experiment ran on **Windows x64, Node 26.13.0** — 28/28 assertions passing. The Vercel path was
verified **by inspection, not execution**: the `linux-x64-gnu` prebuilt exists (728 KB), is an
N-API addon (no `NODE_MODULE_VERSION` pinning, so it is ABI-stable across Node majors), requires at
most **GLIBC_2.14**, and links only `libc`, `libdl`, `libgcc_s`, `libpthread`, `librt`. There was no
Linux runtime available in this environment to execute it.

### 12.1 Tooling now exists; Linux evidence does not

Two artefacts were added so the gate can be closed without guesswork:

| Artefact | What it does | Has it run on Linux? |
|---|---|---|
| `scripts/verify-argon2-runtime.mjs` | Installs the exact pinned `@node-rs/argon2@2.2.2` into an empty OS temp project, loads the native addon, then asserts hashing, correct/incorrect verification, PHC parameters, rehash policy, concurrency and (with `--with-build`) a Next.js production build. Records platform, arch, libc, distro, kernel, Node, NODE_MODULE_VERSION, NAPI and package version. Exits non-zero on any failure. | **No** |
| `.github/workflows/m2a-argon2-gate.yml` | `workflow_dispatch`-only, `contents: read`, no secrets. Runs the harness on `ubuntu-24.04` (Node 26) and inside a `node:26-bookworm` container, uploading only `argon2-gate.log`. | **No** |

**Windows result: 19/19 assertions passed, 0 failed, 0 skipped** (`--with-build`), on
win32/x64, Node 26.13.0, `@node-rs/argon2@2.2.2`, native binary `argon2.win32-x64-msvc.node`.
That proves the harness is correct. **It is not evidence for C-M2a-4**, which requires a Linux x64
glibc runtime; the harness states this itself at the end of every run.

The Linux gate therefore remains **PENDING** until a GitHub Actions run on a Linux runner succeeds and
the log is returned for review. If it fails, the fallback is Node's built-in `scrypt` (no dependency,
no native addon) and that substitution requires **owner approval** — it is not to be made silently.

### 12.2 What Linux evidence must show

A run counts only if its log shows **all** of: `platform linux`, `arch x64`, a glibc version at or
above **2.14**, the pinned `@node-rs/argon2@2.2.2`, a loaded `argon2.linux-x64-gnu.node`, groups 3–5
actually hashing and verifying, group 6 matching `m=19456,t=2,p=1`, group 9 completing a Next.js
build, and the final line `RUNTIME: linux/x64 - valid evidence for C-M2a-4.` A skipped group or a
synthetic output is not evidence.

---

## 13. Rollback

**No production database exists.** There is no Atlas cluster, no initialised database, no credential
and no deployed instance. Nothing in M2a can therefore destroy production data, and no rollback step
below assumes a database to restore.

### 13.1 Rollback per change

| Change | Rollback | Reversible? |
|---|---|---|
| New `src/lib/auth/*` files | delete the files; nothing imports them until the layouts change | yes |
| New `/api/auth/*` routes | delete the route files; no client calls them until the login form is wired | yes |
| `requireActor` in the three portal layouts | revert each layout to its previous body (one line removed). **This restores the current state, in which every portal is public** — it is a rollback, not a fix | yes |
| `AUTH_SECRET` required in production | revert `src/lib/env.ts` to optional. This re-opens the *silent misconfiguration* the decision closes, so it is an emergency action only | yes |
| `@node-rs/argon2` in `package.json` | remove the dependency and the lockfile entry; `src/lib/auth/password.ts` is the only importer | yes |
| `sessions` rows written by a login | **no delete needed and none should be attempted** — set `revokedAt` + `revokedReason`. The app role holds no `delete`, and `sessions` history is the audit trail for a suspected compromise | not by deletion, by revocation |
| `lastSeenAt` writes | none needed; the field is advisory | yes |

### 13.2 What has no rollback

- **An issued session token.** Expiry and revocation are the only remedies; there is no way to make an
  already-minted token invalid except by revoking the row it hashes to.
- **`auth_events` rows.** The collection is append-only and `primemet_app` holds `find, insert` only.
  A wrong event is corrected by a later event, never by removing the first.
- **Time spent enforcing a policy that turns out to be wrong** (for example a 30-minute idle timeout
  that is too aggressive). The fix is a policy change, not a rollback.

### 13.3 Deployment rollback

There is no deployment. When there is one, the rollback unit is the Vercel deployment (promote the
previous build), **not** the database: M2a adds no migration, so an application rollback and a schema
rollback cannot conflict. Any future M2b change that does add a MongoDB migration version must state
its own forward-fix-only rule, because the ledger refuses to re-apply a changed file (F-1, ARCH §7.1).
