/**
 * Group E — migration v006 against an isolated MongoDB.
 *
 * The tests use the same `applyMigrations` the CLI uses, on databases that exist only inside the
 * in-memory replica set. Nothing here can see a configured cluster: the connection string is generated
 * by the memory server, and every database name is a scratch name.
 */

import { spawn } from "node:child_process";
import path from "node:path";

import { COLLECTIONS, COLLECTIONS_BY_NAME } from "../../../db/collections/index.mjs";
import { plansFor } from "../../../db/define.mjs";
import { MIGRATIONS } from "../../../db/migrations/index.mjs";
import { PROJECT_ROOT, migrate } from "../m1-verify-core.mjs";

const BEFORE_V006 = MIGRATIONS.filter((migration) => migration.version < 6);

function normaliseIndex(index) {
  return {
    key: JSON.stringify(index.key),
    unique: Boolean(index.unique),
    partial: index.partialFilterExpression ? JSON.stringify(index.partialFilterExpression) : null,
    expire: index.expireAfterSeconds ?? null,
  };
}

async function actualIndexes(db, name) {
  const rows = await db.collection(name).listIndexes().toArray();
  return rows
    .filter((row) => row.name !== "_id_")
    .map((row) => normaliseIndex(row))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function expectedIndexes(name) {
  return plansFor(COLLECTIONS_BY_NAME[name]).indexes
    .map((index) => normaliseIndex(index))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { mongo } = ctx;

  await test("E1", "A fresh database migrates through the CLI to v006", async () => {
    const dbName = `primemet_m1_e1_${Date.now()}`;
    const db = mongo.client.db(dbName);
    const child = spawn(process.execPath, [path.join(PROJECT_ROOT, "scripts", "db-init.mjs")], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, MONGODB_URI: mongo.uri, MONGODB_DB: dbName, PRIMEMET_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise((resolve) => child.on("exit", resolve));
    assert(code === 0, `db-init exited ${code}: ${output.slice(-500)}`);

    const rows = await db.collection("_schema_migrations").find({}).sort({ version: 1 }).toArray();
    // The ledger holds every registered migration. M2 added v007, so the count follows the registry
    // rather than a literal: this group's subject is that v006 applied cleanly, not that v006 is last.
    assert(rows.length === MIGRATIONS.length, `ledger has ${rows.length} rows, expected ${MIGRATIONS.length}`);
    assert(rows.every((row) => row.status === "applied"), `statuses: ${rows.map((row) => row.status).join(",")}`);
    const v6 = rows.find((row) => row.version === 6);
    assert(v6 && v6.status === "applied", `v006 status is ${v6?.status}`);

    const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((row) => row.name));
    const missing = COLLECTIONS.map((collection) => collection.name).filter((name) => !names.has(name));
    assert(missing.length === 0, `missing collections: ${missing.join(", ")}`);

    const enquiries = (await db.listCollections({ name: "enquiries" }).toArray())[0];
    const validator = enquiries?.options?.validator ?? null;
    // A collection with invariants carries `{$and:[{$jsonSchema}, …]}`; one without carries the schema
    // directly. Either shape is a validator that names its required fields.
    const jsonSchemas = validator
      ? [validator.$jsonSchema, ...(validator.$and ?? []).map((clause) => clause.$jsonSchema)].filter(Boolean)
      : [];
    assert(jsonSchemas.length > 0, `enquiries has no $jsonSchema validator: ${JSON.stringify(validator)}`);
    const schema = jsonSchemas[0];
    assert(schema.required.includes("buyerOrganisationId"), "the enquiry validator does not require an owner");
    assert(enquiries.options.validationLevel === "strict", `validationLevel is ${enquiries.options.validationLevel}`);
    assert(enquiries.options.validationAction === "error", `validationAction is ${enquiries.options.validationAction}`);
    await db.dropDatabase();
    return `CLI exit 0; ${rows.length} applied; ${COLLECTIONS.length} collections; enquiries validator strict/error`;
  });

  await test("E2", "Upgrading a v005 database to v006 preserves existing records", async () => {
    const dbName = `primemet_m1_e2_${Date.now()}`;
    const db = mongo.client.db(dbName);
    await migrate(db, { migrations: BEFORE_V006, appliedBy: "m1-verifier" });
    const preRows = await db.collection("_schema_migrations").countDocuments({});
    assert(preRows === 5, `v005 fixture has ${preRows} ledger rows`);

    // A product written under the v001–v005 schema, and a listing from before review existed.
    const now = new Date();
    const productId = "11111111-1111-4111-8111-111111111111";
    await db.collection("products").insertOne({
      _id: productId,
      familyId: "22222222-2222-4222-8222-222222222222",
      slug: "legacy-product",
      title: "Legacy Product",
      shortDescription: null,
      alternateNumbers: [],
      condition: "NEW",
      priceMode: "FIXED",
      publicationState: "PUBLISHED",
      publishedAt: now,
      deletedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const listingId = "33333333-3333-4333-8333-333333333333";
    await db.collection("supplier_listings").insertOne(
      {
        _id: listingId,
        supplierId: "44444444-4444-4444-8444-444444444444",
        status: "ACTIVE",
        notes: "Legacy listing written before review states existed",
        productId,
        quantityKg: null,
        createdAt: now,
        updatedAt: now,
      },
      { bypassDocumentValidation: true },
    );
    const listingsBefore = await db.collection("supplier_listings").countDocuments({});
    const productsBefore = await db.collection("products").countDocuments({});

    await migrate(db, { appliedBy: "m1-verifier" });

    const rows = await db.collection("_schema_migrations").find({}).sort({ version: 1 }).toArray();
    assert(rows.length === MIGRATIONS.length, `ledger has ${rows.length} rows after upgrade`);
    const upgraded = rows.find((row) => row.version === 6);
    assert(upgraded && upgraded.status === "applied", "v006 is not recorded as applied");

    assert((await db.collection("supplier_listings").countDocuments({})) === listingsBefore, "a listing was lost");
    assert((await db.collection("products").countDocuments({})) === productsBefore, "a product was lost");

    const listing = await db.collection("supplier_listings").findOne({ _id: listingId });
    assert(listing.reviewStatus === "PENDING", `legacy listing reviewStatus is ${listing.reviewStatus}`);
    assert(listing.title, "legacy listing has no title after backfill");
    assert(listing.submittedAt instanceof Date, "legacy listing has no submittedAt after backfill");
    assert(listing.status === "ACTIVE", "the backfill changed the listing's publication state");

    const product = await db.collection("products").findOne({ _id: productId });
    assert(product.title === "Legacy Product" && product.slug === "legacy-product", "the product changed during upgrade");
    assert(product.publicationState === "PUBLISHED", "the product's publication state changed");

    await db.dropDatabase();
    return `5 → ${MIGRATIONS.length} applied; v006 recorded; legacy listing queued PENDING; product untouched`;
  });

  await test("E3", "Re-running the migration is a no-op and does not duplicate the ledger", async () => {
    const dbName = `primemet_m1_e3_${Date.now()}`;
    const db = mongo.client.db(dbName);
    await migrate(db, { appliedBy: "m1-verifier" });
    const before = await db.collection("_schema_migrations").find({}).sort({ version: 1 }).toArray();
    const indexesBefore = await actualIndexes(db, "supplier_listings");

    const second = await migrate(db, { appliedBy: "m1-verifier" });
    assert(second.every((row) => row.status === "skipped"), `statuses: ${second.map((row) => row.status).join(",")}`);
    const after = await db.collection("_schema_migrations").find({}).sort({ version: 1 }).toArray();
    assert(after.length === before.length, `ledger grew from ${before.length} to ${after.length}`);
    assert(after.every((row, i) => row.checksum === before[i].checksum), "a checksum changed on re-run");
    const indexesAfter = await actualIndexes(db, "supplier_listings");
    assert(JSON.stringify(indexesBefore) === JSON.stringify(indexesAfter), "indexes changed on re-run");

    await db.dropDatabase();
    return "6 skipped, ledger unchanged, indexes unchanged";
  });

  await test("E4", "An interrupted v006 run recovers on the next attempt", async () => {
    const dbName = `primemet_m1_e4_${Date.now()}`;
    const db = mongo.client.db(dbName);
    await migrate(db, { appliedBy: "m1-verifier" });

    // Interruption shape 1: `up()` succeeded but the ledger row was never written (process died between).
    await db.collection("_schema_migrations").deleteOne({ version: 6 });
    const retry = await migrate(db, { appliedBy: "m1-verifier" });
    const v6 = retry.find((row) => row.version === 6);
    assert(v6?.status === "applied", `v006 status after recovery is ${v6?.status}`);
    assert((await db.collection("_schema_migrations").countDocuments({ version: 6, status: "applied" })) === 1, "v006 is not recorded exactly once");

    // Interruption shape 2: the row exists but says `failed`; a retry must transition it, not duplicate it.
    await db.collection("_schema_migrations").updateOne({ version: 6 }, { $set: { status: "failed", error: "simulated interruption" } });
    const retried = await migrate(db, { appliedBy: "m1-verifier" });
    assert(retried.find((row) => row.version === 6)?.status === "skipped" || retried.find((row) => row.version === 6)?.status === "applied", "v006 was not retried");
    const rows = await db.collection("_schema_migrations").find({ version: 6 }).toArray();
    assert(rows.length === 1, `${rows.length} ledger rows for v006`);

    const indexes = await actualIndexes(db, "supplier_listings");
    assert(JSON.stringify(indexes) === JSON.stringify(expectedIndexes("supplier_listings")), "indexes are incomplete after recovery");
    await db.dropDatabase();
    return "missing-ledger and failed-row interruptions both converge to one applied row";
  });

  await test("E5", "Collection validators reject documents that violate the schema", async () => {
    const dbName = `primemet_m1_e5_${Date.now()}`;
    const db = mongo.client.db(dbName);
    await migrate(db, { appliedBy: "m1-verifier" });

    const rejects = async (name, document, label) => {
      // One retry for a transient driver failure (a paused/slow host can miss a heartbeat). This is not
      // a retry of the assertion: a document that is accepted still fails the test.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await db.collection(name).insertOne(document);
        } catch (error) {
          if (attempt === 0 && /monitor timeout|server selection|connection .* interrupted/i.test(String(error.message))) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            continue;
          }
          assert(error.code === 121 || /validation/i.test(String(error.message)), `${label}: unexpected error ${error.message}`);
          return true;
        }
        throw new Error(`${label} was accepted by the validator`);
      }
      throw new Error(`${label}: the driver never completed the insert`);
    };

    await rejects("enquiries", { _id: "55555555-5555-4555-8555-555555555555", reference: "ENQ-2026-000001" }, "enquiry without owner");
    await rejects(
      "supplier_listings",
      {
        _id: "66666666-6666-4666-8666-666666666666",
        supplierId: "77777777-7777-4777-8777-777777777777",
        status: "ACTIVE",
        reviewStatus: "MAYBE",
        title: "Bad review state",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      "listing with reviewStatus MAYBE",
    );
    await rejects(
      "products",
      {
        _id: "88888888-8888-4888-8888-888888888888",
        familyId: "22222222-2222-4222-8222-222222222222",
        slug: "invalid-product",
        title: "Invalid",
        publicationState: "SOMETIME",
        unit: "MT",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      "product with an unknown publication state",
    );
    await db.dropDatabase();
    return "3 invalid documents rejected with code 121";
  });

  await test("E6", "Declared indexes match the database for every collection", async () => {
    const dbName = `primemet_m1_e6_${Date.now()}`;
    const db = mongo.client.db(dbName);
    await migrate(db, { appliedBy: "m1-verifier" });

    const mismatches = [];
    let checked = 0;
    for (const collection of COLLECTIONS) {
      const actual = await actualIndexes(db, collection.name);
      const expected = expectedIndexes(collection.name);
      checked += expected.length;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatches.push(`${collection.name}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
      }
    }
    assert(mismatches.length === 0, mismatches.slice(0, 3).join(" | "));

    // The review queue must be indexed on its own leading key, or every admin queue load is a scan.
    const review = expectedIndexes("supplier_listings").find((index) => index.key.startsWith('{"reviewStatus"'));
    assert(review, `no reviewStatus index: ${JSON.stringify(expectedIndexes("supplier_listings").map((index) => index.key))}`);
    const actualReview = (await actualIndexes(db, "supplier_listings")).find((index) => index.key.startsWith('{"reviewStatus"'));
    assert(actualReview, "the review queue index is missing from the database");
    await db.dropDatabase();
    return `${checked} indexes across ${COLLECTIONS.length} collections match`;
  });

  await test("E7", "v006.up() is idempotent when run directly twice", async () => {
    const dbName = `primemet_m1_e7_${Date.now()}`;
    const db = mongo.client.db(dbName);
    const v6 = MIGRATIONS.find((migration) => migration.version === 6);
    assert(v6, "v006 is not registered in db/migrations/index.mjs");
    await v6.up(db, {});
    const first = await actualIndexes(db, "enquiries");
    const validator = (await db.listCollections({ name: "enquiries" }).toArray())[0].options.validator;
    await v6.up(db, {});
    const second = await actualIndexes(db, "enquiries");
    const validatorAgain = (await db.listCollections({ name: "enquiries" }).toArray())[0].options.validator;
    assert(JSON.stringify(first) === JSON.stringify(second), "indexes changed on the second run");
    assert(JSON.stringify(validator) === JSON.stringify(validatorAgain), "the validator changed on the second run");
    await db.dropDatabase();
    return `${first.length} indexes and the validator stable across two runs`;
  });
}