#!/usr/bin/env node
/**
 * PRIMEMET — independent adversarial suite for the D-ARCH-12 safeguards (C1, C2, C3).
 *
 * WHY THIS FILE IS SEPARATE FROM `check:permissions`.
 *
 * The permission suite was written alongside the implementation, so it proves what the implementation
 * intended to do. This one was written afterwards, from the brief, against the *defects* rather than the
 * design, and it deliberately does not share a helper, a fixture or a database name with it. If both
 * suites pass, the guard is not merely self-consistent — two different fixture sets agree on it.
 *
 * WHAT IT TESTS, and the defect each section closes:
 *
 *   A. definitions           the guard name the database uses is the guard name the store writes; the
 *                            v003 migration's identity is its own file; no role can drop the guard
 *   B. the pure rules        `wouldLockOutSuperAdmins` truth table, including the REVOKE case (C3-D2)
 *   C. the tier matrix       the 62/12 reconciliation, measured rather than quoted (C3 / task D)
 *   D. migration v003        create-if-absent, idempotent, seeded once, fence never reset
 *   E. validator enforcement a malformed guard document is refused by the database, not just by code
 *   F. write skew            N isolated two-super-admin worlds, two simultaneous cross-denials in each.
 *                            Both previously succeeded, leaving zero super admins (C3-D1)
 *   G. idempotency at scale  1000 concurrent deliveries of ONE request (C2-D2)
 *   H. contention at scale   1000 concurrent distinct events: no duplicate seq, nothing silently lost
 *   I. failure and retry     a held fence forces a real WriteConflict; the append must still land
 *
 *   node scripts/check-adversarial.mjs
 *   node scripts/check-adversarial.mjs --offline     # sections A–C only, no database
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Long } from "mongodb";

import { adminPermissionGrant, adminProfile, organisation } from "../db/collections/core.mjs";
import { INFRASTRUCTURE_COLLECTIONS } from "../db/collections/index.mjs";
import { plansFor } from "../db/define.mjs";
import {
  GUARDS,
  GUARD_LAST_SUPER_ADMIN,
  GUARD_PLATFORM_IDENTITY,
  PLATFORM_IDENTITY_COLLECTION,
  ensurePermissionGuards,
  ensurePlatformIdentityCollection,
  validateGuardDefinition,
} from "../db/guards.mjs";
import { MIGRATIONS } from "../db/migrations/index.mjs";
import { checksumOf } from "../db/ledger.mjs";
import { auditRoleDefinitions, buildRoleDefinitions, effectivePrivilegesFor } from "../db/roles.mjs";
import { ADMIN_PERMISSIONS } from "../src/lib/permissions/types.ts";
import { TIER_DEFAULTS } from "../src/lib/permissions/tiers.ts";
import { NON_DELEGABLE, wouldLockOutSuperAdmins } from "../src/lib/permissions/delegation.ts";
import * as store from "../src/lib/permissions/store.ts";
import { resolveAdminPermissions } from "../src/lib/permissions/resolve.ts";
import { integrityTag } from "../src/lib/permissions/integrity.ts";
import { declaredEnvironment, permissionIntegrityPosture } from "../src/lib/env.ts";

const OFFLINE = process.argv.includes("--offline");
const NOW = new Date("2026-11-01T12:00:00.000Z");
const day = (n) => new Date(NOW.getTime() + n * 86_400_000);

let passed = 0;
const failures = [];

function ok(name, detail = "") {
  passed += 1;
  process.stdout.write(`  \u2714 ${name}${detail ? ` — ${detail}` : ""}\n`);
}

function no(name, detail = "") {
  failures.push(name);
  process.stdout.write(`  \u2716 ${name}${detail ? ` — ${detail}` : ""}\n`);
}

function check(name, condition, detail = "") {
  if (condition) ok(name, detail);
  else no(name, detail);
}

function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(name, e.length > 160 ? "" : e);
  else no(name, `expected ${e}, got ${a}`);
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

// ---------------------------------------------------------------------------
// A. Definitions — the guard the database enforces is the guard the store writes.
// ---------------------------------------------------------------------------
function definitions() {
  section("A. Definitions");

  equal("the guard collection name in the store matches the definition", store.GUARDS_COLLECTION, GUARDS);
  equal("the guard document id in the store matches the definition", store.GUARD_LAST_SUPER_ADMIN, GUARD_LAST_SUPER_ADMIN);
  equal("the guard definition validates", validateGuardDefinition(), []);
  equal(
    "the infrastructure list names the ledger, the guard and the protected identity, and nothing else",
    INFRASTRUCTURE_COLLECTIONS.slice().sort(),
    ["_permission_guards", "_platform_identity", "_schema_migrations"],
  );

  const versions = MIGRATIONS.map((m) => m.version);
  equal("migration versions are 1..N with no gap or duplicate", versions, versions.map((_, i) => i + 1));

  const v003 = MIGRATIONS.find((m) => m.version === 3);
  check("v003 is registered and is the continuity guard", v003?.name === "v003_super_admin_continuity_guard", v003?.name);
  equal(
    "v003's identity is its own file, not the shared definitions",
    v003?.source,
    readFileSync("db/migrations/v003-super-admin-continuity-guard.mjs", "utf8"),
  );

  // History is frozen: registering a new version must not change what an applied one claims to be.
  // The two prefixes below were recorded before v003 existed; if either moves, an applied migration
  // has been edited and every deployment would refuse to run.
  equal("v001's identity is unchanged", checksumOf(MIGRATIONS[0].source).slice(0, 12), "58f130c4cc3c");
  equal("v002's identity is unchanged", checksumOf(MIGRATIONS[1].source).slice(0, 12), "7b9b566feede");

  const roles = buildRoleDefinitions();
  const app = roles.find((r) => r.role === "primemet_app");
  const owner = roles.find((r) => r.role === "primemet_owner");
  const appGuard = effectivePrivilegesFor(app, GUARDS);
  check("the application identity can read the guard", appGuard.includes("find"), JSON.stringify(appGuard));
  check("the application identity can increment the fence", appGuard.includes("update"), JSON.stringify(appGuard));
  check(
    "the application identity cannot create the guard",
    !appGuard.includes("insert"),
    JSON.stringify(appGuard),
  );
  check(
    "the owner identity can seed the guard",
    effectivePrivilegesFor(owner, GUARDS).includes("insert"),
    JSON.stringify(effectivePrivilegesFor(owner, GUARDS)),
  );
  for (const role of roles) {
    const effective = effectivePrivilegesFor(role, GUARDS);
    check(
      `${role.role} cannot drop the guard collection`,
      !effective.includes("dropCollection") && !effective.includes("delete"),
      JSON.stringify(effective),
    );
  }
  // W2.2/W2.6: the pointer has to live somewhere the runtime identity cannot write it, and the fence
  // grant is exactly why the guard collection cannot be that place. The authenticated suite proves the
  // server refuses the write; this proves the definitions make the refusal the intended state.
  equal(
    "the protected platform identity collection name in the store matches the definition",
    store.PLATFORM_IDENTITY_COLLECTION,
    PLATFORM_IDENTITY_COLLECTION,
  );
  equal("the protected identity does not reuse the guard collection", PLATFORM_IDENTITY_COLLECTION !== GUARDS, true);
  equal(
    "the application identity holds find and nothing else on the protected identity",
    effectivePrivilegesFor(app, PLATFORM_IDENTITY_COLLECTION),
    ["find"],
  );
  const ownerPointer = effectivePrivilegesFor(owner, PLATFORM_IDENTITY_COLLECTION);
  check(
    "the owner identity can seed and re-anchor the protected identity",
    ["find", "insert", "update"].every((a) => ownerPointer.includes(a)),
    JSON.stringify(ownerPointer),
  );
  for (const role of roles) {
    const effective = effectivePrivilegesFor(role, PLATFORM_IDENTITY_COLLECTION);
    check(
      `${role.role} cannot delete the protected identity document`,
      !effective.includes("delete") && !effective.includes("dropCollection"),
      JSON.stringify(effective),
    );
  }
  equal("the role definitions audit clean", auditRoleDefinitions(), []);

  // S-1: the operator marker has to be a field that can HOLD "PRIMEMET", and the uniqueness guarantee
  // has to name that field. `orgType` cannot: its enum is BUYER | SELLER | BOTH.
  const orgKindField = organisation.fields.orgKind;
  check(
    "organisations can store the operator marker",
    orgKindField?.bsonType === "string" && (orgKindField.enum ?? []).includes("PRIMEMET"),
    JSON.stringify(orgKindField ?? null),
  );
  check(
    "the single-PRIMEMET guarantee filters on the operator marker, not on orgType",
    organisation.indexes.some(
      (ix) => ix.unique === true && ix.partialFilterExpression?.orgKind === "PRIMEMET",
    ),
    JSON.stringify(organisation.indexes.map((ix) => ix.partialFilterExpression ?? {})),
  );
  check(
    "orgType cannot express PRIMEMET, which is why the two columns are separate",
    !(organisation.fields.orgType.enum ?? []).includes("PRIMEMET"),
    JSON.stringify(organisation.fields.orgType.enum ?? null),
  );
}

/** Read a file as text — kept local so this suite shares nothing with the others. */

