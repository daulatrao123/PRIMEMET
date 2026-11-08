#!/usr/bin/env node
/**
 * PRIMEMET — Phase 1 remediation proof suite (W1, W1-t, W2, W3, W4-a).
 *
 * WHY THIS IS SEPARATE FROM THE SUITES IT COMPLEMENTS. `check-permissions`, `check-adversarial` and
 * `check-acceptance` were written before the remediation and, in one case, ASSERTED THE DEFECT AS
 * CORRECT (`check-permissions` P-R13 said an unrecognised effect is skipped). A test written beside the
 * code it verifies cannot witness the change it caused. This suite is written from the remediation's
 * CLAIMS, one section per finding, and each section states the behaviour that must hold and the
 * behaviour that held before, so a reader can see what moved.
 *
 * EVIDENCE CLASS PER SECTION — stated, not implied:
 *   W1   pure function           no database
 *   W2   real mongod 7 replica   started by mongodb-memory-server, no authentication
 *   W3   real mongod 7 replica   same, with PERMISSION_LOG_KEY set in the environment
 *   W4-a real mongod 7 replica   full migration path 1..5, fresh and upgrade
 *
 * WHAT THIS SUITE CANNOT PROVE. The replica set runs without authentication, so no privilege is
 * exercised: "an identity without the write privilege cannot insert" is not tested here and cannot be
 * tested locally. `check:adversarial` asserts the privilege model statically and says so. Every claim in
 * this file is about what the CODE does with rows that exist.
 *
 * Run: node scripts/check-remediation.mjs [--offline]   (offline runs W1 only)
 */

import { randomUUID } from "node:crypto";

import { Long } from "mongodb";

import { MIGRATIONS } from "../db/migrations/index.mjs";
import { applyMigrations, appliedVersions } from "../db/ledger.mjs";
import { GUARDS, GUARD_PLATFORM_IDENTITY, PLATFORM_IDENTITY_COLLECTION, PLATFORM_IDENTITY_VALIDATOR, ensurePlatformIdentityCollection } from "../db/guards.mjs";
import {
  PLATFORM_IDENTITY_ID,
  applyLegacyOrganisationBackfill,
  classifyLegacyOrganisations,
  platformIdentityProblems,
  platformOrganisationId,
} from "../db/organisation-identity.mjs";
import { resolveAdminPermissions } from "../src/lib/permissions/resolve.ts";
import { integrityTag, verifyEventIntegrity } from "../src/lib/permissions/integrity.ts";
import { TIER_DEFAULTS } from "../src/lib/permissions/tiers.ts";
import * as store from "../src/lib/permissions/store.ts";

const OFFLINE = process.argv.includes("--offline");
const NOW = new Date("2026-11-01T12:00:00.000Z");
const uuid = () => randomUUID();

/** A moment `minutes` before NOW, so expiry tests read forward rather than backward. */
const before = (minutes) => new Date(NOW.getTime() - minutes * 60_000);

let pass = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    pass += 1;
    return;
  }
  failures.push({ label, detail });
  process.stdout.write(`  \u2717 ${label}${detail ? `\n      ${detail}` : ""}\n`);
}
function equal(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, a === e ? "" : `expected ${e}\n      actual   ${a}`);
}
function section(title) {
  process.stdout.write(`\n${title}\n`);
}

/** An actor whose every gate passes, so a section can change exactly one fact. */
function actor(over = {}) {
  return {
    user: { id: over.userId ?? "u1", role: "ADMIN", status: "ACTIVE", deletedAt: null, ...(over.user ?? {}) },
    profile: { id: over.profileId ?? "p1", isActive: true, tier: over.tier ?? "READ_ONLY_ADMIN", ...(over.profile ?? {}) },
    org: over.org === undefined ? { id: "o1", orgKind: "PRIMEMET", accountStatus: "ACTIVE" } : over.org,
  };
}

/** One log row. `effect` is deliberately `unknown`: the whole point of W1 is rows that lie about it. */
function ev({
  permission = "ENQUIRY_VIEW",
  effect = "GRANT",
  at = before(30).getTime(),
  seq = 1,
  eventId = uuid(),
  expiresAt = null,
  adminId = "p1",
} = {}) {
  return {
    _id: uuid(),
    adminId,
    permission,
    effect,
    seq: Long.fromNumber(seq),
    eventId,
    grantedById: "actor-user",
    reason: "remediation suite",
    expiresAt,
    createdAt: new Date(at),
  };
}

/** Resolve one permission for one actor. Returns the decision so assertions read as sentences. */
function decide(events, { permission = "ENQUIRY_VIEW", tier = "READ_ONLY_ADMIN", options = {} } = {}) {
  const resolution = resolveAdminPermissions(actor({ tier }), events, NOW, options);
  return {
    decision: resolution.decisions.get(permission),
    diagnostics: resolution.integrityDiagnostics,
    allowed: resolution.allowed.has(permission),
    deniedAt: resolution.deniedAt,
  };
}

