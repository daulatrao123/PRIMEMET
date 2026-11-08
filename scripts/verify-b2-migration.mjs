#!/usr/bin/env node
/**
 * PRIMEMET — B2 migration verification (M6 production-readiness blocker B2).
 *
 * WHY THIS FILE EXISTS. Blocker B2 was: migration v006 (and v007, v008) backfilled documents with
 * `bypassDocumentValidation`, a privilege the least-privilege `primemet_owner` identity deliberately does
 * not hold, so `npm run check:authz` failed the property "the owner identity can apply every migration".
 * The remediation converges each validator with `collMod` BEFORE the backfill, so the backfill writes
 * documents the current validator accepts. This script is the evidence for that claim: it runs the real
 * migrations, through the real ledger, against isolated MongoDB databases, as the real roles.
 *
 * WHAT IT PROVES (the B2 brief's ten tests, in order):
 *   1. fresh database migration through v006 (and on to the newest version);
 *   2. an existing v005 database upgraded to v006, with pre-v006 documents present;
 *   3. re-running the migration adds no duplicate rows and no duplicate ledger entries;
 *   4. an interrupted migration (validator converged, backfill not run) is recoverable by re-running;
 *   5. existing records keep every value except the fields the migration is meant to add;
 *   6. every collection still has its strict validator, and invalid writes are still refused;
 *   7. every declared index is still present;
 *   8. migrations apply as `primemet_owner` (not as root and not as an unrestricted role);
 *   9. `primemet_app` is refused every privileged migration operation, and the owner is refused
 *      `bypassDocumentValidation` — which is why the fix could not be "grant the privilege";
 *  10. no unintended collection or document is created, dropped or rewritten.
 *
 * WHAT IT IS NOT. Not production, not staging, not independent. The replica set is in memory, the data
 * directory is temporary, credentials are generated per run and discarded, and no configured database
 * (there is none: `.env.local` sets no MONGODB_URI) is touched. Nothing is written outside this process.
 *
 * Run: node scripts/verify-b2-migration.mjs
 * Exit: 0 when every property holds, 1 when any does not (each failure is printed with the command).
 */

import { randomBytes, randomUUID } from "node:crypto";

import { MIGRATIONS } from "../db/migrations/index.mjs";
import { applyMigrations, ledgerRows, checksumOf } from "../db/ledger.mjs";
import { buildRoleDefinitions, KNOWN_ACTIONS } from "../db/roles.mjs";
import { verifyDatabase } from "../db/verify.mjs";
import { COLLECTION_NAMES, INFRASTRUCTURE_COLLECTIONS } from "../db/collections/index.mjs";

const PASSWORD = randomBytes(18).toString("hex");
const DBS = { fresh: "b2_fresh", upgrade: "b2_upgrade", interrupted: "b2_interrupted" };
const V006 = MIGRATIONS.find((m) => m.version === 6);
const VERSIONS_THROUGH_V005 = MIGRATIONS.filter((m) => m.version <= 5);

let holds = 0;
const failures = [];

