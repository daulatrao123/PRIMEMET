# PRIMEMET — Security Remediation Plan

**Status:** proposal. No code changed, no database contacted, no credential created, `db-init.yml` not activated.
**Scope:** the seven items named in the Phase 0 acceptance brief.
**Guiding rule:** a control that is only described is not a control. Each item below states what is wrong, what
enforces the fix, and how it is proven — so "done" means a test that fails without the fix.

---

## 0. Priority and sequence

| # | Item | Current risk | Fix cost | Do it |
|---|---|---|---|---|
| 1 | Publicly accessible preview routes | **Critical (latent)** | M | **Phase 1** — before any real row exists |
| 2 | Database initialisation workflow | **Critical** | S | **Phase 1** — before the workflow is ever enabled |
| 3 | Runtime database role verification | High | S | **Phase 1** |
| 4 | Append-only collections | Medium | S | **Phase 1** |
| 5 | Security headers | Medium | S | **Phase 1** (cheap, no dependency) |
| 6 | Organisation isolation / IDOR | Medium (latent) | M | **Phase 2** — designed in, not retrofitted |
| 7 | Secure document upload and access | Medium | L | **Phase 3** — with the first upload |

**Why items 1–5 come first:** four of the five are cheap, need no database, and become materially harder once
real records exist. Item 1 is the only one whose *severity* grows with time — today it exposes labels, tomorrow it
exposes buyers.

---

## 1. Publicly accessible preview routes

### What is wrong
`/admin`, `/buyer` and `/seller` return **200 to anyone**. Measured: 35 protected pages (20 admin, 7 buyer,
8 seller) behind three layouts, plus `/api/health`. `src/middleware.ts` declares `PROTECTED_PREFIXES`,
`ROLE_BY_PREFIX` and `PUBLIC_PREFIXES`, then does nothing with them (`return NextResponse.next()`).

The area is currently safe **only because it holds no records**. Every panel is an `ExampleData` or `NotConnected`
layout. The first persisted row turns this into an open data breach.

Two additional facts that shape the fix:
- `middleware.ts` runs on the **Edge runtime** and cannot load the native MongoDB driver. It can check that a
  cookie is *present*; it cannot validate it.
- There is **no `POST` handler anywhere** in `src/`, so there is nothing to protect yet beyond reads.

### Remediation
1. **Two-layer guard, and be honest about which layer enforces.**
   - *Layout guard* (`src/app/admin/layout.tsx`, buyer, seller): server-side `requireActor(role)` →
     `redirect("/login")` or `notFound()`. This is the enforcing control.
   - *Middleware*: presence + route-class check only — redirect when no session cookie exists. Treated as a
     convenience, never as the control.
2. **Guard in the layout, not the page.** A per-page guard leaves the 36th page unprotected with nothing failing.
   One guard per layout covers every child route by construction.
3. **Fail closed.** Unknown route class → deny. A new top-level portal folder must be added to
   `PROTECTED_PREFIXES` deliberately, and a test must assert that every portal layout calls `requireActor`.
4. **Keep `noindex`** on all three portals. It is already present and correct.

### Proof
| Test | Asserts |
|---|---|
| S1-1 | Every portal layout calls `requireActor` (source scan; fails when a new layout omits it) |
| S1-2 | Unauthenticated request to each of the 35 routes → 302 to the correct sign-in page |
| S1-3 | Authenticated with the wrong role → 403 (not a redirect loop) |
| S1-4 | Deleting `middleware.ts` entirely leaves the system still guarded (proves layout is the control) |
| S1-5 | A new `/partner` portal folder without a guard fails S1-1 |

---

## 2. Database initialisation workflow

### What is wrong
`.github/workflows/db-init.yml` triggers on **`push: [main]`** with `paths: db/**`, `prisma/schema.prisma`,
`package.json`, `package-lock.json`. A routine dependency bump on `main` therefore fires database initialisation
against whatever `MONGODB_URI` resolves to.

Three compounding issues:
- `environment: production-database` is declared, but **required reviewers live in repository settings**, which
  cannot be read from the repository. If the environment does not already exist with reviewers, GitHub creates it
  **unprotected** on first run and the declaration becomes decorative.
- If `MONGODB_URI` is a *repository* secret rather than an *environment* secret, the environment gate does not
  scope access to it.
- `${{ inputs.dry_run }}` is interpolated into `run:` — safe for typed booleans, but the pattern becomes injection
  the day an input changes to free text.

### Remediation
1. **`workflow_dispatch` only.** Remove the `push` trigger entirely. Initialisation is a deliberate human act, not
   a consequence of merging.
2. **Environment secret, with reviewers configured before the first run.** Owner step: create
   `production-database` with required reviewers, then move `MONGODB_URI` into it.
3. **Dry run is the default.** `dry_run` defaults to `true`; applying requires an explicit input plus the
   environment approval.
