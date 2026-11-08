# PRIMEMET — M2 Owner Decision Briefs

**Status: NOTHING IN THIS DOCUMENT IS APPROVED.** Eight decisions are open. Each entry states what is
proposed, what is recommended, the security and operational consequences, and — separately — whether M2
can proceed while it is unanswered. Only the dependent operation stops; unrelated M2 work can continue.

Evidence for every factual claim here is in `PRIMEMET_PHASE1_INDEPENDENT_ACCEPTANCE.md` and in the
repository itself. No rate, price or latency figure is asserted.

---

## Summary

| ID | Decision | Blocks | Can M2 proceed without it? |
|---|---|---|---|
| **D-TIER-1** | Which tier holds `LOT_OVERRIDE_GATE`, `PARTY_SUSPEND`, `ORDER_CANCEL` | Policy only — code is consistent either way | **Yes.** Only the three permissions' holders change |
| **D-M2a-1** | Password hashing dependency | Everything that authenticates a password | **No** — hard blocker |
| **D-M2a-2** | Absolute and idle session lifetimes | Session creation, cookie max-age | **No** for those two values; yes for the rest |
| **D-M2a-3** | `AUTH_SECRET` scope | Session signing, CSRF, rate-limit keys | **Partly** — CSRF and rate limiting only |
| **D-BOOT-1** | Bootstrap mechanism | First super admin | **No** — nothing can be tested end to end |
| **D-BOOT-2** | Break-glass versus restore | Recovery procedure | Yes for build, no for launch |
| **D-BOOT-3** | Staff-code convention | Profile creation | Yes — it can default |
| **D-BOOT-4** | Mandatory MFA at first login | Admin onboarding | Yes — it can be enforced later |

---

## 1. D-TIER-1 — the three disputed permissions

**Current proposal.** `SOURCING_OPS_ADMIN` holds **45** permissions, which includes all three. The union
across the three non-super tiers is therefore **62**, and **12** permissions are super-only. Measured, not
assumed: see acceptance report §7.

**The three, and what they actually do**

| Permission | Operational effect | Abuse risk | Business risk |
|---|---|---|---|
| `LOT_OVERRIDE_GATE` | Lets one person authorise dispatch of a lot that failed a quality gate — the one control that stands between an unverified consignment and a buyer | **High.** It is the only permission that can neutralise the evidence chain the whole quality model exists to preserve. Used quietly, it converts a failed inspection into a shipment with no second signature | High — a rejected consignment shipped on one person's judgement is the liability event the workflow was built to prevent |
| `PARTY_SUSPEND` | Suspends a buyer or supplier organisation, which revokes portal access for all of its users | Medium. Denial of service against a counterparty mid-transaction; reversible but disruptive | Medium — a suspended supplier cannot quote, so a live enquiry loses its source |
| `ORDER_CANCEL` | Cancels a confirmed order | Medium. Cancelling after procurement commits PRIMEMET to stock it must then sell | High commercially, low security |

**Recommended decision.** Keep `ORDER_CANCEL` in `SOURCING_OPS_ADMIN` — the desk negotiates and commits,
and forcing a super admin to cancel makes the desk route around the system. Move `LOT_OVERRIDE_GATE` to
**super-only**, because a quality gate that the desk can override on its own is not a gate. Keep
`PARTY_SUSPEND` with the desk but require a stated reason and make the audit entry mandatory — which the
schema already enforces for permission events.

That gives `SOURCING_OPS_ADMIN = 43`, union **60**, super-only **14**. It is a *policy* change: no code
needs restructuring, only the two sets.

**Alternative.** Keep 45/62/12 unchanged and accept that a quality override is a desk decision. Defensible
if the override is visible on the same screen the buyer's approval came from and carries a mandatory note.

**Can M2 proceed?** Yes. `M2` authenticates; it does not decide which tier holds what.

---

## 2. D-M2a-1 — password hashing dependency

**Current proposal.** `@node-rs/argon2` v2.2.2 (Argon2id, m=19456 KiB, t=2, p=1). No hashing library
exists in the project today — verified: zero matches for `argon2|bcrypt|scrypt|pbkdf` in `package.json`.

