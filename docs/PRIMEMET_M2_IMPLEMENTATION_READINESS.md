# PRIMEMET — M2 Authentication and Authorization Readiness

**Status:** prepared, not implemented. No authentication code, route, cookie, dependency or migration was
added. Nothing staged, committed or deployed.

What this document fixes is the *shape* of M2: what exists, what must be built, in what order, what each
piece must refuse, and which piece is blocked on which owner decision.

---

## 1. What exists today

Measured, not recalled:

| Fact | Value |
|---|---|
| Route handlers under `src/app/api/` | **1** — `health/route.ts`, read-only |
| Mutating request handlers (`POST`/`PUT`/`PATCH`/`DELETE`) in `src/` | **0** |
| Server actions (`"use server"`) | **0** |
| Cookie code | **0** |
| Hashing libraries in `package.json` | **0** |
| `middleware.ts` | present; authenticates nothing, returns `NextResponse.next()` |
| Permission resolver, store, delegation rules | implemented and tested (`src/lib/permissions/`) |
| Collections for identity | `users`, `admin_profiles`, `sessions`, `portal_invitations`, `auth_events` |

So M2 is net-new request-path code on top of a finished authorisation engine. That is a better position
than it sounds: the hard part — deterministic permission resolution, an append-only event log, delegation
ceilings, the continuity guard — is done and independently challenged. What is missing is the part every
web application needs and most get subtly wrong: the session.

---

## 2. The rule that decides the architecture

**Middleware cannot be the control.** It runs on the Edge runtime, which cannot open a MongoDB connection
with the native driver. It can check that a cookie is *present* and that the route class matches; it cannot
verify that the session exists, is unexpired, belongs to an active user in an active organisation, or that
the user holds the permission. Any design that puts the decision there is either wrong or must add a
network hop to a session service.

Therefore: **middleware may redirect for ergonomics; `requirePermission()` in the handler is the control**,
and deleting `middleware.ts` entirely must leave the system secure. That is asserted as a test, not as a
comment (see §6, T-GUARD-3).

The corollary matters as much: **the check belongs in the layout, not the page.** There are 35 protected
pages behind three layouts; a per-page check leaves the thirty-sixth page unprotected and nothing fails.

---

## 3. Authentication boundary

| Concern | Requirement | Blocks on |
|---|---|---|
| Password hashing | Argon2id, PHC-encoded, rehash-on-login when parameters rise | **D-M2a-1** |
| Registration | One transaction: organisation (PENDING) + user (INVITED) + profile + primary contact | D-M2a-1 |
| Email verification | Single-use token, hashed at rest, expiry, invalidated on use | D-M2a-1, mail transport |
| Login | Constant-time outcome; **identical response** for unknown user, wrong password and suspended account | D-M2a-1 |
| Logout | Server-side revocation first, then cookie clear; revocation must survive a cookie the client keeps | — |
| Password reset | Single-use token; **all sessions revoked** on success | D-M2a-1, mail transport |
| Session creation | 32 random bytes, SHA-256 stored, `__Host-` cookie in production | D-M2a-2 |
| Idle and absolute expiry | Absolute cap plus coarse sliding idle renewal | **D-M2a-2** |
| Cookie security | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `__Host-` prefix in production | — |
| CSRF | Double-submit token derived from `AUTH_SECRET`; `SameSite` is defence in depth, not the control | **D-M2a-3** |
| Rate limiting | Per-account and per-IP, on login, reset and registration | D-M2a-3 |

Two details that are easy to get wrong and are stated here so they are not discovered in review:

- **Enumeration safety is behavioural.** "Email not found" and "wrong password" must be indistinguishable
  in body, status *and* latency; a password check that is skipped for unknown users is a timing oracle.
  The standard fix is to hash a dummy value on the unknown-user path.
- **The `__Host-` prefix is browser-enforced**, which makes a domain-scoping mistake impossible rather than
  merely discouraged. It requires `Secure`, `Path=/` and **no** `Domain`. The cookie name must be decided
  once at module load, not per request: a mis-set `NODE_ENV` evaluated per request silently drops the
  prefix on some requests and not others.

---

## 4. Authorization boundary

The chain, in order, each step fail-closed:

```
cookie  ->  session  ->  user  ->  organisation  ->  admin actor  ->  resolver  ->  permission
```

| Step | Refuses when | Refusal is |
|---|---|---|
| cookie → session | absent, unknown hash, `expiresAt` past, `revokedAt` set | 401 |
| session → user | user deleted, `status != ACTIVE` | 401 |
| user → organisation | no organisation, organisation not `ACTIVE` (PRIMEMET exempt by design) | 403 |
| admin actor | `role != ADMIN`, no profile, profile inactive | 403 |
| resolver | permission not held | 403 |
| audit | — | every protected mutation writes an audit row **before** the response |

**404, not 403, for a resource the actor may not see.** 403 confirms the record exists; the isolation rule
is that a buyer asking for another organisation's enquiry must not learn whether it exists.

**Ownership is a filter, not a check.** Every query is scoped by the actor's organisation at the data
layer, so "fetch then compare" never appears. That is a design constraint now because there is no data yet;
retrofitting it after the first query is written is how IDOR arrives.