4. **Stop interpolating inputs into `run:`.** Pass them via `env:` and read `$DRY_RUN` in the script.
5. **Keep the per-step secret scoping** that already exists (`MONGODB_URI` is exposed only to the migration step, so
   `npm ci` and its lifecycle scripts cannot read it). This is a genuine strength — preserve it.
6. **Do not activate until 1–5 are done.** Tracked as the standing blocker.

### Proof
| Test | Asserts |
|---|---|
| S2-1 | Workflow YAML parses; triggers are exactly `["workflow_dispatch"]` |
| S2-2 | No `${{ }}` expression appears inside any `run:` block |
| S2-3 | `MONGODB_URI` appears in no step other than the migration step |
| S2-4 | Running with `dry_run: true` against a scratch database performs no write |

---

## 3. Runtime database role verification

### What is wrong
`db/roles.mjs` defines `primemet_owner` and `primemet_app` correctly, and `auditRoleDefinitions()` passes — but
**nothing proves the deployed application is actually using `primemet_app`**. The Vercel environment could hold
owner credentials and every check would still be green. `db:check-role` exists and is wired into **no** workflow.

### Remediation
1. **Run `db:check-role` at deploy time**, as a post-deploy smoke step: it asserts the connected identity is not an
   owner role, and refuses to report healthy otherwise.
2. **Fail the deploy, not just the check.** A production deployment whose identity holds owner rights should not
   complete.
3. **Also assert positively**: the identity must hold `insert` on `audit_logs` and **must not** hold `update` or
   `delete` on any append-only collection.
4. **Surface it in `/api/health`** as a boolean (`database: "connected"` already exists; add nothing sensitive —
   just role class, never the identity).

### Proof
| Test | Asserts |
|---|---|
| S3-1 | `db:check-role` exits non-zero when run with owner credentials |
| S3-2 | It exits zero with `primemet_app` credentials |
| S3-3 | Deploy pipeline fails when S3-1's condition holds |

**Limit to state plainly:** S3-1/S3-2 require an authenticated server. A `mongod` started without auth cannot
prove role enforcement; that must be run against the real cluster once it exists.

---

## 4. Append-only collections

### What is wrong
Seven collections declare `immutable: true`, but MongoDB has no triggers. Protection rests on two things: the
privilege definitions, and the **binding** of the deployed identity to those privileges. Both must hold.

A defect was found and fixed in the audit earlier: `auditRoleDefinitions()` discarded database-wide grants
(`if (!collection) continue`) before testing the append-only rule, so the owner's wildcard `update` on all seven
history collections passed unreported. The corrected audit expands wildcards and judges each collection on its
*effective* privilege set.

### Remediation
1. **Keep the corrected effective-privilege audit** and make it a provisioning gate.
2. **Derive the append-only list from one place.** `IMMUTABLE_COLLECTIONS` is canonical; `APPEND_ONLY` re-exports
   it. A new `immutable: true` collection is protected automatically instead of needing three edits.
3. **Test every collection, not a sample.** The DAO refusal loop previously hardcoded two names, leaving five
   untested. Derive the loop from the canonical list.
4. **Add a reconciliation check** to `db:verify`: any document in an append-only collection whose `updatedAt` is
   later than its `createdAt` is suspicious, because history should never be rewritten.
5. **Accept the residual:** an owner or superuser can always disable the rule. That is closed by not deploying DDL
   rights, not by schema.

### Proof
| Test | Asserts |
|---|---|
| S4-1 | For each of the 7, an `updateMany` through the DAO is refused |
| S4-2 | For each of the 7, a `deleteMany` through the DAO is refused |
| S4-3 | Injecting the old wildcard grant produces 7 audit failures naming each collection |
| S4-4 | A newly declared `immutable: true` collection is covered without editing the test |

---

## 5. Security headers

