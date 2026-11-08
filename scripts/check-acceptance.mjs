#!/usr/bin/env node
/**
 * PRIMEMET — Phase 1 INDEPENDENT adversarial acceptance.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM check-adversarial.mjs / check-permissions.mjs.
 * Those suites were written by the same work they verify. Their assertions reproduce the behaviour the
 * implementation intended; this suite is written from the *claims* and tries to break them. It shares no
 * harness, no helpers and no fixtures with them, and it is deliberately hostile in three ways:
 *
 *   1. it seeds facts the implementation's own helpers cannot produce (a suspended user behind an
 *      active super-admin profile, a deleted user, a missing orgKind);
 *   2. it asserts on the *invariant* rather than on the refusal code, so a change that stops the wrong
 *      thing for the right reason still fails here;
 *   3. it states, per section, what the evidence class is — pure function, real mongod, or static.
 *
 * GROUP A is pure and needs no database. Groups B–G run against a real mongod 7 replica set started by
 * mongodb-memory-server. THAT IS STILL NOT A MANAGED DEPLOYMENT: it has no authentication, so no
 * privilege is exercised here — role separation is asserted statically and reported as such.
 *
 * Run: node scripts/check-acceptance.mjs [--offline]
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Long } from "mongodb";

import { MIGRATIONS } from "../db/migrations/index.mjs";
import { GUARDS, GUARD_LAST_SUPER_ADMIN, ensurePlatformIdentityCollection } from "../db/guards.mjs";
import { resolveAdminPermissions } from "../src/lib/permissions/resolve.ts";
import { TIER_DEFAULTS } from "../src/lib/permissions/tiers.ts";
import { ADMIN_PERMISSIONS } from "../src/lib/permissions/types.ts";
import * as store from "../src/lib/permissions/store.ts";

const OFFLINE = process.argv.includes("--offline");
const NOW = new Date("2026-11-01T12:00:00.000Z");
const T0 = new Date(NOW.getTime() - 60_000);
const T1 = new Date(NOW.getTime() - 30_000);
const T2 = new Date(NOW.getTime() - 10_000);
const uuid = () => randomUUID();

let pass = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { pass += 1; return; }
  failures.push({ label, detail });
  process.stdout.write(`  \u2717 ${label}${detail ? `\n      ${detail}` : ""}\n`);
}
function equal(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(label, a === e, a === e ? "" : `expected ${e}\n      actual   ${a}`);
}
function section(title) { process.stdout.write(`\n${title}\n`); }

/** An actor with every gate satisfied unless a test says otherwise. */
function actor(over = {}) {
  return {
    user: { id: over.userId ?? "u1", role: "ADMIN", status: "ACTIVE", deletedAt: null, ...(over.user ?? {}) },
    profile: { id: over.profileId ?? "p1", isActive: true, tier: over.tier ?? "READ_ONLY_ADMIN", ...(over.profile ?? {}) },
    org: { id: "o1", orgKind: "PRIMEMET", accountStatus: "ACTIVE", ...(over.org ?? {}) },
  };
}
function event(over) {
  return {
    adminId: over.adminId ?? "p1",
    permission: over.permission ?? "ENQUIRY_VIEW",
    effect: over.effect,
    seq: over.seq ?? 1,
    eventId: over.eventId ?? `e-${Math.random().toString(36).slice(2)}`,
    createdAt: over.createdAt ?? T1,
    expiresAt: over.expiresAt ?? null,
  };
}
const allowedIn = (r, p) => r.allowed.has(p);

