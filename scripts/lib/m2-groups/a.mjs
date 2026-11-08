/**
 * Group A — migration v007 on an isolated instance.
 *
 * Every test creates its own scratch database, so a failure in one cannot be explained by another's
 * leftovers. The migration code under test is the repository's own registry (`db/migrations/index.mjs`)
 * applied by the repository's own ledger (`db/ledger.mjs`) — the same code `npm run db:init` runs.
 */

import { MIGRATIONS } from "../../../db/migrations/index.mjs";
import { applyMigrations, ledgerRows } from "../../../db/ledger.mjs";

const V007 = 7;

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { mongo } = ctx;

  const freshDb = async (name) => {
    const db = mongo.client.db(`m2_a_${name}_${Date.now()}`.slice(0, 60));
    await db.dropDatabase();
    return db;
  };

  await test("A1", "fresh database reaches v007 with the images field and its indexes", async () => {
    const db = await freshDb("fresh");
    await applyMigrations(db, { migrations: MIGRATIONS, appliedBy: "m2-verifier" });
    const rows = await ledgerRows(db);
    assert(rows.length === MIGRATIONS.length, `${rows.length} ledger rows for ${MIGRATIONS.length} migrations`);
    assert(rows.every((row) => row.status === "applied"), "a migration is not applied");

    const info = await db.listCollections({ name: "products" }).next();
    assert(info, "products collection missing");
    const props = info.options?.validator?.$jsonSchema?.properties
      ?? info.options?.validator?.$and?.[0]?.$jsonSchema?.properties;
    assert(props?.images, "the products validator has no images field");
    assert(props.images.maxItems === 8, `maxItems is ${props.images.maxItems}`);

    const indexes = await db.collection("products").indexes();
    const listing = indexes.find((index) => index.key.publicationState === 1 && index.key.publishedAt === -1);
    assert(listing, "the public listing index is missing");
    const byFamily = indexes.find((index) => index.key.familyId === 1 && index.key.publicationState === 1);
    assert(byFamily, "the subcategory/state index is missing");
    return `v007 applied, ${indexes.length} product indexes`;
  });

  await test("A2", "upgrade from v006 backfills images without touching existing records", async () => {
    const db = await freshDb("upgrade");
    await applyMigrations(db, { migrations: MIGRATIONS.filter((m) => m.version <= 6), appliedBy: "m2-verifier" });

    // A document written under the v006 validator: the shape an existing production product has.
    const legacy = {
      _id: "11111111-1111-4111-8111-111111111111",
      familyId: "22222222-2222-4222-8222-222222222222",
      slug: "legacy-bearing",
      partNumber: "6205-2RS",
      alternateNumbers: [],
      brand: "SKF",
      manufacturer: "SKF",
      title: "Legacy bearing",
      shortDescription: "Written before v007",
      technicalSpecification: null,
      condition: "NEW",
      priceMode: "REQUEST",
      imageUrl: "https://cdn.example.test/legacy.jpg",
      publicationState: "PUBLISHED",
      publishedAt: new Date(),
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection("products").insertOne(legacy);

    const before = await db.collection("products").findOne({ _id: legacy._id });
    assert(before.images === undefined, "the fixture already had images");

    await applyMigrations(db, { migrations: MIGRATIONS, appliedBy: "m2-verifier" });

    const after = await db.collection("products").findOne({ _id: legacy._id });
    assert(Array.isArray(after.images) && after.images.length === 0, "images was not backfilled to []");
    assert(after.title === legacy.title, "the title changed");
    assert(after.publicationState === "PUBLISHED", "the publication state changed");
    assert(after.imageUrl === legacy.imageUrl, "the hero image reference changed");
    assert(String(after.publishedAt.getTime()) === String(legacy.publishedAt.getTime()), "the publication date changed");
    return "images backfilled to [] and every other field untouched";
  });

  await test("A3", "re-running v007 is a no-op", async () => {
    const db = await freshDb("repeat");
    await applyMigrations(db, { migrations: MIGRATIONS, appliedBy: "m2-verifier" });
    const countBefore = await db.collection("products").countDocuments({});
    const rowsBefore = (await ledgerRows(db)).length;

    await applyMigrations(db, { migrations: MIGRATIONS, appliedBy: "m2-verifier" });
    const rowsAfter = await ledgerRows(db);
    assert(rowsAfter.length === rowsBefore, `${rowsBefore} → ${rowsAfter.length} ledger rows`);
    assert(new Set(rowsAfter.map((row) => row.version)).size === rowsAfter.length, "duplicate ledger rows for one version");
    assert((await db.collection("products").countDocuments({})) === countBefore, "documents changed");
    return "second run applied nothing";
  });

  await test("A4", "an interrupted v007 run is recorded as failed and recovers on retry", async () => {
    const db = await freshDb("interrupted");
    await applyMigrations(db, { migrations: MIGRATIONS.filter((m) => m.version <= 6), appliedBy: "m2-verifier" });

    // The v006 → v007 boundary is where a crash would leave the ledger. Reproduce the state the ledger
    // itself would hold after `up()` threw: one row, status failed, with its error preserved.
    const failing = {
      ...MIGRATIONS.find((m) => m.version === 7),
      async up() {
        throw new Error("simulated interruption mid-migration");
      },
    };
    let thrown = null;
    try {
      await applyMigrations(db, { migrations: [failing], appliedBy: "m2-verifier" });
    } catch (error) {
      thrown = error;
    }
    assert(thrown && /simulated interruption/.test(thrown.message), "the failure did not propagate to the caller");
    const failedRow = await db.collection("_schema_migrations").findOne({ version: V007 });
    assert(failedRow?.status === "failed", `ledger status is ${failedRow?.status}`);
    assert(/simulated interruption/.test(failedRow.error ?? ""), "the failure reason was not recorded");

    await applyMigrations(db, { migrations: MIGRATIONS, appliedBy: "m2-verifier" });
    const recovered = await db.collection("_schema_migrations").findOne({ version: V007 });
    assert(recovered.status === "applied", `status is ${recovered.status} after retry`);
    assert(recovered.error === undefined, "the old error was left on an applied row");
    assert(recovered.attempts >= 2, `attempts is ${recovered.attempts}`);
    return `failed → applied, attempts=${recovered.attempts}`;
  });

  await test("A5", "the validator refuses a bad gallery and an unknown field", async () => {
    const db = await freshDb("validator");
    await applyMigrations(db, { migrations: MIGRATIONS, appliedBy: "m2-verifier" });

    const base = {
      _id: "33333333-3333-4333-8333-333333333333",
      familyId: "44444444-4444-4444-8444-444444444444",
      slug: "validator-product",
      alternateNumbers: [],
      title: "Validator product",
      condition: "NEW",
      priceMode: "REQUEST",
      publicationState: "DRAFT",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Nine images: maxItems is 8.
    const nine = Array.from({ length: 9 }, (_, index) => ({ url: `https://cdn.example.test/${index}.jpg`, alt: null, sortOrder: index }));
    let tooMany = null;
    try {
      await db.collection("products").insertOne({ ...base, images: nine });
    } catch (error) {
      tooMany = error;
    }
    assert(tooMany, "nine images were accepted");

    // An unknown top-level field: additionalProperties is false.
    let unknown = null;
    try {
      await db.collection("products").insertOne({ ...base, _id: "55555555-5555-4555-8555-555555555555", secretCost: 42 });
    } catch (error) {
      unknown = error;
    }
    assert(unknown, "an undeclared field was accepted");

    // Eight images is the documented limit and must be accepted.
    await db.collection("products").insertOne({ ...base, _id: "66666666-6666-4666-8666-666666666666", images: nine.slice(0, 8) });
    return "9 images and an undeclared field refused; 8 images accepted";
  });

  await test("A6", "an image without the required url is refused", async () => {
    const db = await freshDb("image-shape");
    await applyMigrations(db, { migrations: MIGRATIONS, appliedBy: "m2-verifier" });
    let rejected = null;
    try {
      await db.collection("products").insertOne({
        _id: "77777777-7777-4777-8777-777777777777",
        familyId: "88888888-8888-4888-8888-888888888888",
        slug: "no-url-image",
        alternateNumbers: [],
        title: "No url image",
        condition: "NEW",
        priceMode: "REQUEST",
        publicationState: "DRAFT",
        images: [{ alt: "missing url", sortOrder: 0 }],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      rejected = error;
    }
    assert(rejected, "an image without a url was accepted");
    return "an image without a url is refused by the validator";
  });

  await test("A7", "the application itself can write a gallery through the data layer", async () => {
    const { catalogue } = ctx.modules;
    const { db } = ctx;
    const category = await catalogue.createCategory({ name: "A7 Category", slug: "a7-category", kind: "SCRAP" });
    const family = await catalogue.createFamily({ categoryId: category.id, name: "A7 Family", slug: "a7-family" });
    const created = await catalogue.createProduct({
      title: "A7 product with a gallery",
      familyId: family.id,
      condition: "NEW",
      priceMode: "REQUEST",
      publicationState: "DRAFT",
      images: [
        { url: "https://cdn.example.test/a7-front.jpg", alt: "Front" },
        { url: "https://cdn.example.test/a7-side.jpg", alt: "Side" },
      ],
    });
    const stored = await db.collection("products").findOne({ _id: created.id });
    assert(stored.images.length === 2, `${stored.images.length} images stored`);
    assert(stored.images[0].sortOrder === 0 && stored.images[1].sortOrder === 1, "sortOrder was not assigned");
    return "two images stored with dense sortOrder";
  });
}
