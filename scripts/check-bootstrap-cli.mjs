#!/usr/bin/env node
/**
 * PRIMEMET — the first-SUPER_ADMIN bootstrap CLI, exercised against a real authenticated replica set.
 *
 * WHY THIS SUITE EXISTS. `db/bootstrap-organisation.mjs` is the one code path in the repository that can
 * create an administrator. Everything it does is a refusal waiting to be tested: it must refuse the
 * runtime identity, refuse a mismatched organisation, refuse a duplicate, and leave nothing behind when
 * a write fails halfway. A bootstrap that is merely "reviewed" is a bootstrap nobody has run.
 *
 * WHAT IT PROVES, in order:
 *   1. a clean run creates exactly one organisation, one ADMIN user, one SUPER_ADMIN profile, three
 *      CRITICAL audit rows under one requestId, and seeds the protected pointer;
 *   2. a second identical run performs zero inserts and records BOOTSTRAP_VERIFIED;
 *   3. a differing legal name aborts before any write;
 *   4. two live platform organisations abort;
 *   5. an existing non-ADMIN user, or a non-SUPER_ADMIN profile, aborts;
 *   6. a pointer naming a different organisation aborts;
 *   7. the runtime identity is refused;
 *   8. a missing MONGODB_URI is refused by the CLI itself;
 *   9. a failure inside the transaction leaves zero documents of any kind;
 *   9b. a partial failure (documents committed, pointer missing) is repaired by re-running;
 *   9c. a failure DURING pointer creation after the commit is reported as PARTIAL COMPLETION, flagged
 *       `partial`, and mapped to exit code 3 rather than 1;
 *   9d. that partial state is repaired by re-running, with no duplicate organisation, user or profile;
 *   9e. an ADMIN user or SUPER_ADMIN profile the bootstrap did not create is never adopted;
 *  10. `_permission_guards` is byte-identical before and after;
 *  11. a dry run writes nothing, including audit;
 *  12. a weak password is refused by the application's own policy;
 *  13. nothing under `src/` imports the CLI, so it cannot be reached over HTTP.
 *
 * The database is an in-memory replica set with `--auth` and a keyfile. No configured or production
 * database is contacted, and the process exits non-zero if any assertion fails.
 */

import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MIGRATIONS } from "../db/migrations/index.mjs";
import { applyMigrations } from "../db/ledger.mjs";
import { buildRoleDefinitions } from "../db/roles.mjs";
import { GUARDS, GUARD_LAST_SUPER_ADMIN, PLATFORM_IDENTITY_COLLECTION, GUARD_PLATFORM_IDENTITY } from "../db/guards.mjs";
import { hashPassword, passwordProblem } from "../src/lib/auth/password.ts";
import {
  BootstrapError,
  applyBootstrap,
  assertOwnerIdentity,
  exitCodeFor,
  generatePassword,
  parseBootstrapArgs,
  planBootstrap,
  validateBootstrapArgs,
} from "../db/bootstrap-organisation.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DB = "primemet_bootstrap_check";
const PASSWORD = "bootstrap-check-password-1";

let held = 0;
let failed = 0;

function hold(label, condition, detail = "") {
  if (condition) {
    held += 1;
    process.stdout.write(`  \u2714 ${label}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  \u2716 ${label}${detail ? ` — ${detail}` : ""}\n`);
  }
}