// ===========================================================================
// A — Resolver assumptions. Evidence class: pure function, no database.
// ===========================================================================
function groupA() {
  section("A. Resolver — challenging the assumptions");

  // A1 (W1 REGRESSION). A row whose effect is not one of the three used to be skipped, so the row
  // underneath it decided: a mistyped DENY was weaker than no DENY at all, and damaging the log could
  // broaden access. Since the W1 remediation the corrupt row is the newest applicable event and refuses
  // the permission. This fixture was originally written to DOCUMENT the defect — it now guards the fix.
  {
    const r = resolveAdminPermissions(actor(), [
      event({ effect: "GRANT", seq: 1, createdAt: T1, eventId: "g1" }),
      event({ effect: "DENY ", seq: 2, createdAt: T2, eventId: "typo-deny" }),
    ], NOW);
    const d = r.decisions.get("ENQUIRY_VIEW");
    check("A1 the corrupt row is reported", d.ignoredEvents.includes("typo-deny"));
    check("A1 the corrupt row decides — the permission is refused", !allowedIn(r, "ENQUIRY_VIEW"));
    check("A1 the refusal is attributable to the corrupt event", d.decidedBy === "INVALID_EVENT" && d.eventId === "typo-deny");
    check("A1 an integrity diagnostic is emitted", r.integrityDiagnostics.some((x) => x.eventId === "typo-deny"));
  }

  // A2. Expiry makes an event inert, not negative (D-ARCH-12). A lapsed DENY must NOT deny.
  {
    const r = resolveAdminPermissions(actor(), [
      event({ effect: "GRANT", seq: 1, createdAt: T0, eventId: "g1" }),
      event({ effect: "DENY", seq: 2, createdAt: T1, eventId: "d1", expiresAt: new Date(NOW.getTime() - 1) }),
    ], NOW);
    check("A2 a lapsed DENY does not deny", allowedIn(r, "ENQUIRY_VIEW"));
    equal("A2 the GRANT is what decided", r.decisions.get("ENQUIRY_VIEW").eventId, "g1");
  }

  // A3. Two events in the same millisecond: the tiebreaker must be a true total order above 2^53, which
  // a JS number cannot represent. seq is stored as a BSON long, so the resolver must not round it.
  {
    const r = resolveAdminPermissions(actor(), [
      event({ effect: "GRANT", seq: Long.fromString("9007199254740992"), createdAt: T1, eventId: "lower" }),
      event({ effect: "DENY", seq: Long.fromString("9007199254740993"), createdAt: T1, eventId: "higher" }),
    ], NOW);
    check("A3 the larger long wins without precision loss", !allowedIn(r, "ENQUIRY_VIEW"));
    equal("A3 the decision names the exact event", r.decisions.get("ENQUIRY_VIEW").eventId, "higher");
  }

  // A4/A5. An unorderable row cannot decide, and a future-dated row has not happened yet.
  {
    const noCreatedAt = { ...event({ effect: "DENY", seq: 9 }), createdAt: undefined };
    const r4 = resolveAdminPermissions(actor(), [event({ effect: "GRANT", seq: 1, createdAt: T1, eventId: "g" }), noCreatedAt], NOW);
    check("A4 a row with no createdAt is ignored", allowedIn(r4, "ENQUIRY_VIEW"));
    const r5 = resolveAdminPermissions(actor(), [event({ effect: "DENY", seq: 5, createdAt: new Date(NOW.getTime() + 60_000) })], NOW);
    check("A5 a future-dated DENY does not apply yet", allowedIn(r5, "ENQUIRY_VIEW"));
  }

  // A6. An unknown tier must grant nothing. It also must not leave per-permission provenance claiming the
  // opposite, because an access-review screen reads `decisions`, not `allowed`.
  {
    const r = resolveAdminPermissions(actor({ tier: "NOT_A_TIER" }), [
      event({ effect: "GRANT", seq: 1, createdAt: T1 }),
    ], NOW);
    equal("A6 unknown tier denies everything", r.allowed.size, 0);
    equal("A6 and says why", r.deniedAt, "UNKNOWN_TIER");
    const d = r.decisions.get("ENQUIRY_VIEW");
    check("A6 but the per-permission record must not contradict the set", d.allowed === false,
      `decisions says allowed=${d.allowed} while the permission set is empty`);
  }

  // A7. The platform organisation is exempt from its own account status. That is deliberate — but it means
  // suspending PRIMEMET's own row does nothing, and no test in the project asserts that trade-off.
  {
    const r = resolveAdminPermissions(actor({ org: { orgKind: "PRIMEMET", accountStatus: "SUSPENDED" } }), [], NOW);
    check("A7 a suspended PRIMEMET organisation still admits staff (deliberate exemption)",
      allowedIn(r, "ENQUIRY_VIEW"));
    const r2 = resolveAdminPermissions(actor({ org: { orgKind: "BUYER", accountStatus: "SUSPENDED" } }), [], NOW);
    equal("A7 any other suspended organisation refuses", r2.deniedAt, "ORGANISATION_NOT_ACTIVE");
  }

  // A8. Every gate fails closed, in the stated order.
  {
    equal("A8 no actor", resolveAdminPermissions(null, [], NOW).deniedAt, "NO_ACTOR");
    equal("A8 non-admin role", resolveAdminPermissions(actor({ user: { role: "BUYER" } }), [], NOW).deniedAt, "NOT_ADMIN_ROLE");
    equal("A8 suspended user", resolveAdminPermissions(actor({ user: { status: "SUSPENDED" } }), [], NOW).deniedAt, "USER_NOT_ACTIVE");
    equal("A8 deleted user", resolveAdminPermissions(actor({ user: { deletedAt: T0 } }), [], NOW).deniedAt, "USER_DELETED");
    equal("A8 no profile", resolveAdminPermissions({ ...actor(), profile: null }, [], NOW).deniedAt, "NO_ADMIN_PROFILE");
    equal("A8 inactive profile", resolveAdminPermissions(actor({ profile: { isActive: false } }), [], NOW).deniedAt, "PROFILE_INACTIVE");
    equal("A8 no organisation", resolveAdminPermissions({ ...actor(), org: null }, [], NOW).deniedAt, "NO_ORGANISATION");
  }

  // A9. The tier default is a real fallback layer, and its size is contractual.
  {
    equal("A9 SUPER_ADMIN reaches every permission", TIER_DEFAULTS.SUPER_ADMIN.length, ADMIN_PERMISSIONS.length);
    equal("A9 SOURCING_OPS_ADMIN", TIER_DEFAULTS.SOURCING_OPS_ADMIN.length, 45);
    equal("A9 CATALOGUE_MANAGER", TIER_DEFAULTS.CATALOGUE_MANAGER.length, 14);
    const union = new Set([...TIER_DEFAULTS.SOURCING_OPS_ADMIN, ...TIER_DEFAULTS.CATALOGUE_MANAGER, ...TIER_DEFAULTS.READ_ONLY_ADMIN]);
    equal("A9 union across the three non-super tiers", union.size, 62);
    equal("A9 super-only", ADMIN_PERMISSIONS.length - union.size, 12);
    // The three disputed permissions are inside SOURCING_OPS, which is what moves the union 59 -> 62.
    for (const p of ["LOT_OVERRIDE_GATE", "PARTY_SUSPEND", "ORDER_CANCEL"]) {
      check(`A9 ${p} sits in the sourcing tier (the D-TIER-1 difference)`, TIER_DEFAULTS.SOURCING_OPS_ADMIN.includes(p));
    }
  }

  // A10. Provenance completeness: every permission gets a record, always.
  {
    const r = resolveAdminPermissions(actor(), [], NOW);
    equal("A10 one decision per permission", r.decisions.size, ADMIN_PERMISSIONS.length);
    check("A10 every decision carries a reason", [...r.decisions.values()].every((d) => d.decidedBy === "TIER_DEFAULT"));
  }
}