**Recommended decision.** Approve it, **conditional on the Linux gate**. The package ships a prebuilt
`linux-x64-gnu` addon (N-API, no `node-gyp`), which is what makes it safe on a serverless build platform.
The Windows results show the algorithm and the PHC parameters behave; they say nothing about the Linux
binary, which has never been loaded.

**Security implications.** Argon2id is the correct modern choice: memory-hard, so GPU cracking is
expensive. The parameters are the OWASP-recommended baseline and the project asserts them against the
stored PHC string, so a future downgrade is detectable. The fallback — Node's built-in `scrypt` — is
acceptable but weaker against memory-bandwidth-parallel attackers and has no tunable memory cost in the
same sense.

**Operational implications.** One dependency, one native binary, version-pinned. If the Linux binding fails
to load on the deploy target, every login fails closed — loudly, not silently — which is the right failure
mode but is an outage.

**Alternative.** Implement `scrypt` from `node:crypto` and accept a modestly weaker KDF with zero
dependencies. Choose this only if the Linux gate cannot be run before M2a is needed.

**Can M2 proceed?** **No.** Nothing that verifies a password can be written. Everything else in M2 that
does not touch password material — route inventory, session store shape, CSRF design, permission resolver
wiring, audit emission — can.

---

## 3. D-M2a-2 — absolute and idle session lifetimes

**Current proposal.** Absolute 12 hours; idle timeout 30 minutes with sliding renewal. `sessions` already
carries `expiresAt` and `lastSeenAt`, so **no schema change is required** — confirmed against
`db/collections/core.mjs`.

**Recommended decision.** Approve 12 h / 30 min.

**Security implications.** The absolute cap is what bounds the damage of a stolen cookie: without it, a
stolen session is valid until revoked. The idle timeout bounds an unattended workstation. Twelve hours is
chosen so a working day fits in one session but an overnight theft does not; thirty minutes is standard for
a B2B back office and short enough that a shared machine is mostly covered.

**Operational implications.** Too short, and a trading desk re-authenticates mid-quotation, which drives
people to shared logins; too long, and an unattended terminal is an open admin session. The sliding renewal
must update `lastSeenAt` without a write on every request — a write per request is a self-inflicted load
problem — so renewal should be coarse (for example, at most once per minute).

**Alternative.** 8 h / 15 min for stricter admin-only access; 24 h / 60 min if staff work across time zones.

**Can M2 proceed?** The two numbers are needed by the session-creation code and the cookie `max-age`. The
rest of M2 can proceed; login cannot be finished without them.

---

## 4. D-M2a-3 — `AUTH_SECRET` scope

**Current proposal.** `AUTH_SECRET` exists in `src/lib/env.ts` as an **optional** variable, minimum 32
characters, and is not used by any code. Sessions are opaque 32-byte random tokens hashed with SHA-256 —
**not** signed JWTs — so the secret is not what makes a session unforgeable.

**Recommended decision.** Make it **required in production**, scoped to: CSRF token derivation, rate-limit
key derivation, and any future signed artefact. Do **not** use it as the session secret, because the session
is already a database-backed opaque token.

**Security implications.** Scoping it correctly matters: a rotating session secret that does not sign
sessions cannot log everyone out by accident, and a CSRF secret that rotates does not invalidate live
sessions. The risk of the alternative — signing sessions with it — is that rotation becomes a mass sign-out
event, which in practice means nobody rotates it.

**Operational implications.** Required-in-production means the build fails rather than silently generating
one per process, which is the failure that produces "sessions randomly log out" in a multi-instance
deployment. One secret, one place, rotated by a documented procedure.

**Alternative.** Leave it optional and generate per process. Rejected: with more than one instance, that
is a subtle and intermittent authentication bug.

**Can M2 proceed?** CSRF and rate limiting need it. Password hashing, session storage and the resolver do
not.

---

## 5. D-BOOT-1 — bootstrap mechanism

**Current proposal.** A one-time operator command that creates the platform organisation, the first
`users` row, the first `admin_profiles` row and a first `SUPER_ADMIN`, then refuses to run again.

**Recommended decision.** Approve, with the preconditions already established: the command must refuse if
a live PRIMEMET organisation exists, must be run with the *owner* credential (never the application
identity), and must leave an audit row naming who ran it.

