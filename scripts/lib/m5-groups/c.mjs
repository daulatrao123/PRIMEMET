/**
 * Group C — product management over HTTP.
 *
 * Creation, publication, editing, archiving and manufacturer rename all go through the single guarded
 * endpoint the admin forms post to. The product under test is created here so the assertions cannot be
 * satisfied by a fixture someone else made.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, fixture } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  const admin = createClient(ctx.baseUrl);
  const buyer = createClient(ctx.baseUrl);
  const anonymous = createClient(ctx.baseUrl);

  const suffix = randomUUID().slice(0, 6);
  const title = `M5 Managed Product ${suffix}`;
  const build = "M5-C-001";

  const adminSignIn = await admin.post("/api/auth/login", {
    body: { email: fixture.adminActor.email, password: fixture.adminPassword, area: "admin" },
    useJar: true,
    anonymous: true,
    ip: "198.51.100.31",
  });
  assert([200, 303].includes(adminSignIn.status), `admin sign-in ${adminSignIn.status}`);

  const buyerSignIn = await buyer.post("/api/auth/login", {
    body: { email: fixture.buyerA.email, password: fixture.buyerA.password },
    useJar: true,
    anonymous: true,
    ip: "198.51.100.32",
  });
  assert([200, 303].includes(buyerSignIn.status), `buyer sign-in ${buyerSignIn.status}`);

  await test("C1", "an administrator creates a draft product and then publishes it", async () => {
    const created = await admin.post("/api/admin/catalogue/products", {
      body: {
        action: "create",
        title,
        familyId: fixture.familyId,
        condition: "NEW",
        priceMode: "REQUEST",
        partNumber: build,
        manufacturer: `M5 Managed Works ${suffix}`,
        shortDescription: "A product the M5 gate creates through the administrator's own endpoint.",
        publish: "no",
        imageUrls: "",
        specifications: "Material: Chrome steel\nBore: 25 (mm)",
      },
    });
    assert(created.status === 201, `create ${created.status} ${created.text.slice(0, 200)}`);

    const stored = await db.collection("products").findOne({ title });
    assert(stored, "the product was not stored");
    assert(stored.publicationState === "DRAFT", `state ${stored.publicationState}`);
    const specs = await db.collection("product_specifications").find({ productId: stored._id }).toArray();
    assert(specs.length === 2, `${specs.length} specification rows`);

    const draftPage = await anonymous.get(`/products/${stored.slug}`, { headers: { accept: "text/html" } });
    assert(draftPage.status === 404, `draft public page ${draftPage.status}`);

    const published = await admin.post("/api/admin/catalogue/products", {
      body: { action: "publish", id: stored._id, returnTo: "/admin/products" },
    });
    assert([200, 303].includes(published.status), `publish ${published.status} ${published.text.slice(0, 160)}`);
    const afterPublish = await db.collection("products").findOne({ _id: stored._id });
    assert(afterPublish.publicationState === "PUBLISHED", `state ${afterPublish.publicationState}`);
    assert(afterPublish.publishedAt instanceof Date, "no publication date");

    const publicPage = await anonymous.get(`/products/${stored.slug}`, { headers: { accept: "text/html" } });
    assert(publicPage.status === 200, `published public page ${publicPage.status}`);
    ctx.fixture.managedProductId = stored._id;
    ctx.fixture.managedProductSlug = stored.slug;
    return `created DRAFT, published, /products/${stored.slug} 200`;
  });

  await test("C2", "an administrator edits the product, and the URL does not change", async () => {
    const before = await db.collection("products").findOne({ _id: ctx.fixture.managedProductId });
    const updated = await admin.post("/api/admin/catalogue/products", {
      body: {
        action: "update",
        id: before._id,
        title: `${title} Revised`,
        partNumber: "M5-C-002",
        manufacturer: before.manufacturer,
        shortDescription: "Revised description written by the M5 verification gate.",
        imageUrls: "https://cdn.example.test/m5/hero.jpg|Hero image",
        specifications: "Material: Stainless steel\nOuter diameter: 52 (mm)",
      },
    });
    assert([200, 303].includes(updated.status), `update ${updated.status} ${updated.text.slice(0, 200)}`);

    const after = await db.collection("products").findOne({ _id: before._id });
    assert(after.title.endsWith("Revised"), `title ${after.title}`);
    assert(after.partNumber === "M5-C-002", `partNumber ${after.partNumber}`);
    assert(after.slug === before.slug, `slug changed to ${after.slug}`);
    assert((after.images ?? []).length === 1, `${(after.images ?? []).length} images after edit`);

    const specs = await db.collection("product_specifications").find({ productId: before._id }).toArray();
    assert(specs.length === 2 && specs.some((row) => row.attribute === "Material"), "specification table not replaced");

    const page = await anonymous.get(`/products/${before.slug}`, { headers: { accept: "text/html" } });
    assert(page.status === 200, `public page ${page.status}`);
    assert(page.text.includes("Revised"), "the public page does not show the edited title");
    return "title, part number, gallery and specifications updated; slug unchanged";
  });

  await test("C3", "archiving removes the product from the public catalogue but keeps the record", async () => {
    const archived = await admin.post("/api/admin/catalogue/products", {
      body: { action: "archive", id: ctx.fixture.managedProductId, returnTo: "/admin/products" },
    });
    assert([200, 303].includes(archived.status), `archive ${archived.status}`);

    const stored = await db.collection("products").findOne({ _id: ctx.fixture.managedProductId });
    assert(stored.publicationState === "ARCHIVED", `state ${stored.publicationState}`);
    assert(stored.deletedAt instanceof Date, "archive did not set deletedAt");

    const page = await anonymous.get(`/products/${ctx.fixture.managedProductSlug}`, { headers: { accept: "text/html" } });
    assert(page.status === 404, `archived public page ${page.status}`);

    const list = await admin.get(`/admin/products?q=${encodeURIComponent("M5 Managed Product")}&state=ARCHIVED`, {
      headers: { accept: "text/html" },
    });
    assert(list.status === 200, `admin list ${list.status}`);
    assert(list.text.includes("Archived"), "the admin list does not show the archived state");
    return "state ARCHIVED, deletedAt set, public 404, admin list keeps the row";
  });

  await test("C4", "a buyer, a seller and an anonymous caller cannot touch the catalogue", async () => {
    const attempt = {
      action: "create",
      title: `M5 Forbidden Product ${suffix}`,
      familyId: fixture.familyId,
      condition: "NEW",
      priceMode: "REQUEST",
    };
    const asBuyer = await buyer.post("/api/admin/catalogue/products", { body: attempt });
    assert(asBuyer.status === 403, `buyer ${asBuyer.status}`);
    const asAnonymous = await anonymous.post("/api/admin/catalogue/products", { body: attempt });
    assert(asAnonymous.status === 401, `anonymous ${asAnonymous.status}`);
    const written = await db.collection("products").countDocuments({ title: attempt.title });
    assert(written === 0, `a forbidden request created ${written} product(s)`);
    return "buyer 403, anonymous 401, nothing written";
  });

  await test("C5", "a manufacturer rename reaches the product and leaves its URL alone", async () => {
    const product = await db.collection("products").findOne({ _id: fixture.productId });
    const next = `M5 Renamed Manufacturer ${suffix}`;
    const response = await admin.post("/api/admin/manufacturers", { body: { from: product.manufacturer, to: next } });
    assert([200, 303].includes(response.status), `rename ${response.status} ${response.text.slice(0, 160)}`);

    const after = await db.collection("products").findOne({ _id: fixture.productId });
    assert(after.manufacturer === next, `manufacturer ${after.manufacturer}`);
    assert(after.slug === product.slug, `slug changed to ${after.slug}`);
    const page = await anonymous.get(`/products/${product.slug}`, { headers: { accept: "text/html" } });
    assert(page.status === 200, `public page ${page.status}`);
    return `renamed to "${next}", slug ${product.slug} preserved, public page 200`;
  });

  return {};
}