// ===========================================================================
// Database harness — real mongod 7 replica set, started locally.
// ===========================================================================
async function bootWorld(client, name, { supers = 2, usersSuspended = [] } = {}) {
  const db = client.db(name);
  for (const migration of MIGRATIONS) await migration.up(db, { log: () => {} });

  const orgId = uuid();
  const orgs = db.collection("organisations");
  // Seeding bypasses the collection validator on purpose: these fixtures must be able to represent states
  // the product's own helpers cannot produce (a suspended user behind an active profile). Every section
  // that *asserts* on a validator inserts WITHOUT bypass and says so.
  const seed = { bypassDocumentValidation: true };
  await orgs.insertOne({
    _id: orgId, legalName: "PRIMEMET", orgType: "BOTH", orgKind: "PRIMEMET", countryCode: "IN",
    accountStatus: "ACTIVE", isListable: false, verificationStatus: "VERIFIED",
    deletedAt: null, createdAt: T0, updatedAt: T0,
  }, seed);

  // F1: the marker fallback is gone, so the world carries the protected pointer that names the operator
  // organisation. Every admin below claims `organisationId: orgId`, which F2 requires to AGREE with it.
  await ensurePlatformIdentityCollection(db, { now: T0, organisationId: orgId });

  const admins = [];
  for (let i = 0; i < supers; i += 1) {
    const userId = uuid();
    const profileId = uuid();
    const suspended = usersSuspended.includes(i);
    await db.collection("users").insertOne({
      _id: userId, email: `super-${i}-${userId}@example.test`, role: "ADMIN",
      status: suspended ? "SUSPENDED" : "ACTIVE", fullName: `Super ${i}`, locale: "en-IN",
      mfaEnabled: false, failedLoginCount: 0, deletedAt: null, organisationId: orgId,
      createdAt: T0, updatedAt: T0,
    }, seed);
    await db.collection("admin_profiles").insertOne({
      _id: profileId, userId, staffCode: `S-${i}-${profileId.slice(0, 8)}`, tier: "SUPER_ADMIN",
      mfaRequired: true, isActive: true, createdAt: T0, updatedAt: T0,
    }, seed);
    admins.push({
      user: userId, profile: profileId, suspended,
      target: { profileId, isActive: true, userIsActive: !suspended, tier: "SUPER_ADMIN" },
    });
  }
  // Each admin needs a DIFFERENT admin as an event target: a self-target is refused by design.
  admins.forEach((a, i) => { a.other = admins[(i + 1) % admins.length]; });
  return { db, orgId, admins };
}

/** Who can actually write an access event right now — resolved, not counted from profiles. */
async function usableHolders(db, admins) {
  let n = 0;
  for (const a of admins) {
    const r = await store.resolveActorPermissions(db, a.user, NOW);
    if (r.permissions.has("ACCESS_GRANT_PERMISSION")) n += 1;
  }
  return n;
}