async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** The arguments a real operator would type, with the confirmation matching. */
function baseArgs(overrides = {}) {
  return validateBootstrapArgs(
    parseBootstrapArgs([
      "--legal-name", "PRIMEMET Industrial Solutions Private Limited",
      "--country-code", "IN",
      "--admin-email", "operator@primemet.test",
      "--admin-name", "Platform Operator",
      "--staff-code", "PM-0001",
      "--confirm", "PRIMEMET Industrial Solutions Private Limited",
      ...Object.entries(overrides).flatMap(([key, value]) => [`--${key}`, value]),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Every document the bootstrap could touch, so "nothing was written" is a measurement, not a claim. */
async function census(db) {
  const count = async (name) => {
    try {
      return await db.collection(name).countDocuments();
    } catch {
      return -1;
    }
  };
  return {
    organisations: await count("organisations"),
    users: await count("users"),
    admin_profiles: await count("admin_profiles"),
    audit_logs: await count("audit_logs"),
    platform_identity: await count(PLATFORM_IDENTITY_COLLECTION),
  };
}

/** The guard collection, read as raw documents so a byte-level change is visible. */
async function guardSnapshot(db) {
  try {
    return JSON.stringify(await db.collection(GUARDS).find({}).sort({ _id: 1 }).toArray());
  } catch {
    return "ABSENT";
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

  const root = new MongoClient(server.getUri(), {
    auth: { username: "mongodb-memory-server-root", password: "rootuser" },
    authSource: "admin",
  });

  let owner;
  let app;

  try {
    await root.connect();

    process.stdout.write("\n0. Fixture\n");
    const migrated = await attempt(() =>
      applyMigrations(root.db(DB), { migrations: MIGRATIONS, appliedBy: "check-bootstrap-cli", log: () => {} }),
    );
    hold("the schema applies to a scratch database", migrated.ok && !migrated.value?.refused, String(migrated.error?.message ?? "").slice(0, 200));

    // Roles are created INSIDE the target database, so `resource.db: ""` resolves to it rather than to
    // admin. Creating them in admin produces a role the target database cannot find.
    for (const definition of buildRoleDefinitions()) {
      const privileges = definition.privileges.map((privilege) => ({
        resource: {
          db: privilege.resource.db === "" ? DB : privilege.resource.db,
          collection: privilege.resource.collection ?? "",
        },
        actions: [...privilege.actions],
      }));
      await root.db(DB).command({ createRole: definition.role, privileges, roles: [] });
    }
    // Created in the TARGET database, so the client below can authenticate with authSource: DB.
    for (const [name, role] of [["bootstrap-owner", "primemet_owner"], ["bootstrap-app", "primemet_app"]]) {
      await root.db(DB).command({
        createUser: name,
        pwd: PASSWORD,
        roles: [{ role, db: DB }],
        mechanisms: ["SCRAM-SHA-256"],
      });
    }
    hold("owner and runtime identities exist", true);

    owner = new MongoClient(server.getUri(), { auth: { username: "bootstrap-owner", password: PASSWORD }, authSource: DB });
    app = new MongoClient(server.getUri(), { auth: { username: "bootstrap-app", password: PASSWORD }, authSource: DB });
    await owner.connect();
    await app.connect();

    const db = owner.db(DB);
    const guardsBefore = await guardSnapshot(db);
    const args = baseArgs();
    const passwordHash = await hashPassword("Operator-Password-1");

    // -----------------------------------------------------------------------
    process.stdout.write("\n1. The runtime identity is refused\n");
    // -----------------------------------------------------------------------
    const appRefusal = await attempt(() => assertOwnerIdentity(app.db(DB)));
    hold(
      "primemet_app cannot run a bootstrap",
      !appRefusal.ok && appRefusal.error instanceof BootstrapError && appRefusal.error.code === "BOOTSTRAP_APP_IDENTITY",
      appRefusal.ok ? "it was allowed" : String(appRefusal.error?.code ?? appRefusal.error?.message),
    );
    const ownerIdentity = await attempt(() => assertOwnerIdentity(db));
    hold("primemet_owner is accepted", ownerIdentity.ok && ownerIdentity.value.owner.includes("primemet_owner"));

    // -----------------------------------------------------------------------
    process.stdout.write("\n2. A dry run writes nothing\n");
    // -----------------------------------------------------------------------
    const beforeDry = await census(db);
    const dryPlan = await planBootstrap(db, args);
    const afterDry = await census(db);
    hold("the plan is all inserts", dryPlan.organisation.action === "insert" && dryPlan.user.action === "insert" && dryPlan.profile.action === "insert");
    hold("planning writes nothing", JSON.stringify(beforeDry) === JSON.stringify(afterDry), JSON.stringify(afterDry));

    // -----------------------------------------------------------------------
    process.stdout.write("\n3. A clean run creates exactly one of each\n");
    // -----------------------------------------------------------------------
    const applied = await attempt(() => applyBootstrap(owner, db, dryPlan, args, { passwordHash, log: () => {} }));
    hold("the bootstrap applies", applied.ok, String(applied.error?.message ?? "").slice(0, 300));

    const orgs = await db.collection("organisations").find({ orgKind: "PRIMEMET", deletedAt: null }).toArray();
    hold("exactly one live platform organisation", orgs.length === 1, String(orgs.length));
    hold("it carries the supplied legal identity", orgs[0]?.legalName === args.legalName && orgs[0]?.countryCode === "IN");

    const user = await db.collection("users").findOne({ email: args.adminEmail });
    hold("the admin user exists", Boolean(user));
    hold("it is ADMIN and ACTIVE", user?.role === "ADMIN" && user?.status === "ACTIVE", `${user?.role}/${user?.status}`);
    hold("its password hash is a real scrypt record", /^scrypt\$\d+\$\d+\$\d+\$/.test(user?.passwordHash ?? ""));
    hold("the hash is not the plaintext", user?.passwordHash !== "Operator-Password-1");

    const profile = await db.collection("admin_profiles").findOne({ userId: user?._id });
    hold("the profile is SUPER_ADMIN and active", profile?.tier === "SUPER_ADMIN" && profile?.isActive === true, `${profile?.tier}/${profile?.isActive}`);

    const pointer = await db.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: GUARD_PLATFORM_IDENTITY });
    hold("the protected pointer names the new organisation", pointer?.organisationId === orgs[0]?._id, String(pointer?.organisationId));

    const auditRows = await db.collection("audit_logs").find({}).toArray();
    hold("three CRITICAL audit rows were written", auditRows.length === 3, String(auditRows.length));
    hold("they share one requestId", new Set(auditRows.map((row) => row.requestId)).size === 1);
    hold("they are all CRITICAL", auditRows.every((row) => row.severity === "CRITICAL"));
    hold(
      "they name the three objects",
      ["BOOTSTRAP_ORGANISATION", "BOOTSTRAP_ADMIN_USER", "BOOTSTRAP_ADMIN_PROFILE"].every((action) =>
        auditRows.some((row) => row.action === action),
      ),
    );
    hold("no audit row contains a password or hash", !JSON.stringify(auditRows).includes("scrypt$") && !JSON.stringify(auditRows).includes("Operator-Password-1"));

    // -----------------------------------------------------------------------
    process.stdout.write("\n4. A second identical run is idempotent\n");
    // -----------------------------------------------------------------------
    const beforeSecond = await census(db);
    const secondPlan = await planBootstrap(db, args);
    hold("the second plan is all verifies", secondPlan.organisation.action === "verify" && secondPlan.user.action === "verify" && secondPlan.profile.action === "verify");
    hold("it is reported as already bootstrapped", secondPlan.alreadyBootstrapped === true);
    const second = await attempt(() => applyBootstrap(owner, db, secondPlan, args, { passwordHash, log: () => {} }));
    hold("the second run succeeds", second.ok, String(second.error?.message ?? "").slice(0, 200));
    hold("it inserts no business document", second.ok && second.value.written.organisation === 0 && second.value.written.user === 0 && second.value.written.profile === 0);
    const afterSecond = await census(db);
    hold("the census is unchanged except for one audit row", afterSecond.audit_logs === beforeSecond.audit_logs + 1 && afterSecond.organisations === beforeSecond.organisations && afterSecond.users === beforeSecond.users, JSON.stringify(afterSecond));
    const verified = await db.collection("audit_logs").findOne({ action: "BOOTSTRAP_VERIFIED" });
    hold("the second run records BOOTSTRAP_VERIFIED", Boolean(verified) && verified.severity === "CRITICAL");

    // -----------------------------------------------------------------------
    process.stdout.write("\n5. A differing legal name aborts before any write\n");
    // -----------------------------------------------------------------------
    const beforeMismatch = await census(db);
    const mismatchArgs = validateBootstrapArgs(
      parseBootstrapArgs([
        "--legal-name", "Some Other Company Private Limited",
        "--country-code", "IN",
        "--admin-email", "second@primemet.test",
        "--admin-name", "Second Operator",
        "--staff-code", "PM-0002",
        "--confirm", "Some Other Company Private Limited",
      ]),
    );
    const mismatch = await attempt(() => planBootstrap(db, mismatchArgs));
    hold(
      "a mismatched organisation is refused",
      !mismatch.ok && mismatch.error.code === "BOOTSTRAP_ORGANISATION_MISMATCH",
      String(mismatch.error?.code ?? "allowed"),
    );
    hold("the refusal names both identities", /existing/.test(mismatch.error?.message ?? "") && /supplied/.test(mismatch.error?.message ?? ""));
    hold("nothing was written", JSON.stringify(await census(db)) === JSON.stringify(beforeMismatch));

    // -----------------------------------------------------------------------
    process.stdout.write("\n6. Two live platform organisations abort\n");
    // -----------------------------------------------------------------------
    // The partial unique index makes two live PRIMEMET rows impossible — which is exactly why the CLI's
    // ambiguity branch is defensive. To prove it refuses that state if the index is ever lost, the state
    // is constructed with the ROOT identity (privileges the CLI itself must never hold) and the index is
    // restored afterwards.
    const orgIndex = (await db.collection("organisations").indexes()).find(
      (ix) => ix.name === "ix_organisations_orgKind_u_p",
    );
    hold("the partial unique index is present before the experiment", Boolean(orgIndex));
    await root.db(DB).command({ dropIndexes: "organisations", index: "ix_organisations_orgKind_u_p" });
    await db.collection("organisations").insertOne({
      _id: randomUUID(),
      legalName: "Rogue Platform",
      countryCode: "IN",
      orgType: "BOTH",
      orgKind: "PRIMEMET",
      accountStatus: "ACTIVE",
      isListable: false,
      verificationStatus: "VERIFIED",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const ambiguous = await attempt(() => planBootstrap(db, args));
    hold(
      "an ambiguous platform organisation is refused",
      !ambiguous.ok && ambiguous.error.code === "BOOTSTRAP_AMBIGUOUS_ORGANISATION",
      String(ambiguous.error?.code ?? "allowed"),
    );
    // No identity in the access model holds `delete` on organisations (OD-16), so the fixture is removed
    // with the root connection — the same reason the index was dropped with it.
    await root.db(DB).collection("organisations").deleteOne({ legalName: "Rogue Platform" });
    if (orgIndex) {
      await root.db(DB).collection("organisations").createIndex(orgIndex.key, {
        name: orgIndex.name,
        unique: true,
        partialFilterExpression: orgIndex.partialFilterExpression,
      });
      hold("the partial unique index is restored", true);
    }

    // -----------------------------------------------------------------------
    process.stdout.write("\n7. A conflicting user or profile aborts\n");
    // -----------------------------------------------------------------------
    const buyerId = randomUUID();
    await db.collection("users").insertOne({
      _id: buyerId,
      email: "buyer@primemet.test",
      emailVerifiedAt: null,
      passwordHash: null,
      passwordChangedAt: null,
      fullName: "A Buyer",
      phone: null,
      locale: "en-IN",
      role: "BUYER",
      status: "ACTIVE",
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const buyerArgs = validateBootstrapArgs(
      parseBootstrapArgs([
        "--legal-name", args.legalName,
        "--country-code", "IN",
        "--admin-email", "buyer@primemet.test",
        "--admin-name", "A Buyer",
        "--staff-code", "PM-0003",
        "--confirm", args.legalName,
      ]),
    );
    const roleConflict = await attempt(() => planBootstrap(db, buyerArgs));
    hold(
      "an existing BUYER cannot be promoted by the bootstrap",
      !roleConflict.ok && roleConflict.error.code === "BOOTSTRAP_USER_ROLE_CONFLICT",
      String(roleConflict.error?.code ?? "allowed"),
    );

    const secondAdminId = randomUUID();
    await db.collection("users").insertOne({
      _id: secondAdminId,
      email: "readonly@primemet.test",
      emailVerifiedAt: new Date(),
      passwordHash: null,
      passwordChangedAt: null,
      fullName: "Read Only Admin",
      phone: null,
      locale: "en-IN",
      role: "ADMIN",
      status: "ACTIVE",
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("admin_profiles").insertOne({
      _id: randomUUID(),
      userId: secondAdminId,
      staffCode: "PM-0004",
      jobTitle: null,
      desk: null,
      tier: "READ_ONLY_ADMIN",
      mfaRequired: true,
      approvalLimit: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const tierArgs = validateBootstrapArgs(
      parseBootstrapArgs([
        "--legal-name", args.legalName,
        "--country-code", "IN",
        "--admin-email", "readonly@primemet.test",
        "--admin-name", "Read Only Admin",
        "--staff-code", "PM-0004",
        "--confirm", args.legalName,
      ]),
    );
    const tierConflict = await attempt(() => planBootstrap(db, tierArgs));
    hold(
      "an existing non-SUPER_ADMIN profile is not silently promoted",
      !tierConflict.ok && tierConflict.error.code === "BOOTSTRAP_PROFILE_TIER_CONFLICT",
      String(tierConflict.error?.code ?? "allowed"),
    );

    // -----------------------------------------------------------------------
    process.stdout.write("\n8. A pointer naming another organisation aborts\n");
    // -----------------------------------------------------------------------
    const originalPointer = await db.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: GUARD_PLATFORM_IDENTITY });
    await db.collection(PLATFORM_IDENTITY_COLLECTION).updateOne(
      { _id: GUARD_PLATFORM_IDENTITY },
      { $set: { organisationId: randomUUID(), updatedAt: new Date() } },
    );
    const pointerConflict = await attempt(() => planBootstrap(db, args));
    hold(
      "a re-anchor is refused, not performed",
      !pointerConflict.ok && pointerConflict.error.code === "BOOTSTRAP_POINTER_CONFLICT",
      String(pointerConflict.error?.code ?? "allowed"),
    );
    await db.collection(PLATFORM_IDENTITY_COLLECTION).updateOne(
      { _id: GUARD_PLATFORM_IDENTITY },
      { $set: { organisationId: originalPointer.organisationId, updatedAt: originalPointer.updatedAt } },
    );

    // -----------------------------------------------------------------------
    process.stdout.write("\n9. A failure inside the transaction leaves nothing behind\n");
    // -----------------------------------------------------------------------
    // A unique-index conflict on staffCode is the realistic failure: the operator reuses a code that
    // another admin already holds. The organisation and user inserts must roll back with it.
    const blockerId = randomUUID();
    await db.collection("users").insertOne({
      _id: blockerId,
      email: "blocker@primemet.test",
      emailVerifiedAt: new Date(),
      passwordHash: null,
      passwordChangedAt: null,
      fullName: "Blocker",
      phone: null,
      locale: "en-IN",
      role: "ADMIN",
      status: "ACTIVE",
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("admin_profiles").insertOne({
      _id: randomUUID(),
      userId: blockerId,
      staffCode: "PM-0009",
      jobTitle: null,
      desk: null,
      tier: "SUPER_ADMIN",
      mfaRequired: true,
      approvalLimit: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const clashArgs = validateBootstrapArgs(
      parseBootstrapArgs([
        "--legal-name", args.legalName,
        "--country-code", "IN",
        "--admin-email", "clash@primemet.test",
        "--admin-name", "Clash Operator",
        "--staff-code", "PM-0009",
        "--confirm", args.legalName,
      ]),
    );
    const beforeClash = await census(db);
    const clashPlan = await planBootstrap(db, clashArgs);
    const clash = await attempt(() => applyBootstrap(owner, db, clashPlan, clashArgs, { passwordHash, log: () => {} }));
    const afterClash = await census(db);
    hold("the conflicting run fails", !clash.ok, "it succeeded");
    hold("no user was left behind", afterClash.users === beforeClash.users, `${beforeClash.users} → ${afterClash.users}`);
    hold("no audit row was left behind", afterClash.audit_logs === beforeClash.audit_logs, `${beforeClash.audit_logs} → ${afterClash.audit_logs}`);
    hold("no organisation was left behind", afterClash.organisations === beforeClash.organisations);
    hold("the pointer was not moved", (await db.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: GUARD_PLATFORM_IDENTITY }))?.organisationId === originalPointer.organisationId);

    // -----------------------------------------------------------------------
    process.stdout.write("\n9b. A partial failure is repaired by re-running\n");
    // -----------------------------------------------------------------------
    // The one state applyBootstrap can leave behind: business documents committed, pointer not. The
    // re-run must converge WITHOUT asking for a password, because the account already exists.
    await root.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).deleteOne({ _id: GUARD_PLATFORM_IDENTITY });
    const recoveryPlan = await planBootstrap(db, args);
    hold(
      "the recovery plan inserts nothing",
      recoveryPlan.organisation.action === "verify" &&
        recoveryPlan.user.action === "verify" &&
        recoveryPlan.profile.action === "verify",
    );
    hold("it reports the pointer as unseeded", recoveryPlan.pointerAction === "seed");
    const beforeRecovery = await census(db);
    const recovery = await attempt(() => applyBootstrap(owner, db, recoveryPlan, args, { log: () => {} }));
    hold("the re-run succeeds with no password supplied", recovery.ok, String(recovery.error?.message ?? "").slice(0, 200));
    hold(
      "the pointer is seeded back to the same organisation",
      (await db.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: GUARD_PLATFORM_IDENTITY }))?.organisationId ===
        originalPointer.organisationId,
    );
    const afterRecovery = await census(db);
    hold(
      "no business document was touched by the repair",
      afterRecovery.users === beforeRecovery.users &&
        afterRecovery.admin_profiles === beforeRecovery.admin_profiles &&
        afterRecovery.organisations === beforeRecovery.organisations,
    );

    // -----------------------------------------------------------------------
    process.stdout.write("\n9c. A pointer failure after the transaction is reported as partial\n");
    // -----------------------------------------------------------------------
    // The one window the transaction cannot cover: DDL is refused inside a transaction, so the pointer is
    // seeded afterwards. A failure there leaves a real SUPER_ADMIN who cannot resolve permissions. The
    // failure is injected through the `ensurePointer` seam, which defaults to the real function.
    await root.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).deleteOne({ _id: GUARD_PLATFORM_IDENTITY });
    const partialPlan = await planBootstrap(db, args);
    const beforePartial = await census(db);
    const partial = await attempt(() =>
      applyBootstrap(owner, db, partialPlan, args, {
        log: () => {},
        ensurePointer: async () => {
          throw new Error("injected DDL failure");
        },
      }),
    );
    hold("the injected pointer failure is reported", !partial.ok);
    // Printed, not only asserted: the operator-facing text is the deliverable, so the log shows it.
    process.stdout.write("    --- operator-facing message ---\n" +
      String(partial.error?.message ?? "").split("\n").map((line) => "    " + line).join("\n") + "\n");
    hold(
      "it is a BootstrapError with a stable code",
      partial.error instanceof BootstrapError && partial.error.code === "BOOTSTRAP_POINTER_FAILED",
      String(partial.error?.code ?? "none"),
    );
    hold("it is flagged as partial", partial.error?.partial === true);
    hold(
      "it carries the requestId of the committed run",
      typeof partial.error?.requestId === "string" && partial.error.requestId.length > 0,
    );
    hold("it says the business documents were committed", /were committed/i.test(partial.error?.message ?? ""));
    hold("it names the cause", /injected DDL failure/.test(partial.error?.message ?? ""));
    hold("it names the recovery", /re-run this command/i.test(partial.error?.message ?? ""));
    hold("it does not claim the run succeeded", !/bootstrap applied/.test(partial.error?.message ?? ""));
    hold("the CLI maps it to exit code 3, not 1", exitCodeFor(partial.error) === 3, String(exitCodeFor(partial.error)));
    hold("a plain refusal still maps to exit code 1", exitCodeFor(new BootstrapError("X", "y")) === 1);

    const afterPartial = await census(db);
    hold(
      "the business documents are committed, not rolled back",
      afterPartial.users === beforePartial.users &&
        afterPartial.admin_profiles === beforePartial.admin_profiles &&
        afterPartial.organisations === beforePartial.organisations,
      JSON.stringify({ beforePartial, afterPartial }),
    );
    hold(
      "the pointer is still absent",
      (await db.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: GUARD_PLATFORM_IDENTITY })) === null,
    );

    // -----------------------------------------------------------------------
    process.stdout.write("\n9d. The partial state is repaired by re-running, with no duplicates\n");
    // -----------------------------------------------------------------------
    const repairPlan = await planBootstrap(db, args);
    hold(
      "the repair plan inserts nothing",
      repairPlan.organisation.action === "verify" &&
        repairPlan.user.action === "verify" &&
        repairPlan.profile.action === "verify",
    );
    const beforeRepair = await census(db);
    const repair = await attempt(() => applyBootstrap(owner, db, repairPlan, args, { log: () => {} }));
    hold("the repair succeeds", repair.ok, String(repair.error?.message ?? "").slice(0, 200));
    hold(
      "the pointer now names the organisation",
      (await db.collection(PLATFORM_IDENTITY_COLLECTION).findOne({ _id: GUARD_PLATFORM_IDENTITY }))?.organisationId ===
        originalPointer.organisationId,
    );
    const afterRepair = await census(db);
    hold(
      "no duplicate organisation, user or profile",
      afterRepair.organisations === beforeRepair.organisations &&
        afterRepair.users === beforeRepair.users &&
        afterRepair.admin_profiles === beforeRepair.admin_profiles,
      JSON.stringify({ beforeRepair, afterRepair }),
    );
    hold("the repair is auditable", afterRepair.audit_logs === beforeRepair.audit_logs + 1);

    // -----------------------------------------------------------------------
    process.stdout.write("\n9e. An account the bootstrap did not create is never adopted\n");
    // -----------------------------------------------------------------------
    // A partial state must not become a promotion path. An ADMIN user that no bootstrap recorded creating
    // is refused, even though its role and status would otherwise pass.
    const strayId = randomUUID();
    await db.collection("users").insertOne({
      _id: strayId,
      email: "stray@primemet.test",
      emailVerifiedAt: new Date(),
      passwordHash: null,
      passwordChangedAt: null,
      fullName: "Stray Admin",
      phone: null,
      locale: "en-IN",
      role: "ADMIN",
      status: "ACTIVE",
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const strayArgs = validateBootstrapArgs(
      parseBootstrapArgs([
        "--legal-name", args.legalName,
        "--country-code", "IN",
        "--admin-email", "stray@primemet.test",
        "--admin-name", "Stray Admin",
        "--staff-code", "PM-0007",
        "--confirm", args.legalName,
      ]),
    );
    const beforeStray = await census(db);
    const stray = await attempt(() => planBootstrap(db, strayArgs));
    hold(
      "an ADMIN user with no bootstrap provenance is refused",
      !stray.ok && stray.error.code === "BOOTSTRAP_USER_NOT_BOOTSTRAP_ORIGIN",
      String(stray.error?.code ?? "allowed"),
    );
    hold("nothing was written", JSON.stringify(await census(db)) === JSON.stringify(beforeStray));

    // The same rule for the profile: a user a bootstrap DID create, whose SUPER_ADMIN profile it did not.
    const halfId = randomUUID();
    await db.collection("users").insertOne({
      _id: halfId,
      email: "half@primemet.test",
      emailVerifiedAt: new Date(),
      passwordHash: null,
      passwordChangedAt: null,
      fullName: "Half Bootstrapped",
      phone: null,
      locale: "en-IN",
      role: "ADMIN",
      status: "ACTIVE",
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("audit_logs").insertOne({
      _id: randomUUID(),
      occurredAt: new Date(),
      actorUserId: null,
      actorRole: null,
      actorIpHash: null,
      action: "BOOTSTRAP_ADMIN_USER",
      entityType: "users",
      entityId: halfId,
      beforeState: null,
      afterState: { email: "half@primemet.test", role: "ADMIN", status: "ACTIVE", passwordSet: true },
      requestId: randomUUID(),
      severity: "CRITICAL",
      createdAt: new Date(),
    });
    await db.collection("admin_profiles").insertOne({
      _id: randomUUID(),
      userId: halfId,
      staffCode: "PM-0008",
      jobTitle: null,
      desk: null,
      tier: "SUPER_ADMIN",
      mfaRequired: true,
      approvalLimit: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const halfArgs = validateBootstrapArgs(
      parseBootstrapArgs([
        "--legal-name", args.legalName,
        "--country-code", "IN",
        "--admin-email", "half@primemet.test",
        "--admin-name", "Half Bootstrapped",
        "--staff-code", "PM-0008",
        "--confirm", args.legalName,
      ]),
    );
    const beforeHalf = await census(db);
    const half = await attempt(() => planBootstrap(db, halfArgs));
    hold(
      "a SUPER_ADMIN profile with no bootstrap provenance is refused",
      !half.ok && half.error.code === "BOOTSTRAP_PROFILE_NOT_BOOTSTRAP_ORIGIN",
      String(half.error?.code ?? "allowed"),
    );
    hold("nothing was written", JSON.stringify(await census(db)) === JSON.stringify(beforeHalf));

    // -----------------------------------------------------------------------
    process.stdout.write("\n9f. A first run that fails at the pointer leaves a real, unusable account\n");
    // -----------------------------------------------------------------------
    // The scenario the transaction cannot cover, from a clean slate: the organisation, user, profile and
    // audit rows are inserted and committed, then the pointer step fails. The account is real and cannot
    // sign in. This is the state the runbook's §6.5.1 describes, and the counts must say so.
    await root.db(DB).collection(PLATFORM_IDENTITY_COLLECTION).deleteOne({ _id: GUARD_PLATFORM_IDENTITY });
    await root.db(DB).collection("admin_profiles").deleteMany({});
    await root.db(DB).collection("users").deleteMany({});
    await root.db(DB).collection("organisations").deleteMany({});
    await root.db(DB).collection("audit_logs").deleteMany({});

    const freshArgs = validateBootstrapArgs(
      parseBootstrapArgs([
        "--legal-name", "Primemet Fresh Private Limited",
        "--country-code", "IN",
        "--admin-email", "fresh@primemet.test",
        "--admin-name", "Fresh Operator",
        "--staff-code", "PM-0010",
        "--confirm", "Primemet Fresh Private Limited",
      ]),
    );
    const freshPlan = await planBootstrap(db, freshArgs);
    hold(
      "the fresh plan inserts everything",
      freshPlan.organisation.action === "insert" &&
        freshPlan.user.action === "insert" &&
        freshPlan.profile.action === "insert",
    );
    const fresh = await attempt(() =>
      applyBootstrap(owner, db, freshPlan, freshArgs, {
        passwordHash,
        log: () => {},
        ensurePointer: async () => {
          throw new Error("injected DDL failure on a first run");
        },
      }),
    );
    hold("the first run fails at the pointer", !fresh.ok && fresh.error?.code === "BOOTSTRAP_POINTER_FAILED");
    hold("it is flagged partial", fresh.error?.partial === true);
    hold(
      "it reports the committed counts, not zeros",
      /organisation 1, user 1, profile 1, audit 3/.test(fresh.error?.message ?? ""),
      (fresh.error?.message ?? "").split("\n")[1] ?? "",
    );
    const freshCensus = await census(db);
    hold(
      "the organisation, user, profile and audit rows are committed",
      freshCensus.organisations === 1 &&
        freshCensus.users === 1 &&
        freshCensus.admin_profiles === 1 &&
        freshCensus.audit_logs === 3,
      JSON.stringify(freshCensus),
    );
    hold("the pointer is absent, so the account cannot resolve permissions", freshCensus.platform_identity === 0);
    const freshUser = await db.collection("users").findOne({ email: "fresh@primemet.test" });
    hold("the account is real and ACTIVE", freshUser?.role === "ADMIN" && freshUser?.status === "ACTIVE");

    // The repair: the identical command, no password, no duplicates.
    const freshRepairPlan = await planBootstrap(db, freshArgs);
    hold(
      "the repair plan inserts nothing",
      freshRepairPlan.organisation.action === "verify" &&
        freshRepairPlan.user.action === "verify" &&
        freshRepairPlan.profile.action === "verify",
    );
    const freshRepair = await attempt(() => applyBootstrap(owner, db, freshRepairPlan, freshArgs, { log: () => {} }));
    hold("the repair succeeds", freshRepair.ok, String(freshRepair.error?.message ?? "").slice(0, 200));
    const repairedCensus = await census(db);
    hold(
      "no duplicate organisation, user or profile",
      repairedCensus.organisations === 1 && repairedCensus.users === 1 && repairedCensus.admin_profiles === 1,
      JSON.stringify(repairedCensus),
    );
    hold("the pointer now names the organisation", repairedCensus.platform_identity === 1);
    hold("the repair is auditable", repairedCensus.audit_logs === 4, String(repairedCensus.audit_logs));

    // -----------------------------------------------------------------------
    process.stdout.write("\n10. _permission_guards is never touched\n");
    // -----------------------------------------------------------------------
    const guardsAfter = await guardSnapshot(db);
    hold("the guard collection is byte-identical", guardsBefore === guardsAfter, guardsBefore === "ABSENT" ? "absent both times" : "changed");
    hold(
      "the continuity fence still exists",
      (await db.collection(GUARDS).findOne({ _id: GUARD_LAST_SUPER_ADMIN })) !== null,
    );

    // -----------------------------------------------------------------------
    process.stdout.write("\n11. Password policy is the application's own\n");
    // -----------------------------------------------------------------------
    hold("a short password is refused", passwordProblem("short") !== null);
    hold("a letters-only password is refused", passwordProblem("onlylettershere") !== null);
    hold("a digits-only password is refused", passwordProblem("1234567890123") !== null);
    const generated = generatePassword();
    hold("a generated password satisfies the policy", passwordProblem(generated) === null, generated.length + " chars");
    hold("two generated passwords differ", generatePassword() !== generatePassword());

    // -----------------------------------------------------------------------
    process.stdout.write("\n12. The CLI is unreachable from the application\n");
    // -----------------------------------------------------------------------
    const srcHits = spawnSync("git", ["grep", "-l", "bootstrap-organisation", "--", "src"], { cwd: ROOT, encoding: "utf8" });
    hold("nothing under src/ references the bootstrap CLI", (srcHits.stdout ?? "").trim() === "", (srcHits.stdout ?? "").trim());

    // -----------------------------------------------------------------------
    process.stdout.write("\n13. The CLI refuses to run without a target\n");
    // -----------------------------------------------------------------------
    const noUri = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "db/bootstrap-organisation.mjs", "--legal-name", "X", "--country-code", "IN", "--admin-email", "x@y.test", "--admin-name", "X", "--staff-code", "PM-1", "--confirm", "X"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, MONGODB_URI: "", MONGODB_DB: "", PRIMEMET_ENV: "" },
    });
    hold("a missing MONGODB_URI exits non-zero", noUri.status !== 0, String(noUri.status));
    hold("it says nothing was changed", /Nothing was changed|MONGODB_URI/.test(`${noUri.stdout}${noUri.stderr}`), `${noUri.stdout}${noUri.stderr}`.slice(0, 160));

    const badConfirm = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "db/bootstrap-organisation.mjs", "--legal-name", "A", "--country-code", "IN", "--admin-email", "x@y.test", "--admin-name", "X", "--staff-code", "PM-1", "--confirm", "B"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, MONGODB_URI: "", MONGODB_DB: "", PRIMEMET_ENV: "" },
    });
    hold("a mismatched --confirm exits non-zero", badConfirm.status !== 0, String(badConfirm.status));
    hold("it names the mismatch", /--confirm must equal --legal-name/.test(`${badConfirm.stdout}${badConfirm.stderr}`));
  } finally {
    if (owner) await owner.close().catch(() => {});
    if (app) await app.close().catch(() => {});
    await root.close().catch(() => {});
    await server.stop().catch(() => {});
  }

  process.stdout.write(`\n${failed === 0 ? "\u2714" : "\u2716"} ${held} held, ${failed} failed\n\n`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = await main();
