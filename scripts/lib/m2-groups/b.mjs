/**
 * Group B — the admin catalogue API, driven over HTTP against the running server.
 *
 * The session is a real one: an administrator row is inserted directly (no public route creates an
 * administrator) and then signs in through `/api/auth/login`, so the cookie under test is the one the
 * product issues. Every request below is what the admin screens send.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { client, db, modules } = ctx;

  const suffix = randomUUID().slice(0, 6);
  const adminEmail = `m2-admin-${suffix}@verify.primemet.test`;
  const adminPassword = "M2AdminPass123";
  const buyerEmail = `m2-buyer-${suffix}@verify.primemet.test`;
  const sellerEmail = `m2-seller-${suffix}@verify.primemet.test`;
  const buyerPassword = "M2BuyerPass123";

  // ---- fixtures ---------------------------------------------------------------------------------
  const adminId = randomUUID();
  await db.collection("users").insertOne({
    _id: adminId,
    email: adminEmail,
    emailVerifiedAt: null,
    passwordHash: await modules.password.hashPassword(adminPassword),
    passwordChangedAt: new Date(),
    fullName: "M2 Administrator",
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

  for (const [email, role, company, password] of [
    [buyerEmail, "BUYER", "M2 Buyer Pvt Ltd", buyerPassword],
    [sellerEmail, "SELLER", "M2 Seller Pvt Ltd", buyerPassword],
  ]) {
    await modules.accounts.registerAccount({
      company,
      contactName: company,
      email,
      passwordHash: await modules.password.hashPassword(password),
      role,
    });
  }

  // A seller registers into PENDING and cannot sign in until an administrator approves the supplier —
  // that gate is M4's, and it is asserted here by doing what approval does. The seller session below is
  // then a genuine one, which is what makes the "seller cannot touch the catalogue" test meaningful.
  await db.collection("users").updateOne({ email: sellerEmail }, { $set: { status: "ACTIVE", updatedAt: new Date() } });
  const sellerUser = await db.collection("users").findOne({ email: sellerEmail });
  await db
    .collection("supplier_profiles")
    .updateOne({ userId: sellerUser._id }, { $set: { verification: "VERIFIED", updatedAt: new Date() } });

  // Sign in as the buyer and the seller in their own jars, so an admin request can never be confused
  // with theirs.
  const admin = (await import("../m1-verify-core.mjs")).createClient(ctx.baseUrl);
  const buyer = (await import("../m1-verify-core.mjs")).createClient(ctx.baseUrl);
  const seller = (await import("../m1-verify-core.mjs")).createClient(ctx.baseUrl);

  // An administrator signs in through the administrator portal: the login route refuses an ADMIN
  // credential presented at the buyer/seller door, which is what "wrong portal" means.
  const signIn = async (jar, email, password, area) => {
    const body = area ? { email, password, area } : { email, password };
    const response = await jar.post("/api/auth/login", { body, useJar: true, anonymous: true });
    assert(response.status === 200 || response.status === 303, `sign-in for ${email} returned ${response.status}`);
    return response;
  };

  await test("B1", "the admin fixtures sign in with real cookies", async () => {
    await signIn(admin, adminEmail, adminPassword, "admin");
    await signIn(buyer, buyerEmail, buyerPassword);
    await signIn(seller, sellerEmail, buyerPassword);
    assert(admin.jar.size > 0, "the admin jar is empty");
    return `3 sessions issued (admin, buyer, seller)`;
  });

  const post = (jar, path, body) =>
    jar.post(path, { body, headers: { accept: "application/json", "content-type": "application/json" } });

  // ---- authorisation ----------------------------------------------------------------------------
  await test("B2", "an anonymous catalogue write is refused", async () => {
    const response = await client.post("/api/admin/catalogue/categories", {
      body: { action: "create", name: "Anonymous", kind: "SCRAP" },
      anonymous: true,
      headers: { accept: "application/json" },
    });
    assert(response.status === 401, `status ${response.status}`);
    assert((await db.collection("categories").countDocuments({ name: "Anonymous" })) === 0, "a category was created");
    return "401 unauthenticated, nothing written";
  });

  await test("B3", "a buyer and a seller cannot write the catalogue", async () => {
    for (const [jar, label] of [[buyer, "buyer"], [seller, "seller"]]) {
      const response = await post(jar, "/api/admin/catalogue/products", { action: "publish", id: "whatever" });
      assert(response.status === 403, `${label} got ${response.status}`);
    }
    return "403 for both portal roles";
  });

  // ---- categories -------------------------------------------------------------------------------
  await test("B4", "an administrator creates a category and a subcategory", async () => {
    const category = await post(admin, "/api/admin/catalogue/categories", {
      action: "create",
      name: `M2 Category ${suffix}`,
      kind: "SCRAP",
      shortDescription: "Created by the M2 gate",
    });
    assert(category.status === 201, `status ${category.status}: ${category.text.slice(0, 200)}`);

    const row = await db.collection("categories").findOne({ name: `M2 Category ${suffix}` });
    assert(row, "the category was not stored");
    assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug), `slug is "${row.slug}"`);
    assert(row.publishedAt instanceof Date, "publishedAt was not set");

    const family = await post(admin, "/api/admin/catalogue/families", {
      action: "create",
      categoryId: row._id,
      name: "Ball bearings",
    });
    assert(family.status === 201, `status ${family.status}: ${family.text.slice(0, 200)}`);

    const familyRow = await db.collection("product_families").findOne({ categoryId: row._id });
    assert(familyRow?.name === "Ball bearings", "the subcategory was not stored against the category");
    ctx.fixture.categoryId = row._id;
    ctx.fixture.categorySlug = row.slug;
    ctx.fixture.familyId = familyRow._id;
    ctx.fixture.familySlug = familyRow.slug;
    return `category ${row.slug} + subcategory ${familyRow.slug}`;
  });

  await test("B5", "a category with subcategories cannot be deleted", async () => {
    const response = await post(admin, "/api/admin/catalogue/categories", {
      action: "delete",
      id: ctx.fixture.categoryId,
    });
    assert(response.status === 400, `status ${response.status}`);
    assert(/subcategory/i.test(response.json?.message ?? ""), `message: ${response.json?.message}`);
    assert(await db.collection("categories").findOne({ _id: ctx.fixture.categoryId }), "the category was deleted anyway");
    return "refused with a readable reason";
  });

  // ---- products ---------------------------------------------------------------------------------
  await test("B6", "an administrator creates a draft product with images and specifications", async () => {
    const response = await post(admin, "/api/admin/catalogue/products", {
      action: "create",
      title: "Deep groove ball bearing 6205",
      slug: `m2-bearing-${suffix}`,
      familyId: ctx.fixture.familyId,
      partNumber: "6205-2RS",
      brand: "SKF",
      manufacturer: "SKF",
      condition: "NEW",
      priceMode: "REQUEST",
      shortDescription: "Sealed deep groove ball bearing for conveyor drives.",
      technicalSpecification: "Single row, contact seals both sides.",
      imageUrls: "https://cdn.example.test/6205-front.jpg | Front view\nhttps://cdn.example.test/6205-side.jpg",
      specifications: "Bore: 25 (mm)\nOuter diameter: 52 (mm)\nWidth: 15 (mm)",
      publish: "no",
    });
    assert(response.status === 201, `status ${response.status}: ${response.text.slice(0, 300)}`);

    const product = await db.collection("products").findOne({ slug: `m2-bearing-${suffix}` });
    assert(product, "the product was not stored");
    assert(product.publicationState === "DRAFT", `state is ${product.publicationState}`);
    assert(product.images.length === 2, `${product.images.length} images stored`);
    assert(product.images[0].alt === "Front view", `alt is ${product.images[0].alt}`);

    const specs = await db.collection("product_specifications").find({ productId: product._id }).sort({ sortOrder: 1 }).toArray();
    assert(specs.length === 3, `${specs.length} specification rows`);
    assert(specs[0].attribute === "Bore" && specs[0].valueText === "25" && specs[0].unit === "mm", JSON.stringify(specs[0]));

    ctx.fixture.productId = product._id;
    ctx.fixture.productSlug = product.slug;
    return `draft product ${product.slug}, 2 images, 3 specification rows`;
  });

  await test("B7", "a draft is not readable on the public catalogue", async () => {
    const list = await client.get(`/products?q=m2-bearing-${suffix}`, { anonymous: true });
    assert(list.status === 200, `listing status ${list.status}`);
    assert(!list.text.includes("6205-2RS"), "the draft appears in the public listing");

    const detail = await client.get(`/products/${ctx.fixture.productSlug}`, { anonymous: true });
    assert(detail.status === 404, `draft detail page returned ${detail.status}`);
    return "absent from the listing, 404 by slug";
  });

  await test("B8", "an administrator edits the product and its gallery", async () => {
    const response = await post(admin, "/api/admin/catalogue/products", {
      action: "update",
      id: ctx.fixture.productId,
      title: "Deep groove ball bearing 6205-2RS",
      familyId: ctx.fixture.familyId,
      condition: "NEW",
      priceMode: "REQUEST",
      manufacturer: "SKF India",
      imageUrls: "https://cdn.example.test/6205-hero.jpg | Hero",
      specifications: "Bore: 25 (mm)\nDynamic load rating: 14 (kN)",
    });
    assert(response.status === 200, `status ${response.status}: ${response.text.slice(0, 300)}`);

    const product = await db.collection("products").findOne({ _id: ctx.fixture.productId });
    assert(product.title === "Deep groove ball bearing 6205-2RS", "the title was not updated");
    assert(product.manufacturer === "SKF India", "the manufacturer was not updated");
    assert(product.images.length === 1 && /6205-hero/.test(product.images[0].url), "the gallery was not replaced");
    assert(product.slug === ctx.fixture.productSlug, "the slug changed on edit");

    const specs = await db.collection("product_specifications").find({ productId: product._id }).toArray();
    assert(specs.length === 2, `${specs.length} specification rows after edit`);
    return "fields, gallery and specification table replaced";
  });

  await test("B9", "a non-https image and a short title are refused with a message", async () => {
    const badImage = await post(admin, "/api/admin/catalogue/products", {
      action: "update",
      id: ctx.fixture.productId,
      title: "Deep groove ball bearing 6205-2RS",
      familyId: ctx.fixture.familyId,
      condition: "NEW",
      priceMode: "REQUEST",
      imageUrls: "http://cdn.example.test/insecure.jpg",
    });
    assert(badImage.status === 400, `status ${badImage.status}`);
    assert(/https/i.test(badImage.json?.message ?? ""), `message: ${badImage.json?.message}`);

    const stored = await db.collection("products").findOne({ _id: ctx.fixture.productId });
    assert(stored.images.every((image) => image.url.startsWith("https://")), "an insecure URL was stored");

    const badTitle = await post(admin, "/api/admin/catalogue/products", {
      action: "update",
      id: ctx.fixture.productId,
      title: "x",
      familyId: ctx.fixture.familyId,
      condition: "NEW",
      priceMode: "REQUEST",
    });
    assert(badTitle.status === 400, `status ${badTitle.status}`);
    return "both refused, nothing stored";
  });

  await test("B10", "publish and unpublish move the product in and out of the public catalogue", async () => {
    const published = await post(admin, "/api/admin/catalogue/products", {
      action: "publish",
      id: ctx.fixture.productId,
    });
    assert(published.status === 200, `publish status ${published.status}`);

    const stored = await db.collection("products").findOne({ _id: ctx.fixture.productId });
    assert(stored.publicationState === "PUBLISHED", `state is ${stored.publicationState}`);
    assert(stored.publishedAt instanceof Date, "publishedAt was not stamped");

    const detail = await client.get(`/products/${ctx.fixture.productSlug}`, { anonymous: true });
    assert(detail.status === 200, `public detail returned ${detail.status}`);
    assert(detail.text.includes("6205-2RS"), "the part number is missing from the public page");
    assert(detail.text.includes("Outer diameter") || detail.text.includes("Dynamic load rating"), "specifications are missing");

    const unpublished = await post(admin, "/api/admin/catalogue/products", {
      action: "unpublish",
      id: ctx.fixture.productId,
    });
    assert(unpublished.status === 200, `unpublish status ${unpublished.status}`);
    const after = await client.get(`/products/${ctx.fixture.productSlug}`, { anonymous: true });
    assert(after.status === 404, `after unpublish the page returned ${after.status}`);

    await post(admin, "/api/admin/catalogue/products", { action: "publish", id: ctx.fixture.productId });
    return "published → visible, unpublished → 404, republished for later groups";
  });

  await test("B11", "archive withdraws a product without deleting it", async () => {
    const created = await post(admin, "/api/admin/catalogue/products", {
      action: "create",
      title: "Archived test product",
      slug: `m2-archive-${suffix}`,
      familyId: ctx.fixture.familyId,
      condition: "USED",
      priceMode: "REQUEST",
      publish: "yes",
    });
    assert(created.status === 201, `create status ${created.status}`);
    const row = await db.collection("products").findOne({ slug: `m2-archive-${suffix}` });

    const archived = await post(admin, "/api/admin/catalogue/products", { action: "archive", id: row._id });
    assert(archived.status === 200, `archive status ${archived.status}`);

    const stored = await db.collection("products").findOne({ _id: row._id });
    assert(stored, "the document was deleted");
    assert(stored.publicationState === "ARCHIVED", `state is ${stored.publicationState}`);
    assert(stored.deletedAt instanceof Date, "deletedAt was not set");

    const detail = await client.get(`/products/m2-archive-${suffix}`, { anonymous: true });
    assert(detail.status === 404, `archived page returned ${detail.status}`);
    return "ARCHIVED + deletedAt set, page 404, document retained";
  });

  await test("B12", "every catalogue mutation is in the audit log with the acting administrator", async () => {
    const rows = await db
      .collection("audit_logs")
      .find({ action: { $regex: "^catalogue\\." } })
      .toArray();
    assert(rows.length >= 6, `${rows.length} catalogue audit rows`);
    assert(rows.every((row) => row.actorUserId === adminId), "an audit row names a different actor");
    const actions = new Set(rows.map((row) => row.action));
    for (const expected of [
      "catalogue.category.created",
      "catalogue.family.created",
      "catalogue.product.created",
      "catalogue.product.updated",
      "catalogue.product.published",
      "catalogue.product.archived",
    ]) {
      assert(actions.has(expected), `missing audit action ${expected}`);
    }
    return `${rows.length} audit rows across ${actions.size} actions`;
  });

  await test("B13", "the admin product list is paged and searchable", async () => {
    const jar = admin;
    const first = await jar.get("/admin/products?state=ALL&page=1", { headers: { accept: "text/html" } });
    assert(first.status === 200, `status ${first.status}`);
    assert(first.text.includes("Deep groove ball bearing"), "the fixture product is missing from the admin list");

    const searched = await jar.get(`/admin/products?q=m2-bearing-${suffix}`, { headers: { accept: "text/html" } });
    assert(searched.status === 200, `search status ${searched.status}`);
    assert(searched.text.includes("Deep groove ball bearing"), "the search did not find the product by slug");

    const missing = await jar.get("/admin/products?q=zzzz-not-a-product", { headers: { accept: "text/html" } });
    assert(missing.text.includes("No product matches"), "an empty result does not say so");
    return "list, search hit and empty state all render";
  });

  await test("B14", "the category manager renders the tree it just built", async () => {
    const response = await admin.get("/admin/catalogue/categories", { headers: { accept: "text/html" } });
    assert(response.status === 200, `status ${response.status}`);
    assert(response.text.includes(`M2 Category ${suffix}`), "the created category is missing");
    assert(response.text.includes("Ball bearings"), "the created subcategory is missing");
    return "category and subcategory both rendered";
  });

  return { adminEmail, adminPassword, buyerEmail, buyerPassword, sellerEmail, sellerPassword: buyerPassword };
}