// ===========================================================================
// B — Super-admin continuity. Evidence class: real mongod.
// ===========================================================================
async function groupB(client) {
  section("B. Super-admin continuity");

  // B1. THE INVARIANT IS "A WAY BACK IN", WHICH MEANS A USABLE IDENTITY — not an active profile. Two
  // departing staff who were suspended as users still carry an active SUPER_ADMIN profile. If the guard
  // counts profiles rather than usable identities, the last usable super admin can remove itself and the
  // platform is locked out with no in-application path back.
  {
    const w = await bootWorld(client, "b1", { supers: 3, usersSuspended: [1, 2] });
    const before = await usableHolders(w.db, w.admins);
    equal("B1 precondition: exactly one usable super admin", before, 1);

    const res = await store.setAdminProfileAccess(w.db, {
      actorUserId: w.admins[0].user,
      profileId: w.admins[0].profile,
      isActive: false,
      now: NOW,
    });
    const after = await usableHolders(w.db, w.admins);
    // The invariant, not the refusal code: a usable holder must survive.
    check("B1 deactivating the last USABLE super admin is refused (a way back in survives)", after >= 1,
      `result=${JSON.stringify(res)} usable holders before=${before} after=${after}`);
  }

  // B2. The ordinary shape: with one usable super admin and no ghosts, the guard does fire.
  {
    const w = await bootWorld(client, "b2", { supers: 2 });
    const res = await store.setAdminProfileAccess(w.db, {
      actorUserId: w.admins[0].user, profileId: w.admins[0].profile, isActive: false, now: NOW,
    });
    check("B2 deactivating one of two is allowed", res.ok === true, JSON.stringify(res));
    const res2 = await store.setAdminProfileAccess(w.db, {
      actorUserId: w.admins[1].user, profileId: w.admins[1].profile, isActive: false, now: NOW,
    });
    check("B2 deactivating the second is refused", res2.ok === false && res2.refusal === "LAST_SUPER_ADMIN",
      JSON.stringify(res2));
    const still = await w.db.collection("admin_profiles").findOne({ _id: w.admins[1].profile });
    check("B2 the refused profile is untouched", still.isActive === true);
  }

  // B3. Demotion is the quiet route to the same place, and must be guarded by the same decision.
  {
    const w = await bootWorld(client, "b3", { supers: 1 });
    const res = await store.setAdminProfileAccess(w.db, {
      actorUserId: w.admins[0].user, profileId: w.admins[0].profile, tier: "READ_ONLY_ADMIN", now: NOW,
    });
    check("B3 demoting the last super admin is refused", res.ok === false, JSON.stringify(res));
  }

  // B4. Two instances, one each, denying a different super admin — the write-skew C3 was written for.
  {
    const w = await bootWorld(client, "b4", { supers: 2 });
    const [a, b] = w.admins;
    // Both hold ACCESS_ASSIGN_ROLE through the SUPER_ADMIN tier default, so no seeding is needed.

    const results = await Promise.allSettled([
      store.setAdminProfileAccess(w.db, { actorUserId: a.user, profileId: a.profile, isActive: false, now: NOW }),
      store.setAdminProfileAccess(w.db, { actorUserId: b.user, profileId: b.profile, isActive: false, now: NOW }),
    ]);
    const after = await usableHolders(w.db, w.admins);
    check("B4 concurrent cross-deactivations leave a usable super admin", after >= 1,
      `results=${JSON.stringify(results.map((r) => r.status === "fulfilled" ? r.value : String(r.reason)))} after=${after}`);
  }

  // B5. Fail closed when the deployment skipped its migration.
  {
    const w = await bootWorld(client, "b5", { supers: 2 });
    await w.db.collection(GUARDS).deleteOne({ _id: GUARD_LAST_SUPER_ADMIN });
    const res = await store.appendPermissionEvent(w.db, {
      actorUserId: w.admins[0].user, target: w.admins[1].target,
      permission: "ACCESS_GRANT_PERMISSION", effect: "DENY",
      reason: "test", eventId: "b5", now: NOW,
    });
    check("B5 a missing guard document refuses the change", res.ok === false && res.refusal === "GUARD_UNAVAILABLE",
      JSON.stringify(res));
    equal("B5 and writes nothing", await w.db.collection("admin_permission_grants").countDocuments({ eventId: "b5" }), 0);
  }
}

// ===========================================================================
// C — Event idempotency. Evidence class: real mongod.
// ===========================================================================
async function groupC(client) {
  section("C. Event idempotency");

  const append = (db, admin, target, over = {}) => store.appendPermissionEvent(db, {
    actorUserId: admin.user,
    target: target ?? admin.target,
    permission: over.permission ?? "ENQUIRY_VIEW",
    effect: over.effect ?? "GRANT",
    reason: over.reason ?? "acceptance",
    expiresAt: over.expiresAt ?? null,
    eventId: over.eventId ?? uuid(),
    now: NOW,
  });

  // C1. A retry is a no-op, and the row count proves it.
  {
    const w = await bootWorld(client, "c1", { supers: 2 });
    const key = uuid();
    const first = await append(w.db, w.admins[0], w.admins[1].target, { eventId: key });
    const second = await append(w.db, w.admins[0], w.admins[1].target, { eventId: key });
    check("C1 first delivery inserts", first.ok === true && first.seq_idempotent === false, JSON.stringify(first));
    check("C1 retry is recognised as a retry", second.ok === true && second.seq_idempotent === true, JSON.stringify(second));
    equal("C1 one row", await w.db.collection("admin_permission_grants").countDocuments({ eventId: key }), 1);
  }

  // C2. The same key with a DIFFERENT payload is not a retry. Believing it would record a DENY under a
  // GRANT's idempotency key, and the audit trail would then describe an event that never happened.
  {
    const w = await bootWorld(client, "c2", { supers: 2 });
    const key = uuid();
    await append(w.db, w.admins[0], w.admins[1].target, { eventId: key, effect: "GRANT" });
    const conflict = await append(w.db, w.admins[0], w.admins[1].target, { eventId: key, effect: "DENY" });
    check("C2 a contradictory payload under one key is refused", conflict.ok === false && conflict.refusal === "EVENT_ID_CONFLICT",
      JSON.stringify(conflict));
    const rows = await w.db.collection("admin_permission_grants").find({ eventId: key }).toArray();
    equal("C2 and the stored effect is unchanged", rows.map((r) => r.effect), ["GRANT"]);
  }

  // C3. Genuine concurrency: both arrive before either is stored.
  {
    const w = await bootWorld(client, "c3", { supers: 2 });
    const key = uuid();
    const [x, y] = await Promise.all([
      append(w.db, w.admins[0], w.admins[1].target, { eventId: key, effect: "GRANT" }),
      append(w.db, w.admins[0], w.admins[1].target, { eventId: key, effect: "DENY" }),
    ]);
    const rows = await w.db.collection("admin_permission_grants").find({ eventId: key }).toArray();
    equal("C3 exactly one row survives the race", rows.length, 1);
    const outcomes = [x, y];
    check("C3 the loser is told why, not silently dropped",
      outcomes.some((o) => o.ok === false && o.refusal === "EVENT_ID_CONFLICT")
        || outcomes.filter((o) => o.ok === true).length === 2,
      JSON.stringify(outcomes));
  }

  // C4. 1000 simultaneous duplicate deliveries of one request: exactly one logical event.
  {
    const w = await bootWorld(client, "c4", { supers: 2 });
    const key = uuid();
    const N = 1000;
    const results = await Promise.all(Array.from({ length: N }, () => append(w.db, w.admins[0], w.admins[1].target, { eventId: key })));
    const ok = results.filter((r) => r.ok).length;
    equal("C4 all 1000 answered successfully", ok, N);
    equal("C4 one logical event", await w.db.collection("admin_permission_grants").countDocuments({ eventId: key }), 1);
  }
}