**Security implications.** The dangerous shape is a bootstrap that can be re-run: it becomes a permanent
backdoor that mints super admins. The safe shape is one that fails closed on a second invocation and whose
credential is not present at runtime. A bootstrap that runs inside the deployed application inherits the
application's privileges and blast radius, which is why it is a separate command.

**Operational implications.** Someone must run it once, by hand, against production, with a documented
procedure. That is a deliberate cost: it is the only step that cannot be automated without becoming the
backdoor described above.

**Alternative.** Restore-from-backup as the only path. Rejected: it cannot create the first row.

**Can M2 proceed?** **No** in any testable sense — with no super admin, no admin route can be exercised.
M2a's library work can proceed.

---

## 6. D-BOOT-2 — break-glass versus restore

**Current proposal.** Break-glass: a documented, offline procedure using the owner credential to append a
`GRANT` for a named person, with an audit row and a mandatory follow-up review.

**Recommended decision.** Approve break-glass, and pair it with the continuity guard rather than replace
it. The guard (fixed this turn, defect A-1) should make the situation unreachable; break-glass is what
happens when it is reached anyway.

**Security implications.** Every break-glass path is a bypass with a human in the loop; the control is not
prevention but *visibility* — it must be impossible to use quietly. Restore-from-backup is the stronger
option technically, but it rewinds every unrelated change made since the backup, which in a trading system
means losing enquiries and quotations to recover one permission.

**Operational implications.** Break-glass needs an owner-credential procedure that works at 2 a.m. and a
review step that actually happens. Restore needs a rehearsed restore and a decision about what data loss is
acceptable.

**Alternative.** Restore only. Choose this if the owner credential must never be used outside initialisation.

**Can M2 proceed?** Yes for build; no for launch, because launch is when this must exist.

---

## 7. D-BOOT-3 — staff-code convention

**Current proposal.** `admin_profiles.staffCode` is required, unique, and currently free-form
(`S-0-a1b2c3d4` in the test fixtures).

**Recommended decision.** Approve a simple opaque format — a fixed prefix, a year, and a zero-padded
sequence (`PM-2026-0001`) — generated server-side. Do not encode tier, department or initials: those
change, and an identifier that changes is not an identifier.

**Security implications.** Low. The risk to avoid is a code derived from the person's name or role, which
leaks organisational information to anyone who sees a support ticket.

**Operational implications.** A sequence needs an allocator (the same `$inc` pattern the permission
sequence uses), or a collision is possible under concurrency. Alternatively a UUID-derived short code needs
no allocator but is not human-friendly.

**Can M2 proceed?** Yes. Any format works for build; decide before the first real profile exists.

---

## 8. D-BOOT-4 — mandatory MFA at first login

**Current proposal.** `admin_profiles.mfaRequired` exists and defaults to `true`; nothing enforces it.

**Recommended decision.** Approve enrolment-at-first-login for `SUPER_ADMIN` and
`SOURCING_OPS_ADMIN`, enforced **after** M2a — that is, let an admin sign in with a password once, land on
an enrol-only page, and reach nothing else until a second factor exists. Do not block the *first*
password login; blocking it creates a chicken-and-egg problem for the bootstrap account.

**Security implications.** Admin sessions can change prices, approve quality overrides and grant
permissions. A password alone is the weakest link in the whole model, and the model has no defence against
a phished admin beyond this. The grace-login shape is the standard mitigation for the bootstrap problem.

**Operational implications.** Every admin needs an authenticator. Recovery for a lost device must be
defined before it is needed — that is D-BOOT-2 territory again.

**Alternative.** Defer MFA to M3 and accept password-only admin access for the first release of the portal.

**Can M2 proceed?** Yes. M2a delivers password authentication; MFA is a second factor on top of it.

---

## 9. Standing decisions carried forward

Unchanged and still open from earlier stages: **O-27.7** (hosting region), **O-27.5** (document retention),
**D-ARCH-1** (Prisma `effect` enum), **D-ARCH-3** (listing approval axis), **D-ARCH-7** (document storage
provider), **FU-1** (`orgKind` as a real enum), **O-17.4** (dual control threshold), **O-27.8** (serviced
cities). None is decided by this document.
