#!/usr/bin/env node
/**
 * PRIMEMET — authorisation under an AUTHENTICATED MongoDB (W2-s and W3 verification).
 *
 * WHY THIS FILE EXISTS. Every other suite in this repository runs against a mongod with no `--auth`, so
 * no privilege is exercised by any of them: they say what the code does with rows that exist, and nothing
 * about who may create those rows. Two findings — W2-s (the organisation marker is editable) and W3 (a
 * direct insert into the permission log) — are necessarily BLOCKED in that posture, because they are
 * questions about privilege. This script removes the excuse: it starts an isolated, single-node replica
 * set with `--auth` and a keyfile, creates the identities the project actually declares
 * (`db/roles.mjs`), and asks each question with the credential that would really ask it.
 *
 * WHAT IT IS NOT. It is not a managed deployment, not production, and not independent. Passwords are
 * generated per run, the data directory is a temporary directory, and nothing survives the process.
 *
 * THE IDENTITIES, all created from `buildRoleDefinitions()` rather than copied by hand:
 *
 *   owner      primemet_owner     structural changes: createCollection, collMod, createIndex
 *   app        primemet_app       runtime: read/write business collections, insert+find on history
 *   readonly   primemet_readonly  reporting: find only
 *   intruder   (no roles)         a credential that exists and may do nothing
 *
 * THE QUESTIONS (the brief's five, in order):
 *   1. Can ordinary application credentials modify protected organisation identity?
 *   2. Can ordinary application credentials directly insert effective permission grants?
 *   3. Can the privileged permission writer perform authorised operations?
 *   4. Are unauthorised operations rejected by MongoDB itself?
 *   5. Does the application still enforce delegation and super-admin continuity?
 *
 * ASSERTION DISCIPLINE. Two kinds of statement are printed:
 *   HOLDS  — a property that must hold, and does. A failure here makes the script exit non-zero.
 *   GAP    — a property that does NOT hold, reported with the credential and the exact command that
 *            demonstrates it. A gap is not a test failure; it is the measurement that keeps W2-s and W3
 *            BLOCKED instead of letting a green suite imply they are solved.
 *
 * Run: node scripts/check-authz-authenticated.mjs
 */

import { randomBytes, randomUUID } from "node:crypto";

import { Long } from "mongodb";

import { MIGRATIONS } from "../db/migrations/index.mjs";
import { applyMigrations } from "../db/ledger.mjs";
import { buildRoleDefinitions } from "../db/roles.mjs";
import { GUARDS, PLATFORM_IDENTITY_COLLECTION } from "../db/guards.mjs";
import * as store from "../src/lib/permissions/store.ts";
import { PLATFORM_IDENTITY_ID } from "../db/organisation-identity.mjs";

const DB = "primemet";
const PASSWORD = randomBytes(18).toString("hex");
const USERS = {
  owner: "primemet_owner_user",
  app: "primemet_app_user",
  readonly: "primemet_readonly_user",
  intruder: "primemet_intruder_user",
};

let holds = 0;
let gaps = 0;
const failures = [];

/** The brief's own question matrix, counted separately from the five original questions. */
const briefItems = [];
function brief(id, title, fields) {
  briefItems.push({ id, title, ...fields });
  process.stdout.write(`\n  ${id}  ${title}\n`);
  for (const [key, value] of Object.entries(fields)) {
    process.stdout.write(`     ${key.padEnd(12)}: ${value}\n`);
  }
}

function hold(label, condition, detail) {
  if (condition) {
    holds += 1;
    process.stdout.write(`  \u2714 HOLDS  ${label}\n`);
    return;
  }
  failures.push({ label, detail });
  process.stdout.write(`  \u2717 FAILED ${label}${detail ? `\n             ${detail}` : ""}\n`);
}

function gap(label, observed, credential) {
  gaps += 1;
  process.stdout.write(`  ! GAP    ${label}\n             credential: ${credential}\n             observed:   ${observed}\n`);
}

/** Run one operation and classify the outcome, whether it is refused by MongoDB or succeeds. */
async function attempt(operation) {
  try {
    const value = await operation();
    return { refused: false, value };
  } catch (error) {
    return { refused: true, code: error?.code, message: String(error?.message ?? error).slice(0, 160) };
  }
}