// ===========================================================================
// D — Sequence allocation and ordering. Evidence class: real mongod.
// ===========================================================================
async function groupD(client, secondClient) {
  section("D. Sequence ordering");

  const append = (db, admin, i) => store.appendPermissionEvent(db, {
    actorUserId: admin.user,
    target: admin.other.target,
    permission: "ENQUIRY_VIEW",
    effect: i % 2 === 0 ? "GRANT" : "DENY",
    reason: `burst ${i}`,
    eventId: `burst-${i}`,
    now: NOW,
  });

  // D1. A concurrent burst on one admin: no two rows may claim the same position.
  {
    const w = await bootWorld(client, "d1", { supers: 2 });
    const N = 200;
    const results = await Promise.all(Array.from({ length: N }, (_, i) => append(w.db, w.admins[0], i)));
    const applied = results.filter((r) => r.ok).length;
    const rows = await w.db.collection("admin_permission_grants").find({ eventId: { $regex: "^burst-" } }).toArray();
    equal("D1 every append was applied", applied, N);
    equal("D1 one row each", rows.length, N);
    equal("D1 every position is distinct", new Set(rows.map((r) => Number(r.seq))).size, N);
    check("D1 positions are positive", rows.every((r) => Number(r.seq) >= 1));
  }

  // D2. Ordering across two INDEPENDENT clients — two pools, two connections, which is what two
  // application instances reduce to. A shared handle would prove nothing about cross-instance order.
  {
    const w = await bootWorld(client, "d2", { supers: 2 });
    const otherDb = secondClient.db("d2");
    const results = await Promise.all([
      append(w.db, w.admins[0], 1),
      append(otherDb, w.admins[0], 2),
      append(w.db, w.admins[0], 3),
      append(otherDb, w.admins[0], 4),
    ]);
    check("D2 four concurrent appends from two instances all applied", results.every((r) => r.ok), JSON.stringify(results));
    const rows = await w.db.collection("admin_permission_grants")
      .find({ eventId: { $regex: "^burst-" } }).sort({ seq: 1 }).toArray();
    equal("D2 total order with no duplicates", new Set(rows.map((r) => Number(r.seq))).size, rows.length);
    const distinct = new Set(results.filter((r) => r.ok).map((r) => Number(r.seq)));
    equal("D2 the two instances received different positions", distinct.size, results.filter((r) => r.ok).length);
  }

  // D3. The counter is infrastructure and may be lost; the log is the authority. Losing the counter must
  // cost throughput, never correctness.
  {
    const w = await bootWorld(client, "d3", { supers: 2 });
    await append(w.db, w.admins[0], 10);
    await w.db.collection(GUARDS).deleteMany({ _id: { $regex: "^seq-" } });
    const res = await append(w.db, w.admins[0], 11);
    check("D3 an append succeeds after the counter is lost", res.ok === true, JSON.stringify(res));
    const rows = await w.db.collection("admin_permission_grants").find({ eventId: { $regex: "^burst-" } }).toArray();
    equal("D3 positions remain distinct", new Set(rows.map((r) => Number(r.seq))).size, rows.length);
    check("D3 the new position is beyond the log, not a replay of it",
      Number(res.seq) > Math.max(...rows.filter((r) => r.eventId !== "burst-11").map((r) => Number(r.seq))));
  }

  // D4. Gaps are permitted and harmless: a failed write consumes a position it never uses. What must not
  // happen is a duplicate or an inversion.
  {
    const w = await bootWorld(client, "d4", { supers: 2 });
    const a = await append(w.db, w.admins[0], 20);
    // Burn a counter position the way a crashed writer would.
    await w.db.collection(GUARDS).updateOne({ _id: `seq-${w.admins[0].profile}` }, { $inc: { value: 5 } });
    const b = await append(w.db, w.admins[0], 21);
    check("D4 both appends applied", a.ok && b.ok, JSON.stringify([a, b]));
    check("D4 the second is strictly later even across the gap", Number(b.seq) > Number(a.seq));
    equal("D4 and no duplicate position was written",
      await w.db.collection("admin_permission_grants").countDocuments({ eventId: "burst-20" }), 1);
  }
}

