# PRIMEMET — M1 Independent Verification Package

**Prepared:** 2026-11-04
**For:** a separate engineer who did not write this code
**Subject:** M1 authentication and authorisation layer (migration v006 + auth core + data layer)
**Status of the work:** verified locally by the implementing agent; **independent sign-off not yet given**

This package is written so that someone else can reach their own verdict. It contains the security
findings, the fixes with affected files, exact reproduction steps, the behaviour a secure system is
expected to show, the migration evidence, the remaining limitations, and the exact commands.

It is **not** a re-run of the Workstream 6 package and does not depend on it. Workstream 6 remains
DELIVERED / INDEPENDENT REVIEW PENDING SEPARATE ENGINEER / SECURITY ACCEPTANCE NOT GRANTED, and nothing
in this document changes that status.

Per-test observed evidence for every claim below is in `docs/PRIMEMET_M1_VERIFICATION_REPORT.md`.

---

## 1. Security findings

Severity is the risk **before** the fix, judged by what an unauthenticated or buyer-level attacker could
have done.

| # | Severity | Finding | Where |
|---|---|---|---|
| F-1 | **High** | The buyer enquiry write path was broken: `reference_sequences.lastValue` was incremented as an int32 while the collection validator requires a BSON long, so every enquiry insert was rejected. A degraded write path is a security-adjacent failure: the visible effect was a 500 on a core action, and the temptation under pressure is to loosen the validator. | `src/lib/data/enquiries.ts` |
| F-2 | **High** | Seller approval and listing approval had **no actor check inside the data layer**. They were protected only by a route guard that does not exist yet. Any future route, server action or script calling them would approve a seller or publish a listing. | `src/lib/data/admin.ts`, `src/lib/data/listings.ts` |
| F-3 | **Medium** | A blank optional environment variable (`DATABASE_URL=""`, a normal shape for a deployment template) failed validation of the whole environment, so `isDatabaseConfigured()` returned false and every account request answered 503 while `/api/health` reported a healthy server. A deployment could sit in that state unnoticed. | `src/lib/env.ts` |
| F-4 | **Low** | The sign-in and registration screens were forced dynamic, so the production build emitted no HTML for them (`/login`, `/admin/login`, `/register/*` were 404s in the build output). The pages could not be verified as `noindex`, and a deployment serving the build without the server would expose a broken entry point. | `src/app/(auth)/**/page.tsx` |
| F-5 | **Informational** | 40 TypeScript errors from untyped MongoDB collections: the driver's default `Db` assumes `ObjectId` identifiers while PRIMEMET uses UUID strings. Not a vulnerability, but the tree did not compile, so no security property could be verified at all. | `src/lib/db.ts`, `src/lib/data/*.ts` |

No finding was found in the credential or session primitives themselves: password hashing (scrypt
32768/8/1), session-token hashing (SHA-256), the signed cookie (HMAC-SHA256, expiry-checked), CSRF origin
checking, the rate limiter, or the guards. Those behaved correctly under attack in tests B6–B12, C1–C11,
D1–D6.

## 2. Fixes and affected files

| # | Fix | Files | How a reviewer confirms it |
|---|---|---|---|
| F-1 | Increment written as a BSON long; `year` as an int32 | `src/lib/data/enquiries.ts` | Tests F3, C10, C11 insert enquiries successfully; E5 proves the validator still rejects malformed documents |
| F-2 | New `requireAdminActor`; `decideSeller`, `decideListing`, `updateEnquiryForAdmin` take an `AuthUser` and throw `AuthorisationError` for a non-admin | `src/lib/data/authorise.ts` (new), `src/lib/data/admin.ts`, `src/lib/data/listings.ts` | Tests F4, F5 (seller actor refused), C9 (no admin write endpoint exists → 404) |
| F-3 | `definedEnv()` drops blank values before parsing; blank optional variables are treated as absent | `src/lib/env.ts` | `npm run check:env-blank` (blank `DATABASE_URL`/`DIRECT_URL` ⇒ database configured; missing `MONGODB_URI` ⇒ unconfigured) |
| F-4 | Query-string feedback moved into client `AuthNotice` / `NextField` inside `Suspense`; `robots: { index: false, follow: false }` on all four pages; superseded `auth-alert.tsx` removed | `src/components/auth/auth-notice.tsx` (new), the four `(auth)` pages | `npm run build` lists `○ /login`, `○ /admin/login`, `○ /register/buyer`, `○ /register/seller`; `npm run check:seo` 654 passed / 0 failed |
| F-5 | `PrimemetDocument` / `AppDb` types with string `_id`; data-layer signatures take `AppDb` | `src/lib/db.ts`, `src/lib/data/{catalogue,enquiries,listings,admin,db-safe,accounts}.ts` | `npm run typecheck` exits 0 |