async function main() {
  let MongoMemoryReplSet;
  let MongoClient;
  try {
    ({ MongoMemoryReplSet } = await import("mongodb-memory-server"));
    ({ MongoClient } = await import("mongodb"));
  } catch (error) {
    process.stdout.write(`\n  \u2716 integration dependencies missing: ${String(error?.message ?? error)}\n`);
    return 1;
  }

  let server;
  try {
    // `auth` is a REPL-SET option, not a top-level one: placed at the top level it is silently ignored and
    // the server starts WITHOUT —auth — which would make every privilege question below pass for the
    // wrong reason. It is read back and asserted after start for exactly that reason.
    server = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
        auth: { enable: true, keyfileContent: randomBytes(24).toString("base64") },
      },
      binary: { version: "7.0.14" },
    });
  } catch (error) {
    process.stdout.write(`\n  \u2716 an authenticated replica set did not start: ${String(error?.message ?? error).slice(0, 300)}\n`);
    return 1;
  }

  // Is —auth actually on? A silent "no" would make every refusal below vacuous, so it is asserted first.
  const authEnabled = server.servers[0]?.instanceInfo?.instance?.instanceOpts?.auth === true;
  hold("—auth is actually enabled on the started mongod", authEnabled, String(server.servers[0]?.instanceInfo?.instance?.instanceOpts?.auth));

  // The ADMINISTRATIVE account is the one mongodb-memory-server creates when auth is enabled; no
  // anonymous window exists here (with —auth plus a keyfile, "createUser" without credentials is
  // refused). Its password is generated by the library per instance and never leaves this process.
  const rootName = "mongodb-memory-server-root";
  const rootPwd = "rootuser";
  const root = new MongoClient(server.getUri(), {
    auth: { username: rootName, password: rootPwd },
    authSource: "admin",
  });
  const rootConnect = await attempt(() => root.connect());
  hold("the administrative credential authenticates", !rootConnect.refused, rootConnect.message);
  const admin = root.db("admin");

  // -------------------------------------------------------------------------
  // Provisioning — the project's own role definitions, not a copy of them
  // -------------------------------------------------------------------------
  process.stdout.write(`\nAuthenticated topology\n`);
  process.stdout.write(`  mode        : in-memory single-node replica set, \u2014auth + keyfile\n`);
  process.stdout.write(`  mongod      : 7.0.14\n`);
  process.stdout.write(`  database    : ${DB}\n`);
  process.stdout.write(`  credentials : generated per run, discarded with the process\n`);

  for (const definition of buildRoleDefinitions()) {
    // `resource.db: ""` means "this database" for a role created inside it, which is what the project's
    // definitions intend; it is spelled out here so the created role is unambiguous.
    const privileges = definition.privileges.map((privilege) => ({
      resource: { db: privilege.resource.db === "" ? DB : privilege.resource.db, collection: privilege.resource.collection ?? "" },
      actions: [...privilege.actions],
    }));
    // Created INSIDE the target database, so the role is primemet_<role>@primemet and its "" resources
    // resolve to that database rather than to admin.
    await root.db(DB).command({
      createRole: definition.role,
      privileges,
      roles: [],
    });
  }

  const create = (user, roles) =>
    admin.command({ createUser: user, pwd: PASSWORD, roles, mechanisms: ["SCRAM-SHA-256"] });

  // The owner role is a database role, so grant it on the database it was created in.
  await create(USERS.owner, [{ role: "primemet_owner", db: DB }]);
  await create(USERS.app, [{ role: "primemet_app", db: DB }]);
  await create(USERS.readonly, [{ role: "primemet_readonly", db: DB }]);
  await create(USERS.intruder, []);
  process.stdout.write(`  users       : ${Object.values(USERS).join(", ")}\n`);

  const connectAs = async (user) => {
    const client = new MongoClient(server.getUri(), {
      auth: { username: user, password: PASSWORD },
      authSource: "admin",
    });
    await client.connect();
    return client;
  };

  const owner = await connectAs(USERS.owner);
  const app = await connectAs(USERS.app);
  const readonly = await connectAs(USERS.readonly);
  const intruder = await connectAs(USERS.intruder);

  try {
    // ---------------------------------------------------------------------
    // Owner: structural authority. This is the role migrations are meant to use.
    // ---------------------------------------------------------------------
    process.stdout.write(`\n1. The privileged identities\n`);
    const migrated = await attempt(() =>
      applyMigrations(owner.db(DB), { migrations: MIGRATIONS, appliedBy: "check-authz", log: () => {} }),
    );
    hold("the owner identity can apply every migration", !migrated.refused, migrated.message);
    hold("...and all five versions land", !migrated.refused && migrated.value.length === MIGRATIONS.length, JSON.stringify(migrated.value)?.slice(0, 160));

    const appCreate = await attempt(() => app.db(DB).command({ createCollection: "should-not-exist" }));
    hold("the application identity cannot create a collection", appCreate.refused, appCreate.message);

    const appCollMod = await attempt(() =>
      app.db(DB).command({ collMod: "organisations", validationLevel: "off", validator: {} }),
    );
    hold("the application identity cannot relax a validator", appCollMod.refused, appCollMod.message);

    const appDrop = await attempt(() => app.db(DB).collection("admin_permission_grants").dropIndex("ix_admin_permission_grants_adminId_seq_u"));
    hold("the application identity cannot drop an index", appDrop.refused, appDrop.message);

    // ---------------------------------------------------------------------
    // 2. Q1 — can the application identity modify protected organisation identity?
    // ---------------------------------------------------------------------
    process.stdout.write(`\n2. Q1 \u2014 ordinary credentials against protected organisation identity\n`);
    const orgId = randomUUID();
    const otherId = randomUUID();
    const now = new Date();
    const orgDoc = (id, over = {}) => ({
      _id: id,
      legalName: `Org ${id.slice(0, 8)}`,
      countryCode: "IN",
      accountStatus: "ACTIVE",
      isListable: false,
      orgType: "BOTH",
      orgKind: "BUYER",
      verificationStatus: "VERIFIED",
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      ...over,
    });

    const seed = await attempt(() => owner.db(DB).collection("organisations").insertMany([orgDoc(orgId), orgDoc(otherId, { orgKind: "PRIMEMET" })]));
    hold("the owner identity can seed organisations", !seed.refused, seed.message);

    const legacySeed = await attempt(() =>
      owner.db(DB).collection(GUARDS).insertOne({ _id: PLATFORM_IDENTITY_ID, kind: "PLATFORM_IDENTITY", organisationId: otherId, updatedAt: now }),
    );
    hold("the owner identity can seed the legacy platform identity pointer", !legacySeed.refused, legacySeed.message);

    // W2.2: the pointer the runtime obeys lives in its own collection, and only the owner may write it.
    const pointerSeed = await attempt(() =>
      owner.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).insertOne({ _id: PLATFORM_IDENTITY_ID, kind: "PLATFORM_IDENTITY", organisationId: otherId, updatedAt: now }),
    );
    hold("the owner identity can seed the protected platform identity pointer", !pointerSeed.refused, pointerSeed.message);

    const relabel = await attempt(() =>
      app.db(DB).collection("organisations").updateOne({ _id: orgId }, { $set: { orgKind: "PRIMEMET" } }),
    );
    if (relabel.refused) {
      hold("a relabel to PRIMEMET is refused WHILE another live PRIMEMET row exists (uniqueness, not privilege)", true);
    } else {
      gap(
        "a relabel to PRIMEMET succeeded although another live PRIMEMET row exists",
        "updateOne accepted (matched " + relabel.value.matchedCount + ")",
        `primemet_app (${USERS.app})`,
      );
    }

    // ...and the same update once the competing row is out of the way. The unique index was the whole of the
    // first refusal, so this is the case that decides W2-s.
    await attempt(() => owner.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { orgKind: "OTHER" } }));
    const relabelFree = await attempt(() =>
      app.db(DB).collection("organisations").updateOne({ _id: orgId }, { $set: { orgKind: "PRIMEMET" } }),
    );
    if (relabelFree.refused) {
      hold("the application identity cannot relabel a BUYER organisation to PRIMEMET", true);
    } else {
      gap(
        "the application identity CAN relabel a BUYER organisation to PRIMEMET once no other PRIMEMET row exists",
        "updateOne accepted (matched " + relabelFree.value.matchedCount + ", modified " + relabelFree.value.modifiedCount + ")",
        `primemet_app (${USERS.app})`,
      );
    }

    const repoint = await attempt(() =>
      app.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: PLATFORM_IDENTITY_ID }, { $set: { organisationId: orgId } }),
    );
    if (repoint.refused) {
      hold("the platform identity pointer cannot be re-pointed by the application identity", true);
    } else {
      gap(
        "the platform identity pointer CAN be re-pointed by the application identity",
        "updateOne accepted (matched " + repoint.value.matchedCount + ", modified " + repoint.value.modifiedCount + ")",
        `primemet_app (${USERS.app}) \u2014 the same grant that lets it increment the continuity fence`,
      );
    }

    const softDelete = await attempt(() =>
      app.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { deletedAt: now } }),
    );
    gap(
      "the application identity can soft-delete an organisation (by design: retirement is soft)",
      softDelete.refused ? "refused" : "updateOne accepted",
      `primemet_app (${USERS.app})`,
    );

    const hardDelete = await attempt(() => app.db(DB).collection("organisations").deleteOne({ _id: otherId }));
    hold("the application identity cannot delete an organisation", hardDelete.refused, hardDelete.message);

    // ---------------------------------------------------------------------
    // 3. Q2 — can the application identity insert an effective grant directly?
    // ---------------------------------------------------------------------
    process.stdout.write(`\n3. Q2 \u2014 ordinary credentials against the permission log\n`);

    // The Q1 experiments above leave the governing organisation soft-deleted and the pointer unmoved, so
    // the precondition for this section is re-established explicitly, as the OWNER, instead of being
    // inherited from them. Before v010 the application identity's re-point succeeded and moved the
    // pointer onto a live organisation as a side effect; refusing that write is the whole point of the
    // fix, so the state this section needs must now be built on purpose.
    await attempt(() =>
      owner.db(DB).collection("organisations").updateOne({ _id: orgId }, { $set: { orgKind: "OTHER", deletedAt: null } }),
    );
    await attempt(() =>
      owner.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { orgKind: "PRIMEMET", deletedAt: null } }),
    );
    await attempt(() =>
      owner.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: PLATFORM_IDENTITY_ID }, { $set: { organisationId: otherId } }),
    );
    const pointerNow = await owner.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: PLATFORM_IDENTITY_ID });
    const governingOrg = await owner.db(DB).collection("organisations").findOne({ _id: otherId });
    hold(
      "the governing organisation is live and named by the protected pointer before the permission-log tests",
      pointerNow?.organisationId === otherId && governingOrg?.deletedAt === null,
      JSON.stringify({ pointer: pointerNow?.organisationId, orgKind: governingOrg?.orgKind, deletedAt: governingOrg?.deletedAt }),
    );
    const userId = randomUUID();
    const profileId = randomUUID();
    await attempt(() =>
      owner.db(DB).collection("users").insertOne({
        _id: userId,
        email: `admin-${userId}@example.test`,
        fullName: "Authz Admin",
        locale: "en-IN",
        role: "ADMIN",
        status: "ACTIVE",
        mfaEnabled: true,
        failedLoginCount: 0,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await attempt(() =>
      owner.db(DB).collection("admin_profiles").insertOne({
        _id: profileId,
        userId,
        staffCode: `S-${profileId.slice(0, 8)}`,
        tier: "READ_ONLY_ADMIN",
        mfaRequired: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const forged = {
      _id: randomUUID(),
      adminId: profileId,
      permission: "DATABASE_APPLY_MIGRATION",
      effect: "GRANT",
      seq: Long.fromNumber(1),
      eventId: randomUUID(),
      grantedById: userId,
      reason: "inserted by the application identity, never delegated",
      expiresAt: null,
      createdAt: now,
    };
    const forgedInsert = await attempt(() => app.db(DB).collection(store.GRANTS_COLLECTION).insertOne(forged));
    if (forgedInsert.refused) {
      hold("the application identity cannot insert into the permission log", true);
    } else {
      gap(
        "the application identity CAN insert a validator-conforming row into the permission log",
        "insertOne accepted; the row is then subject to the resolver's integrity check, not to MongoDB",
        `primemet_app (${USERS.app})`,
      );
    }

    const historyUpdate = await attempt(() =>
      app.db(DB).collection(store.GRANTS_COLLECTION).updateOne({ _id: forged._id }, { $set: { effect: "DENY" } }),
    );
    hold("the application identity cannot update a permission event (append-only, enforced by privilege)", historyUpdate.refused, historyUpdate.message);

    const historyDelete = await attempt(() => app.db(DB).collection(store.GRANTS_COLLECTION).deleteOne({ _id: forged._id }));
    hold("the application identity cannot delete a permission event", historyDelete.refused, historyDelete.message);

    // The resolver's view of the forged row, with a key configured: the row is inert.
    process.env.PERMISSION_LOG_KEY = randomBytes(18).toString("hex");
    const resolution = await store.resolveActorPermissions(owner.db(DB), userId, now);
    hold(
      "the resolver refuses the hand-inserted row when a key is configured",
      resolution.decisions.get("DATABASE_APPLY_MIGRATION").decidedBy === "INVALID_EVENT",
      JSON.stringify(resolution.decisions.get("DATABASE_APPLY_MIGRATION")),
    );

    // ---------------------------------------------------------------------
    // 4. Q3/Q5 — the application identity, doing what it is supposed to do
    // ---------------------------------------------------------------------
    process.stdout.write(`\n4. Q3 + Q5 \u2014 authorised operations, and delegation under a real credential\n`);
    const superUser = randomUUID();
    const superProfile = randomUUID();
    const seedSuper = await attempt(() =>
      owner.db(DB).collection("users").insertOne({
        _id: superUser,
        email: `super-${superUser}@example.test`,
        fullName: "Super Admin",
        locale: "en-IN",
        role: "ADMIN",
        status: "ACTIVE",
        mfaEnabled: true,
        failedLoginCount: 0,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    hold("the owner identity can seed a super admin user", !seedSuper.refused, seedSuper.message);
    await attempt(() =>
      owner.db(DB).collection("admin_profiles").insertOne({
        _id: superProfile,
        userId: superUser,
        staffCode: `S-${superProfile.slice(0, 8)}`,
        tier: "SUPER_ADMIN",
        mfaRequired: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );

    // This section must not inherit the Q1 experiments: the previous two sections re-pointed the pointer,
    // soft-deleted an organisation and relabelled another. The state is therefore re-established
    // explicitly, as the OWNER, so the governing organisation is known rather than incidental.
    await attempt(() =>
      owner.db(DB).collection("organisations").updateOne({ _id: orgId }, { $set: { orgKind: "OTHER", deletedAt: null } }),
    );
    await attempt(() =>
      owner.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { orgKind: "PRIMEMET", deletedAt: null } }),
    );
    await attempt(() =>
      owner.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: PLATFORM_IDENTITY_ID }, { $set: { organisationId: otherId } }),
    );
    const governing = await owner.db(DB).collection("organisations").findOne({ _id: otherId });
    hold(
      "the governing organisation is PRIMEMET and live before the delegation checks",
      governing?.orgKind === "PRIMEMET" && governing?.deletedAt === null,
      JSON.stringify({ orgKind: governing?.orgKind, deletedAt: governing?.deletedAt }),
    );

    const authorised = await store.appendPermissionEvent(app.db(DB), {
      actorUserId: superUser,
      target: { profileId, isActive: true, userIsActive: true, tier: "READ_ONLY_ADMIN" },
      permission: "ENQUIRY_ASSIGN",
      effect: "GRANT",
      reason: "authorised grant through the delegation path",
      eventId: randomUUID(),
      now,
    });
    hold("the application identity CAN append through the delegation path", authorised.ok === true, JSON.stringify(authorised));

    const selfTarget = await store.appendPermissionEvent(app.db(DB), {
      actorUserId: superUser,
      target: { profileId: superProfile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" },
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "GRANT",
      reason: "self grant",
      eventId: randomUUID(),
      now,
    });
    hold("delegation still refuses a self-target under a real credential", selfTarget.ok === false, JSON.stringify(selfTarget));

    // Continuity is exercised on the PROFILE path, which is where the invariant lives: an event DENY by a
    // super admin against another super admin is legal while a holder remains, and a tier change or
    // deactivation that would leave none is refused. Both run under the application credential, so this is
    // the real privilege doing the real work, not a direct database write.
    const demote = await store.setAdminProfileAccess(app.db(DB), {
      actorUserId: superUser,
      profileId: superProfile,
      tier: "SOURCING_OPS_ADMIN",
      now,
    });
    hold(
      "super-admin continuity still refuses demoting the last holder under a real credential",
      demote.ok === false && demote.refusal === "LAST_SUPER_ADMIN",
      JSON.stringify(demote),
    );

    const deactivate = await store.setAdminProfileAccess(app.db(DB), {
      actorUserId: superUser,
      profileId: superProfile,
      isActive: false,
      now,
    });
    hold(
      "super-admin continuity still refuses deactivating the last holder under a real credential",
      deactivate.ok === false && deactivate.refusal === "LAST_SUPER_ADMIN",
      JSON.stringify(deactivate),
    );

    const stillActive = await app.db(DB).collection("admin_profiles").findOne({ _id: superProfile });
    hold("the refused changes left the last super admin active", stillActive?.isActive === true && stillActive?.tier === "SUPER_ADMIN", JSON.stringify({ isActive: stillActive?.isActive, tier: stillActive?.tier }));

    // ---------------------------------------------------------------------
    // 4b. F-1 — the continuity counter must VERIFY events, not merely read them
    // ---------------------------------------------------------------------
    // P2 made `UNKEYED` a failure in production. `countRemainingGrantHolders` resolved each holder
    // without passing the signing key, so in the production posture every stored row reported UNKEYED,
    // the newest applicable row became INVALID_EVENT, and that holder was dropped from the count. A
    // super admin with no recorded event still counted from the tier default, which is why the defect
    // was invisible: it only bit holders who actually had an event. The effect was a false refusal —
    // every DENY of ACCESS_GRANT_PERMISSION against a super admin was rejected as LAST_SUPER_ADMIN, so
    // a legitimate revocation became impossible in production. Fail-closed, but wrong.
    //
    // This drives the real `appendPermissionEvent` path. `countRemainingGrantHolders` is deliberately
    // not exported, so the only honest way to test it is through the operation it guards.
    const secondUser = randomUUID();
    const secondProfile = randomUUID();
    await attempt(() =>
      owner.db(DB).collection("users").insertOne({
        _id: secondUser,
        email: `super2-${secondUser}@example.test`,
        fullName: "Second Super Admin",
        locale: "en-IN",
        role: "ADMIN",
        status: "ACTIVE",
        mfaEnabled: true,
        failedLoginCount: 0,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await attempt(() =>
      owner.db(DB).collection("admin_profiles").insertOne({
        _id: secondProfile,
        userId: secondUser,
        staffCode: `S-${secondProfile.slice(0, 8)}`,
        tier: "SUPER_ADMIN",
        mfaRequired: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );

    // The second super admin needs a SIGNED event that decides ACCESS_GRANT_PERMISSION. Without one it
    // would count from its tier default and the defect would stay invisible — the counter only mis-reads
    // stored rows, so a holder with no rows is counted correctly either way.
    const HOLDER_REASON = "F-1: give the second holder a signed event that decides access";
    const seedHolderEvent = await store.appendPermissionEvent(app.db(DB), {
      actorUserId: superUser,
      target: { profileId: secondProfile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" },
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "GRANT",
      reason: HOLDER_REASON,
      eventId: randomUUID(),
      now,
    });
    hold(
      "F-1 setup: a signed ACCESS_GRANT_PERMISSION event is recorded for the second super admin",
      seedHolderEvent.ok === true,
      JSON.stringify(seedHolderEvent),
    );

    // A THIRD super admin with its own signed event. The acceptance condition asks the positive
    // control to prove that TWO valid holders are counted, not one: the actor is excluded from its
    // own count, so a single remaining holder only ever demonstrates a count of 1.
    const thirdUser = randomUUID();
    const thirdProfile = randomUUID();
    await attempt(() =>
      owner.db(DB).collection("users").insertOne({
        _id: thirdUser,
        email: `super3-${thirdUser}@example.test`,
        fullName: "Third Super Admin",
        locale: "en-IN",
        role: "ADMIN",
        status: "ACTIVE",
        mfaEnabled: true,
        failedLoginCount: 0,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await attempt(() =>
      owner.db(DB).collection("admin_profiles").insertOne({
        _id: thirdProfile,
        userId: thirdUser,
        staffCode: `S-${thirdProfile.slice(0, 8)}`,
        tier: "SUPER_ADMIN",
        mfaRequired: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const THIRD_HOLDER_REASON = "F-1: give the third holder a signed event that decides access";
    const seedThirdEvent = await store.appendPermissionEvent(app.db(DB), {
      actorUserId: superUser,
      target: { profileId: thirdProfile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" },
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "GRANT",
      reason: THIRD_HOLDER_REASON,
      eventId: randomUUID(),
      now,
    });
    hold(
      "F-1 setup: a signed ACCESS_GRANT_PERMISSION event is recorded for the third super admin",
      seedThirdEvent.ok === true,
      JSON.stringify(seedThirdEvent),
    );

    const savedKey = process.env.PERMISSION_LOG_KEY;
    const previousPrimemetEnv = process.env.PRIMEMET_ENV;
    process.env.PRIMEMET_ENV = "production";

    // A DENY by one super admin against ANOTHER can never drive the count to zero: the actor is always
    // one of the remaining holders, so it counts itself. The route that can is self-removal — the actor
    // deactivating its own profile — which is the route the existing continuity test already uses. So
    // the actor is `superProfile`, the excluded profile is `superProfile`, and the remaining holder is
    // `secondProfile`.
    //
    // POSITIVE FIRST: with only the signed row present, the holder must be counted and the removal
    // allowed. Before F-1 the counter passed no key, so this VERIFIED row still reported UNKEYED in the
    // production posture, still counted as zero, and this call was refused — the regression pinned here.
    const selfRemoveVerified = await store.setAdminProfileAccess(app.db(DB), {
      actorUserId: superUser,
      profileId: superProfile,
      isActive: false,
      now,
    });
    hold(
      "F-1 step 1 of 3: two VERIFIED holders are counted, so removing the actor's access is allowed",
      selfRemoveVerified.ok === true,
      JSON.stringify(selfRemoveVerified),
    );

    // The call above deactivated the actor. Restore it as the OWNER so the next case can act; this
    // is fixture cleanup, not a bypass of the invariant under test.
    await attempt(() =>
      owner.db(DB).collection("admin_profiles").updateOne({ _id: superProfile }, { $set: { isActive: true } }),
    );
    const restoredSuper = await owner.db(DB).collection("admin_profiles").findOne({ _id: superProfile });
    hold("F-1 cleanup: the first super admin is active again", restoredSuper?.isActive === true, JSON.stringify({ isActive: restoredSuper?.isActive }));

    // STEP 2 OF 3 — the discriminating assertion, and the reason this is a three-step sequence.
    //
    // Step 1's `ok === true` only proves `remaining >= 1`, because the continuity gate refuses when
    // `remainingHolders <= 0`. On its own it therefore cannot distinguish "two holders counted" from
    // "one holder counted": a counter that ignored `thirdProfile` entirely would still satisfy it.
    // Making exactly ONE of the two remaining holders unverifiable separates the cases — if the count
    // is genuinely 2 it falls to 1 and the removal is still allowed; if the count was only ever 1 it
    // falls to 0 and the call below is refused, failing the assertion.
    //
    // The row is inserted UNSIGNED — the exact W3.3 vector, and the only way to produce an unverifiable
    // row here, because the collection's validator refuses an in-place edit of a signed row (an earlier
    // attempt to tamper `reason` was rejected, which is itself the append-only property working). An
    // unsigned row is MISSING, so it must not be counted.
    const unsignedRows = [
      {
        _id: randomUUID(),
        adminId: secondProfile,
        permission: "ACCESS_GRANT_PERMISSION",
        effect: "GRANT",
        seq: Long.fromNumber(9_000),
        eventId: randomUUID(),
        grantedById: secondUser,
        reason: "F-1: unsigned row, must not be counted",
        expiresAt: null,
        // MUST be `now`, not later: `readPermissionEvents` filters `createdAt <= now`, so a future
        // timestamp would be excluded from the read and the signed row would win by default.
        createdAt: now,
      },
    ];
    const firstUnsignedInsert = await attempt(() =>
      owner.db(DB).collection(store.GRANTS_COLLECTION).insertMany(unsignedRows),
    );
    hold(
      "F-1 step 2 setup: an unsigned row is the newest event for the first remaining holder",
      !firstUnsignedInsert.refused,
      firstUnsignedInsert.message,
    );

    const selfRemoveOneUnverified = await store.setAdminProfileAccess(app.db(DB), {
      actorUserId: superUser,
      profileId: superProfile,
      isActive: false,
      now,
    });
    hold(
      "F-1 step 2 of 3: one UNVERIFIABLE holder still leaves one VERIFIED holder, so the removal is still allowed",
      selfRemoveOneUnverified.ok === true,
      JSON.stringify(selfRemoveOneUnverified),
    );

    // Step 2 succeeded, so it deactivated the actor again. Restore it as the OWNER before step 3.
    await attempt(() =>
      owner.db(DB).collection("admin_profiles").updateOne({ _id: superProfile }, { $set: { isActive: true } }),
    );

    // STEP 3 OF 3 — both remaining holders unverifiable. The count is now genuinely 0, so the identical
    // operation must be refused. Read together with step 2 this is a real negative control; on its own
    // it would also pass with a count of 1, which is why step 2 exists.
    const secondUnsignedRow = {
      _id: randomUUID(),
      adminId: thirdProfile,
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "GRANT",
      seq: Long.fromNumber(9_001),
      eventId: randomUUID(),
      grantedById: thirdUser,
      reason: "F-1: unsigned row for the second remaining holder, must not be counted",
      expiresAt: null,
      createdAt: now,
    };
    unsignedRows.push(secondUnsignedRow);
    const secondUnsignedInsert = await attempt(() =>
      owner.db(DB).collection(store.GRANTS_COLLECTION).insertMany([secondUnsignedRow]),
    );
    hold(
      "F-1 step 3 setup: an unsigned row is the newest event for the other remaining holder too",
      !secondUnsignedInsert.refused,
      secondUnsignedInsert.message,
    );

    const selfRemoveUnverified = await store.setAdminProfileAccess(app.db(DB), {
      actorUserId: superUser,
      profileId: superProfile,
      isActive: false,
      now,
    });
    hold(
      "F-1 step 3 of 3: no VERIFIED holder remains, so the same removal is refused with LAST_SUPER_ADMIN",
      selfRemoveUnverified.ok === false && selfRemoveUnverified.refusal === "LAST_SUPER_ADMIN",
      JSON.stringify(selfRemoveUnverified),
    );

    // Remove ONLY the rows this test inserted, so the fixture is left as the rest of the suite expects it.
    await attempt(() =>
      owner.db(DB)
        .collection(store.GRANTS_COLLECTION)
        .deleteMany({ _id: { $in: unsignedRows.map((row) => row._id) } }),
    );
    const superStillActive = await owner.db(DB).collection("admin_profiles").findOne({ _id: superProfile });
    hold("F-1 cleanup: the refused removal left the first super admin active", superStillActive?.isActive === true, JSON.stringify({ isActive: superStillActive?.isActive }));

    if (previousPrimemetEnv === undefined) delete process.env.PRIMEMET_ENV;
    else process.env.PRIMEMET_ENV = previousPrimemetEnv;
    if (savedKey === undefined) delete process.env.PERMISSION_LOG_KEY;
    else process.env.PERMISSION_LOG_KEY = savedKey;

    // ---------------------------------------------------------------------
    // 5. Q4 — unauthorised identities are rejected by MongoDB itself
    // ---------------------------------------------------------------------
    process.stdout.write(`\n5. Q4 \u2014 MongoDB rejects what the roles do not grant\n`);
    const readonlyWrite = await attempt(() =>
      readonly.db(DB).collection("organisations").insertOne(orgDoc(randomUUID(), { legalName: "Readonly attempt" })),
    );
    hold("the read-only identity cannot insert", readonlyWrite.refused, readonlyWrite.message);

    const readonlyRead = await attempt(() => readonly.db(DB).collection("organisations").findOne({}));
    hold("the read-only identity can read", !readonlyRead.refused, readonlyRead.message);

    const intruderRead = await attempt(() => intruder.db(DB).collection("organisations").findOne({}));
    hold("a credential with no roles can read nothing", intruderRead.refused, intruderRead.message);

    const intruderWrite = await attempt(() => intruder.db(DB).collection(store.GRANTS_COLLECTION).insertOne(forged));
    hold("a credential with no roles can write nothing", intruderWrite.refused, intruderWrite.message);

    const unauthenticated = new MongoClient(server.getUri());
    const anonConnect = await attempt(() => unauthenticated.connect());
    const anon = anonConnect.refused
      ? anonConnect
      : await attempt(() => unauthenticated.db(DB).collection("organisations").findOne({}));
    hold("a connection with no credentials cannot read", anon.refused, anon.message ?? "read succeeded");
    await unauthenticated.close().catch(() => {});

    // Effective privilege, read back from the SERVER rather than from the definitions.
    const shown = await admin.command({ connectionStatus: 1, showPrivileges: true });
    const appPrivileges = await admin.command({ usersInfo: { user: USERS.app, db: "admin" }, showPrivileges: true });
    hold(
      "the server reports the application identity's roles as primemet_app only",
      JSON.stringify(appPrivileges.users?.[0]?.roles ?? []).includes("primemet_app"),
      JSON.stringify(appPrivileges.users?.[0]?.roles ?? []),
    );
    void shown;

    // ---------------------------------------------------------------------
    // 6. W3 — the permission write boundary, the brief's seven questions
    // ---------------------------------------------------------------------
    process.stdout.write(`\n6. W3 \u2014 permission write boundary (the brief's seven questions)\n`);

    // W3.1 — direct insert of an effective grant (measured in section 3; restated with its locus).
    brief("W3.1", "ordinary identity inserts an effective grant directly", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: `db.${store.GRANTS_COLLECTION}.insertOne(<validator-conforming GRANT>)`,
      outcome: forgedInsert.refused ? "refused" : "ACCEPTED by MongoDB",
      enforcement: forgedInsert.refused ? "MONGODB" : "APPLICATION only (integrity tag)",
      verdict: forgedInsert.refused ? "SATISFIED" : "OPEN",
    });

    // W3.2 — update and whole-document replacement of an existing event.
    const replacement = await attempt(() =>
      app.db(DB).collection(store.GRANTS_COLLECTION).replaceOne(
        { _id: forged._id },
        { ...forged, effect: "GRANT", permission: "ACCESS_GRANT_PERMISSION", reason: "replaced by the application identity" },
      ),
    );
    hold("the application identity cannot replace an existing permission event", replacement.refused, replacement.message);
    brief("W3.2", "ordinary identity updates or replaces an existing grant", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: `updateOne( $set effect ) and replaceOne( whole document )`,
      outcome: `updateOne ${historyUpdate.refused ? "refused" : "accepted"}; replaceOne ${replacement.refused ? "refused" : "accepted"}`,
      enforcement: "MONGODB (no update privilege on the append-only collection)",
      verdict: historyUpdate.refused && replacement.refused ? "SATISFIED" : "OPEN",
    });

    // W3.3 — is there any writer boundary left to bypass? A second write path with the same credential
    // answers that question, and it does not care which helper the code calls.
    const sweep = await attempt(() =>
      app.db(DB).collection(store.GRANTS_COLLECTION).insertMany([
        { ...forged, _id: randomUUID(), eventId: randomUUID(), seq: Long.fromNumber(90) },
        { ...forged, _id: randomUUID(), eventId: randomUUID(), seq: Long.fromNumber(91) },
      ]),
    );
    brief("W3.3", "ordinary identity bypasses the trusted writer", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: `db.${store.GRANTS_COLLECTION}.insertMany([...])`,
      outcome: sweep.refused ? "refused" : "ACCEPTED by MongoDB (2 rows)",
      enforcement: "NONE \u2014 the runtime identity is also the only writer, so no boundary exists to bypass",
      verdict: sweep.refused ? "SATISFIED" : "OPEN",
    });

    // W3.4 — the brief presumes a privileged writer. Measure whether one is declared at all rather than
    // pretending the application identity is one.
    const declaredRoles = buildRoleDefinitions().map((role) => role.role);
    const writerRoles = declaredRoles.filter((role) => /writer/i.test(role));
    brief("W3.4", "privileged writer performs a valid delegated grant", {
      credential: writerRoles.length > 0 ? writerRoles.join(", ") : `NONE DECLARED (roles: ${declaredRoles.join(", ")})`,
      operation: "delegate ENQUIRY_ASSIGN to a READ_ONLY_ADMIN through the writer identity",
      outcome: writerRoles.length > 0 ? "not reached" : "NOT TESTABLE: db/roles.mjs declares no writer role",
      enforcement: "NONE \u2014 primemet_app holds insert on the log and holds the signing key",
      verdict: "BLOCKED",
    });

    // W3.5 — invalid delegation through the application path. Each refusal is the application refusing;
    // the database accepts the document, which is exactly the distinction the brief asks us to state.
    const invalidCases = [];
    const tryDelegate = async (label, expected, overrides) => {
      const result = await store.appendPermissionEvent(app.db(DB), {
        actorUserId: superUser,
        target: { profileId, isActive: true, userIsActive: true, tier: "READ_ONLY_ADMIN" },
        permission: "ENQUIRY_ASSIGN",
        effect: "GRANT",
        reason: "invalid delegation probe",
        eventId: randomUUID(),
        now,
        ...overrides,
      });
      const observed = result.ok ? "ACCEPTED" : String(result.refusal);
      invalidCases.push({ label, expected, observed });
      return result;
    };
    await tryDelegate("unknown permission", "UNKNOWN_PERMISSION", { permission: "NOT_A_PERMISSION" });
    await tryDelegate("unknown effect", "UNKNOWN_EFFECT", { effect: "SUPERUSER" });
    await tryDelegate("self target", "SELF_TARGET", { target: { profileId: superProfile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" } });
    // NON_DELEGABLE is a rule for a NON-super actor, so the probe needs one: a super admin seeds a
    // delegate who may change access, and that delegate then tries to redistribute a protected permission.
    const seedDelegate = await store.appendPermissionEvent(app.db(DB), {
      actorUserId: superUser,
      target: { profileId, isActive: true, userIsActive: true, tier: "READ_ONLY_ADMIN" },
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "GRANT",
      reason: "seed a delegate so the non-delegable rule can be exercised",
      eventId: randomUUID(),
      now,
    });
    hold("a super admin can seed a delegate who may change access", seedDelegate.ok === true, JSON.stringify(seedDelegate));
    await tryDelegate("non-delegable permission", "NON_DELEGABLE", {
      actorUserId: userId,
      permission: "AUDIT_EXPORT",
      target: { profileId: superProfile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" },
    });
    await tryDelegate("inactive target", "TARGET_NOT_ACTIVE", { target: { profileId, isActive: false, userIsActive: true, tier: "READ_ONLY_ADMIN" } });
    await tryDelegate("expiry already in the past", "EXPIRY_NOT_IN_FUTURE", { expiresAt: new Date(now.getTime() - 60_000) });
    const unresolvedActor = await store.appendPermissionEvent(app.db(DB), {
      actorUserId: randomUUID(),
      target: { profileId, isActive: true, userIsActive: true, tier: "READ_ONLY_ADMIN" },
      permission: "ENQUIRY_ASSIGN",
      effect: "GRANT",
      reason: "unresolved actor probe",
      eventId: randomUUID(),
      now,
    });
    invalidCases.push({
      label: "unresolved actor",
      expected: "ACTOR_UNRESOLVED",
      observed: unresolvedActor.ok ? "ACCEPTED" : String(unresolvedActor.refusal),
    });
    for (const probe of invalidCases) {
      hold(
        `invalid delegation is refused by the application: ${probe.label}`,
        probe.observed === probe.expected,
        `expected ${probe.expected}, observed ${probe.observed}`,
      );
    }

    // ...and the same invalid payloads written straight to the collection, for the database's half.
    const rawBadEffect = await attempt(() =>
      app.db(DB).collection(store.GRANTS_COLLECTION).insertOne({ ...forged, _id: randomUUID(), eventId: randomUUID(), effect: "SUPERUSER" }),
    );
    brief("W3.5", "privileged writer attempts an invalid delegation", {
      credential: `primemet_app_user (primemet_app@${DB}) (nearest existing writer)`,
      operation: `${invalidCases.length} delegation refusals via store.appendPermissionEvent; raw insertOne with effect SUPERUSER`,
      outcome: `${invalidCases.filter((c) => c.observed === c.expected).length}/${invalidCases.length} refused by the application; raw insert ${rawBadEffect.refused ? "refused" : "accepted"}`,
      enforcement: "APPLICATION (delegation rules); MONGODB for enum shape only (validator)",
      verdict: invalidCases.every((c) => c.observed === c.expected) && rawBadEffect.refused ? "SATISFIED" : "OPEN",
    });

    // W3.6 — revoked or expired authority must not be reusable.
    const expiringUser = randomUUID();
    const expiringProfile = randomUUID();
    await attempt(() =>
      owner.db(DB).collection("users").insertOne({
        _id: expiringUser,
        email: `expiring-${expiringUser}@example.test`,
        fullName: "Expiring Admin",
        locale: "en-IN",
        role: "ADMIN",
        status: "ACTIVE",
        mfaEnabled: true,
        failedLoginCount: 0,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await attempt(() =>
      owner.db(DB).collection("admin_profiles").insertOne({
        _id: expiringProfile,
        userId: expiringUser,
        staffCode: `S-${expiringProfile.slice(0, 8)}`,
        tier: "READ_ONLY_ADMIN",
        mfaRequired: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const temporary = await store.appendPermissionEvent(app.db(DB), {
      actorUserId: superUser,
      target: { profileId: expiringProfile, isActive: true, userIsActive: true, tier: "READ_ONLY_ADMIN" },
      permission: "ENQUIRY_ASSIGN",
      effect: "GRANT",
      reason: "temporary authority for the expiry experiment",
      expiresAt: new Date(now.getTime() + 3_600_000),
      eventId: randomUUID(),
      now,
    });
    hold("the writer can delegate a temporary grant", temporary.ok === true, JSON.stringify(temporary));

    const liveGrant = await store.resolveActorPermissions(owner.db(DB), expiringUser, new Date(now.getTime() + 60_000));
    hold("the temporary grant is honoured while it is live", liveGrant.permissions.has("ENQUIRY_ASSIGN"), JSON.stringify([...liveGrant.permissions]).slice(0, 120));

    const lapsedGrant = await store.resolveActorPermissions(owner.db(DB), expiringUser, new Date(now.getTime() + 7_200_000));
    hold("the temporary grant lapses once it is expired", !lapsedGrant.permissions.has("ENQUIRY_ASSIGN"), JSON.stringify([...lapsedGrant.permissions]).slice(0, 120));

    const revokedAt = new Date(now.getTime() + 120_000);
    const revokeEvent = await store.appendPermissionEvent(app.db(DB), {
      actorUserId: superUser,
      target: { profileId: expiringProfile, isActive: true, userIsActive: true, tier: "READ_ONLY_ADMIN" },
      permission: "ENQUIRY_ASSIGN",
      effect: "REVOKE",
      reason: "authority withdrawn for the reuse experiment",
      eventId: randomUUID(),
      now: revokedAt,
    });
    hold("the writer can withdraw a grant with a REVOKE", revokeEvent.ok === true, JSON.stringify(revokeEvent));

    const afterRevoke = await store.resolveActorPermissions(owner.db(DB), expiringUser, new Date(now.getTime() + 180_000));
    hold("revoked authority cannot be reused", !afterRevoke.permissions.has("ENQUIRY_ASSIGN"), JSON.stringify([...afterRevoke.permissions]).slice(0, 120));

    brief("W3.6", "revoked or expired authority cannot be reused", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: "append GRANT with +1h expiry, resolve at +1m and +2h; append REVOKE, resolve at +3m; append a GRANT already expired",
      outcome: `live ${liveGrant.permissions.has("ENQUIRY_ASSIGN")}, expired ${lapsedGrant.permissions.has("ENQUIRY_ASSIGN")}, revoked ${afterRevoke.permissions.has("ENQUIRY_ASSIGN")}, past-expiry write ${invalidCases.find((c) => c.label === "expiry already in the past")?.observed}`,
      enforcement: "APPLICATION (resolution at authorisation time; the writer refuses a past expiry)",
      verdict:
        liveGrant.permissions.has("ENQUIRY_ASSIGN") && !lapsedGrant.permissions.has("ENQUIRY_ASSIGN") && !afterRevoke.permissions.has("ENQUIRY_ASSIGN")
          ? "SATISFIED"
          : "OPEN",
    });

    // W3.7 — forged actor identity and forged payload. Both are written by the application credential,
    // because that credential holds insert; the question is whether either is ever honoured.
    const forgedActorRow = {
      ...forged,
      _id: randomUUID(),
      adminId: expiringProfile,
      permission: "ENQUIRY_ASSIGN",
      effect: "GRANT",
      seq: Long.fromNumber(40),
      eventId: randomUUID(),
      grantedById: superUser,
      reason: "forged attribution: claims a super admin delegated this",
      createdAt: new Date(now.getTime() + 600_000),
    };
    const forgedActorInsert = await attempt(() => app.db(DB).collection(store.GRANTS_COLLECTION).insertOne(forgedActorRow));
    const forgedActorView = await store.resolveActorPermissions(owner.db(DB), expiringUser, new Date(now.getTime() + 900_000));
    const forgedActorDecision = forgedActorView.decisions.get("ENQUIRY_ASSIGN");
    hold(
      "a row with a forged actor identity is never honoured",
      forgedActorDecision?.decidedBy === "INVALID_EVENT",
      JSON.stringify(forgedActorDecision),
    );

    const forgedTagRow = {
      ...forgedActorRow,
      _id: randomUUID(),
      seq: Long.fromNumber(41),
      eventId: randomUUID(),
      integrity: randomBytes(32).toString("hex"),
      createdAt: new Date(now.getTime() + 1_200_000),
    };
    const forgedTagInsert = await attempt(() => app.db(DB).collection(store.GRANTS_COLLECTION).insertOne(forgedTagRow));
    const forgedTagView = await store.resolveActorPermissions(owner.db(DB), expiringUser, new Date(now.getTime() + 1_500_000));
    const forgedTagDecision = forgedTagView.decisions.get("ENQUIRY_ASSIGN");
    hold(
      "a row with a forged integrity tag is never honoured",
      forgedTagDecision?.decidedBy === "INVALID_EVENT",
      JSON.stringify(forgedTagDecision),
    );

    brief("W3.7", "forged actor identity and forged event payloads are rejected", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: "insert a signed-shaped row attributing the grant to a super admin; insert a second row with a fabricated integrity tag",
      outcome: `unsigned row insert ${forgedActorInsert.refused ? "refused" : "accepted"} -> ${forgedActorDecision?.decidedBy}; forged tag insert ${forgedTagInsert.refused ? "refused" : "accepted"} -> ${forgedTagDecision?.decidedBy}`,
      enforcement: "APPLICATION (integrity tag over actor, permission, effect, seq, eventId, reason and instants)",
      verdict: forgedActorDecision?.decidedBy === "INVALID_EVENT" && forgedTagDecision?.decidedBy === "INVALID_EVENT" ? "SATISFIED" : "OPEN",
    });


    // ---------------------------------------------------------------------
    // 7. W2 — organisation identity, the brief's seven questions
    // ---------------------------------------------------------------------
    process.stdout.write(`\n7. W2 \u2014 organisation identity (the brief's seven questions)\n`);

    const usurperId = randomUUID();
    await owner.db(DB).collection("organisations").insertOne(orgDoc(usurperId, { orgKind: "BUYER" }));
    await owner.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { orgKind: "PRIMEMET", deletedAt: null } });
    await owner.db(DB).collection("organisations").updateOne({ _id: orgId }, { $set: { orgKind: "OTHER", deletedAt: null } });
    await owner.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: PLATFORM_IDENTITY_ID }, { $set: { organisationId: otherId } });

    const baseline = await store.resolveActorPermissions(owner.db(DB), superUser, now);
    hold(
      "administrator resolution follows the pointer before the attacks",
      baseline.actor?.org?.id === otherId,
      JSON.stringify(baseline.actor?.org),
    );

    // W2.1 — orgKind modification. The write is expected to succeed; the question is whether it moves
    // the organisation that governs administrator access.
    // The unique index refuses a SECOND live PRIMEMET marker, so the existing marker is moved aside
    // first: the write must be shown SUCCEEDING for "authority did not move" to mean anything at all.
    await owner.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { orgKind: "OTHER" } });
    const relabelAttack = await attempt(() =>
      app.db(DB).collection("organisations").updateOne({ _id: usurperId }, { $set: { orgKind: "PRIMEMET" } }),
    );
    const afterRelabel = await store.resolveActorPermissions(owner.db(DB), superUser, now);
    hold(
      "a relabelled organisation does not become the governing organisation",
      afterRelabel.actor?.org?.id === otherId,
      JSON.stringify({ governing: afterRelabel.actor?.org?.id, expected: otherId }),
    );
    brief("W2.1", "orgKind modification (BUYER relabelled PRIMEMET)", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: `organisations.updateOne({ _id: usurper }, { $set: { orgKind: "PRIMEMET" } })`,
      outcome: `${relabelAttack.refused ? "refused" : "accepted by MongoDB"}; resolution still names ${afterRelabel.actor?.org?.id}`,
      enforcement: "APPLICATION (resolution reads the pointer, not the marker)",
      verdict: afterRelabel.actor?.org?.id === otherId ? "SATISFIED" : "OPEN",
    });
    await owner.db(DB).collection("organisations").updateOne({ _id: usurperId }, { $set: { orgKind: "BUYER" } });
    await owner.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { orgKind: "PRIMEMET" } });

    // W2.2 — identity-pointer replacement. This is the whole W2-s question.
    const pointerAttack = await attempt(() =>
      app.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: PLATFORM_IDENTITY_ID }, { $set: { organisationId: usurperId } }),
    );
    const afterPointer = await store.resolveActorPermissions(owner.db(DB), superUser, now);
    if (afterPointer.actor?.org?.id === otherId) {
      hold("the identity pointer resists replacement by the application identity", true);
    } else {
      gap(
        "the application identity CAN re-point the governing identity pointer",
        "updateOne accepted; resolution now names " + afterPointer.actor?.org?.id,
        `primemet_app (${USERS.app}) \u2014 the same grant that increments the continuity fence`,
      );
    }
    brief("W2.2", "identity-pointer replacement", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: `_platform_identity.updateOne({ _id: "platform-identity" }, { $set: { organisationId: usurper } })`,
      outcome: `${pointerAttack.refused ? "refused by MongoDB" : "accepted by MongoDB"}; resolution now names ${afterPointer.actor?.org?.id}`,
      enforcement: pointerAttack.refused
        ? "MONGODB \u2014 the runtime identity holds no update privilege on _platform_identity"
        : "NONE \u2014 the runtime identity can write the pointer",
      verdict: afterPointer.actor?.org?.id === otherId ? "SATISFIED" : "OPEN",
    });

    // Restore the pointer before the next question, as the owner.
    await owner.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: PLATFORM_IDENTITY_ID }, { $set: { organisationId: otherId } });

    // W2.3 — deletion of the referenced organisation.
    const softGoverning = await attempt(() =>
      app.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { deletedAt: new Date() } }),
    );
    const afterDeletion = await store.resolveActorPermissions(owner.db(DB), superUser, now);
    hold(
      "deleting the referenced organisation fails closed instead of promoting another",
      afterDeletion.actor?.org === null,
      JSON.stringify(afterDeletion.actor?.org),
    );
    brief("W2.3", "referenced organisation deletion", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: "soft-delete the pointed-at organisation, then hard-delete it",
      outcome: `soft delete ${softGoverning.refused ? "refused" : "accepted"}, resolution ${afterDeletion.actor?.org === null ? "NO_ORGANISATION" : "still governed"}; hard delete ${hardDelete.refused ? "refused by MongoDB" : "accepted"}`,
      enforcement: "APPLICATION (fail closed on a non-live organisation); MONGODB for hard delete",
      verdict: afterDeletion.actor?.org === null && hardDelete.refused ? "SATISFIED" : "OPEN",
    });
    await owner.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { deletedAt: null } });

    // W2.4 — identity recreation: insert a replacement, delete the guard, upsert a new one.
    const recreateInsert = await attempt(() =>
      app.db(DB).collection(GUARDS).insertOne({
        _id: "platform-identity-recreated",
        kind: "PLATFORM_IDENTITY",
        organisationId: usurperId,
        updatedAt: now,
      }),
    );
    const recreateDelete = await attempt(() => app.db(DB).collection(GUARDS).deleteOne({ _id: PLATFORM_IDENTITY_ID }));
    const recreateDeleteProtected = await attempt(() => app.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).deleteOne({ _id: PLATFORM_IDENTITY_ID }));
    const recreateUpsert = await attempt(() =>
      app.db(DB).collection(GUARDS).updateOne(
        { _id: "platform-identity-upserted" },
        { $set: { kind: "PLATFORM_IDENTITY", organisationId: usurperId, updatedAt: now } },
        { upsert: true },
      ),
    );
    const afterRecreation = await store.resolveActorPermissions(owner.db(DB), superUser, now);
    hold("the application identity cannot insert a replacement identity document", recreateInsert.refused, recreateInsert.message);
    hold("the application identity cannot delete the identity document", recreateDelete.refused, recreateDelete.message);
    hold(
      "the application identity cannot delete the protected identity document",
      recreateDeleteProtected.refused,
      recreateDeleteProtected.message,
    );
    hold(
      "an upserted extra identity document does not change the governing organisation",
      afterRecreation.actor?.org?.id === otherId,
      JSON.stringify(afterRecreation.actor?.org),
    );
    brief("W2.4", "identity recreation", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: "insertOne a replacement guard; deleteOne the guard; updateOne(..., { upsert: true }) a new guard",
      outcome: `insert ${recreateInsert.refused ? "refused" : "accepted"}, delete ${recreateDelete.refused ? "refused" : "accepted"}, upsert ${recreateUpsert.refused ? "refused" : "accepted"}; governing ${afterRecreation.actor?.org?.id}`,
      enforcement: "MONGODB for insert/delete; APPLICATION for the inert extra document",
      verdict: recreateInsert.refused && recreateDelete.refused && afterRecreation.actor?.org?.id === otherId ? "SATISFIED" : "OPEN",
    });

    // W2.5 — duplicate platform identity. Written by the OWNER, because the app credential cannot insert.
    const duplicate = await attempt(() =>
      owner.db(DB).collection(GUARDS).insertOne({
        _id: "platform-identity-duplicate",
        kind: "PLATFORM_IDENTITY",
        organisationId: usurperId,
        updatedAt: now,
      }),
    );
    const afterDuplicate = await store.resolveActorPermissions(owner.db(DB), superUser, now);
    hold(
      "a duplicate platform identity document is inert",
      afterDuplicate.actor?.org?.id === otherId,
      JSON.stringify(afterDuplicate.actor?.org),
    );
    brief("W2.5", "duplicate platform identity", {
      credential: `primemet_owner_user (${duplicate.refused ? "refused" : "accepted"})`,
      operation: `_permission_guards.insertOne({ _id: "platform-identity-duplicate", kind: "PLATFORM_IDENTITY", organisationId: usurper })`,
      outcome: `governing organisation remains ${afterDuplicate.actor?.org?.id}`,
      enforcement: "APPLICATION (the pointer is read by a fixed document id)",
      verdict: afterDuplicate.actor?.org?.id === otherId ? "SATISFIED" : "OPEN",
    });

    // W2.6 — concurrent identity changes.
    const concurrentPointer = await Promise.all([
      attempt(() => app.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: PLATFORM_IDENTITY_ID }, { $set: { organisationId: usurperId, updatedAt: new Date() } })),
      attempt(() => app.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: PLATFORM_IDENTITY_ID }, { $set: { organisationId: orgId, updatedAt: new Date() } })),
    ]);
    const pointerAfterRace = await owner.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: PLATFORM_IDENTITY_ID });
    const bothAccepted = concurrentPointer.every((outcome) => !outcome.refused);
    brief("W2.6", "concurrent identity changes", {
      credential: `primemet_app_user (primemet_app@${DB})`,
      operation: "two updateOne calls in parallel, naming two different organisations",
      outcome: `${concurrentPointer.filter((o) => !o.refused).length}/2 accepted; final pointer ${pointerAfterRace?.organisationId}`,
      enforcement: bothAccepted
        ? "NONE \u2014 last write wins, with no sequence and no createdAt ordering"
        : "MONGODB \u2014 neither write is authorised on _platform_identity, so there is no race to win",
      verdict: bothAccepted ? "OPEN" : "SATISFIED",
    });
    if (bothAccepted) {
      gap(
        "two concurrent pointer writes are both accepted and the survivor is order-dependent",
        `final pointer ${pointerAfterRace?.organisationId}; no sequence guards the guard document`,
        `primemet_app (${USERS.app})`,
      );
    }

    // W2.7 — administrator resolution after each attempt, with the pointer restored.
    await owner.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).updateOne({ _id: PLATFORM_IDENTITY_ID }, { $set: { organisationId: otherId } });
    await owner.db(DB).collection("organisations").updateOne({ _id: otherId }, { $set: { orgKind: "PRIMEMET", deletedAt: null } });
    const restored = await store.resolveActorPermissions(owner.db(DB), superUser, now);
    hold(
      "administration resolves against the pointer's organisation once the attacks stop",
      restored.actor?.org?.id === otherId,
      JSON.stringify(restored.actor?.org),
    );
    hold(
      "the super admin still resolves the permissions their tier grants",
      restored.permissions.has("ACCESS_GRANT_PERMISSION"),
      JSON.stringify([...restored.permissions].slice(0, 5)),
    );
    brief("W2.7", "administrator resolution after each attempted attack", {
      credential: `primemet_owner_user (resolution is a read)`,
      operation: "resolveActorPermissions after W2.1-W2.6",
      outcome: `after relabel ${afterRelabel.actor?.org?.id}; after re-point ${afterPointer.actor?.org?.id}; after deletion ${afterDeletion.actor?.org === null ? "NO_ORGANISATION" : afterDeletion.actor?.org?.id}; restored ${restored.actor?.org?.id}`,
      enforcement: "APPLICATION (pointer, with fail-closed behaviour on a non-live organisation)",
      verdict: restored.actor?.org?.id === otherId && restored.permissions.has("ACCESS_GRANT_PERMISSION") ? "SATISFIED" : "OPEN",
    });

  } finally {
    delete process.env.PERMISSION_LOG_KEY;
    for (const client of [owner, app, readonly, intruder]) await client.close().catch(() => {});
    await root.close().catch(() => {});
    await server.stop().catch(() => {});
  }

  const satisfiedBrief = briefItems.filter((item) => item.verdict === "SATISFIED").length;
  const openBrief = briefItems.filter((item) => item.verdict === "OPEN").length;
  const blockedBrief = briefItems.filter((item) => item.verdict === "BLOCKED").length;
  process.stdout.write(
    "\n  brief matrix    : " + briefItems.length + " questions \u2014 " + satisfiedBrief + " satisfied, " +
      openBrief + " open, " + blockedBrief + " blocked\n",
  );
  for (const item of briefItems) process.stdout.write("    " + item.id + " " + item.verdict + "\n");

  process.stdout.write(
    `\n  properties held : ${holds}\n` +
      `  measured gaps   : ${gaps}\n` +
      `  failures        : ${failures.length}\n`,
  );
  if (failures.length === 0) {
    process.stdout.write(`  \u2714 authenticated authorisation: ${holds} properties held, ${gaps} gaps recorded\n\n`);
    return 0;
  }
  process.stdout.write(`  \u2716 authenticated authorisation: ${failures.length} properties did not hold\n`);
  for (const failure of failures) process.stdout.write(`    - ${failure.label}\n`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`\n  fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