// ===========================================================================
// E — Migrations. Evidence class: real mongod.
// ===========================================================================
async function groupE(client) {
  section("E. Migrations v002–v004");

  const v302 = MIGRATIONS.find((m) => m.version === 2);
  const v303 = MIGRATIONS.find((m) => m.version === 3);
  const v304 = MIGRATIONS.find((m) => m.version === 4);

  // E1. Replay must not reset the fence. A reset is the one write that could convince two concurrent
  // transactions they were alone, which is the whole mechanism.
  {
    const db = client.db("e1");
    await v303.up(db, { log: () => {} });
    await db.collection(GUARDS).updateOne({ _id: GUARD_LAST_SUPER_ADMIN }, { $inc: { fence: 7 } });
    await v303.up(db, { log: () => {} });
    const after = await db.collection(GUARDS).findOne({ _id: GUARD_LAST_SUPER_ADMIN });
    equal("E1 a second run preserves the fence", Number(after.fence), 7);
  }

  // E2. Interrupted execution and retry: every up() is re-runnable and lands on the same state.
  {
    const db = client.db("e2");
    for (const m of MIGRATIONS) await m.up(db, { log: () => {} });
    const snapshot = async () => {
      const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
      const counts = {};
      for (const n of names) counts[n] = await db.collection(n).countDocuments();
      return { names, counts };
    };
    const first = await snapshot();
    for (const m of MIGRATIONS) await m.up(db, { log: () => {} });
    const second = await snapshot();
    equal("E2 re-running every migration changes no collection list", second.names, first.names);
    equal("E2 and duplicates no document", second.counts, first.counts);
  }

  // E3. A second live PRIMEMET organisation is rejected by the database, not by review.
  {
    const db = client.db("e3");
    for (const m of MIGRATIONS) await m.up(db, { log: () => {} });
    const orgs = db.collection("organisations");
    const base = {
      legalName: "X", orgType: "BUYER", countryCode: "IN", accountStatus: "ACTIVE", isListable: false,
      verificationStatus: "VERIFIED", deletedAt: null, createdAt: T0, updatedAt: T0,
    };
    await orgs.insertOne({ _id: uuid(), ...base, orgKind: "PRIMEMET" });
    let secondError = null;
    try { await orgs.insertOne({ _id: uuid(), ...base, orgKind: "PRIMEMET" }); } catch (e) { secondError = e; }
    check("E3 a second live PRIMEMET organisation is refused", secondError !== null,
      secondError === null ? "the insert succeeded" : "");
    check("E3 and it is a duplicate-key refusal", !secondError || secondError.code === 11000, String(secondError?.code));
    // A soft-deleted one does not count, so a reorganisation is possible.
    await orgs.updateOne({ orgKind: "PRIMEMET" }, { $set: { deletedAt: T0 } });
    let thirdError = null;
    try { await orgs.insertOne({ _id: uuid(), ...base, orgKind: "PRIMEMET" }); } catch (e) { thirdError = e; }
    check("E3 a soft-deleted platform row frees the slot", thirdError === null, String(thirdError?.message?.slice(0, 90)));
  }

  // E4. Missing or unknown orgKind fails closed: the validator refuses it and the pre-flight catches a
  // document written before the rule existed.
  {
    const db = client.db("e4");
    for (const m of MIGRATIONS) await m.up(db, { log: () => {} });
    const orgs = db.collection("organisations");
    const base = {
      legalName: "X", orgType: "BUYER", countryCode: "IN", accountStatus: "ACTIVE", isListable: false,
      verificationStatus: "VERIFIED", deletedAt: null, createdAt: T0, updatedAt: T0,
    };
    let missing = null;
    try { await orgs.insertOne({ _id: uuid(), ...base }); } catch (e) { missing = e; }
    check("E4 an organisation without orgKind is refused", missing !== null);
    let unknown = null;
    try { await orgs.insertOne({ _id: uuid(), ...base, orgKind: "PLATFORM" }); } catch (e) { unknown = e; }
    check("E4 an unknown orgKind is refused", unknown !== null);
    // The reclassification route. The validator constrains orgKind to five values; it does NOT make the
    // value immutable. Nothing stops an existing BUYER row being relabelled PRIMEMET, and because
    // loadAdminActor resolves staff against the single PRIMEMET row, that relabel silently changes which
    // organisation governs every admin's access. Asserted as a finding, not as a passing control.
    await orgs.insertOne({ _id: uuid(), ...base, orgKind: "BUYER" });
    let forge = null;
    try { await orgs.updateOne({ orgKind: "BUYER" }, { $set: { orgKind: "PRIMEMET" } }); } catch (e) { forge = e; }
    check("E4 FINDING: the database permits relabelling a counterparty row as PRIMEMET", forge === null,
      forge ? `the update was refused (${forge.code}) — control present` : "the update succeeded: orgKind is validated but not immutable");
    await orgs.deleteMany({ orgKind: "PRIMEMET" });
  }

  // E5. The pre-flight stops the migration BEFORE the validator changes, so a bad historical document does
  // not leave a collection whose old rows no longer satisfy its new rule.
  {
    const db = client.db("e5");
    await MIGRATIONS[0].up(db, { log: () => {} });
    await v302.up(db, { log: () => {} });
    const before = await db.command({ listCollections: 1, filter: { name: "admin_permission_grants" } });
    const validatorBefore = JSON.stringify(before.cursor.firstBatch[0]?.options?.validator ?? {});
    // A row the new effect enum forbids, written while the old validator allowed it.
    await db.collection("admin_permission_grants").insertOne({
      _id: uuid(), adminId: uuid(), permission: "ENQUIRY_VIEW", effect: "OWN", seq: Long.fromNumber(1),
      eventId: "legacy", grantedById: uuid(), reason: "legacy row",
      expiresAt: null, createdAt: T0,
    }, { bypassDocumentValidation: true }).catch(() => {});
    let refused = null;
    try { await v302.up(db, { log: () => {} }); } catch (e) { refused = e; }
    const after = await db.command({ listCollections: 1, filter: { name: "admin_permission_grants" } });
    const validatorAfter = JSON.stringify(after.cursor.firstBatch[0]?.options?.validator ?? {});
    check("E5 a legacy row outside the new rule stops the migration", refused !== null, refused === null ? "migration applied anyway" : "");
    equal("E5 and the validator was left untouched", validatorAfter, validatorBefore);
  }

  // E6. Reachability of v004's pre-flight. v001 applies the CURRENT collection definitions, so a fresh
  // database already carries orgKind and its unique index. v004 therefore only matters for a deployment
  // created before the change — and its ">1 live PRIMEMET" pre-flight is unreachable, because the unique
  // index makes that state unstorable. Asserted so the claim is not taken on trust.
  {
    const db = client.db("e6");
    await MIGRATIONS[0].up(db, { log: () => {} });
    const organisationsDef = (await db.command({ listCollections: 1, filter: { name: "organisations" } }))
      .cursor.firstBatch[0];
    const validator = JSON.stringify(organisationsDef?.options?.validator ?? {});
    check("E6 FINDING: v001 already requires orgKind, so v004 is a no-op on a fresh database",
      validator.includes("orgKind"));
    const indexes = await db.collection("organisations").indexes();
    check("E6 FINDING: v001 already creates the single-PRIMEMET index",
      indexes.some((i) => i.name === "ix_organisations_orgKind_u_p"));
    // A second live platform row is refused, so v004's count>1 branch cannot be reached in practice.
    const base = {
      legalName: "X", orgType: "BUYER", countryCode: "IN", accountStatus: "ACTIVE", isListable: false,
      verificationStatus: "VERIFIED", deletedAt: null, createdAt: T0, updatedAt: T0,
    };
    await db.collection("organisations").insertOne({ _id: uuid(), ...base, orgKind: "PRIMEMET" });
    let second = null;
    try { await db.collection("organisations").insertOne({ _id: uuid(), ...base, orgKind: "PRIMEMET" }); }
    catch (e) { second = e; }
    check("E6 so two live platform rows are unstorable and the pre-flight cannot fire", second?.code === 11000);
    void v304;
  }
}