**No frontend visibility as enforcement.** A hidden button is a courtesy. Every protected screen must call
the same resolver that the API calls, and the API must refuse independently.

---

## 5. Build order

| # | Step | Depends on | Deliverable |
|---|---|---|---|
| **M2a-1** | Password hashing module + tests | D-M2a-1 | `hashPassword`, `verifyPassword`, `needsRehash` |
| **M2a-2** | Session store: create, verify, revoke, renew | D-M2a-2 | `createSession`, `loadSession`, `revokeSession` |
| **M2a-3** | `requireActor()` — the six-step chain | M2a-2 | one function, used by every protected route |
| **M2a-4** | `requirePermission()` on top of the resolver | M2a-3 | fail-closed, returns 403/404 per §4 |
| **M2a-5** | Routes: login, logout, register, verify, reset | M2a-1…4 | six handlers |
| **M2a-6** | CSRF + rate limiting | D-M2a-3 | middleware-independent |
| **M2a-7** | Layout guards + audit emission | M2a-4 | 35 pages behind 3 layouts |
| **M2b** | Admin RBAC resolver in the request path | M2a-4 | tier defaults + event log, deny-wins per D-ARCH-12 |
| **M2c** | Registration, verification, approval queue | M2a-5 | buyer and seller onboarding |
| **M2d** | Admin auth, invitation, session listing | M2b | separate admin login |

Blocked entirely: M2a-1 needs D-M2a-1; M2a-2 needs D-M2a-2; M2a-6 needs D-M2a-3. Everything else has an
independent start.

---

## 6. Test plan — named, not written

| ID | Asserts |
|---|---|
| T-PW-1 | A stored hash verifies only the correct password |
| T-PW-2 | A hash below policy is flagged for rehash; one above is not |
| T-PW-3 (Linux) | The native binding loads and hashes on the deploy runtime |
| T-SESS-1 | A session past `expiresAt` is refused |
| T-SESS-2 | A revoked session is refused even with a valid cookie |
| T-SESS-3 | Idle expiry is measured from `lastSeenAt`, not from creation |
| T-COOKIE-1 | Production sets `__Host-`, `HttpOnly`, `Secure`, `SameSite` |
| T-ENUM-1 | Unknown user, wrong password and suspended account are indistinguishable |
| T-CSRF-1 | A mutating request without a matching token is refused |
| T-RATE-1 | Repeated failures are throttled per account and per IP |
| T-GUARD-1 | A protected page without a session redirects, and the API returns 401 |
| T-GUARD-2 | A buyer cannot read another organisation's record — **404**, not 403 |
| T-GUARD-3 | **Deleting `middleware.ts` leaves every protected route refused** |
| T-GUARD-4 | A page added without a guard fails the route-inventory test |
| T-AUDIT-1 | Every protected mutation writes an audit row naming actor, target and action |

T-GUARD-3 and T-GUARD-4 are the two that keep the design honest over time.

---

## 7. Blockers

**Owner decisions**

- **D-M2a-1** — hashing dependency. Hard blocker on M2a-1.
- **D-M2a-2** — session lifetimes. Blocks M2a-2.
- **D-M2a-3** — `AUTH_SECRET` scope. Blocks M2a-6.
- **D-BOOT-1** — bootstrap. Blocks end-to-end testing of any admin route.
- **D-TIER-1**, **D-BOOT-2/3/4** — not blocking for build.

**Technical**

- **Linux Argon2 is NOT VERIFIED.** No Linux runtime on this machine (WSL stub reports "not installed";
  no Docker, no Podman). `m2a-argon2-gate.yml` has never run. Windows passing does not substitute.
- **No database exists.** Authentication can be written and unit-tested, but nothing can be exercised
  against a real cluster; the session store's index behaviour, TTL characteristics and latency are unproven.
- **Mail is not configured.** Registration and reset cannot complete end to end; they can be built behind
  an interface and tested with a fake transport.

**Security prerequisites that are M2's own**

- `middleware.ts` still authenticates nothing — correct today, fatal the moment a real record exists.
- `db:check-role` is not wired into any workflow, so the deployed identity is never proven to be
  `primemet_app`.
- **S-2 (open):** `orgKind` is not immutable, so a counterparty organisation could be relabelled PRIMEMET.
  M2 must not expose an admin route that edits `orgKind` until this is closed.

---

## 8. What M2 must not do

- Use middleware as the authorisation control.
- Enforce permissions by hiding UI.
- Introduce production credentials or a fake external service to "make it work".
- Add a schema field for sessions: `expiresAt` and `lastSeenAt` already exist, verified.
- Write an audit row *after* the mutation, or as a side effect that can fail silently.

---

## 9. Honest statement of readiness

**M2 cannot start authenticating today.** Three owner decisions and one unverified platform behaviour sit
in front of it. What can start immediately: the session store shape, the `requireActor` chain, the CSRF and
rate-limit design, the layout guard, the test file skeletons, and the audit emission — none of which needs
D-M2a-1, and all of which is where the security properties actually live.
