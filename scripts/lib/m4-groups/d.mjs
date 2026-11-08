/**
 * Group D — the administrator's review screens and the publication gate.
 *
 * The administrator is the account group B created. The decisions are posted exactly as the detail page
 * posts them, and every one is followed by a read of the database: a 200 is not evidence that the
 * approval gate moved.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  const suffix = randomUUID().slice(0, 6);
  const admin = createClient(ctx.baseUrl);
  const seller = createClient(ctx.baseUrl);
  const anonymous = createClient(ctx.baseUrl);
  const buyer = createClient(ctx.baseUrl);

  const signIn = async (jar, email, password, area) => {
    const response = await jar.post("/api/auth/login", {
      body: area ? { email, password, area } : { email, password },
      useJar: true,
      anonymous: true,
    });
    assert(response.status === 200 || response.status === 303, "sign-in for " + email + " returned " + response.status);
  };

  await signIn(admin, ctx.fixture.adminEmail, ctx.fixture.adminPassword, "admin");
  await signIn(seller, ctx.fixture.sellerEmail, ctx.fixture.sellerPassword);

  const user = await db.collection("users").findOne({ email: ctx.fixture.sellerEmail });
  const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });
  const organisationId = profile.organisationId;

  await test("D1", "the queue filters by status and searches, with the term escaped", async () => {
    // A fresh application, so this test never depends on another group's decisions.
    await modules.accounts.registerAccount({
      company: "M4 Queue Applicant " + suffix,
      contactName: "Queue Applicant",
      email: "m4-queue-" + suffix + "@verify.primemet.test",
      passwordHash: await modules.password.hashPassword("M4QueuePass123"),
      role: "SELLER",
      businessType: "WORKSHOP",
      city: "Coimbatore",
      stateCode: "TN",
    });

    const pending = await admin.get("/admin/suppliers?status=PENDING_APPROVAL", { headers: { accept: "text/html" } });
    assert(pending.status === 200, "status " + pending.status);
    assert(pending.text.includes("M4 Queue Applicant " + suffix), "the pending seller is missing");
    assert(!pending.text.includes("M4 Http Metals Limited"), "an approved seller is listed as pending");

    const search = await admin.get("/admin/suppliers?q=Http%20Metals", { headers: { accept: "text/html" } });
    assert(search.text.includes("M4 Http Metals Limited"), "the search did not find the company");
    assert(!search.text.includes("M4 Alpha Processors"), "the search did not narrow the list");

    const regex = await admin.get("/admin/suppliers?q=.*", { headers: { accept: "text/html" } });
    assert(regex.status === 200, "a regex-shaped search returned " + regex.status);
    assert(!regex.text.includes("M4 Http Metals Limited"), "a regex-shaped search matched every company");
    return "status filter, literal search, regex-shaped term escaped";
  });

  await test("D2", "the application detail page shows the company record and the address", async () => {
    const page = await admin.get("/admin/suppliers/" + organisationId, { headers: { accept: "text/html" } });
    assert(page.status === 200, "status " + page.status);
    assert(page.text.includes("M4 Http Metals Limited"), "legal name missing");
    assert(page.text.includes("Gat 221, Satpur"), "registered address missing");
    assert(page.text.includes("Castings, machining"), "company description missing");
    assert(page.text.includes("M4 Http aluminium ingots"), "the seller's listing is missing");
    return "200 with company, address, description and listing";
  });

  await test("D3", "an internal note is recorded and never reaches the seller", async () => {
    const note = "Site visit booked for 12 Nov; spectro lab confirmed on the call.";
    const response = await admin.post("/api/admin/sellers", {
      body: { organisationId, action: "note", note },
    });
    assert(response.status === 200, "status " + response.status + " " + response.text.slice(0, 160));

    const organisation = await db.collection("organisations").findOne({ _id: organisationId });
    assert(String(organisation.internalNotes).includes("Site visit booked"), "the note was not stored");

    const detail = await admin.get("/admin/suppliers/" + organisationId, { headers: { accept: "text/html" } });
    assert(detail.text.includes("Site visit booked"), "the note is missing from the admin detail page");

    for (const path of ["/seller/dashboard", "/seller/profile", "/seller/products"]) {
      const page = await seller.get(path, { headers: { accept: "text/html" } });
      assert(page.status === 200, path + " status " + page.status);
      assert(!page.text.includes("Site visit booked"), "the internal note reached " + path);
    }
    return "stored, visible to the desk, absent from three seller pages";
  });

  await test("D4", "a listing rejection without a reason is refused", async () => {
    const listing = await db.collection("supplier_listings").findOne({ supplierId: profile._id, reviewStatus: "PENDING" });
    assert(listing, "no pending listing to reject");
    const response = await admin.post("/api/admin/listings", {
      body: { listingId: listing._id, action: "reject", reason: "" },
    });
    assert(response.status === 400, "status " + response.status);
    const after = await db.collection("supplier_listings").findOne({ _id: listing._id });
    assert(after.reviewStatus === "PENDING", "the listing moved to " + after.reviewStatus);
    return "400, listing still PENDING";
  });

  await test("D5", "an administrator approves the listing, and it becomes ACTIVE", async () => {
    const listing = await db.collection("supplier_listings").findOne({ supplierId: profile._id, reviewStatus: "PENDING" });
    const response = await admin.post("/api/admin/listings", {
      body: { listingId: listing._id, action: "approve" },
    });
    assert(response.status === 200, "status " + response.status + " " + response.text.slice(0, 160));

    const after = await db.collection("supplier_listings").findOne({ _id: listing._id });
    assert(after.reviewStatus === "APPROVED", "reviewStatus " + after.reviewStatus);
    assert(after.status === "ACTIVE", "status " + after.status);
    assert(after.reviewedByUserId, "no reviewer recorded");
    assert(after.reviewedAt, "no review timestamp");

    const audit = await db.collection("audit_logs").findOne({ action: "listing.approved", entityId: listing._id });
    assert(audit, "no audit row for the approval");
    return "APPROVED + ACTIVE, reviewer and audit recorded";
  });

  await test("D6", "an approved submission still does not publish a catalogue product", async () => {
    const page = await anonymous.get("/products", { headers: { accept: "text/html" }, anonymous: true });
    assert(page.status === 200, "catalogue status " + page.status);
    assert(!page.text.includes("M4 Http aluminium ingots"), "approval published the product by itself");
    const product = await db.collection("products").findOne({ title: "M4 Http aluminium ingots" });
    assert(!product, "a catalogue product document was created by approving a listing");
    return "APPROVED listing, no catalogue product and no public page";
  });

  await test("D7", "the catalogue publishes only when an administrator publishes a product", async () => {
    const category = await modules.catalogue.createCategory({
      name: "M4 Gate Category " + suffix,
      slug: "m4-gate-category-" + suffix,
      kind: "SCRAP",
    });
    const family = await modules.catalogue.createFamily({
      categoryId: category.id,
      name: "M4 Gate Family",
      slug: "m4-gate-family-" + suffix,
    });
    const draft = await modules.catalogue.createProduct({
      title: "M4 Gate Product " + suffix,
      slug: "m4-gate-product-" + suffix,
      familyId: family.id,
      condition: "NEW",
      priceMode: "REQUEST",
      shortDescription: "A product created as a draft for the publication-gate test.",
      publicationState: "DRAFT",
    });

    const before = await anonymous.get("/products", { headers: { accept: "text/html" }, anonymous: true });
    assert(!before.text.includes("M4 Gate Product " + suffix), "a DRAFT product is publicly listed");

    await modules.catalogue.updateProduct(draft.id, { publicationState: "PUBLISHED" });

    const after = await anonymous.get("/products", { headers: { accept: "text/html" }, anonymous: true });
    assert(after.text.includes("M4 Gate Product " + suffix), "the published product is not on the catalogue");
    return "DRAFT hidden, PUBLISHED visible";
  });

  await test("D8", "only an administrator can decide a listing or an application", async () => {
    const buyerEmail = "m4-d-buyer-" + suffix + "@verify.primemet.test";
    await modules.accounts.registerAccount({
      company: "M4 D Buyer Pvt Ltd",
      contactName: "D Buyer",
      email: buyerEmail,
      passwordHash: await modules.password.hashPassword("M4BuyerPass123"),
      role: "BUYER",
    });
    await signIn(buyer, buyerEmail, "M4BuyerPass123");

    const asBuyer = await buyer.post("/api/admin/sellers", { body: { organisationId, action: "approve" } });
    assert(asBuyer.status === 403, "buyer → /api/admin/sellers returned " + asBuyer.status);
    const anon = await anonymous.post("/api/admin/listings", { body: { listingId: "x", action: "approve" }, anonymous: true });
    assert(anon.status === 401, "anonymous → /api/admin/listings returned " + anon.status);

    const organisation = await db.collection("organisations").findOne({ _id: organisationId });
    assert(organisation.accountStatus === "ACTIVE", "a buyer changed the application status to " + organisation.accountStatus);
    return "403 buyer, 401 anonymous, status unchanged";
  });

  await test("D9", "the audit trail is visible on the application", async () => {
    const page = await admin.get("/admin/suppliers/" + organisationId, { headers: { accept: "text/html" } });
    assert(page.text.includes("seller.application.approved"), "the approval is missing from the audit trail");
    assert(page.text.includes("seller.note_added"), "the note is missing from the audit trail");
    const listingAudit = await db.collection("audit_logs").findOne({ action: "listing.approved" });
    assert(listingAudit, "the listing approval wrote no audit row");
    return "approval and note actions listed on the application; listing decision audited";
  });
}