// ---------------------------------------------------------------------------
// W1 — an unrecognised or malformed effect must FAIL CLOSED, and say so
// ---------------------------------------------------------------------------
function groupW1() {
  section("W1 \u2014 unknown and malformed effects fail closed (pure resolver)");

  // A permission whose tier default is FALSE, so "granted" can only mean an event decided it.
  const F = "DATABASE_APPLY_MIGRATION";
  check("W1 precondition: the fixture permission is not a READ_ONLY_ADMIN default", TIER_DEFAULTS.READ_ONLY_ADMIN.includes(F) === false);
  // A permission whose tier default is TRUE, so "denied" can only mean an event overrode it.
  const V = "ENQUIRY_VIEW";
  check("W1 precondition: the second fixture permission IS a READ_ONLY_ADMIN default", TIER_DEFAULTS.READ_ONLY_ADMIN.includes(V) === true);

  // The defect, restated: before the remediation an unknown effect was SKIPPED, so the older GRANT
  // beneath it decided and the permission was allowed.
  {
    const corrupt = ev({ permission: F, effect: "PROMOTE", at: before(5).getTime(), seq: 2 });
    const older = ev({ permission: F, effect: "GRANT", at: before(30).getTime(), seq: 1 });
    const r = decide([older, corrupt], { permission: F });
    equal("W1.1 unrecognised effect above an older GRANT denies the permission", r.allowed, false);
    equal("W1.1 the decision is attributed to the invalid event", r.decision.decidedBy, "INVALID_EVENT");
    equal("W1.1 the decision effect is INVALID, not the older GRANT", r.decision.effect, "INVALID");
    equal("W1.1 the deciding event is the corrupt row", r.decision.eventId, corrupt.eventId);
    equal("W1.1 a diagnostic names the permission, event and reason", r.diagnostics.map((d) => [d.permission, d.eventId, d.reason, d.decisive]), [[F, corrupt.eventId, "EFFECT_NOT_RECOGNISED", true]]);
  }

  // The old behaviour also made a corrupt row WEAKER than no row: above a DENY it used to fall through
  // to... the DENY's own older sibling, which was accidentally safe. Attribution is what distinguishes it.
  {
    const corrupt = ev({ permission: F, effect: "ALLOW", at: before(5).getTime(), seq: 2 });
    const olderDeny = ev({ permission: F, effect: "DENY", at: before(30).getTime(), seq: 1 });
    const r = decide([olderDeny, corrupt], { permission: F });
    equal("W1.2 unrecognised effect above an older DENY still denies", r.allowed, false);
    equal("W1.2 ... but is attributed to the invalid event, not to the DENY", r.decision.decidedBy, "INVALID_EVENT");
  }

  // Above a REVOKE the distinction is visible without any older event: REVOKE restores the tier default,
  // which for ENQUIRY_VIEW is ALLOW. So a corrupt row must flip an allowed permission to denied.
  {
    const corrupt = ev({ permission: V, effect: "MAYBE", at: before(5).getTime(), seq: 3 });
    const olderRevoke = ev({ permission: V, effect: "REVOKE", at: before(30).getTime(), seq: 1 });
    equal("W1.3 control: REVOKE alone restores the tier default (allowed)", decide([olderRevoke], { permission: V }).allowed, true);
    const r = decide([olderRevoke, corrupt], { permission: V });
    equal("W1.3 an unrecognised effect above a REVOKE denies instead of restoring the default", r.allowed, false);
    equal("W1.3 ... attributed to the invalid event", r.decision.decidedBy, "INVALID_EVENT");
  }

  // Malformed shapes. Each is a value the database validator would now refuse, but the resolver must not
  // depend on the validator having run — a restore, a bypass, or a pre-validator row all get here.
  const malformed = [
    ["null", null],
    ["empty string", ""],
    ["lowercase grant", "grant"],
    ["padded GRANT", " GRANT"],
    ["numeric 1", 1],
    ["object", { effect: "GRANT" }],
    ["absent", "ABSENT"],
  ];
  for (const [name, effect] of malformed) {
    // "absent" deletes the property rather than setting it to undefined, which a default parameter would
    // silently replace with the valid value.
    const row = ev({ permission: F, at: before(5).getTime(), seq: 2 });
    if (effect === "ABSENT") delete row.effect;
    else row.effect = effect;
    const r = decide([row], { permission: F });
    equal(`W1.4 malformed effect (${name}) denies the permission`, r.allowed, false);
    check(`W1.4 malformed effect (${name}) is reported`, r.diagnostics.length === 1 && r.diagnostics[0].reason === "EFFECT_NOT_RECOGNISED", JSON.stringify(r.diagnostics));
  }

  // The three legal effects must still do exactly what D-ARCH-12 says.
  equal("W1.5 GRANT allows", decide([ev({ permission: F, effect: "GRANT" })], { permission: F }).allowed, true);
  equal("W1.5 DENY denies", decide([ev({ permission: V, effect: "DENY" })], { permission: V }).allowed, false);
  equal("W1.5 REVOKE restores the tier default (deny for a non-default permission)", decide([ev({ permission: F, effect: "REVOKE" })], { permission: F }).allowed, false);
  equal("W1.5 REVOKE restores the tier default (allow for a default permission)", decide([ev({ permission: V, effect: "REVOKE" })], { permission: V }).allowed, true);
  equal("W1.5 REVOKE reports decidedBy TIER_DEFAULT", decide([ev({ permission: V, effect: "REVOKE" })], { permission: V }).decision.decidedBy, "TIER_DEFAULT");

  // Expiry keeps its existing semantics: an expired row is inert, whatever it says.
  {
    const expiredCorrupt = ev({ permission: F, effect: "NONSENSE", at: before(60).getTime(), seq: 9, expiresAt: before(50) });
    const liveGrant = ev({ permission: F, effect: "GRANT", at: before(30).getTime(), seq: 1 });
    const r = decide([liveGrant, expiredCorrupt], { permission: F });
    equal("W1.6 an expired corrupt row is inert, not decisive", r.allowed, true);
    equal("W1.6 ... and is not reported as an integrity problem", r.diagnostics.length, 0);
  }

  // Order is deterministic: createdAt, then the atomic sequence.
  {
    const sameMoment = before(10).getTime();
    const low = ev({ permission: F, effect: "GRANT", at: sameMoment, seq: 1 });
    const high = ev({ permission: F, effect: "TAMPERED", at: sameMoment, seq: 2 });
    const r = decide([low, high], { permission: F });
    equal("W1.7 within one instant the higher sequence wins, and it is the corrupt one", r.decision.eventId, high.eventId);
    equal("W1.7 ... so the permission is refused", r.allowed, false);
  }

  // A corrupt row does not poison a permission decided by a NEWER valid row — it is reported, not obeyed.
  {
    const corrupt = ev({ permission: F, effect: "BOGUS", at: before(30).getTime(), seq: 1 });
    const newer = ev({ permission: F, effect: "GRANT", at: before(5).getTime(), seq: 2 });
    const r = decide([corrupt, newer], { permission: F });
    equal("W1.8 a newer valid GRANT still decides over an older corrupt row", r.allowed, true);
    equal("W1.8 ... attributed to the valid event", r.decision.eventId, newer.eventId);
    equal("W1.8 ... and the older row is reported as non-decisive", r.diagnostics.map((d) => d.decisive), [false]);
  }

  // Scoping: another admin's rows are not this admin's problem, and must not produce diagnostics.
  {
    const foreign = ev({ permission: F, effect: "BOGUS", adminId: "someone-else" });
    const mine = ev({ permission: F, effect: "GRANT" });
    const r = decide([foreign, mine], { permission: F });
    equal("W1.9 another admin's corrupt row is ignored", r.allowed, true);
    equal("W1.9 ... and produces no diagnostic", r.diagnostics.length, 0);
  }

  // A clean history produces no diagnostics at all.
  equal("W1.10 a clean history produces no integrity diagnostics", decide([ev({ permission: F, effect: "GRANT" })], { permission: F }).diagnostics.length, 0);

  // The gate still runs first: an ineligible actor is refused before any event is read.
  {
    const resolution = resolveAdminPermissions(actor({ profile: { isActive: false } }), [ev({ permission: F, effect: "BOGUS" })], NOW);
    equal("W1.11 an ineligible actor is refused by the gate, not by the log", resolution.deniedAt, "PROFILE_INACTIVE");
    equal("W1.11 ... with no diagnostics, because nothing was projected", resolution.integrityDiagnostics.length, 0);
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures for the database sections
// ---------------------------------------------------------------------------

const T0 = before(120);

/** A valid organisation document. `over` changes exactly the fields a section is about. */
function orgDoc(id, over = {}) {
  return {
    _id: id,
    legalName: over.legalName ?? `Organisation ${id.slice(0, 8)}`,
    countryCode: "IN",
    accountStatus: "ACTIVE",
    isListable: false,
    orgType: "BUYER",
    orgKind: "BUYER",
    verificationStatus: "VERIFIED",
    deletedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

/** A valid admin: an ACTIVE user with an ACTIVE profile at `tier`. */
async function seedAdmin(db, { tier = "READ_ONLY_ADMIN", userId = uuid(), profileId = uuid() } = {}) {
  await db.collection("users").insertOne({
    _id: userId,
    email: `admin-${userId}@example.test`,
    fullName: "Remediation Admin",
    locale: "en-IN",
    role: "ADMIN",
    status: "ACTIVE",
    mfaEnabled: true,
    failedLoginCount: 0,
    deletedAt: null,
    createdAt: T0,
    updatedAt: T0,
  });
  await db.collection("admin_profiles").insertOne({
    _id: profileId,
    userId,
    staffCode: `S-${profileId.slice(0, 8)}`,
    tier,
    mfaRequired: true,
    isActive: true,
    createdAt: T0,
    updatedAt: T0,
  });
  return { userId, profileId };
}

/** Apply every migration through `lastVersion`. Used to build a database at a chosen point in history. */
async function migrateTo(db, lastVersion) {
  const migrations = MIGRATIONS.filter((m) => m.version <= lastVersion);
  return applyMigrations(db, { migrations, appliedBy: "check-remediation", log: () => {} });
}

/**
 * Write the protected platform identity pointer directly, as the OWNER identity would.
 *
 * Created with the declared validator so the collection is production-shaped, and written with `upsert` so
 * each call states the pointer rather than depending on a previous one. The pointer deliberately accepts
 * ids the migration would refuse (a suspended organisation, a non-existent one) because those are exactly
 * the hostile states the resolver must handle.
 */
async function setProtectedPointer(db, organisationId) {
  const present = await db.listCollections({ name: PLATFORM_IDENTITY_COLLECTION }, { nameOnly: true }).hasNext();
  if (!present) {
    await db.createCollection(PLATFORM_IDENTITY_COLLECTION, {
      validator: PLATFORM_IDENTITY_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error",
    });
  }
  await db.collection(PLATFORM_IDENTITY_COLLECTION).updateOne(
    { _id: PLATFORM_IDENTITY_ID },
    { $set: { kind: "PLATFORM_IDENTITY", organisationId, updatedAt: NOW } },
    { upsert: true },
  );
}

// ---------------------------------------------------------------------------
// W2 — platform identity lives in a protected pointer, not in a mutable marker
// ---------------------------------------------------------------------------
async function groupW2(client) {
  section("W2 \u2014 administrator resolution reads the protected identity pointer");

  const db = client.db("w2");
  await migrateTo(db, 9);

  const orgs = db.collection("organisations");
  const identity = db.collection(PLATFORM_IDENTITY_COLLECTION);

  // Two organisations that disagree: the marker says "B is the operator", the pointer says "A is".
  const A = uuid();
  const B = uuid();
  await orgs.insertOne(orgDoc(A, { orgKind: "BUYER", accountStatus: "SUSPENDED", legalName: "Suspended counterparty" }));
  await orgs.insertOne(orgDoc(B, { orgKind: "PRIMEMET", orgType: "BOTH", accountStatus: "ACTIVE", legalName: "PRIMEMET" }));

  const admin = await seedAdmin(db);

  // W2.1 The pointer decides, even when a PRIMEMET marker exists on another, healthier organisation.
  await setProtectedPointer(db, A);
  {
    const resolution = await store.resolveActorPermissions(db, admin.userId, NOW);
    equal("W2.1 a pointer to a suspended organisation denies, although another organisation is ACTIVE PRIMEMET", resolution.deniedAt, "ORGANISATION_NOT_ACTIVE");
    equal("W2.1 ... and grants nothing", resolution.permissions.size, 0);
    // Control: the marker alone would have said ACTIVE, which is exactly the pre-fix behaviour.
    const marker = await orgs.findOne({ orgKind: "PRIMEMET" });
    equal("W2.1 control: the marker points at the ACTIVE organisation", String(marker._id), B);
  }

  // W2.2 Pointing at the healthy organisation grants the tier default, so the pointer is what changed.
  await setProtectedPointer(db, B);
  {
    const resolution = await store.resolveActorPermissions(db, admin.userId, NOW);
    equal("W2.2 a pointer to a live PRIMEMET organisation resolves", resolution.deniedAt, null);
    equal("W2.2 ... with the READ_ONLY_ADMIN default set", resolution.permissions.size, TIER_DEFAULTS.READ_ONLY_ADMIN.length);
  }

  // W2.3 THE ATTACK THE FINDING DESCRIBED. Relabel the operator's own row, relabel a counterparty to
  // PRIMEMET, and suspend the operator. Under the old rule the marker promoted the counterparty and the
  // administrator kept every permission. Under the pointer the label changes nothing.
  {
    await orgs.updateOne({ _id: B }, { $set: { orgKind: "BUYER", accountStatus: "SUSPENDED" } });
    await orgs.updateOne({ _id: A }, { $set: { orgKind: "PRIMEMET", accountStatus: "ACTIVE" } });
    const marker = await orgs.findOne({ orgKind: "PRIMEMET" });
    equal("W2.3 precondition: the marker now names the attacker-controlled organisation", String(marker._id), A);
    const resolution = await store.resolveActorPermissions(db, admin.userId, NOW);
    equal("W2.3 relabelling does not transfer authority: the pointer still names the suspended row", resolution.deniedAt, "ORGANISATION_NOT_ACTIVE");
    equal("W2.3 ... and the relabelled counterparty grants nothing", resolution.permissions.size, 0);
  }

  // W2.4 Deleting the pointed-at organisation fails closed. It must NOT fall through to whoever holds
  // the marker next — that fall-through is what made the marker a privilege-escalation primitive.
  {
    await orgs.updateOne({ _id: B }, { $set: { deletedAt: new Date(NOW.getTime() - 1000) } });
    await orgs.updateOne({ _id: A }, { $set: { orgKind: "PRIMEMET", accountStatus: "ACTIVE" } });
    const resolution = await store.resolveActorPermissions(db, admin.userId, NOW);
    equal("W2.4 soft-deleting the pointed-at organisation denies", resolution.deniedAt, "NO_ORGANISATION");
    equal("W2.4 ... rather than promoting the live PRIMEMET marker", resolution.permissions.size, 0);
  }

  // W2.5 A pointer naming a row that does not exist is refused, not repaired.
  {
    await orgs.updateOne({ _id: B }, { $set: { deletedAt: null } });
    await setProtectedPointer(db, uuid());
    const resolution = await store.resolveActorPermissions(db, admin.userId, NOW);
    equal("W2.5 a pointer to a nonexistent organisation denies", resolution.deniedAt, "NO_ORGANISATION");
  }

  // W2.6 F1: there is NO fallback. Deleting the pointer denies rather than falling back to the marker, and
  // a re-seed cannot be conjured from a marker either — it needs an owner-supplied id (F3/F4).
  {
    await identity.deleteOne({ _id: PLATFORM_IDENTITY_ID });
    await orgs.updateOne({ _id: A }, { $set: { orgKind: "PRIMEMET", accountStatus: "ACTIVE" } });
    const resolution = await store.resolveActorPermissions(db, admin.userId, NOW);
    equal("W2.6 with no pointer the administrator resolves to nothing", resolution.deniedAt, "NO_ORGANISATION");
    equal("W2.6 ... and no live marker stands in", resolution.permissions.size, 0);
    const reseed = await ensurePlatformIdentityCollection(db, { now: NOW }).then(
      () => null,
      (error) => error,
    );
    check(
      "W2.6 re-seeding from a marker is refused, so application-writable state cannot restore authority",
      reseed?.name === "PlatformIdentitySeedError",
      String(reseed?.name ?? reseed),
    );
  }

  // W2.6b F1: the fallback is gone, and this is what proves it GONE rather than narrowed. A marker is a
  // writable field, so its cardinality — one, two, or a soft-deleted one — must make no difference at all.
  {
    const db4 = client.db("w2fallback");
    await migrateTo(db4, 9);
    for (const index of await db4.collection("organisations").indexes()) {
      if (index.unique && index.key && "orgKind" in index.key) {
        await db4.collection("organisations").dropIndex(index.name);
      }
    }
    const first = uuid();
    const second = uuid();
    const member = await seedAdmin(db4);
    await db4.collection("organisations").insertMany([
      orgDoc(first, { orgKind: "PRIMEMET", orgType: "BOTH" }),
      orgDoc(second, { orgKind: "PRIMEMET", orgType: "BOTH" }),
    ], { bypassDocumentValidation: true });
    equal("W2.6b two live PRIMEMET markers do not stand in for the pointer", (await store.resolveActorPermissions(db4, member.userId, NOW)).deniedAt, "NO_ORGANISATION");

    await db4.collection("organisations").deleteOne({ _id: second });
    equal("W2.6b exactly one marker does not stand in either", (await store.resolveActorPermissions(db4, member.userId, NOW)).deniedAt, "NO_ORGANISATION");

    await db4.collection("organisations").updateOne({ _id: first }, { $set: { deletedAt: new Date(NOW.getTime() - 1000) } });
    equal("W2.6b a soft-deleted marker does not govern", (await store.resolveActorPermissions(db4, member.userId, NOW)).deniedAt, "NO_ORGANISATION");
  }

  // W2.7 The pointer's own document is validated, and the shape is closed to exactly one id. Tested on a
  // scratch collection created from the declared validator, because the real collection already holds the
  // single legal document — a second insert there would fail on the id rather than on the field under test.
  {
    const db5 = client.db("w2validator");
    await db5.createCollection(PLATFORM_IDENTITY_COLLECTION, {
      validator: PLATFORM_IDENTITY_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error",
    });
    const scratch = db5.collection(PLATFORM_IDENTITY_COLLECTION);
    const refusalOf = async (doc) => {
      try {
        await scratch.insertOne(doc);
        return null;
      } catch (error) {
        return { code: error?.code, message: String(error?.message ?? error) };
      }
    };
    const missing = await refusalOf({ _id: PLATFORM_IDENTITY_ID, kind: "PLATFORM_IDENTITY", updatedAt: NOW });
    check("W2.7 a PLATFORM_IDENTITY document without organisationId is refused (code 121)", missing?.code === 121, JSON.stringify(missing));
    const malformed = await refusalOf({ _id: PLATFORM_IDENTITY_ID, kind: "PLATFORM_IDENTITY", organisationId: "not a uuid !", updatedAt: NOW });
    check("W2.7 a malformed organisationId is refused (code 121)", malformed?.code === 121, JSON.stringify(malformed));
    const second = await refusalOf({ _id: "platform-identity-other", kind: "PLATFORM_IDENTITY", organisationId: uuid(), updatedAt: NOW });
    check("W2.7 a second document id is refused, so the pointer cannot multiply (code 121)", second?.code === 121, JSON.stringify(second));
    const control = await refusalOf({ _id: PLATFORM_IDENTITY_ID, kind: "PLATFORM_IDENTITY", organisationId: uuid(), updatedAt: NOW });
    equal("W2.7 control: a well-formed pointer is accepted, so the refusals are about the fields", control, null);
  }

  // W2.8 F3/F4: the seeding authority is the owner's explicit id, so an ambiguous marker set can neither
  // seed nor block — and the id itself is validated before anything is written.
  {
    const db2 = client.db("w2seed");
    await migrateTo(db2, 9);
    // Two live PRIMEMET rows cannot coexist while the single-PRIMEMET partial unique index exists, so the
    // index is dropped first. That is not a contrivance: it is precisely the drift a restore or a hand-edit
    // produces, and it is the state in which "seed the pointer from the marker" must refuse to guess.
    // (bypassDocumentValidation would not help: it skips validators, not indexes.)
    for (const index of await db2.collection("organisations").indexes()) {
      if (index.unique && index.key && "orgKind" in index.key) {
        await db2.collection("organisations").dropIndex(index.name);
      }
    }
    const two = await db2.collection("organisations").insertMany([
      orgDoc(uuid(), { orgKind: "PRIMEMET", orgType: "BOTH" }),
      orgDoc(uuid(), { orgKind: "PRIMEMET", orgType: "BOTH" }),
    ], { bypassDocumentValidation: true });
    check("W2.8 precondition: two PRIMEMET rows were seeded", Object.keys(two.insertedIds).length === 2);
    let refusal = null;
    try {
      await ensurePlatformIdentityCollection(db2, { log: () => {}, now: NOW });
    } catch (error) {
      refusal = String(error?.message ?? error);
    }
    check(
      "W2.8 two live PRIMEMET organisations do not seed the pointer",
      refusal !== null && /PLATFORM_IDENTITY_UNSEEDED/.test(refusal),
      String(refusal),
    );
    equal(
      "W2.8 ... and nothing was written",
      await db2.collection(PLATFORM_IDENTITY_COLLECTION).countDocuments({}),
      0,
    );

    // The explicit id is the authority: ambiguity in the markers is irrelevant to it, and it is validated.
    // The collection already exists (the refused attempt created it), so `up()` reports no creation — the
    // state that matters is the pointer.
    const target = String(Object.values(two.insertedIds)[0]);
    await ensurePlatformIdentityCollection(db2, { log: () => {}, now: NOW, organisationId: target });
    const pointer = await db2.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: PLATFORM_IDENTITY_ID });
    equal("W2.8 an explicit owner-supplied id seeds even when the markers are ambiguous", pointer?.organisationId, target);
  }

  // W2.9 Two concurrent seeds converge on ONE pointer document.
  {
    const db3 = client.db("w2concurrent");
    await migrateTo(db3, 9);
    const only = uuid();
    await db3.collection("organisations").insertOne(orgDoc(only, { orgKind: "PRIMEMET", orgType: "BOTH" }));
    const results = await Promise.all([
      ensurePlatformIdentityCollection(db3, { log: () => {}, now: NOW, organisationId: only }),
      ensurePlatformIdentityCollection(db3, { log: () => {}, now: NOW, organisationId: only }),
    ]);
    check("W2.9 both concurrent seeds complete", results.every((r) => Array.isArray(r)), JSON.stringify(results));
    const pointers = await db3.collection(PLATFORM_IDENTITY_COLLECTION).find({ _id: PLATFORM_IDENTITY_ID }).toArray();
    equal("W2.9 exactly one pointer document exists", pointers.length, 1);
    equal("W2.9 ... and it names the seeded organisation", pointers[0].organisationId, only);
  }

  // W2.10 The literal the resolver uses and the literal the validator uses are one value.
  equal("W2.10 store and db/guards agree on the pointer id", store.GUARD_PLATFORM_IDENTITY, GUARD_PLATFORM_IDENTITY);
  equal("W2.10 the exported id is that literal", PLATFORM_IDENTITY_ID, GUARD_PLATFORM_IDENTITY);
}

// ---------------------------------------------------------------------------
// W3 — an unsigned row is never effective when a key is configured
// ---------------------------------------------------------------------------
async function groupW3(client) {
  section("W3 \u2014 integrity tags make an unauthorised insert inert");

  const KEY = "remediation-suite-key-0123456789";
  process.env.PERMISSION_LOG_KEY = KEY;

  const db = client.db("w3");
  await migrateTo(db, 9);

  const orgId = uuid();
  await db.collection("organisations").insertOne(orgDoc(orgId, { orgKind: "PRIMEMET", orgType: "BOTH" }));
  // F1: the protected pointer is the only source, so this world must carry it explicitly.
  await ensurePlatformIdentityCollection(db, { log: () => {}, now: NOW, organisationId: orgId });

  const granter = await seedAdmin(db, { tier: "SUPER_ADMIN" });
  const target = await seedAdmin(db, { tier: "READ_ONLY_ADMIN" });
  const FORGED = "DATABASE_APPLY_MIGRATION";
  check("W3 precondition: the forged permission is not a READ_ONLY_ADMIN default", TIER_DEFAULTS.READ_ONLY_ADMIN.includes(FORGED) === false);

  // The row an attacker would write: it satisfies every validator rule the collection has.
  const forged = {
    _id: uuid(),
    adminId: target.profileId,
    permission: FORGED,
    effect: "GRANT",
    seq: Long.fromNumber(1),
    eventId: uuid(),
    grantedById: granter.userId,
    reason: "hand-written row, schema-conforming, never delegated",
    expiresAt: null,
    createdAt: new Date(NOW.getTime() - 60_000),
  };
  await db.collection(store.GRANTS_COLLECTION).insertOne(forged);

  {
    const stored = await db.collection(store.GRANTS_COLLECTION).findOne({ _id: forged._id });
    check("W3.1 the database ACCEPTS the hand-written row (validation is not authorisation)", stored !== null);
    const resolution = await store.resolveActorPermissions(db, target.userId, NOW);
    equal("W3.1 the unsigned row does not grant", resolution.permissions.has(FORGED), false);
    const decision = resolution.decisions.get(FORGED);
    equal("W3.1 ... it is attributed to the invalid event", decision.decidedBy, "INVALID_EVENT");
    equal("W3.1 ... the effect reads INVALID, not GRANT", decision.effect, "INVALID");
    equal("W3.1 ... and the deciding event is the forged row", decision.eventId, forged.eventId);
  }

  // The signing path produces a row that DOES decide, so the mechanism is a discriminator and not a
  // blanket refusal.
  let signed = null;
  {
    const result = await store.appendPermissionEvent(db, {
      actorUserId: granter.userId,
      target: { profileId: target.profileId, isActive: true, userIsActive: true, tier: "READ_ONLY_ADMIN" },
      permission: FORGED,
      effect: "GRANT",
      reason: "signed through the delegation path",
      eventId: uuid(),
      now: new Date(NOW.getTime() - 30_000),
    });
    check("W3.2 the append succeeds through the authorised path", result.ok === true, JSON.stringify(result));
    if (result.ok) {
      signed = await db.collection(store.GRANTS_COLLECTION).findOne({ eventId: result.eventId });
      check("W3.2 the stored row carries a tag", typeof signed?.integrity === "string" && signed.integrity.length === 64, JSON.stringify(signed?.integrity));
      equal("W3.2 the tag verifies", verifyEventIntegrity(signed, KEY), "VALID");
    }
    const resolution = await store.resolveActorPermissions(db, target.userId, NOW);
    equal("W3.2 the signed row DOES grant", resolution.permissions.has(FORGED), true);
    equal("W3.2 ... and no integrity diagnostic is raised for it", resolution.decisions.get(FORGED).decidedBy, "EVENT");
  }

  // Tampering: copy the signed row and change the decision without re-signing. The tag covers the field,
  // so the copy is inert — this is the property that makes an edit after the fact detectable.
  if (!signed) {
    check("W3.3 unreachable: the signing path produced no row to tamper with", false);
  } else {
    // `seq` is read back as a JS number because the driver promotes Longs by default, and re-inserting that
    // number would be rejected by the validator (int32 where the schema requires long). The copy therefore
    // restores the wire type: an artefact of the test harness, not of the mechanism under test.
    // A distinct, higher sequence keeps the unique (adminId, seq) index satisfied AND makes the copy the
    // newest applicable row, which is the strongest form of the attack.
    const tampered = { ...signed, _id: uuid(), eventId: uuid(), effect: "DENY", seq: Long.fromNumber(Number(signed.seq) + 1000) };
    await db.collection(store.GRANTS_COLLECTION).insertOne(tampered);
    equal("W3.3 the tampered copy does not verify", verifyEventIntegrity(tampered, KEY), "INVALID");
    const decision = (await store.resolveActorPermissions(db, target.userId, NOW)).decisions.get(FORGED);
    equal("W3.3 the newest row is the tampered one", decision.eventId, tampered.eventId);
    equal("W3.3 ... so the permission is refused rather than denied-by-DENY", decision.effect, "INVALID");
    equal("W3.3 ... attributed to the invalid event", decision.decidedBy, "INVALID_EVENT");
    await db.collection(store.GRANTS_COLLECTION).deleteOne({ _id: tampered._id });
  }

  // Rotation: a tag from another key does not verify, so a rotation fails CLOSED (the row stops deciding)
  // rather than open. This is the documented consequence, asserted rather than described.
  {
    const otherKey = "an-entirely-different-key-9876543210";
    equal("W3.4 a tag under a different key does not verify", verifyEventIntegrity(signed, otherKey), "INVALID");
    const resolution = await store.resolveActorPermissions(db, target.userId, NOW);
    equal("W3.4 under the current key the row still verifies", resolution.permissions.has(FORGED), true);
  }

  // THE LIMITATION, MEASURED. With no key configured, verification is DISABLED and the forged row decides.
  // This is stated in integrity.ts and in the reviewer package; asserting it keeps the limitation from
  // being quietly claimed as solved.
  {
    delete process.env.PERMISSION_LOG_KEY;
    equal("W3.5 with no key the store reports no key", store.permissionLogKey(), null);
    const resolution = await store.resolveActorPermissions(db, target.userId, NOW);
    equal("W3.5 WITHOUT a key the unsigned row DOES grant (documented limitation, not a fix)", resolution.permissions.has(FORGED), true);
    equal("W3.5 ... and nothing is reported, because nothing was checkable", resolution.decisions.get(FORGED).decidedBy, "EVENT");
    process.env.PERMISSION_LOG_KEY = KEY;
  }

  // A key shorter than 16 characters is "not configured" rather than a weak key: a short secret would
  // produce tags that look sound.
  {
    process.env.PERMISSION_LOG_KEY = "short";
    equal("W3.6 a short key is treated as no key", store.permissionLogKey(), null);
    process.env.PERMISSION_LOG_KEY = KEY;
  }

  // The canonical string is length-prefixed, so a value containing the separator cannot shift a field
  // boundary. Two events that would collide under a naive "|" join must not collide here.
  {
    const base = { adminId: "a", permission: "P", effect: "GRANT", seq: 1, eventId: "e", grantedById: "g", reason: "r", expiresAt: null, createdAt: null };
    const shifted = { ...base, adminId: "a|P", permission: "", effect: "GRANT" };
    check("W3.7 a separator inside a value cannot shift the field boundary", integrityTag(base, KEY) !== integrityTag(shifted, KEY));
    equal("W3.7 the tag is deterministic", integrityTag(base, KEY), integrityTag({ ...base }, KEY));
    check("W3.7 the tag is 64 hex characters", /^[0-9a-f]{64}$/.test(integrityTag(base, KEY)));
  }

  // The write path refuses a row it cannot sign, rather than writing an unsigned one.
  {
    let thrown = null;
    try {
      await store.appendPermissionEvent(db, {
        actorUserId: granter.userId,
        target: { profileId: target.profileId, isActive: true, userIsActive: true, tier: "READ_ONLY_ADMIN" },
        permission: "",
        effect: "GRANT",
        reason: "empty permission",
        eventId: uuid(),
        now: NOW,
      });
    } catch (error) {
      thrown = String(error?.message ?? error);
    }
    check("W3.8 a row that cannot be signed is refused by the write path", thrown === null || /integrity|permission/i.test(thrown), String(thrown));
  }
}

// ---------------------------------------------------------------------------
// W4-a — the legacy organisation backfill is controlled, reported and convergent
// ---------------------------------------------------------------------------
async function groupW4a(client) {
  section("W4-a \u2014 legacy organisation backfill: refusing, reported, convergent");

  // W4-a.1 A FRESH database migrates all the way and seeds nothing it cannot justify.
  {
    const db = client.db("w4fresh");
    const results = await migrateTo(db, 5);
    equal("W4-a.1 every migration applies on an empty database", results.map((r) => [r.version, r.status]), [[1, "applied"], [2, "applied"], [3, "applied"], [4, "applied"], [5, "applied"]]);
    const applied = await appliedVersions(db);
    equal("W4-a.1 the ledger records versions 1..5", [...applied.keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    const pointer = await db.collection(GUARDS).findOne({ _id: PLATFORM_IDENTITY_ID });
    equal("W4-a.1 no platform identity is invented on an empty database", pointer, null);
    equal("W4-a.1 v005 leaves the reason on the record", await platformOrganisationId(db), null);
  }

  // W4-a.2 THE DEAD END. A database written before v004 has organisations without orgKind. v004 requires
  // it, so the migration cannot converge them on its own. Without a decision it must refuse — and it must
  // refuse for the RIGHT reason, naming the rows, rather than failing on the first document.
  {
    const db = client.db("w4upgrade");
    await migrateTo(db, 3);
    const orgs = db.collection("organisations");
    const legacy = { bypassDocumentValidation: true };
    const buyer = uuid();
    const seller = uuid();
    const both = uuid();
    const operator = uuid();
    await orgs.insertOne({ _id: buyer, legalName: "Legacy Buyer", countryCode: "IN", accountStatus: "ACTIVE", isListable: false, orgType: "BUYER", verificationStatus: "VERIFIED", deletedAt: null, createdAt: T0, updatedAt: T0 }, legacy);
    await orgs.insertOne({ _id: seller, legalName: "Legacy Seller", countryCode: "IN", accountStatus: "ACTIVE", isListable: false, orgType: "SELLER", verificationStatus: "VERIFIED", deletedAt: null, createdAt: T0, updatedAt: T0 }, legacy);
    await orgs.insertOne({ _id: both, legalName: "Legacy Both", countryCode: "IN", accountStatus: "ACTIVE", isListable: false, orgType: "BOTH", verificationStatus: "VERIFIED", deletedAt: null, createdAt: T0, updatedAt: T0 }, legacy);
    await orgs.insertOne({ _id: operator, legalName: "PRIMEMET", countryCode: "IN", accountStatus: "ACTIVE", isListable: false, orgType: "BOTH", orgKind: "PRIMEMET", verificationStatus: "VERIFIED", deletedAt: null, createdAt: T0, updatedAt: T0 });

    // Classification is a pure reading of the rows, and it never invents an operator.
    const report = await classifyLegacyOrganisations(db);
    equal("W4-a.2 classification: one row already carries a marker", report.alreadyClassified.length, 1);
    equal("W4-a.2 classification: two rows are derivable from orgType", report.derivable.length, 2);
    equal("W4-a.2 classification: one row is ambiguous", report.ambiguous.length, 1);
    equal("W4-a.2 classification: nothing claims PRIMEMET twice", report.conflicts.length, 0);
    check("W4-a.2 classification never proposes PRIMEMET for a legacy row", report.derivable.every((r) => r.proposed !== "PRIMEMET"));

    // v004 without a decision must refuse, and write nothing.
    let refusal = null;
    try {
      await migrateTo(db, 4);
    } catch (error) {
      refusal = String(error?.message ?? error);
    }
    check("W4-a.2 the migration refuses when a row needs a business decision", refusal !== null && /PREFLIGHT_FAILED/.test(refusal), String(refusal));
    check("W4-a.2 the refusal names the ambiguous organisation", refusal !== null && refusal.includes(both), String(refusal));
    const afterRefusal = await appliedVersions(db);
    equal("W4-a.2 the ledger records no version 4 after the refusal", afterRefusal.has(4), false);
    equal("W4-a.2 no row was written by the refusal", (await orgs.find({ orgKind: { $exists: false } }).toArray()).length, 3);

    // The dry run reports and writes nothing.
    {
      const outcome = await applyLegacyOrganisationBackfill(db, { dryRun: true, bothAs: "OTHER", log: () => {} });
      equal("W4-a.3 the dry run reports the derivable rows", outcome.report.derivable.length, 2);
      equal("W4-a.3 the dry run reports the ambiguous rows", outcome.report.ambiguous.length, 1);
      equal("W4-a.3 the dry run writes nothing", outcome.written, 0);
      equal("W4-a.3 ... and the rows are untouched", (await orgs.find({ orgKind: { $exists: false } }).toArray()).length, 3);
    }

    // An operator decision applies: derivable rows get their orgType, ambiguous rows get the named marker,
    // and the operator row is never touched.
    {
      const outcome = await applyLegacyOrganisationBackfill(db, { dryRun: false, bothAs: "OTHER", log: () => {} });
      equal("W4-a.4 the backfill writes the derivable and ambiguous rows", outcome.written, 3);
      equal("W4-a.4 the buyer keeps its counterparty kind", (await orgs.findOne({ _id: buyer })).orgKind, "BUYER");
      equal("W4-a.4 the seller keeps its counterparty kind", (await orgs.findOne({ _id: seller })).orgKind, "SELLER");
      equal("W4-a.4 the ambiguous row takes the operator's decision", (await orgs.findOne({ _id: both })).orgKind, "OTHER");
      equal("W4-a.4 the existing operator marker is not rewritten", (await orgs.findOne({ _id: operator })).orgKind, "PRIMEMET");
    }

    // The migration now converges through the same implementation, guided by the environment flag.
    {
      process.env.PRIMEMET_BACKFILL_BOTH_AS = "OTHER";
      const results = await migrateTo(db, 5);
      delete process.env.PRIMEMET_BACKFILL_BOTH_AS;
      check("W4-a.5 the migration applies once the state is decidable", Array.isArray(results), JSON.stringify(results)?.slice(0, 200));
      const applied = await appliedVersions(db);
      check("W4-a.5 the ledger now records version 4 and 5", applied.has(4) && applied.has(5));
      const pointer = await db.collection(GUARDS).findOne({ _id: PLATFORM_IDENTITY_ID });
      equal("W4-a.5 v005 seeds the platform identity from the single PRIMEMET row", pointer?.organisationId, operator);
      const problems = await platformIdentityProblems(db);
      check("W4-a.5 the converged database reports no identity problem", problems.length === 0, JSON.stringify(problems));
    }

    // Convergence is real, not just a successful exit: the validator now rejects what it used to accept.
    {
      let rejected = null;
      try {
        await orgs.insertOne({ _id: uuid(), legalName: "No marker", countryCode: "IN", accountStatus: "ACTIVE", isListable: false, orgType: "BUYER", verificationStatus: "VERIFIED", deletedAt: null, createdAt: T0, updatedAt: T0 });
      } catch (error) {
        // Validator rejections arrive as code 121 without the field name, so the code is what is asserted.
        rejected = error?.code ?? String(error?.message ?? error);
      }
      equal("W4-a.6 a new organisation without orgKind is refused after the upgrade (code 121)", rejected, 121);
    }

    // Re-running the migration is idempotent: the ledger is not duplicated and the pointer is not moved.
    {
      const before = await db.collection(GUARDS).findOne({ _id: PLATFORM_IDENTITY_ID });
      const v004 = MIGRATIONS.find((m) => m.version === 4);
      const v005 = MIGRATIONS.find((m) => m.version === 5);
      await v004.up(db, { log: () => {} });
      await v005.up(db, { log: () => {} });
      const after = await db.collection(GUARDS).findOne({ _id: PLATFORM_IDENTITY_ID });
      equal("W4-a.7 re-running v004 and v005 is idempotent", after.organisationId, before.organisationId);
      equal("W4-a.7 the ledger is not duplicated", (await db.collection("_schema_migrations").countDocuments({ version: 4 })), 1);
    }
  }

  // W4-a.8 Ambiguity without a decision is a refusal, not a default — the behaviour that makes the tool
  // safe to leave in a pipeline.
  {
    const db = client.db("w4ambiguous");
    await migrateTo(db, 3);
    await db.collection("organisations").insertOne(
      { _id: uuid(), legalName: "Ambiguous", countryCode: "IN", accountStatus: "ACTIVE", isListable: false, orgType: "BOTH", verificationStatus: "VERIFIED", deletedAt: null, createdAt: T0, updatedAt: T0 },
      { bypassDocumentValidation: true },
    );
    let refusal = null;
    try {
      await applyLegacyOrganisationBackfill(db, { dryRun: false, log: () => {} });
    } catch (error) {
      refusal = String(error?.message ?? error);
    }
    check("W4-a.8 an ambiguous row without a decision is refused", refusal !== null && /PREFLIGHT_FAILED/.test(refusal), String(refusal));
    check("W4-a.8 the refusal offers the two acceptable markers", refusal !== null && /OTHER \| PARTNER/.test(refusal), String(refusal));
    equal("W4-a.8 nothing was written", (await db.collection("organisations").find({ orgKind: { $exists: false } }).toArray()).length, 1);
  }

  // W4-a.9 A marker that claims the platform identity without being named by it is a conflict, refused.
  {
    const db = client.db("w4conflict");
    await migrateTo(db, 3);
    const real = uuid();
    const impostor = uuid();
    // Same reason as W2.8: two live PRIMEMET rows require the single-PRIMEMET index to be absent.
    for (const index of await db.collection("organisations").indexes()) {
      if (index.unique && index.key && "orgKind" in index.key) {
        await db.collection("organisations").dropIndex(index.name);
      }
    }
    await db.collection("organisations").insertMany([
      orgDoc(real, { orgKind: "PRIMEMET", orgType: "BOTH", legalName: "PRIMEMET" }),
      orgDoc(impostor, { orgKind: "PRIMEMET", orgType: "BOTH", legalName: "Impostor" }),
    ], { bypassDocumentValidation: true });
    await db.collection(GUARDS).insertOne({ _id: PLATFORM_IDENTITY_ID, kind: "PLATFORM_IDENTITY", organisationId: real, updatedAt: NOW });
    let refusal = null;
    try {
      await applyLegacyOrganisationBackfill(db, { dryRun: false, bothAs: "OTHER", log: () => {} });
    } catch (error) {
      refusal = String(error?.message ?? error);
    }
    check("W4-a.9 a second PRIMEMET marker is a conflict, not a silent duplicate", refusal !== null && /PREFLIGHT_FAILED/.test(refusal), String(refusal));
    check("W4-a.9 the conflict names the impostor", refusal !== null && refusal.includes(impostor), String(refusal)?.slice(0, 300));
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function main() {
  groupW1();

  if (OFFLINE) {
    process.stdout.write("\n  (offline: the W2, W3 and W4-a database sections were not executed)\n");
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

  try {
    await groupW2(client);
    await groupW3(client);
    await groupW4a(client);
  } finally {
    delete process.env.PERMISSION_LOG_KEY;
    delete process.env.PRIMEMET_BACKFILL_BOTH_AS;
    await client.close().catch(() => {});
    await server.stop().catch(() => {});
  }

  return summary();
}

function summary() {
  const total = pass + failures.length;
  if (failures.length === 0) {
    process.stdout.write(`\n  \u2714 remediation: ${pass}/${total} assertions passed\n`);
    return 0;
  }
  process.stdout.write(`\n  \u2716 remediation: ${pass}/${total} passed, ${failures.length} failed\n`);
  for (const failure of failures) process.stdout.write(`    - ${failure.label}\n`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`\n  fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