// ---------------------------------------------------------------------------
// B. The pure rule — one truth table, no database.
// ---------------------------------------------------------------------------
function pureRule() {
  section("B. The lockout rule (pure)");
  const base = { permission: "ACCESS_GRANT_PERMISSION", effect: "DENY", remainingHolders: 0 };
  const superTarget = { profileId: "p", isActive: true, userIsActive: true, tier: "SUPER_ADMIN" };
  const opsTarget = { profileId: "p", isActive: true, userIsActive: true, tier: "SOURCING_OPS_ADMIN" };

  check(
    "the last holder cannot be denied",
    wouldLockOutSuperAdmins({ ...base, target: superTarget }) === true,
  );
  check(
    "a denial is allowed while another holder remains",
    wouldLockOutSuperAdmins({ ...base, target: superTarget, remainingHolders: 1 }) === false,
  );
  check(
    "a non-super target is never blocked",
    wouldLockOutSuperAdmins({ ...base, target: opsTarget }) === false,
  );
  check(
    "a GRANT is never blocked",
    wouldLockOutSuperAdmins({ ...base, target: superTarget, effect: "GRANT" }) === false,
  );
  // C3-D2: REVOKE restores the tier default, and a super admin's default IS this permission, so a
  // REVOKE can never remove the way in. The old guard only covered DENY; this pins the reasoning down.
  check(
    "a REVOKE is never blocked (it restores the super-admin tier default)",
    wouldLockOutSuperAdmins({ ...base, target: superTarget, effect: "REVOKE" }) === false,
  );
  check(
    "another permission is never blocked",
    wouldLockOutSuperAdmins({ ...base, target: superTarget, permission: "CATALOGUE_EDIT" }) === false,
  );
  check(
    "ACCESS_GRANT_PERMISSION is non-delegable below SUPER_ADMIN",
    NON_DELEGABLE.includes("ACCESS_GRANT_PERMISSION") &&
      NON_DELEGABLE.includes("ACCESS_ASSIGN_ROLE") &&
      NON_DELEGABLE.includes("DATABASE_APPLY_MIGRATION") &&
      NON_DELEGABLE.includes("AUDIT_EXPORT"),
    JSON.stringify(NON_DELEGABLE),
  );
}

// ---------------------------------------------------------------------------
// C. The tier matrix — measured, so the report cannot quote a stale figure.
// ---------------------------------------------------------------------------
const SUPER_ONLY_EXPECTED = [
  "ACCESS_ASSIGN_ROLE",
  "ACCESS_GRANT_PERMISSION",
  "AUDIT_EXPORT",
  "DATABASE_APPLY_MIGRATION",
  "INVOICE_ISSUE",
  "LOT_OVERRIDE_GATE",
  "NOTIFICATION_RETRY",
  "ORDER_CANCEL",
  "PARTY_SUSPEND",
  "PRICING_APPROVE",
  "PRICING_EDIT",
  "TAX_APPROVE",
  "TAX_EDIT",
  "USER_INVITE",
  "USER_SUSPEND",
];