### What is wrong
`next.config.ts` sets `reactStrictMode` and `poweredByHeader: false`, and nothing else. There is no CSP, no HSTS,
no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`, no `frame-ancestors`. The site is a
B2B platform that will hold commercial documents and eventually sessions.

### Remediation
Add a `headers()` block in `next.config.ts` — no dependency, no runtime cost:

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | force HTTPS |
| `X-Content-Type-Options` | `nosniff` | stop MIME sniffing on uploaded documents |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | do not leak enquiry URLs to third parties |
| `X-Frame-Options` / `frame-ancestors` | `DENY` / `'none'` | clickjacking |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | minimise surface |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | report-only first, then enforce |

**CSP caution, stated because it will bite otherwise:** Next.js inlines a small bootstrap script. Enforcing a
strict `script-src 'self'` without a nonce will break hydration. Plan: ship CSP in **report-only** first, observe
violations for a week, then enforce with a nonce via middleware.

One existing exception to keep visible: `src/components/seo/json-ld.tsx` uses `dangerouslySetInnerHTML` for the
JSON-LD island. If CSP enforces `script-src`, decide deliberately whether to allow it or move JSON-LD to a
header-injected block. A source scan should fail on a **second** occurrence.

### Proof
| Test | Asserts |
|---|---|
| S5-1 | Each header present on `/`, `/admin` and an API route |
| S5-2 | Header assertions run against a real `next start` response, not the config file |
| S5-3 | Exactly one `dangerouslySetInnerHTML` exists in `src/` |

---

## 6. Organisation-level isolation and IDOR

### What is wrong
There is no ownership model in code. No helper scopes a query to the caller's organisation, and no repository
pattern enforces it, because nothing reads the database yet. This is the classic failure: each new endpoint author
writes their own filter, one forgets, and a buyer reads another buyer's quotation by changing an id in the URL.

Currently unobservable — there is no data to leak — which is exactly why it must be designed now rather than
discovered in Phase 5.

### Remediation — three layers, all required
1. **Authentication context.** `requireActor()` returns `{ userId, role, organisationId, permissions }`. Never a
   bare boolean, so callers cannot forget the org.
2. **Repository scope, not query discipline.** Every read goes through a repository function whose signature
   demands the actor: `findOrderForActor(actor, orderId)`. There is no `findOrderById(id)` to reach for by mistake.
   The scope predicate is applied inside the repository, once.
3. **DTO allow-list at the boundary.** Responses are built by explicit mappers. A field not listed is not
   serialised — which makes "supplier cost never reaches a buyer" a property of the mapper, not of reviewer care.

**The IDOR test that matters:** authenticated as buyer A, request every record belonging to buyer B by id and
assert 404 (not 403 — do not confirm existence) for each. Run it over every new endpoint as a suite, driven by a
route inventory so a new endpoint cannot be added without a test.

### Proof
| Test | Asserts |
|---|---|
| S6-1 | Buyer A requesting buyer B's enquiry / quote / order / invoice id → 404 for each |
| S6-2 | Seller A requesting seller B's listing → 404 |
| S6-3 | A buyer response contains no `supplierCost`, `margin`, `supplierId` key (recursive key scan) |
| S6-4 | A route inventory test fails when a new `/api` route has no IDOR case |

---

## 7. Secure document upload and access

### What is wrong
`documents` holds the right metadata — `visibility`, `scanStatus`, `retentionUntil`, `legalHold`, `checksumSha256`,
`no URL` — and `document_access_logs` exists. But no storage provider is configured, no upload guard exists, no
signed-access path exists, and no retention job runs.

The dangerous part is that `visibility` is a **label**. A label is not an access control; something must enforce
it on every read.

### Remediation
1. **Private bucket only.** No public ACL, no static path, no long-lived signed URL. Bucket region must match the
   database region (same decision family as O-27.7).
2. **Upload guard before the bytes land:** MIME allow-list per `DocumentType`, size cap per type, server-side
   checksum verification after upload, `originalFilename` treated as untrusted display text only (never a path).
3. **Scan gate:** a document is not servable until `scanStatus = CLEAN`. The existing invariant (CLEAN requires a
   result) is necessary but not sufficient — serving must read it.
4. **Signed access per request**, after the authorisation check in
   `PRIMEMET_ARCHITECTURE_CLOSURE.md` §8: `INTERNAL` → admin with cost permission, `BUYER_VISIBLE` → the buyer on
   the owning enquiry/order, `SUPPLIER_VISIBLE` → that supplier, everyone else refused **and logged**.
5. **One row per serve** in `document_access_logs`.
6. **Retention job** refuses while `legalHold = true` and supersedes rather than overwrites.

### Proof
| Test | Asserts |
|---|---|
| S7-1 | A stored object is not reachable without a signed URL (direct path → 403) |
| S7-2 | An oversized or disallowed MIME type is refused before storage |
| S7-3 | A non-CLEAN document is not served |
| S7-4 | Buyer A cannot fetch buyer B's document by id → 404, and the attempt is logged |
| S7-5 | Every serve writes exactly one access-log row |
| S7-6 | Retention purge skips a document with `legalHold = true` |

---

## 8. Residual risks that no code change removes

| Risk | Why it remains | Mitigation |
|---|---|---|
| Owner/superuser can rewrite history | DDL rights always can | do not deploy DDL rights; audit on every apply |
| Atlas custom role may not match `db/roles.mjs` | the binding lives in Atlas, not the repo | verify once at provisioning; re-check with `db:check-role` |
| No independent security testing | all suites are self-authored | commission a third-party review before launch |
| Tax/invoicing treatment unconfirmed | requires the CA | keep assumptions out of the schema (already done) |
| Hosting region undecided | O-27.7 | decide before the cluster exists — affects data residency, documents and backups together |

---

## 9. What this plan does not do

It does not implement anything. No middleware logic, no headers, no guard, no upload path, no workflow edit, no
credential. `db-init.yml` remains inactive and unmodified. Item 1's guard lands with M2 authentication, because a
guard without a session is theatre — which is precisely why the current preview pages say so on screen.