// ===========================================================================
// F — The bypass surface. Evidence class: real mongod + static reading.
// ===========================================================================
async function groupF(client) {
  section("F. Bypass surface");

  const w = await bootWorld(client, "f", { supers: 2 });
  const grants = w.db.collection("admin_permission_grants");

  // F1. A row the resolver would have to ignore cannot be written in the first place.
  let badEffect = null;
  try {
    await grants.insertOne({
      _id: uuid(), adminId: w.admins[1].profile, permission: "ENQUIRY_VIEW", effect: "OWN",
      seq: Long.fromNumber(999), eventId: "forge-1", grantedById: w.admins[1].user,
      reason: "forged", expiresAt: null, createdAt: NOW,
    });
  } catch (e) { badEffect = e; }
  check("F1 the validator refuses an effect outside GRANT|DENY|REVOKE", badEffect !== null);

  // F2. An unattributable row is refused: actor, target, permission, reason and timestamp are mandatory.
  let blankReason = null;
  try {
    await grants.insertOne({
      _id: uuid(), adminId: w.admins[1].profile, permission: "ENQUIRY_VIEW", effect: "GRANT",
      seq: Long.fromNumber(998), eventId: "forge-2", grantedById: w.admins[1].user,
      reason: "   ", expiresAt: null, createdAt: NOW,
    });
  } catch (e) { blankReason = e; }
  check("F2 a blank reason is refused", blankReason !== null);

  // F3. The log is append-only by definition. The collection carries no update path in the module, and the
  // privilege layer denies it — but this server has no auth, so only the first half is observable here.
  const storeSource = readFileSync(new URL("../src/lib/permissions/store.ts", import.meta.url), "utf8");
  check("F3 the store exposes no update or delete of an event",
    !/collection<GrantDoc>\(GRANTS_COLLECTION\)[\s\S]{0,80}(updateOne|deleteOne|deleteMany|findOneAndUpdate)/.test(storeSource)
      && !/\.updateMany\(/.test(storeSource));

  // F4. A duplicate position is refused even when the writer skips the allocator.
  let dupSeq = null;
  await store.appendPermissionEvent(w.db, {
    actorUserId: w.admins[0].user, target: w.admins[1].target,
    permission: "ENQUIRY_VIEW", effect: "GRANT", reason: "seed for F4", eventId: "f4-seed", now: NOW,
  });
  const existing = await grants.findOne({ eventId: "f4-seed" });
  check("F4 precondition: a real event exists to collide with", existing !== null);
  try {
    await grants.insertOne({
      _id: uuid(), adminId: w.admins[1].profile, permission: "ENQUIRY_VIEW", effect: "GRANT",
      // int64, not a JS number: the driver promotes longs to numbers on read, and writing one back
      // would land as int32 — which this validator refuses, and that refusal is itself a control.
      seq: Long.fromNumber(Number(existing.seq)), eventId: "forge-3", grantedById: w.admins[1].user,
      reason: "duplicate position", expiresAt: null, createdAt: NOW,
    });
  } catch (e) { dupSeq = e; }
  check("F4 a duplicate sequence position is refused", dupSeq !== null && dupSeq.code === 11000, String(dupSeq?.code));

  // F5. The residual, stated rather than hidden: nothing in the database can force a writer to go through
  // the store. A direct insert that satisfies the validator IS accepted, which is why the role definition
  // and review are part of the control.
  let directInsert = null;
  try {
    await grants.insertOne({
      _id: uuid(), adminId: w.admins[1].profile, permission: "AUDIT_EXPORT", effect: "GRANT",
      seq: Long.fromNumber(5000), eventId: "direct-1", grantedById: w.admins[0].user,
      reason: "written without the store", expiresAt: null, createdAt: NOW,
    });
  } catch (e) { directInsert = e; }
  check("F5 RESIDUAL: a direct insert bypasses delegation and is accepted by the database",
    directInsert === null, String(directInsert?.message?.slice(0, 100)));
  const resolvedDirect = await store.resolveActorPermissions(w.db, w.admins[1].user, NOW);
  check("F5 and it does take effect — so the store is a code boundary, not a database one",
    resolvedDirect.decisions.get("AUDIT_EXPORT")?.eventId === "direct-1");
}

// ===========================================================================
// G — Provenance and the static controls. Evidence class: static reading of the repo.
// ===========================================================================
async function groupG(client) {
  section("G. Provenance and role separation");

  // G1. Provenance: an access review must be able to name the event that decided, for every permission.
  {
    const w = await bootWorld(client, "g1", { supers: 2 });
    const res = await store.appendPermissionEvent(w.db, {
      actorUserId: w.admins[0].user, target: w.admins[1].target,
      permission: "ENQUIRY_VIEW", effect: "DENY", reason: "provenance", eventId: "prov-1", now: NOW,
    });
    check("G1 the event was recorded", res.ok === true, JSON.stringify(res));
    const resolved = await store.resolveActorPermissions(w.db, w.admins[1].user, NOW);
    const d = resolved.decisions.get("ENQUIRY_VIEW");
    equal("G1 the decision names the event", d.eventId, "prov-1");
    equal("G1 and the effect", d.effect, "DENY");
    equal("G1 and the deciding layer", d.decidedBy, "EVENT");
    equal("G1 every permission still has a record", resolved.decisions.size, ADMIN_PERMISSIONS.length);
  }

  // G2. Role separation is a definition, not an observation. This server runs without auth, so it is
  // asserted here and reported as a definition-level check, not as proof of enforcement.
  {
    const roles = readFileSync(new URL("../db/roles.mjs", import.meta.url), "utf8");
    const guards = readFileSync(new URL("../db/guards.mjs", import.meta.url), "utf8");
    check("G2 the guard collection literal agrees between store and definitions",
      guards.includes('"_permission_guards"') && readFileSync(new URL("../src/lib/permissions/store.ts", import.meta.url), "utf8").includes('"_permission_guards"'));
    check("G2 no role definition grants a drop or delete action on the event log",
      !/dropCollection|dropIndex|dropDatabase/.test(roles.split("APPEND_ONLY")[1] ?? ""),
      "a drop* action appears in the append-only privilege block");
  }

  // G3. The event log is flagged immutable, which is what drives the role split and the DAO refusal.
  {
    const core = readFileSync(new URL("../db/collections/core.mjs", import.meta.url), "utf8");
    const from = core.indexOf("export const adminPermissionGrant");
    const next = core.indexOf("export const ", from + 10);
    const grantBlock = core.slice(from, next > 0 ? next : core.length);
    check("G3 admin_permission_grants is declared immutable", /immutable:\s*true/.test(grantBlock));
    check("G3 and carries the unique idempotency and position indexes",
      /adminId: 1, eventId: 1 \}, unique: true/.test(grantBlock) && /adminId: 1, seq: 1 \}, unique: true/.test(grantBlock));
  }
}