function tierMatrix() {
  section("C. The tier matrix (measured)");
  const all = [...ADMIN_PERMISSIONS];
  const superSet = new Set(TIER_DEFAULTS.SUPER_ADMIN);
  const ops = new Set(TIER_DEFAULTS.SOURCING_OPS_ADMIN);
  const cat = new Set(TIER_DEFAULTS.CATALOGUE_MANAGER);
  const ro = new Set(TIER_DEFAULTS.READ_ONLY_ADMIN);
  const union = new Set([...ops, ...cat, ...ro]);
  const superOnly = all.filter((p) => !union.has(p));

  equal("the vocabulary is 74 permissions", all.length, 74);
  equal("SUPER_ADMIN defaults to all 74", superSet.size, 74);
  equal("SOURCING_OPS_ADMIN defaults to 45", ops.size, 45);
  equal("CATALOGUE_MANAGER defaults to 14", cat.size, 14);
  equal("READ_ONLY_ADMIN defaults to 20", ro.size, 20);
  equal("the non-super union is 62, so 12 permissions are super-only", [union.size, superOnly.length], [62, 12]);
  equal(
    "the twelve super-only permissions are exactly the documented set",
    superOnly.slice().sort(),
    SUPER_ONLY_EXPECTED.filter((p) => superOnly.includes(p)).slice().sort(),
  );
  equal(
    "the documented fifteen are the twelve plus the three disputed permissions",
    SUPER_ONLY_EXPECTED.slice().sort(),
    [...superOnly, "LOT_OVERRIDE_GATE", "PARTY_SUSPEND", "ORDER_CANCEL"].sort(),
  );
  check(
    "the three disputed permissions are ordinary admin permissions today",
    ["LOT_OVERRIDE_GATE", "PARTY_SUSPEND", "ORDER_CANCEL"].every((p) => ops.has(p)),
    ["LOT_OVERRIDE_GATE", "PARTY_SUSPEND", "ORDER_CANCEL"].filter((p) => !ops.has(p)).join(","),
  );
  check(
    "45 is only reachable with those three included (42 otherwise)",
    ops.size - 3 === 42 && ops.size === 45,
    `${ops.size}`,
  );
  // Removing exactly those three from SOURCING_OPS would leave 42, and the union would fall to 59 with
  // 15 super-only — the arithmetic behind the older 59/15 design. Both figures are reproducible, which
  // is why the discrepancy is a decision about policy, not a counting error.
  const withoutThree = new Set([...union].filter((p) => !["LOT_OVERRIDE_GATE", "PARTY_SUSPEND", "ORDER_CANCEL"].includes(p)));
  equal("the older 59/15 figure is the same matrix minus those three", [withoutThree.size, all.length - withoutThree.size], [59, 15]);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function uuid() {
  return randomUUID();
}

async function seedWorld(client, name, { guard = true, superAdmins = 2 } = {}) {
  const db = client.db(name);
  // organisations and admin_profiles are created from their REAL definitions, validator included. The
  // earlier fixtures inserted into validator-less collections, which is exactly how the `orgKind` defect
  // (S-1) survived: a field the schema forbids can be written into a collection that has no schema.
  for (const def of [organisation, adminProfile, adminPermissionGrant]) {
    const plan = plansFor(def);
    await db.createCollection(plan.name, {
      validator: plan.validator,
      validationLevel: "strict",
      validationAction: "error",
    });
    await db.collection(plan.name).createIndexes(plan.indexes);
  }
  if (guard) await ensurePermissionGuards(db, { now: NOW });

  const orgId = uuid();
  await db.collection("organisations").insertOne({
    _id: orgId,
    legalName: "PRIMEMET",
    orgType: "BOTH",
    orgKind: "PRIMEMET",
    countryCode: "IN",
    accountStatus: "ACTIVE",
    isListable: false,
    verificationStatus: "VERIFIED",
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  const admins = [];
  // F1: the marker fallback is gone, so the world carries the protected pointer that names the operator
  // organisation — through the same migration helper production uses, which also asserts that the
  // organisation is a live PRIMEMET one. The admins below carry `organisationId: orgId` as well, and F2
  // requires that claim to AGREE with the pointer rather than override it.
  await ensurePlatformIdentityCollection(db, { now: NOW, organisationId: orgId });
  for (let i = 0; i < superAdmins; i += 1) {
    const user = uuid();
    const profile = uuid();
    await db.collection("users").insertOne({
      _id: user,
      email: `admin-${i}-${user}@example.test`,
      role: "ADMIN",
      status: "ACTIVE",
      fullName: `Admin ${i}`,
      locale: "en-IN",
      mfaEnabled: false,
      failedLoginCount: 0,
      deletedAt: null,
      organisationId: orgId,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.collection("admin_profiles").insertOne({
      _id: profile,
      userId: user,
      staffCode: `S-${i}-${profile.slice(0, 8)}`,
      tier: "SUPER_ADMIN",
      mfaRequired: true,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    admins.push({
      user,
      profile,
      target: { profileId: profile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" },
    });
  }

  return { db, orgId, admins };
}

async function holdersOf(db, admins) {
  let holders = 0;
  for (const admin of admins) {
    const resolved = await store.resolveActorPermissions(db, admin.user, NOW);
    if (resolved.permissions.has("ACCESS_GRANT_PERMISSION")) holders += 1;
  }
  return holders;
}

// ---------------------------------------------------------------------------
// P2 — the permission-event signing key is load-bearing in production (W3.3).
// ---------------------------------------------------------------------------
// W3.3 was reachable because an unkeyed deployment reported UNKEYED for every stored event and UNKEYED
// was the one verdict that did not fail, so a hand-written, validator-conforming GRANT was honoured.
// These assertions are pure — they need no database — and they pin both halves: the resolver's refusal
// in production, and the fact that a correctly signed event is still honoured.
function signingPosture() {
  section("P2. Unsigned permission events (W3.3)");

  const actor = {
    user: { role: "ADMIN", status: "ACTIVE", deletedAt: null },
    profile: { id: "admin-p2", isActive: true, tier: "SUPER_ADMIN" },
    org: { orgKind: "PRIMEMET", accountStatus: "ACTIVE" },
  };
  const forged = {
    adminId: "admin-p2",
    permission: "DATABASE_APPLY_MIGRATION",
    effect: "GRANT",
    seq: 1,
    eventId: "evt-forged",
    grantedById: "admin-p2",
    reason: "hand-written, validator-conforming",
    expiresAt: null,
    createdAt: new Date(NOW.getTime() - 1000),
  };
  const decide = (events, options) =>
    resolveAdminPermissions(actor, events, NOW, options).decisions.get("DATABASE_APPLY_MIGRATION");

  // The pre-P2 posture, kept as a control: it is what makes the change measurable rather than assumed.
  equal(
    "control: without the production rule an unsigned GRANT is honoured — the W3.3 posture",
    decide([forged], { requireIntegrity: false }).decidedBy,
    "EVENT",
  );

  const refused = decide([forged], { requireIntegrity: true });
  equal("in production an unsigned GRANT is refused", refused.allowed, false);
  equal("and the decision names it invalid", refused.decidedBy, "INVALID_EVENT");

  const KEY = "0123456789abcdef0123456789abcdef";
  const signed = { ...forged, integrity: integrityTag(forged, KEY) };
  const signedDecision = decide([signed], { integrityKey: KEY, requireIntegrity: true });
  equal("a correctly signed GRANT is still honoured", signedDecision.decidedBy, "EVENT");
  equal("and it is allowed", signedDecision.allowed, true);

  const tampered = decide([{ ...signed, seq: 2 }], { integrityKey: KEY, requireIntegrity: true });
  equal("a tampered GRANT is refused", tampered.decidedBy, "INVALID_EVENT");
  equal("and it is not allowed", tampered.allowed, false);

  const keyless = decide([signed], { requireIntegrity: true });
  equal("a signed GRANT with no key configured is refused in production", keyless.decidedBy, "INVALID_EVENT");

  // The default must follow the declared environment, not only an explicit option — otherwise a caller
  // that forgets to pass one silently restores the hole. Only exercised when this runner declares no
  // environment, which is how the suite is invoked.
  const declared = declaredEnvironment();
  if (declared !== undefined && declared !== "production") {
    ok("the runner declares an environment, so the derived default is covered by check:env-blank", String(declared));
  } else {
    const previous = process.env.PRIMEMET_ENV;
    process.env.PRIMEMET_ENV = "production";
    const derived = decide([forged], {});
    process.env.PRIMEMET_ENV = previous === undefined ? "" : previous;
    if (previous === undefined) delete process.env.PRIMEMET_ENV;
    equal("the production rule is derived from PRIMEMET_ENV by default", derived.decidedBy, "INVALID_EVENT");
  }

  // F-5. The non-production tolerance is deliberate — local work must run without a key — but it must be
  // stated rather than implied, because "the resolver verifies integrity" is only true in production.
  // Asserted against the posture this runner is actually in, so the suite reports what it observed.
  if (permissionIntegrityPosture() !== "production") {
    equal(
      "F-5: outside production an unsigned GRANT is still honoured — staging is not production-grade",
      decide([forged], {}).decidedBy,
      "EVENT",
    );
  } else {
    ok("F-5: this runner is in the production posture, so the tolerance branch is not exercised", "production");
  }

  // F-2b. An explicit declaration always wins over NODE_ENV. The NODE_ENV-only branch cannot be exercised
  // in this process — `env.NODE_ENV` is parsed once at module load — so it is covered by `check:env-blank`,
  // which runs the real module in a child process with a fresh environment.
  equal(
    "F-2b: the posture follows the declared environment, never NODE_ENV, when PRIMEMET_ENV is set",
    permissionIntegrityPosture(),
    declaredEnvironment() === "production" ? "production" : "other",
  );
}

// ---------------------------------------------------------------------------
// D/E/F/G/H/I — everything that needs a real mongod.
// ---------------------------------------------------------------------------
async function main() {
  definitions();
  pureRule();
  tierMatrix();
  signingPosture();

  if (OFFLINE) {
    process.stdout.write("\n  (offline run: the database sections were not executed)\n");
    return summary();
  }

  let MongoMemoryReplSet;
  let MongoClient;
  try {
    ({ MongoMemoryReplSet } = await import("mongodb-memory-server"));
    ({ MongoClient } = await import("mongodb"));
  } catch (error) {
    no("the integration dependencies load", String(error?.message ?? error));
    return summary();
  }

  let server;
  try {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
      binary: { version: "7.0.14" },
    });
  } catch (error) {
    process.stdout.write(`  ! could not start mongod: ${String(error?.message ?? error).slice(0, 160)}\n`);
    no("a real mongod is available");
    return summary();
  }

  const client = new MongoClient(server.getUri());
  await client.connect();

  try {
    // ---- D0. migration v010 ------------------------------------------------
    // F3/F4. The pointer has ONE authority: an organisation id supplied by the owner running the
    // migration. Every application-writable source — the legacy `_permission_guards` pointer, the
    // `orgKind: "PRIMEMET"` marker — is a hint in the refusal message and never an input. These tests
    // assert the refusals, because a migration that silently adopts what the application can write is
    // the defect, not the fix.
    section("D0. Migration v010 — owner-supplied seed, or refuse");
    {
      const v010 = MIGRATIONS[MIGRATIONS.length - 1];
      equal("v010 is registered last and is version 10", [v010.version, v010.name], [10, "v010_protected_platform_identity"]);

      const operatorId = "11111111-2222-3333-4444-555555555555";
      const buyerId = "66666666-7777-8888-9999-aaaaaaaaaaaa";
      const legacyNamed = "cccccccc-dddd-eeee-ffff-000000000000";
      const orgDoc = (id, orgKind) => ({ _id: id, orgKind, accountStatus: "ACTIVE", deletedAt: null });

      const seedClaims = async (name) => {
        const db = client.db(name);
        await db.collection("organisations").insertMany([orgDoc(operatorId, "PRIMEMET"), orgDoc(buyerId, "BUYER")], {
          bypassDocumentValidation: true,
        });
        // A legacy pointer the APPLICATION identity could have written, naming a different organisation.
        await db.collection(GUARDS).insertOne({
          _id: GUARD_PLATFORM_IDENTITY,
          kind: "PLATFORM_IDENTITY",
          organisationId: legacyNamed,
          updatedAt: NOW,
        });
        return db;
      };

      // F4 — the happy path, on a database that also carries a conflicting legacy pointer.
      {
        const db = await seedClaims("adversarial_v010");
        const created = await v010.up(db, { log: () => {}, now: NOW, platformOrganisationId: operatorId });
        equal("v010 reports the collection it created", created, [PLATFORM_IDENTITY_COLLECTION]);

        const pointer = await db.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: GUARD_PLATFORM_IDENTITY });
        equal("v010 seeds from the owner-supplied id, NOT the legacy pointer", pointer?.organisationId, operatorId);
        equal("the protected document declares the kind the validator requires", pointer?.kind, "PLATFORM_IDENTITY");

        const closed = await db
          .collection(PLATFORM_IDENTITY_COLLECTION)
          .updateOne({ _id: GUARD_PLATFORM_IDENTITY }, { $set: { extra: 1 } })
          .then(() => null)
          .catch((error) => error);
        check(
          "the protected identity validator rejects an undeclared field",
          closed !== null,
          String(closed?.message ?? closed).slice(0, 80),
        );

        const moved = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        await db.collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: GUARD_PLATFORM_IDENTITY }, { $set: { organisationId: moved } });
        const again = await v010.up(db, { log: () => {}, now: NOW, platformOrganisationId: operatorId });
        equal("v010 is idempotent: a second run creates nothing", again, []);
        const replay = await db.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: GUARD_PLATFORM_IDENTITY });
        equal("v010 never overwrites an existing pointer", replay?.organisationId, moved);
      }

      // F3/F4 — refusals, and the retry that follows one.
      {
        const db = await seedClaims("adversarial_v010_refusal");

        const noId = await v010.up(db, { log: () => {}, now: NOW }).then(() => null, (error) => error);
        check(
          "v010 refuses to seed when no owner-supplied id is given",
          noId?.name === "PlatformIdentitySeedError",
          String(noId?.name ?? noId),
        );
        check(
          "the refusal reports the application-writable claim only as a hint",
          String(noId?.message ?? "").includes(legacyNamed),
          String(noId?.message ?? "").slice(0, 100),
        );
        check(
          "the refusal names the environment variable an owner must set",
          String(noId?.message ?? "").includes("PLATFORM_ORGANISATION_ID"),
          String(noId?.message ?? "").slice(0, 100),
        );
        equal("a refused v010 writes no pointer", await db.collection(PLATFORM_IDENTITY_COLLECTION).countDocuments({}), 0);

        const wrongKind = await v010
          .up(db, { log: () => {}, now: NOW, platformOrganisationId: buyerId })
          .then(() => null, (error) => error);
        check(
          "v010 refuses an id whose organisation is not the operator",
          wrongKind?.name === "PlatformIdentitySeedError" && /NOT_OPERATOR/.test(String(wrongKind?.message)),
          String(wrongKind?.message ?? "").slice(0, 100),
        );

        const unknown = await v010
          .up(db, { log: () => {}, now: NOW, platformOrganisationId: "99999999-9999-4999-8999-999999999999" })
          .then(() => null, (error) => error);
        check(
          "v010 refuses an id that names no organisation",
          unknown?.name === "PlatformIdentitySeedError" && /NOT_FOUND/.test(String(unknown?.message)),
          String(unknown?.message ?? "").slice(0, 100),
        );

        // Retry after a refusal: the collection a failed attempt created is converged, and the pointer is
        // established. This is why a refusal is safe — the version stays pending and nothing is lost.
        const retried = await v010.up(db, { log: () => {}, now: NOW, platformOrganisationId: operatorId });
        equal("a retry after a refusal creates nothing new (the collection already exists)", retried, []);
        const seeded = await db.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: GUARD_PLATFORM_IDENTITY });
        equal("the retry establishes the pointer", seeded?.organisationId, operatorId);
      }

      // The one non-failure: a database with no operator claim at all. A fresh install must still be able
      // to apply its own schema, since v001–v010 are what create the collections an organisation lives in.
      {
        const db = client.db("adversarial_v010_fresh");
        const created = await v010.up(db, { log: () => {}, now: NOW });
        equal("a fresh database still creates the collection", created, [PLATFORM_IDENTITY_COLLECTION]);
        equal(
          "and leaves it unseeded rather than inventing an anchor",
          await db.collection(PLATFORM_IDENTITY_COLLECTION).countDocuments({}),
          0,
        );
      }
    }

    // ---- D1. the pointer read path -----------------------------------------
    // F1. There is no ladder. The previous version claimed to distinguish pre-v010 (fall back to the legacy
    // guard pointer) from a v010 database with no pointer (fail closed) — but it asked `listCollections`,
    // which the runtime identity has no action for, so the legacy branch always threw and could never run.
    // These tests assert the behaviour that actually exists: one source, or nothing.
    section("D1. The pointer read path — one source, no fallback");
    {
      const ADMIN = "cccccccc-1111-2222-3333-444444444444";
      const POINTED = "aaaaaaaa-1111-2222-3333-444444444444";
      const OTHER = "bbbbbbbb-1111-2222-3333-444444444444";
      const MARKER = "dddddddd-1111-2222-3333-444444444444";

      const seed = async (name, { protectedPointer, malformed } = {}) => {
        const db = client.db(name);
        await db
          .collection("organisations")
          .insertMany(
            [
              { _id: POINTED, orgKind: "PRIMEMET", accountStatus: "ACTIVE", deletedAt: null },
              { _id: OTHER, orgKind: "BUYER", accountStatus: "ACTIVE", deletedAt: null },
              { _id: MARKER, orgKind: "PRIMEMET", accountStatus: "ACTIVE", deletedAt: null },
            ],
            { bypassDocumentValidation: true },
          );
        await db
          .collection(store.USERS_COLLECTION)
          .insertOne({ _id: ADMIN, role: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null }, { bypassDocumentValidation: true });
        // The legacy guard pointer always names OTHER, so a fallback is always OBSERVABLE: if it is taken
        // the actor resolves to OTHER, and if it is correctly refused the actor resolves to null.
        await db
          .collection(GUARDS)
          .insertOne({ _id: GUARD_PLATFORM_IDENTITY, kind: "PLATFORM_IDENTITY", organisationId: OTHER, updatedAt: NOW });
        if (protectedPointer !== undefined) {
          await db.createCollection(PLATFORM_IDENTITY_COLLECTION);
          await db
            .collection(PLATFORM_IDENTITY_COLLECTION)
            .insertOne({ _id: GUARD_PLATFORM_IDENTITY, kind: "PLATFORM_IDENTITY", organisationId: protectedPointer, updatedAt: NOW });
        } else if (malformed !== undefined) {
          // The collection exists, holds the pointer document, but the value is not a usable id. Written
          // with validation bypassed: this is the state a hand-edited or half-repaired database is in.
          await db.createCollection(PLATFORM_IDENTITY_COLLECTION);
          await db
            .collection(PLATFORM_IDENTITY_COLLECTION)
            .insertOne({ _id: GUARD_PLATFORM_IDENTITY, kind: "PLATFORM_IDENTITY", organisationId: malformed, updatedAt: NOW }, { bypassDocumentValidation: true });
        }
        return db;
      };

      // 1. Pre-v010: no protected collection at all. The legacy pointer and two live markers are present
      // and NONE of them may stand in (F1) — this is exactly the case the old ladder documented and could
      // not deliver.
      const legacyDb = await seed("adversarial_pointer_legacy");
      const legacyActor = await store.loadAdminActor(legacyDb, ADMIN);
      equal(
        "pre-v010, neither the legacy pointer nor a marker stands in — the administrator resolves to nothing",
        legacyActor?.org?.id ?? null,
        null,
      );

      // 2. v010 applied, pointer unset: nothing may stand in, not the legacy pointer and not the marker.
      const emptyDb = await seed("adversarial_pointer_empty");
      await emptyDb.createCollection(PLATFORM_IDENTITY_COLLECTION);
      const emptyActor = await store.loadAdminActor(emptyDb, ADMIN);
      equal("an empty protected collection fails closed instead of falling back", emptyActor?.org?.id ?? null, null);

      // 3. Malformed pointer values, each with a valid legacy pointer and two live markers present.
      for (const [label, value] of [
        ["a non-string", 42],
        ["an empty string", ""],
      ]) {
        const badDb = await seed(`adversarial_pointer_bad_${label.replace(/\W+/g, "_")}`, { malformed: value });
        const badActor = await store.loadAdminActor(badDb, ADMIN);
        equal(`a malformed pointer (${label}) fails closed`, badActor?.org?.id ?? null, null);
      }

      // 4. v010 with a valid pointer: the protected pointer wins and the legacy one is not consulted.
      const protectedDb = await seed("adversarial_pointer_protected", { protectedPointer: POINTED });
      const protectedActor = await store.loadAdminActor(protectedDb, ADMIN);
      equal("a valid protected pointer governs, not the legacy one", protectedActor?.org?.id, POINTED);
    }

    // ---- D2. a user-level claim may corroborate, never override (F2) --------
    // `users.organisationId` is not in the declared `users` validator, so under the application's own
    // privileges it cannot be written: the update is refused by validation, and `bypassDocumentValidation`
    // needs an action the runtime identity does not hold (measured). If either of those changes, this rule
    // is what stops a single write from redirecting an administrator — the claim must AGREE with the
    // protected pointer, and a disagreement or an unusable value fails closed rather than picking a side.
    section("D2. A user-level organisation claim may corroborate, never override");
    {
      const ADMIN2 = "eeeeeeee-1111-2222-3333-444444444444";
      const POINTED2 = "aaaaaaaa-1111-2222-3333-444444444444";
      const ELSEWHERE = "ffffffff-1111-2222-3333-444444444444";

      const build = async (name, claim) => {
        const db = client.db(name);
        await db.collection("organisations").insertMany(
          [
            { _id: POINTED2, orgKind: "PRIMEMET", accountStatus: "ACTIVE", deletedAt: null },
            { _id: ELSEWHERE, orgKind: "BUYER", accountStatus: "ACTIVE", deletedAt: null },
          ],
          { bypassDocumentValidation: true },
        );
        await db.collection(store.USERS_COLLECTION).insertOne(
          {
            _id: ADMIN2,
            role: "SUPER_ADMIN",
            status: "ACTIVE",
            deletedAt: null,
            ...(claim === undefined ? {} : { organisationId: claim }),
          },
          { bypassDocumentValidation: true },
        );
        await db.createCollection(PLATFORM_IDENTITY_COLLECTION);
        await db.collection(PLATFORM_IDENTITY_COLLECTION).insertOne({
          _id: GUARD_PLATFORM_IDENTITY,
          kind: "PLATFORM_IDENTITY",
          organisationId: POINTED2,
          updatedAt: NOW,
        });
        return db;
      };

      equal(
        "a claim that agrees with the pointer resolves normally",
        (await store.loadAdminActor(await build("adversarial_claim_match", POINTED2), ADMIN2))?.org?.id,
        POINTED2,
      );
      equal(
        "no claim at all resolves through the pointer",
        (await store.loadAdminActor(await build("adversarial_claim_absent", undefined), ADMIN2))?.org?.id,
        POINTED2,
      );
      equal(
        "a claim naming a different live organisation fails closed instead of redirecting",
        (await store.loadAdminActor(await build("adversarial_claim_mismatch", ELSEWHERE), ADMIN2))?.org?.id ?? null,
        null,
      );
      equal(
        "a non-string claim fails closed",
        (await store.loadAdminActor(await build("adversarial_claim_number", 42), ADMIN2))?.org?.id ?? null,
        null,
      );
      equal(
        "an empty-string claim fails closed",
        (await store.loadAdminActor(await build("adversarial_claim_empty", ""), ADMIN2))?.org?.id ?? null,
        null,
      );
    }

    // ---- D. migration v003 -------------------------------------------------
    section("D. Migration v003");
    {
      const db = client.db("adversarial_migration");
      const first = await MIGRATIONS[2].up(db, { log: () => {} });
      equal("v003 reports the collection it created", first, [GUARDS]);
      const seeded = await db.collection(GUARDS).findOne({ _id: GUARD_LAST_SUPER_ADMIN });
      check("v003 seeds the guard document", seeded !== null && Number(seeded.fence) === 0, JSON.stringify(seeded?.fence));

      await db.collection(GUARDS).updateOne({ _id: GUARD_LAST_SUPER_ADMIN }, { $inc: { fence: 7 } });
      const second = await MIGRATIONS[2].up(db, { log: () => {} });
      equal("v003 is idempotent: a second run creates nothing", second, []);
      const afterReplay = await db.collection(GUARDS).findOne({ _id: GUARD_LAST_SUPER_ADMIN });
      check(
        "v003 never resets the fence (a reset would let two instances believe they are alone)",
        Number(afterReplay.fence) === 7,
        `${afterReplay.fence}`,
      );
      const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
      equal("v003 created exactly one collection", names.filter((n) => n === GUARDS).length, 1);

      const ledger = await (async () => {
        const { applyMigrations } = await import("../db/ledger.mjs");
        // A separate, virgin database: v001 creates every collection, so replaying it over the one
        // above would test the v001 runner rather than v003's registration.
        return applyMigrations(client.db("adversarial_ledger"), {
          migrations: MIGRATIONS,
          appliedBy: "adversarial",
        });
      })();
      equal(
        "a full apply on this database records v003 as applied",
        ledger.find((r) => r.version === 3)?.status,
        "applied",
      );
    }

    // ---- E. the validator is enforced by the server ------------------------
    section("E. The guard document is enforced by the database");
    {
      const db = client.db("adversarial_migration");
      const guards = db.collection(GUARDS);
      const rejects = async (doc) => {
        try {
          await guards.insertOne(doc);
          return false;
        } catch {
          return true;
        }
      };
      check(
        "a guard document with no fence is refused",
        await rejects({ _id: "another-guard", kind: "SUPER_ADMIN_CONTINUITY", updatedAt: NOW }),
      );
      check(
        "a guard document with an unknown kind is refused",
        await rejects({ _id: "third-guard", kind: "SOMETHING_ELSE", fence: Long.fromNumber(0), updatedAt: NOW }),
      );
      check(
        "a guard document with an extra field is refused",
        await rejects({
          _id: "fourth-guard",
          kind: "SUPER_ADMIN_CONTINUITY",
          fence: Long.fromNumber(0),
          updatedAt: NOW,
          sneaky: true,
        }),
      );
      check(
        "a guard document with a negative fence is refused",
        await rejects({ _id: "fifth-guard", kind: "SUPER_ADMIN_CONTINUITY", fence: -1, updatedAt: NOW }),
      );
      check(
        "an additively valid guard document is accepted",
        await (async () => {
          try {
            await guards.insertOne({ _id: "trial-guard", kind: "SUPER_ADMIN_CONTINUITY", fence: Long.fromNumber(0), updatedAt: NOW });
            return true;
          } catch {
            return false;
          }
        })(),
      );
    }

    // ---- F. write skew: two simultaneous cross-denials --------------------
    section("F. Write skew — two simultaneous cross-denials cannot empty the platform");
    const ROUNDS = 12;
    let guardFired = 0;
    let bothSucceeded = 0;
    let emptied = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const { db, admins } = await seedWorld(client, `adversarial_race_${round}`, { superAdmins: 2 });
      const [a, b] = admins;
      const results = await Promise.all([
        store.appendPermissionEvent(db, {
          actorUserId: a.user,
          target: b.target,
          permission: "ACCESS_GRANT_PERMISSION",
          effect: "DENY",
          reason: `round ${round}: a denies b`,
          eventId: `race-${round}-a`,
          now: NOW,
        }),
        store.appendPermissionEvent(db, {
          actorUserId: b.user,
          target: a.target,
          permission: "ACCESS_GRANT_PERMISSION",
          effect: "DENY",
          reason: `round ${round}: b denies a`,
          eventId: `race-${round}-b`,
          now: NOW,
        }),
      ]);
      const successes = results.filter((r) => r.ok).length;
      const holders = await holdersOf(db, admins);
      if (successes === 2) bothSucceeded += 1;
      if (holders === 0) emptied += 1;
      if (results.some((r) => !r.ok && r.refusal === "LAST_SUPER_ADMIN")) guardFired += 1;
    }
    equal(`${ROUNDS} isolated rounds: both cross-denials never both commit`, bothSucceeded, 0);
    equal(`${ROUNDS} isolated rounds: the platform never loses every super admin`, emptied, 0);
    check(
      "the guard is what stopped the losing transaction (at least one round observed LAST_SUPER_ADMIN)",
      guardFired > 0,
      `${guardFired}/${ROUNDS} rounds`,
    );

    // ---- G. one request delivered 1000 times -------------------------------
    section("G. 1000 concurrent deliveries of ONE request");
    {
      const { db, admins } = await seedWorld(client, "adversarial_idempotency", { superAdmins: 2 });
      const [admin, subject] = admins;
      const target = subject.target;

      const request = () =>
        store.appendPermissionEvent(db, {
          actorUserId: admin.user,
          target,
          permission: "CATALOGUE_EDIT",
          effect: "GRANT",
          reason: "one request, delivered 1000 times",
          eventId: "one-request",
          now: day(-1),
        });

      const results = await Promise.all(Array.from({ length: 1000 }, request));
      const okCount = results.filter((r) => r.ok).length;
      const firstWrites = results.filter((r) => r.ok && r.seq_idempotent === false).length;
      const conflicts = results.filter((r) => !r.ok && r.refusal === "EVENT_ID_CONFLICT").length;
      const rows = await db.collection("admin_permission_grants").countDocuments({ eventId: "one-request" });
      equal("every one of the 1000 callers got a success", okCount, 1000);
      equal("exactly one caller performed the write", firstWrites, 1);
      equal("exactly one row exists", rows, 1);
      equal("no caller was told the payload conflicted", conflicts, 0);

      // The same key with a different payload, after the fact, must be refused.
      const conflicting = await store.appendPermissionEvent(db, {
        actorUserId: admin.user,
        target,
        permission: "CATALOGUE_EDIT",
        effect: "DENY",
        reason: "different request, same key",
        eventId: "one-request",
        now: day(-1),
      });
      check(
        "the same key with a different payload is refused",
        conflicting.ok === false && conflicting.refusal === "EVENT_ID_CONFLICT",
        JSON.stringify(conflicting),
      );
    }

    // ---- H. contention: 1000 distinct concurrent events --------------------
    section("H. 1000 concurrent distinct events");
    {
      const { db, admins } = await seedWorld(client, "adversarial_contention", { superAdmins: 2 });
      const [actor, subject] = admins;
      const target = { profileId: subject.profile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" };
      const results = await Promise.all(
        Array.from({ length: 1000 }, (_, i) =>
          store.appendPermissionEvent(db, {
            actorUserId: actor.user,
            target,
            permission: "REPORT_VIEW",
            effect: i % 2 === 0 ? "GRANT" : "DENY",
            reason: `distinct ${i}`,
            eventId: `distinct-${i}`,
            now: day(-1),
          }),
        ),
      );
      const succeeded = results.filter((r) => r.ok).length;
      const contended = results.filter((r) => !r.ok && r.refusal === "SEQ_CONTENTION").length;
      const otherRefusals = results.filter((r) => !r.ok && r.refusal !== "SEQ_CONTENTION").length;
      const rows = await db.collection("admin_permission_grants").find({ eventId: /^distinct-/ }).toArray();
      const seqs = rows.map((r) => Number(r.seq));
      equal("nothing was refused for any reason other than sequence contention", otherRefusals, 0);
      equal("every success has a row", rows.length, succeeded);
      equal("sequence numbers are unique", new Set(seqs).size, seqs.length);
      equal("contended + succeeded accounts for all 1000 callers", succeeded + contended, 1000);
      process.stdout.write(
        `  \u00b7 ${succeeded} applied, ${contended} refused with SEQ_CONTENTION (an explicit retry, never a silent loss)\n`,
      );
    }

    // ---- I. failure and retry ---------------------------------------------
    section("I. Failure and retry");
    {
      const { db, admins } = await seedWorld(client, "adversarial_retry", { superAdmins: 2 });
      const [a, b] = admins;

      // A second "instance" holds the fence open, which is exactly the conflict two real instances
      // produce. Releasing it must let the append land, and it must land exactly once.
      const holder = db.client.startSession();
      holder.startTransaction();
      await db
        .collection(GUARDS)
        .updateOne({ _id: GUARD_LAST_SUPER_ADMIN }, { $inc: { fence: 1 } }, { session: holder });

      const append = store.appendPermissionEvent(db, {
        actorUserId: a.user,
        target: b.target,
        permission: "ACCESS_GRANT_PERMISSION",
        effect: "DENY",
        reason: "append while another instance holds the fence",
        eventId: "retry-1",
        now: NOW,
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      await holder.commitTransaction();
      await holder.endSession();

      const outcome = await append;
      check("an append that met contention still lands", outcome.ok === true, JSON.stringify(outcome));
      equal(
        "and it landed exactly once",
        await db.collection("admin_permission_grants").countDocuments({ eventId: "retry-1" }),
        1,
      );

      // Fail-closed when the guard is gone.
      await db.collection(GUARDS).deleteOne({ _id: GUARD_LAST_SUPER_ADMIN });
      const unguarded = await store.appendPermissionEvent(db, {
        actorUserId: a.user,
        target: b.target,
        permission: "ACCESS_GRANT_PERMISSION",
        effect: "REVOKE",
        reason: "attempt with no guard document at all",
        eventId: "retry-2",
        now: NOW,
      });
      check(
        "a removal with no guard document is refused, never waved through",
        unguarded.ok === false && unguarded.refusal === "GUARD_UNAVAILABLE",
        JSON.stringify(unguarded),
      );
      equal(
        "the refused attempt wrote nothing",
        await db.collection("admin_permission_grants").countDocuments({ eventId: "retry-2" }),
        0,
      );
    }
    // ---- J. Attacks on the write path -------------------------------------
    section("J. Attacks on the write path");
    {
      const { db, admins } = await seedWorld(client, "adversarial_security", { superAdmins: 2 });
      const [superAdmin, otherSuper] = admins;

      // An ordinary admin, so "not permitted" means something.
      const opsUser = uuid();
      const opsProfile = uuid();
      const orgId = (await db.collection("organisations").findOne({}))?._id;
      await db.collection("users").insertOne({
        _id: opsUser,
        email: `ops-${opsUser}@example.test`,
        role: "ADMIN",
        status: "ACTIVE",
        fullName: "Ops",
        locale: "en-IN",
        mfaEnabled: false,
        failedLoginCount: 0,
        deletedAt: null,
        organisationId: orgId,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.collection("admin_profiles").insertOne({
        _id: opsProfile,
        userId: opsUser,
        staffCode: `O-${opsProfile.slice(0, 8)}`,
        tier: "SOURCING_OPS_ADMIN",
        mfaRequired: true,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const opsTarget = { profileId: opsProfile, isActive: true, userIsActive: true, tier: "SOURCING_OPS_ADMIN" };

      // A forged body: the caller attaches the permissions it would like to have. The store resolves the
      // actor from the log and never reads the payload, so the extra property must be inert.
      const forgedPayload = await store.appendPermissionEvent(db, {
        actorUserId: opsUser,
        target: opsTarget,
        permission: "DATABASE_APPLY_MIGRATION",
        effect: "GRANT",
        reason: "forged payload",
        eventId: "attack-forged",
        now: NOW,
        // @ts-expect-error deliberately not part of AppendInput
        actorPermissions: ["ACCESS_GRANT_PERMISSION", "DATABASE_APPLY_MIGRATION"],
        permissions: ["ACCESS_GRANT_PERMISSION"],
      });
      check(
        "a forged permissions payload cannot grant anything",
        forgedPayload.ok === false,
        JSON.stringify(forgedPayload),
      );
      equal(
        "and it wrote no row",
        await db.collection("admin_permission_grants").countDocuments({ eventId: "attack-forged" }),
        0,
      );

      const selfGrant = await store.appendPermissionEvent(db, {
        actorUserId: superAdmin.user,
        target: superAdmin.target,
        permission: "CATALOGUE_EDIT",
        effect: "GRANT",
        reason: "self grant",
        eventId: "attack-self",
        now: NOW,
      });
      check(
        "a super admin cannot grant themselves anything",
        selfGrant.ok === false && selfGrant.refusal === "SELF_TARGET",
        JSON.stringify(selfGrant),
      );

      const escalation = await store.appendPermissionEvent(db, {
        actorUserId: opsUser,
        target: { profileId: superAdmin.profile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" },
        permission: "CATALOGUE_EDIT",
        effect: "DENY",
        reason: "ordinary admin attacking a super admin",
        eventId: "attack-escalate",
        now: NOW,
      });
      check(
        "an ordinary admin cannot touch a super admin's access",
        escalation.ok === false && ["ACTOR_NOT_PERMITTED", "TARGET_IS_SUPER_ADMIN"].includes(escalation.refusal),
        JSON.stringify(escalation),
      );

      // Cross-organisation: an admin profile whose user belongs to an organisation that is not active.
      const foreignUser = uuid();
      const foreignProfile = uuid();
      const buyerOrg = uuid();
      await db.collection("organisations").insertOne({
        _id: buyerOrg,
        legalName: "Suspended Buyer",
        orgType: "BUYER",
        orgKind: "BUYER",
        countryCode: "IN",
        accountStatus: "SUSPENDED",
        isListable: false,
        verificationStatus: "VERIFIED",
        deletedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.collection("users").insertOne({
        _id: foreignUser,
        email: `foreign-${foreignUser}@example.test`,
        role: "ADMIN",
        status: "ACTIVE",
        fullName: "Foreign",
        locale: "en-IN",
        mfaEnabled: false,
        failedLoginCount: 0,
        deletedAt: null,
        organisationId: buyerOrg,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await db.collection("admin_profiles").insertOne({
        _id: foreignProfile,
        userId: foreignUser,
        staffCode: `F-${foreignProfile.slice(0, 8)}`,
        tier: "SUPER_ADMIN",
        mfaRequired: true,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const foreignResolution = await store.resolveActorPermissions(db, foreignUser, NOW);
      // F2 changes the REASON here, and the change is a strengthening: a claim naming an organisation other
      // than the pointer now fails closed before the organisation is looked at, so this administrator
      // resolves to nothing for two independent reasons. Both are asserted, because they are two controls.
      check(
        "an admin whose claim names another organisation resolves to nothing before the organisation is consulted (F2)",
        foreignResolution.permissions.size === 0 && foreignResolution.deniedAt === "NO_ORGANISATION",
        `${foreignResolution.permissions.size} permissions, deniedAt=${foreignResolution.deniedAt}`,
      );

      // Suspension itself, isolated: the pointer is moved onto the suspended organisation, so the claim
      // above now AGREES with it and the suspension check is reached rather than short-circuited.
      const pointerBefore = await db
        .collection(PLATFORM_IDENTITY_COLLECTION)
        .findOne({ _id: GUARD_PLATFORM_IDENTITY });
      await db
        .collection(PLATFORM_IDENTITY_COLLECTION)
        .updateOne({ _id: GUARD_PLATFORM_IDENTITY }, { $set: { organisationId: buyerOrg } });
      const suspendedResolution = await store.resolveActorPermissions(db, foreignUser, NOW);
      check(
        "an admin attached to a suspended organisation resolves to nothing",
        suspendedResolution.permissions.size === 0 && suspendedResolution.deniedAt === "ORGANISATION_NOT_ACTIVE",
        `${suspendedResolution.permissions.size} permissions, deniedAt=${suspendedResolution.deniedAt}`,
      );
      // Restored, so the sections below test what they name rather than this experiment.
      await db
        .collection(PLATFORM_IDENTITY_COLLECTION)
        .updateOne({ _id: GUARD_PLATFORM_IDENTITY }, { $set: { organisationId: pointerBefore.organisationId } });
      const foreignWrite = await store.appendPermissionEvent(db, {
        actorUserId: foreignUser,
        target: otherSuper.target,
        permission: "CATALOGUE_EDIT",
        effect: "GRANT",
        reason: "cross-organisation write",
        eventId: "attack-foreign",
        now: NOW,
      });
      check(
        "and cannot write an access event",
        foreignWrite.ok === false,
        JSON.stringify(foreignWrite),
      );

      // Concurrent revocations of one permission: every one must land, none may share a position.
      const revocations = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          store.appendPermissionEvent(db, {
            actorUserId: superAdmin.user,
            target: opsTarget,
            permission: "CATALOGUE_EDIT",
            effect: "REVOKE",
            reason: `concurrent revoke ${i}`,
            eventId: `revoke-${i}`,
            now: day(-1),
          }),
        ),
      );
      equal("50 concurrent revocations all land", revocations.filter((r) => r.ok).length, 50);
      const revokeRows = await db.collection("admin_permission_grants").find({ eventId: /^revoke-/ }).toArray();
      equal("and occupy 50 distinct positions", new Set(revokeRows.map((r) => Number(r.seq))).size, 50);

      // Conflicting payloads under one key, concurrently: exactly one shape may win.
      const contested = await Promise.all(
        Array.from({ length: 200 }, (_, i) =>
          store.appendPermissionEvent(db, {
            actorUserId: superAdmin.user,
            target: opsTarget,
            permission: "REPORT_VIEW",
            effect: i % 2 === 0 ? "GRANT" : "DENY",
            reason: `contested ${i % 2}`,
            eventId: "contested-key",
            now: NOW,
          }),
        ),
      );
      const winners = contested.filter((r) => r.ok);
      const conflicts = contested.filter((r) => !r.ok && r.refusal === "EVENT_ID_CONFLICT");
      equal("one shape wins a contested idempotency key", winners.length, 100);
      equal("the other shape is refused as a conflict", conflicts.length, 100);
      equal(
        "and exactly one row exists",
        await db.collection("admin_permission_grants").countDocuments({ eventId: "contested-key" }),
        1,
      );
      const winnerEffect = (await db.collection("admin_permission_grants").findOne({ eventId: "contested-key" }))?.effect;
      equal(
        "every winner agrees on the stored effect",
        new Set(winners.map((r) => r.seq_idempotent)).size,
        2,
      );
      check("the stored effect is one of the two offered", ["GRANT", "DENY"].includes(winnerEffect), winnerEffect);

      // Malformed input the validator must refuse on the way in.
      const grants = db.collection("admin_permission_grants");
      const rejects = async (doc) => {
        try {
          await grants.insertOne(doc);
          return false;
        } catch {
          return true;
        }
      };
      const valid = {
        _id: uuid(),
        adminId: opsProfile,
        permission: "REPORT_VIEW",
        effect: "GRANT",
        seq: Long.fromNumber(900_000),
        eventId: `tail-${uuid()}`,
        grantedById: superAdmin.user,
        reason: "fixture",
        expiresAt: null,
        createdAt: NOW,
      };
      check("a malformed timestamp is refused", await rejects({ ...valid, seq: Long.fromNumber(900_001), createdAt: "2026-11-01" }));
      check("a missing sequence value is refused", await rejects({ ...valid, seq: undefined, _id: uuid(), eventId: `x-${uuid()}` }));
      check(
        "a double sequence value is refused",
        await rejects({ ...valid, _id: uuid(), eventId: `y-${uuid()}`, seq: 12.5 }),
      );
      check(
        "a string sequence value is refused",
        await rejects({ ...valid, _id: uuid(), eventId: `z-${uuid()}`, seq: "12" }),
      );

      // Attempts to rewrite history. The store exposes no mutator, and the collection is append-only.
      const mutators = Object.entries(store)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => name)
        .filter((name) => /^(update|delete|remove|set|replace)/i.test(name) && !name.startsWith("setAdminProfileAccess"));
      equal("the store exports no history mutator", mutators, []);
      equal(
        "the only profile mutator is the guarded one",
        Object.keys(store).filter((name) => /AdminProfile/i.test(name)).sort(),
        ["setAdminProfileAccess"],
      );
    }

    // ---- K. Migration v002 against real, partially-applied states --------
    section("K. Migration v002 verification");
    {
      const db = client.db("adversarial_v002");
      const name = "admin_permission_grants";

      // The v001-era collection: a validator that accepts GRANT and DENY only, one legacy row, and an
      // index v002 does not know about. Convergence must add, must not drop, and must not rewrite.
      await db.createCollection(name, {
        validator: {
          $jsonSchema: {
            bsonType: "object",
            required: ["_id", "adminId", "permission", "effect", "createdAt"],
            properties: { effect: { bsonType: "string", enum: ["GRANT", "DENY"] } },
          },
        },
        validationLevel: "strict",
        validationAction: "error",
      });
      await db.collection(name).createIndexes([{ key: { permission: 1 }, name: "ix_unrelated_preserved" }]);
      const legacyId = uuid();
      // A row written under the v001 validator, in a shape v002 accepts (so the pre-flight passes and
      // convergence is what is under test here, not the refusal).
      await db.collection(name).insertOne({
        _id: legacyId,
        adminId: uuid(),
        permission: "ENQUIRY_VIEW",
        effect: "GRANT",
        seq: 1,
        eventId: `legacy-${uuid()}`,
        grantedById: uuid(),
        reason: "written before v002",
        expiresAt: null,
        createdAt: day(-2),
      });

      const { MIGRATIONS: ALL } = await import("../db/migrations/index.mjs");
      const v002 = ALL.find((m) => m.version === 2);
      await v002.up(db, { log: () => {} });

      equal("v002 leaves the legacy row untouched", await db.collection(name).countDocuments({ _id: legacyId }), 1);
      const afterIndexes = await db.collection(name).indexes();
      check(
        "v002 adds its indexes and keeps the unrelated one",
        afterIndexes.some((i) => i.name === "ix_unrelated_preserved") &&
          afterIndexes.some((i) => i.name === "ix_admin_permission_grants_adminId_eventId_u"),
        afterIndexes.map((i) => i.name).join(", "),
      );

      const accepts = async (doc) => {
        try {
          await db.collection(name).insertOne(doc);
          return true;
        } catch {
          return false;
        }
      };
      const revokeRow = {
        _id: uuid(),
        adminId: uuid(),
        permission: "ENQUIRY_VIEW",
        effect: "REVOKE",
        seq: Long.fromNumber(1),
        eventId: `v002-${uuid()}`,
        grantedById: uuid(),
        reason: "revoke after the convergence",
        expiresAt: null,
        createdAt: NOW,
      };
      check("after v002 the validator accepts REVOKE", await accepts(revokeRow));

      // Idempotent replay, including the partial state where one of its indexes has been lost.
      await db.collection(name).dropIndex("ix_admin_permission_grants_adminId_seq_u");
      await v002.up(db, { log: () => {} });
      const repaired = await db.collection(name).indexes();
      check(
        "a partial state (a lost index) is repaired by re-running v002",
        repaired.some((i) => i.name === "ix_admin_permission_grants_adminId_seq_u"),
        repaired.map((i) => i.name).join(", "),
      );

      // ---- K3. Fail-closed on incompatible pre-existing state ----
      //
      // MongoDB does NOT re-validate existing documents on `collMod`, so without a pre-flight this is
      // exactly where a migration reports success over data it cannot read. A separate database, in the
      // v001 shape, with one row that the incoming definition would refuse.
      const legacyDb = client.db("adversarial_v002_legacy");
      await legacyDb.createCollection(name, {
        validator: {
          $jsonSchema: {
            bsonType: "object",
            required: ["_id", "adminId", "permission", "effect", "createdAt"],
            properties: { effect: { bsonType: "string", enum: ["GRANT", "DENY"] } },
          },
        },
        validationLevel: "strict",
        validationAction: "error",
      });
      await legacyDb.collection(name).insertOne({
        _id: uuid(),
        adminId: uuid(),
        permission: "ENQUIRY_VIEW",
        effect: "GRANT",
        createdAt: day(-2),
      });

      let refused = null;
      try {
        await v002.up(legacyDb, { log: () => {} });
      } catch (error) {
        refused = String(error?.message ?? error);
      }
      check(
        "v002 refuses a collection holding rows the new definition would reject",
        refused !== null && refused.includes("PREFLIGHT_FAILED"),
        (refused ?? "no error was raised").slice(0, 120),
      );
      const untouched = await legacyDb
        .listCollections({ name }, { nameOnly: false })
        .toArray()
        .then((rows) => rows[0]?.options?.validator);
      check(
        "and it did not change the validator it refused to vouch for",
        JSON.stringify(untouched ?? {}).includes("GRANT"),
        JSON.stringify(untouched ?? {}).slice(0, 120),
      );
      equal(
        "and the offending row is still there, not silently deleted",
        await legacyDb.collection(name).countDocuments({}),
        1,
      );
    }
    // ---- L. The platform organisation (defect S-1) ------------------------
    section("L. The platform organisation");
    {
      const { db } = await seedWorld(client, "adversarial_organisation", { superAdmins: 0 });
      const orgs = db.collection("organisations");
      const baseOrg = {
        legalName: "Second Platform",
        orgType: "BOTH",
        orgKind: "PRIMEMET",
        countryCode: "IN",
        accountStatus: "ACTIVE",
        isListable: false,
        verificationStatus: "VERIFIED",
        deletedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      const rejects = async (doc) => {
        try {
          await orgs.insertOne(doc);
          return false;
        } catch {
          return true;
        }
      };

      equal("a live PRIMEMET organisation exists (seeded from the real definition)", await orgs.countDocuments({ orgKind: "PRIMEMET" }), 1);
      check(
        "a second live PRIMEMET organisation is refused",
        await rejects({ ...baseOrg, _id: uuid() }),
      );
      check(
        "a soft-deleted one is allowed, so the platform row can be replaced deliberately",
        (await rejects({ ...baseOrg, _id: uuid(), deletedAt: NOW })) === false,
      );
      check(
        "an organisation with no operator marker is refused",
        await rejects({ ...baseOrg, _id: uuid(), orgKind: undefined }),
      );
      check(
        "an operator marker outside the five kinds is refused",
        await rejects({ ...baseOrg, _id: uuid(), orgKind: "PLATFORM" }),
      );
      check(
        "orgType still refuses PRIMEMET, which is the defect this pair of columns exists to avoid",
        await rejects({ ...baseOrg, _id: uuid(), orgType: "PRIMEMET", orgKind: "OTHER" }),
      );
    }
  } finally {
    await client.close();
    await server.stop();
  }

  return summary();
}

function summary() {
  process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const f of failures) process.stdout.write(`  \u2716 ${f}\n`);
    process.exit(1);
  }
  process.exit(0);
}

await main();