function hold(label, condition, detail) {
  if (condition) {
    holds += 1;
    process.stdout.write(`  \u2714 HOLDS  ${label}\n`);
    return true;
  }
  failures.push({ label, detail });
  process.stdout.write(`  \u2717 FAILED ${label}${detail ? `\n             ${detail}` : ""}\n`);
  return false;
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

async function attempt(operation) {
  try {
    return { refused: false, value: await operation() };
  } catch (error) {
    return { refused: true, code: error?.code, message: String(error?.message ?? error).slice(0, 200) };
  }
}

const ids = () => randomUUID();
const now = () => new Date();

/** A pre-v006 supplier listing: no reviewStatus, no title, no submittedAt. */
function legacyListing({ withNotes = true } = {}) {
  return {
    _id: ids(),
    supplierId: ids(),
    status: "DRAFT",
    categoryLabel: "Copper scrap",
    ...(withNotes ? { notes: "N".repeat(500) } : {}),
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    updatedAt: new Date("2026-01-02T03:04:05.000Z"),
  };
}

/** A pre-v007 product: no images array. */
function legacyProduct(i) {
  return {
    _id: ids(),
    familyId: ids(),
    slug: `legacy-product-${i}-${randomUUID().slice(0, 8)}`,
    alternateNumbers: [],
    title: `Legacy product ${i}`,
    condition: "USED",
    priceMode: "REQUEST",
    publicationState: "DRAFT",
    createdAt: now(),
    updatedAt: now(),
  };
}

/** A pre-v008 organisation: no businessType/description/reviewFeedback (all optional by design). */
function legacyOrganisation() {
  return {
    _id: ids(),
    legalName: "Legacy Buyer Pvt Ltd",
    countryCode: "IN",
    accountStatus: "ACTIVE",
    isListable: false,
    orgType: "BUYER",
    orgKind: "BUYER",
    verificationStatus: "VERIFIED",
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

async function collectionCounts(db) {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .sort();
  const counts = {};
  for (const name of names) counts[name] = await db.collection(name).countDocuments();
  return counts;
}

function sameCounts(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return `${key}: ${a[key] ?? 0} -> ${b[key] ?? 0}`;
  return null;
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
    // `auth` is a REPL-SET option. Placed at the top level it is silently ignored, which would make every
    // refusal below vacuous, so it is read back and asserted.
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

  const authEnabled = server.servers[0]?.instanceInfo?.instance?.instanceOpts?.auth === true;
  hold("—auth is actually enabled on the started mongod", authEnabled);

  const root = new MongoClient(server.getUri(), {
    auth: { username: "mongodb-memory-server-root", password: "rootuser" },
    authSource: "admin",
  });
  await root.connect();
  const admin = root.db("admin");

  // ---------------------------------------------------------------------------
  // Provisioning — the project's own role definitions, once per isolated database
  // ---------------------------------------------------------------------------
  section("Topology");
  process.stdout.write(`  mode        : in-memory single-node replica set, \u2014auth + keyfile\n`);
  process.stdout.write(`  mongod      : 7.0.14\n`);
  process.stdout.write(`  databases   : ${Object.values(DBS).join(", ")}\n`);
  process.stdout.write(`  credentials : generated per run, discarded with the process\n`);
  process.stdout.write(`  migrate as  : primemet_owner (the least-privilege migration identity)\n`);

  const clients = {};
  const connections = [];
  for (const name of Object.values(DBS)) {
    for (const definition of buildRoleDefinitions()) {
      await root.db(name).command({
        createRole: definition.role,
        privileges: definition.privileges.map((privilege) => ({
          resource: {
            db: privilege.resource.db === "" ? name : privilege.resource.db,
            collection: privilege.resource.collection ?? "",
          },
          actions: [...privilege.actions],
        })),
        roles: [],
      });
    }
    clients[name] = { owner: {}, app: {}, readonly: {} };
    for (const role of ["owner", "app", "readonly"]) {
      const user = `b2_${role}_${name}`;
      await admin.command({
        createUser: user,
        pwd: PASSWORD,
        roles: [{ role: `primemet_${role}`, db: name }],
        mechanisms: ["SCRAM-SHA-256"],
      });
      const client = new MongoClient(server.getUri(), { auth: { username: user, password: PASSWORD }, authSource: "admin" });
      await client.connect();
      connections.push(client);
      clients[name][role] = client.db(name);
    }
  }

  const fresh = clients[DBS.fresh];
  const upgrade = clients[DBS.upgrade];
  const interrupted = clients[DBS.interrupted];
  let exitCode = 0;

  try {
    // -------------------------------------------------------------------------
    // 1 + 8. Fresh database, migrated by the least-privilege owner identity
    // -------------------------------------------------------------------------
    section("1. Fresh database migration (as primemet_owner)");
    const freshRun = await attempt(() =>
      applyMigrations(fresh.owner, { migrations: MIGRATIONS, appliedBy: "verify-b2", log: () => {} }),
    );
    hold("the owner identity applies every migration", !freshRun.refused, freshRun.message);
    hold(
      `...and all ${MIGRATIONS.length} versions land as applied`,
      !freshRun.refused && freshRun.value.filter((r) => r.status === "applied").length === MIGRATIONS.length,
      !freshRun.refused ? JSON.stringify(freshRun.value.map((r) => `${r.version}:${r.status}`)) : freshRun.message,
    );
    hold(
      "v006 is one of the versions applied (the failing version now succeeds)",
      !freshRun.refused && freshRun.value.some((r) => r.version === 6 && r.status === "applied"),
    );

    const freshCollections = (await fresh.owner.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .sort();
    const expected = [...COLLECTION_NAMES, ...INFRASTRUCTURE_COLLECTIONS].sort();
    const extraCollections = freshCollections.filter((c) => !expected.includes(c));
    const missingCollections = expected.filter((c) => !freshCollections.includes(c));
    hold(
      "no collection is created that the schema does not declare",
      extraCollections.length === 0,
      `extra: ${extraCollections.join(", ")}`,
    );
    hold("no declared collection is missing", missingCollections.length === 0, `missing: ${missingCollections.join(", ")}`);

    const freshVerify = await verifyDatabase(fresh.owner);
    hold(
      "every collection has its strict validator, every index, the guard and an unbroken ledger",
      freshVerify.failures.length === 0,
      freshVerify.failures.join("; "),
    );

    // -------------------------------------------------------------------------
    // 2 + 5 + 6 + 7. v005 database with pre-v006 documents, upgraded
    // -------------------------------------------------------------------------
    section("2. Existing v005 database upgraded to v006");
    const throughV005 = await attempt(() =>
      applyMigrations(upgrade.owner, { migrations: VERSIONS_THROUGH_V005, appliedBy: "verify-b2", log: () => {} }),
    );
    hold("v001\u2013v005 apply cleanly (the pre-upgrade state)", !throughV005.refused, throughV005.message);

    const listingWithNotes = legacyListing({ withNotes: true });
    const listingWithoutNotes = legacyListing({ withNotes: false });
    const productA = legacyProduct(1);
    const productB = legacyProduct(2);
    const organisation = legacyOrganisation();
    // Seeded through the ROOT credential with validation bypassed: these documents stand for rows written
    // before the rule existed, which is exactly the state a real v005 database is in.
    await root.db(DBS.upgrade).collection("supplier_listings").insertMany([listingWithNotes, listingWithoutNotes], { bypassDocumentValidation: true });
    await root.db(DBS.upgrade).collection("products").insertMany([productA, productB], { bypassDocumentValidation: true });
    await root.db(DBS.upgrade).collection("organisations").insertOne(organisation);
    // Document counts are captured before the upgrade and compared after it, so the evidence is that the
    // migration rewrote the rows it had to and created or destroyed nothing else. The ledger is excluded
    // because applying the pending versions is exactly the growth it is supposed to show.
    const businessCounts = async (db) => {
      const counts = await collectionCounts(db);
      delete counts["_schema_migrations"];
      return counts;
    };
    const before = await businessCounts(upgrade.owner);
    const beforeOrg = await upgrade.owner.collection("organisations").findOne({ _id: organisation._id });
    process.stdout.write(`  seeded      : 2 pre-v006 listings, 2 pre-v007 products, 1 organisation\n`);

    const upgradeRun = await attempt(() =>
      applyMigrations(upgrade.owner, { migrations: MIGRATIONS, appliedBy: "verify-b2", log: () => {} }),
    );
    // F5: the expectation is maintained BY HAND and asserted against the registry separately. Deriving it
    // from the registry — which the same change edited — meant a future version could be registered and
    // pass here automatically, which is not evidence that the right set applied. Two statements now:
    //   1. the registry's pending set equals this literal, so adding a version fails HERE, loudly;
    //   2. the upgrade applied exactly that set, in order.
    // Changing the literal is therefore a deliberate act that a reviewer sees in the diff.
    const EXPECTED_AFTER_V005 = [6, 7, 8, 9, 10];
    const registryPending = MIGRATIONS.filter((m) => m.version > 5).map((m) => m.version);
    hold(
      "the registry's pending set matches this test's hand-maintained expectation",
      registryPending.join(",") === EXPECTED_AFTER_V005.join(","),
      `registry ${registryPending.join(",")} vs expected ${EXPECTED_AFTER_V005.join(",")}`,
    );
    hold(
      "the upgrade applies every pending version as the owner identity",
      !upgradeRun.refused,
      upgradeRun.message,
    );
    hold(
      `only the ${EXPECTED_AFTER_V005.length} expected versions were applied, in order`,
      !upgradeRun.refused &&
        upgradeRun.value.filter((r) => r.status === "applied").map((r) => r.version).join(",") === EXPECTED_AFTER_V005.join(","),
      !upgradeRun.refused ? JSON.stringify(upgradeRun.value.map((r) => `${r.version}:${r.status}`)) : upgradeRun.message,
    );

    const afterUpgrade = await businessCounts(upgrade.owner);
    const upgradeDrift = sameCounts(before, afterUpgrade);
    hold("the upgrade creates and destroys no business document", upgradeDrift === null, upgradeDrift);

    const upgradedWithNotes = await upgrade.owner.collection("supplier_listings").findOne({ _id: listingWithNotes._id });
    const upgradedWithoutNotes = await upgrade.owner.collection("supplier_listings").findOne({ _id: listingWithoutNotes._id });
    hold("an existing listing is queued as PENDING, never APPROVED", upgradedWithNotes?.reviewStatus === "PENDING", String(upgradedWithNotes?.reviewStatus));
    hold(
      "the backfilled title is truncated to the declared 200 characters",
      typeof upgradedWithNotes?.title === "string" && upgradedWithNotes.title.length === 200,
      `length ${upgradedWithNotes?.title?.length}`,
    );
    hold(
      "a listing without notes gets the neutral title rather than an invented one",
      upgradedWithoutNotes?.title === "Supplier listing",
      String(upgradedWithoutNotes?.title),
    );
    hold(
      "submittedAt is taken from the document's own createdAt",
      upgradedWithNotes?.submittedAt instanceof Date &&
        upgradedWithNotes.submittedAt.toISOString() === listingWithNotes.createdAt.toISOString(),
      String(upgradedWithNotes?.submittedAt),
    );
    hold(
      "every existing listing value is preserved (notes, status, supplierId, categoryLabel, timestamps)",
      upgradedWithNotes?.notes === listingWithNotes.notes &&
        upgradedWithNotes?.status === listingWithNotes.status &&
        upgradedWithNotes?.supplierId === listingWithNotes.supplierId &&
        upgradedWithNotes?.categoryLabel === listingWithNotes.categoryLabel &&
        upgradedWithNotes?.createdAt.toISOString() === listingWithNotes.createdAt.toISOString(),
    );
    const upgradedProducts = await upgrade.owner.collection("products").find({ _id: { $in: [productA._id, productB._id] } }).toArray();
    hold(
      "existing products keep their values and gain an empty gallery",
      upgradedProducts.length === 2 &&
        upgradedProducts.every((p) => Array.isArray(p.images) && p.images.length === 0) &&
        upgradedProducts.find((p) => p._id === productA._id)?.title === productA.title &&
        upgradedProducts.find((p) => p._id === productB._id)?.slug === productB.slug,
    );
    const afterOrg = await upgrade.owner.collection("organisations").findOne({ _id: organisation._id });
    hold(
      "an existing organisation is not rewritten by the migration",
      JSON.stringify(afterOrg) === JSON.stringify(beforeOrg),
      `${JSON.stringify(beforeOrg)?.slice(0, 120)} -> ${JSON.stringify(afterOrg)?.slice(0, 120)}`,
    );

    const upgradeVerify = await verifyDatabase(upgrade.owner);
    hold(
      "after the upgrade every validator is strict, matches the declared schema and every index exists",
      upgradeVerify.failures.length === 0,
      upgradeVerify.failures.join("; "),
    );

    const invalidWrite = await attempt(() =>
      upgrade.owner.collection("supplier_listings").insertOne({
        _id: ids(),
        supplierId: ids(),
        status: "DRAFT",
        createdAt: now(),
        updatedAt: now(),
      }),
    );
    hold(
      "a listing without the required review fields is still refused (validator active, not relaxed)",
      invalidWrite.refused && invalidWrite.code === 121,
      `${invalidWrite.code}: ${invalidWrite.message}`,
    );
    const unknownProperty = await attempt(() =>
      upgrade.owner.collection("supplier_listings").insertOne({ ...legacyListing(), reviewStatus: "PENDING", title: "ok", submittedAt: now(), unexpectedField: "x" }),
    );
    hold(
      "an undeclared property is still refused (additionalProperties: false intact)",
      unknownProperty.refused && unknownProperty.code === 121,
      `${unknownProperty.code}: ${unknownProperty.message}`,
    );
    const badEnum = await attempt(() =>
      upgrade.owner.collection("supplier_listings").insertOne({ ...legacyListing(), reviewStatus: "BOGUS", title: "ok", submittedAt: now() }),
    );
    hold(
      "an out-of-enum review state is still refused (no silent approval)",
      badEnum.refused && badEnum.code === 121,
      `${badEnum.code}: ${badEnum.message}`,
    );

    // -------------------------------------------------------------------------
    // 3 + 10. Re-run: no duplicate rows, no duplicate ledger entries, no rewrites
    // -------------------------------------------------------------------------
    section("3. Re-run of an already-migrated database");
    const countsBeforeRerun = await collectionCounts(upgrade.owner);
    const listingBeforeRerun = await upgrade.owner.collection("supplier_listings").findOne({ _id: listingWithNotes._id });
    const rerun = await attempt(() =>
      applyMigrations(upgrade.owner, { migrations: MIGRATIONS, appliedBy: "verify-b2", log: () => {} }),
    );
    hold("the re-run completes", !rerun.refused, rerun.message);
    hold(
      "every version is skipped, none applied twice",
      !rerun.refused && rerun.value.every((r) => r.status === "skipped"),
      !rerun.refused ? JSON.stringify(rerun.value.map((r) => `${r.version}:${r.status}`)) : rerun.message,
    );
    const countsAfterRerun = await collectionCounts(upgrade.owner);
    const countDrift = sameCounts(countsBeforeRerun, countsAfterRerun);
    hold("no document is duplicated or lost by the re-run", countDrift === null, countDrift);
    const listingAfterRerun = await upgrade.owner.collection("supplier_listings").findOne({ _id: listingWithNotes._id });
    hold(
      "the backfilled document is byte-identical after the re-run",
      JSON.stringify(listingAfterRerun) === JSON.stringify(listingBeforeRerun),
    );
    const rows = await ledgerRows(upgrade.owner);
    const duplicateVersions = rows
      .map((r) => r.version)
      .filter((v, i, all) => all.indexOf(v) !== i);
    hold("the ledger holds exactly one row per version", duplicateVersions.length === 0, `duplicated: ${duplicateVersions.join(", ")}`);
    hold("every ledger row is status applied", rows.every((r) => r.status === "applied"), rows.map((r) => `${r.version}:${r.status}`).join(", "));
    hold(
      "no ledger row is a duplicate of the migration's current source (no drift)",
      rows.every((r) => r.checksum === checksumOf(MIGRATIONS.find((m) => m.version === r.version).source)),
    );

    // -------------------------------------------------------------------------
    // 4. Interrupted migration recovery
    // -------------------------------------------------------------------------
    section("4. Interrupted migration (validator converged, backfill not run)");
    await applyMigrations(interrupted.owner, { migrations: VERSIONS_THROUGH_V005, appliedBy: "verify-b2", log: () => {} });
    const stranded = legacyListing();
    await root.db(DBS.interrupted).collection("supplier_listings").insertOne(stranded, { bypassDocumentValidation: true });

    // A database handle that fails exactly where a process death would: the supplier_listings backfill.
    const crashingDb = new Proxy(interrupted.owner, {
      get(target, prop) {
        if (prop === "collection") {
          return (name) => {
            const coll = target.collection(name);
            if (name !== "supplier_listings") return coll;
            return new Proxy(coll, {
              get(inner, key) {
                if (key === "updateMany") {
                  return async () => {
                    throw Object.assign(new Error("simulated process death during the v006 backfill"), { code: 9001 });
                  };
                }
                const value = inner[key];
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
          };
        }
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const crashed = await attempt(() =>
      applyMigrations(crashingDb, { migrations: MIGRATIONS, appliedBy: "verify-b2", log: () => {} }),
    );
    hold("the interrupted run fails loudly", crashed.refused, crashed.message);

    const midInfo = (await interrupted.owner.listCollections({ name: "supplier_listings" }).toArray())[0];
    hold("the interruption left the validator converged (strict, current schema)", midInfo?.options?.validationLevel === "strict");
    const strandedBefore = await interrupted.owner.collection("supplier_listings").findOne({ _id: stranded._id });
    hold("the interruption left the pre-v006 document un-backfilled", strandedBefore?.reviewStatus === undefined, String(strandedBefore?.reviewStatus));
    const midRows = await ledgerRows(interrupted.owner);
    const v006Row = midRows.find((r) => r.version === 6);
    hold("the failed attempt is recorded on the one v006 row, never as applied", v006Row?.status === "failed", `status ${v006Row?.status}`);

    const resume = await attempt(() =>
      applyMigrations(interrupted.owner, { migrations: MIGRATIONS, appliedBy: "verify-b2", log: () => {} }),
    );
    hold("re-running the migration recovers", !resume.refused, resume.message);
    const resumedRow = (await ledgerRows(interrupted.owner)).filter((r) => r.version === 6);
    hold("the recovered run reuses the same v006 row (no duplicate)", resumedRow.length === 1 && resumedRow[0].status === "applied", JSON.stringify(resumedRow.map((r) => r.status)));
    const recovered = await interrupted.owner.collection("supplier_listings").findOne({ _id: stranded._id });
    hold("the recovered run completes the backfill", recovered?.reviewStatus === "PENDING", String(recovered?.reviewStatus));
    const resumeVerify = await verifyDatabase(interrupted.owner);
    hold("the recovered database reconciles exactly", resumeVerify.failures.length === 0, resumeVerify.failures.join("; "));

    // -------------------------------------------------------------------------
    // 9. Security evidence — permissions actually held and actually refused
    // -------------------------------------------------------------------------
    section("9. Least privilege: what the identities may and may not do");
    const migrationSources = MIGRATIONS.map((m) => ({ version: m.version, source: m.source }));
    const bypassing = migrationSources.filter(({ source }) => /bypassDocumentValidation\s*:\s*true/.test(source));
    hold(
      "no migration passes bypassDocumentValidation as an option",
      bypassing.length === 0,
      bypassing.map((m) => `v${String(m.version).padStart(3, "0")}`).join(", "),
    );

    const ownerInfo = await fresh.owner.command({ rolesInfo: "primemet_owner", showPrivileges: true });
    const ownerPrivileges = ownerInfo.roles?.[0]?.privileges ?? [];
    const ownerActions = ownerPrivileges.flatMap((p) => p.actions ?? []);
    hold(
      "primemet_owner holds no bypassDocumentValidation privilege",
      !ownerActions.includes("bypassDocumentValidation"),
      ownerActions.join(", "),
    );
    hold(
      "primemet_owner holds only classified actions",
      ownerActions.every((a) => KNOWN_ACTIONS.includes(a)),
      ownerActions.filter((a) => !KNOWN_ACTIONS.includes(a)).join(", "),
    );
    hold(
      "primemet_owner still holds the structural actions a migration needs",
      ["createCollection", "collMod", "createIndex"].every((a) => ownerActions.includes(a)),
    );
    hold(
      "primemet_owner is not a superuser (no anyResource and no admin-database privilege)",
      !ownerPrivileges.some((p) => p.resource?.anyResource === true || p.resource?.db === "admin"),
      JSON.stringify(ownerPrivileges.map((p) => p.resource)).slice(0, 160),
    );

    const appInfo = await fresh.app.command({ rolesInfo: "primemet_app", showPrivileges: true });
    const appActions = (appInfo.roles?.[0]?.privileges ?? []).flatMap((p) => p.actions ?? []);
    hold(
      "primemet_app holds no structural or destructive action",
      !["createCollection", "collMod", "createIndex", "dropCollection", "dropIndex", "dropDatabase", "delete", "bypassDocumentValidation"].some((a) => appActions.includes(a)),
      appActions.join(", "),
    );

    const ownerBypass = await attempt(() =>
      fresh.owner.collection("supplier_listings").updateMany({}, { $set: { notes: "x" } }, { bypassDocumentValidation: true }),
    );
    hold(
      "the owner identity is REFUSED bypassDocumentValidation (so the migration cannot depend on it)",
      ownerBypass.refused && ownerBypass.code === 13,
      `${ownerBypass.code}: ${ownerBypass.message}`,
    );

    const appOps = {
      "create a collection": () => fresh.app.createCollection("b2_should_not_exist"),
      "collMod a validator": () => fresh.app.command({ collMod: "supplier_listings", validationLevel: "off", validator: {} }),
      "create an index": () => fresh.app.collection("supplier_listings").createIndex({ notes: 1 }),
      "disable validation via collMod on organisations": () => fresh.app.command({ collMod: "organisations", validator: {}, validationLevel: "off" }),
      "drop a collection": () => fresh.app.collection("products").drop(),
      "insert into the migration ledger": () => fresh.app.collection("_schema_migrations").insertOne({ version: 99, status: "applied" }),
      "delete an immutable history row": () => fresh.app.collection("audit_logs").deleteMany({}),
      "bypass validation on a collection it may otherwise update": () =>
        fresh.app.collection("organisations").updateMany({}, { $set: { internalNotes: "x" } }, { bypassDocumentValidation: true }),
    };
    for (const [label, operation] of Object.entries(appOps)) {
      const result = await attempt(operation);
      hold(`primemet_app cannot ${label}`, result.refused && result.code === 13, `${result.code}: ${result.message}`);
    }

    hold(
      "primemet_app CAN read and write the business collections it is meant to use",
      !(await attempt(() => fresh.app.collection("supplier_listings").insertOne({ ...legacyListing(), reviewStatus: "PENDING", title: "ok", submittedAt: now() }))).refused,
    );

    const readonlyWrite = await attempt(() =>
      fresh.readonly.collection("supplier_listings").insertOne({ ...legacyListing(), reviewStatus: "PENDING", title: "ok", submittedAt: now() }),
    );
    hold("primemet_readonly cannot write", readonlyWrite.refused && readonlyWrite.code === 13, `${readonlyWrite.code}: ${readonlyWrite.message}`);

    const driftFreeze = await attempt(() =>
      applyMigrations(fresh.owner, {
        migrations: MIGRATIONS.map((m) => (m.version === 6 ? { ...m, source: `${m.source}\n// edited after it was applied` } : m)),
        appliedBy: "verify-b2",
        log: () => {},
      }),
    );
    hold(
      "an edited, already-applied migration is refused as drift (the ledger still guards history)",
      driftFreeze.refused && String(driftFreeze.message).includes("drift"),
      driftFreeze.message,
    );
    void V006;
  } catch (error) {
    process.stdout.write(`\n  \u2716 verification aborted: ${String(error?.stack ?? error).slice(0, 600)}\n`);
    exitCode = 1;
  } finally {
    await Promise.all(connections.map((client) => client.close().catch(() => {})));
    await root.close().catch(() => {});
    await server.stop().catch(() => {});
  }

  section("Result");
  process.stdout.write(`  properties held : ${holds}\n`);
  process.stdout.write(`  failures        : ${failures.length}\n`);
  for (const failure of failures) process.stdout.write(`  \u2717 ${failure.label}${failure.detail ? ` — ${failure.detail}` : ""}\n`);
  if (failures.length > 0 || exitCode !== 0) {
    process.stdout.write(`\n  B2 NOT VERIFIED\n`);
    return 1;
  }
  process.stdout.write(`\n  \u2714 B2 VERIFIED: migrations apply as primemet_owner without bypassDocumentValidation,\n` +
    `    under active validators, with indexes intact, idempotently and after interruption.\n`);
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  process.stdout.write(`\n  \u2716 unhandled: ${String(error?.stack ?? error)}\n`);
  process.exit(1);
});