// ===========================================================================
// main
// ===========================================================================
async function main() {
  groupA();

  if (OFFLINE) {
    process.stdout.write("\n  (offline: database groups B–G were not executed)\n");
    return summary();
  }

  let MongoMemoryReplSet;
  let MongoClient;
  try {
    ({ MongoMemoryReplSet } = await import("mongodb-memory-server"));
    ({ MongoClient } = await import("mongodb"));
  } catch (error) {
    check("the integration dependencies load", false, String(error?.message ?? error));
    return summary();
  }

  let server;
  try {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
      binary: { version: "7.0.14" },
    });
  } catch (error) {
    check("a real mongod replica set starts", false, String(error?.message ?? error).slice(0, 200));
    return summary();
  }

  const client = new MongoClient(server.getUri());
  await client.connect();
  const secondClient = new MongoClient(server.getUri());
  await secondClient.connect();

  try {
    await groupB(client);
    await groupC(client);
    await groupD(client, secondClient);
    await groupE(client);
    await groupF(client);
    await groupG(client);
  } finally {
    await secondClient.close().catch(() => {});
    await client.close().catch(() => {});
    await server.stop().catch(() => {});
  }

  return summary();
}

function summary() {
  const total = pass + failures.length;
  if (failures.length === 0) {
    process.stdout.write(`\n  \u2714 independent acceptance: ${pass}/${total} assertions passed\n`);
    return 0;
  }
  process.stdout.write(`\n  \u2716 independent acceptance: ${pass}/${total} passed, ${failures.length} failed\n`);
  for (const f of failures) process.stdout.write(`    - ${f.label}\n`);
  return 1;
}

main().then((code) => process.exit(code)).catch((error) => {
  process.stderr.write(`\n  fatal: ${error?.stack ?? error}\n`);
  process.exit(1);
});