## 3. Test reproduction steps

Prerequisites: Node 22+ (this run used 26), `npm ci`, and **no** `NEXT_PUBLIC_APP_URL` override when
building (the SEO check compares against the build's origin). No MongoDB install is needed: the harness
starts its own in-memory replica set and can reach no configured cluster.

```bash
npm ci
npm run build                     # exit 0
node scripts/verify-m1.mjs --selfcheck          # exit 0 — proves the harness itself works
node scripts/verify-m1.mjs --group ALL          # exit 0 — 42 passed, 0 failed
```

Per group, each command standing alone:

```bash
node scripts/verify-m1.mjs --group B     # authentication          12 passed
node scripts/verify-m1.mjs --group C     # authorisation           17 passed (F's fixtures, then C 11)
node scripts/verify-m1.mjs --group D     # cookie/session security  6 passed
node scripts/verify-m1.mjs --group E     # migration v006           7 passed
node scripts/verify-m1.mjs --group F     # data-layer ownership     6 passed
```

Supporting gates:

```bash
npm run typecheck      # 0 errors
npm run lint           # 0 problems
npm run check:env-blank# regression for F-3
npm run check:seo      # 654 passed, 0 failed (needs a fresh, un-overridden build)
```

What the harness does, so it can be audited rather than trusted: it creates a scratch database name,
starts `mongodb-memory-server` (replica set `rs0`), applies the repository's own migrations, sets
`MONGODB_URI`/`MONGODB_DB`/`AUTH_SECRET`/`PRIMEMET_ENV=test` to that instance **before** importing the
application modules, starts the real `next start` on loopback with a fake HTTPS origin, then runs the
groups against it. Each report is written to `.exvisit/tmp/m1-verify/report-*.json`. No test re-implements
the logic it checks: HTTP tests observe responses, and storage claims are checked by reading the scratch
database directly.

**Adversarial manual checks worth repeating by hand** (any of these succeeding is a finding):

1. Sign in as a buyer, then craft a cookie with `role:"ADMIN"` and the same payload → must be 401.
2. Replace the signature's last character with a different base64url character → must be 401.
3. Copy a buyer's `pm_session` into a request for `/admin/dashboard` → must redirect to `/buyer/dashboard`.
4. POST to `/api/auth/register` with `role=ADMIN` and `status=ACTIVE` → 400 on `role`; nothing marked active.
5. With a valid buyer cookie, PUT/POST to `/api/admin/approve`, `/api/admin/sellers`, `/api/admin/listings` → 404.
6. Submit six registrations from one address within the window → the sixth must be 429.
7. Inspect `Set-Cookie` on sign-in → `HttpOnly; Secure; SameSite=lax; Path=/`, and the value must not appear anywhere in the database row (only `tokenHash`).

## 4. Expected security behaviour

The reviewer should confirm these hold, not merely that tests pass.

1. **Identity is not client-controlled.** Role, user id, organisation id and account status are read from
   the session row on the server. A role in the URL, body or cookie payload changes nothing (B11, C8, C11).
2. **The cookie is a pointer, not a credential dump.** It is signed and expiry-checked; the session row is
   the authority; only a SHA-256 hash of the token is stored (D1–D4, B9).
3. **Logout is server-side revocation**, not a client deletion: the row carries `revokedAt` and a reason,
   and replaying the cookie fails (B7).
4. **Failures do not leak which accounts exist.** Wrong password and unknown account return the same
   status and the same wording; no password material appears in any response or auth event (B6, B10).
5. **Registration cannot escalate.** Public registration cannot create `ADMIN`/`SUPER_ADMIN`, and injected
   status fields are ignored — a seller stays `INVITED` until an administrator approves (B11, B2, F5).
6. **Organisation isolation is enforced per record**, not per page: another organisation gets `null` and an
   empty list, and internal notes never reach a buyer (C10, F3).
7. **Seller approval is administrator-only** and approval does not silently verify GST (F4, F5).
8. **Cookie-authenticated state changes refuse cross-site requests** (D5).
9. **The build refuses a missing or invalid production origin** and the portal pages carry `noindex` (F-4).

## 5. Migration verification evidence (v006)

| Property | Evidence |
|---|---|
| Applied by the repository's own CLI to a fresh database | E1: `node scripts/db-init.mjs` exit 0, 6 rows `applied`, 46 collections, `enquiries` validator `strict`/`error` |
| Upgrades a v005 database without disturbing data | E2: ledger 5 → 6; product untouched; legacy listing gains `reviewStatus:"PENDING"`, `submittedAt`, title, keeps `status:"ACTIVE"` |
| Re-running is a no-op | E3: 6 `skipped`, ledger size and checksums unchanged, indexes unchanged |
| An interrupted run recovers | E4: missing-ledger-row and `failed`-row interruptions both converge to exactly one applied row |
| Validators actually reject | E5: enquiry without owner, listing `reviewStatus:"MAYBE"`, product with unknown `publicationState` → code 121 |
| Indexes match the declarations | E6: 103 indexes across 46 collections (keys, uniqueness, partial filters, TTL) |
| `v006.up()` is idempotent | E7: two direct runs produce an identical index set and validator |

Reviewer note: these run against a scratch in-memory database. **No production migration was executed and
no production data was read or modified** — that remains an owner decision under D9.

## 6. Remaining limitations

1. **Portal write routes do not exist yet.** M1 delivered authentication plus the data layer; admin, buyer
   and seller *routes* are M2–M5. C5–C9 prove the middleware decision and the absence of any unguarded
   admin endpoint, not the behaviour of endpoints still to be written.
2. **Admin-scope read functions take no actor** — `listBuyers`, `listSellers`, `listAllProducts`,
   `listEnquiriesForAdmin`, `getEnquiryForAdmin`, `listAuditLogs`, `dashboardStats`,
   `countPendingListings` rely on the ADMIN route guard. Writes now refuse a non-admin; reads should gain
   the same check when M5 routes are built.
3. **Rate limiting is in-process** (fixed window, per address and per account). It bounds guessing on one
   instance; a multi-instance deployment needs a shared store. Not tested across processes.
4. **`Secure` was observed on an HTTPS-configured loopback origin**, which is the attribute a real
   deployment emits; no real TLS termination was exercised.
5. **Not in scope and not verified:** MFA, password reset, email delivery, payment, inspection, dispatch,
   fulfilment, dependency audit, and an independent penetration test. Password policy is length plus two
   character classes with scrypt storage — not a strength meter.
6. **Independent review is still outstanding.** This package makes that review possible; it does not
   substitute for it, and the implementing agent cannot sign on its own behalf.

## 7. Exact commands, for the record

```
npm ci                                   # install
npm run build                            # exit 0
node scripts/verify-m1.mjs --selfcheck   # exit 0, 5/5
node scripts/verify-m1.mjs --group ALL   # exit 0, 42 passed / 0 failed / 0 skipped
npm run typecheck                        # exit 0
npm run lint                             # exit 0
npm run check:env-blank                  # exit 0
npm run check:seo                        # exit 0, 654 passed / 0 failed
```

Repository state during verification: branch `main`, HEAD `7863743f20f9938ba1fd2548409ca05cbab0e471`,
0 staged paths, 0 stashes, 15 pre-existing modified files preserved, 81 untracked files. No commit, push
or deploy was performed.
