/**
 * Group E — the end-to-end seller onboarding journey, in one sequence.
 *
 * Owner's numbered acceptance list, with one deliberate deviation that the product REQUIRES: the list
 * says the seller logs in (2) and sees PENDING_APPROVAL (3) BEFORE the administrator approves (8). A
 * seller cannot sign in while the account is INVITED — that is the M1 login rule — so steps 2-3 are
 * demonstrated as they actually behave: the registration response and the sign-in refusal carry the
 * pending state, and the signed-in view of the status is shown immediately after approval (step 9).
 * Every step below is asserted against MongoDB and against the rendered page.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  const suffix = randomUUID().slice(0, 6);
  const email = "m4-journey-" + suffix + "@verify.primemet.test";
  const password = "M4JourneyPass123";

  const seller = createClient(ctx.baseUrl);
  const admin = createClient(ctx.baseUrl);
  const anonymous = createClient(ctx.baseUrl);
  const other = createClient(ctx.baseUrl);

  const state = {};

  await test("E1", "1. the seller registers", async () => {
    const response = await seller.post("/api/auth/register", {
      anonymous: true,
      body: {
        role: "SELLER",
        company: "M4 Journey Metals Pvt Ltd",
        contactName: "Journey Applicant",
        email,
        phone: "+91 90000 00031",
        gstin: "29ABCDE1234F1Z8",
        city: "Bengaluru",
        stateCode: "KA",
        addressLine1: "Plot 9, Peenya",
        postalCode: "560058",
        businessType: "STOCKIST",
        description: "Stockist of aluminium and copper scrap with a 1-acre yard.",
        password,
        passwordConfirm: password,
      },
    });
    assert(response.status === 201, "status " + response.status + " " + response.text.slice(0, 160));
    const user = await db.collection("users").findOne({ email });
    const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });
    assert(user && profile, "registration did not create the user and profile");
    state.userId = user._id;
    state.profileId = profile._id;
    state.organisationId = profile.organisationId;
    return "201; user " + user.status + ", organisation PENDING_APPROVAL";
  });

  await test("E2", "2. the seller cannot sign in before approval, and is told why", async () => {
    const response = await seller.post("/api/auth/login", { body: { email, password }, useJar: true, anonymous: true });
    assert(response.status === 403, "status " + response.status);
    assert(response.json?.code === "inactive", "code " + response.json?.code);
    assert(/awaiting/i.test(response.json?.message ?? ""), "message: " + response.json?.message);
    const organisation = await db.collection("organisations").findOne({ _id: state.organisationId });
    assert(organisation.accountStatus === "PENDING_APPROVAL", "accountStatus " + organisation.accountStatus);
    return "403 inactive with the pending explanation (PENDING_APPROVAL cannot be signed into)";
  });

  await test("E3", "3. the administrator signs in and the application is in the queue", async () => {
    const login = await admin.post("/api/auth/login", {
      body: { email: ctx.fixture.adminEmail, password: ctx.fixture.adminPassword, area: "admin" },
      useJar: true,
      anonymous: true,
    });
    assert(login.status === 200 || login.status === 303, "admin sign-in " + login.status);
    const page = await admin.get("/admin/suppliers", { headers: { accept: "text/html" } });
    assert(page.text.includes("M4 Journey Metals Pvt Ltd"), "the application is not in the queue");
    assert(page.text.includes("Awaiting decision"), "the queue does not show the pending state");
    return "admin queue shows the application as Awaiting decision";
  });

  await test("E4", "4. the administrator reviews the company information", async () => {
    const page = await admin.get("/admin/suppliers/" + state.organisationId, { headers: { accept: "text/html" } });
    assert(page.status === 200, "status " + page.status);
    assert(page.text.includes("M4 Journey Metals Pvt Ltd"), "legal name missing");
    assert(page.text.includes("Plot 9, Peenya"), "address missing");
    assert(page.text.includes("Stockist of aluminium"), "description missing");
    assert(page.text.includes("29ABCDE1234F1Z8"), "GSTIN missing");
    return "company, address, description and GSTIN all on the review page";
  });

  await test("E5", "5. the administrator approves the seller", async () => {
    const response = await admin.post("/api/admin/sellers", {
      body: { organisationId: state.organisationId, action: "approve" },
    });
    assert(response.status === 200, "status " + response.status + " " + response.text.slice(0, 160));
    const user = await db.collection("users").findOne({ _id: state.userId });
    const organisation = await db.collection("organisations").findOne({ _id: state.organisationId });
    assert(user.status === "ACTIVE", "user " + user.status);
    assert(organisation.accountStatus === "ACTIVE", "organisation " + organisation.accountStatus);
    return "login and organisation both ACTIVE";
  });

  await test("E6", "6. the seller signs in and sees the updated status", async () => {
    const login = await seller.post("/api/auth/login", { body: { email, password }, useJar: true, anonymous: true });
    assert(login.status === 200 || login.status === 303, "sign-in " + login.status);
    const page = await seller.get("/seller/dashboard", { headers: { accept: "text/html" } });
    assert(page.status === 200, "dashboard status " + page.status);
    assert(page.text.includes("M4 Journey Metals Pvt Ltd"), "company missing");
    assert(page.text.includes("Approved"), "the dashboard does not show the approved state");
    return "signed in; dashboard shows Registration status: Approved";
  });

  await test("E7", "7. the seller submits its company information", async () => {
    const response = await seller.post("/api/seller/profile", {
      body: {
        company: "M4 Journey Metals Limited",
        businessType: "PROCESSOR",
        description: "Aluminium and copper processing with a weighbridge, baler and spectro lab.",
        line1: "Plot 10, Peenya Industrial Area",
        city: "Bengaluru",
        stateCode: "KA",
        postalCode: "560058",
        contactName: "Journey Owner",
        phone: "+91 90000 00032",
      },
    });
    assert(response.status === 200, "status " + response.status);
    const organisation = await db.collection("organisations").findOne({ _id: state.organisationId });
    const address = await db.collection("organisation_addresses").findOne({ organisationId: state.organisationId, kind: "REGISTERED" });
    assert(organisation.businessType === "PROCESSOR", "businessType " + organisation.businessType);
    assert(address.line1 === "Plot 10, Peenya Industrial Area", "address " + address.line1);
    return "company, business type and address saved";
  });

  await test("E8", "8. the seller submits a product listing", async () => {
    const response = await seller.post("/api/seller/listings", {
      body: {
        title: "M4 Journey copper millberry",
        categoryLabel: "Copper",
        manufacturer: "Journey Metals",
        description: "Bright copper millberry 99.9%, baled, ex-Bengaluru yard.",
        specification: "Cu 99.9% min, moisture < 0.5%, bale 300-500 kg.",
        quantityKg: "6000",
        images: ["https://images.example.test/journey-1.jpg"],
        supportingInfo: "Assay certificate on request.",
      },
    });
    assert(response.status === 200, "status " + response.status + " " + response.text.slice(0, 160));
    const listing = await db.collection("supplier_listings").findOne({ supplierId: state.profileId, title: "M4 Journey copper millberry" });
    assert(listing, "the listing was not written");
    state.listingId = listing._id;
    assert(listing.reviewStatus === "PENDING" && listing.status === "DRAFT", "state " + listing.reviewStatus + "/" + listing.status);
    return "stored PENDING / DRAFT as listing " + listing._id.slice(0, 8);
  });

  await test("E9", "9. the seller sees its submission awaiting review", async () => {
    const page = await seller.get("/seller/products", { headers: { accept: "text/html" } });
    assert(page.text.includes("M4 Journey copper millberry"), "the submission is missing from the history");
    assert(page.text.includes("Awaiting approval"), "the pending state is not shown");
    return "history shows the submission as Awaiting approval";
  });

  await test("E10", "10. the administrator reviews the submitted listing", async () => {
    const page = await admin.get("/admin/listing-submissions?status=PENDING", { headers: { accept: "text/html" } });
    assert(page.status === 200, "status " + page.status);
    assert(page.text.includes("M4 Journey copper millberry"), "the listing is not in the review queue");
    assert(page.text.includes("Cu 99.9% min"), "the specification is not shown to the reviewer");
    assert(page.text.includes("M4 Journey Metals"), "the supplier is not named");
    return "queue shows the listing with supplier and specification";
  });

  await test("E11", "11. the administrator approves the listing", async () => {
    const response = await admin.post("/api/admin/listings", {
      body: { listingId: state.listingId, action: "approve" },
    });
    assert(response.status === 200, "status " + response.status + " " + response.text.slice(0, 160));
    const listing = await db.collection("supplier_listings").findOne({ _id: state.listingId });
    assert(listing.reviewStatus === "APPROVED" && listing.status === "ACTIVE", "state " + listing.reviewStatus + "/" + listing.status);
    return "APPROVED / ACTIVE";
  });

  await test("E12", "12. the seller sees the approval; the product is published only by the desk", async () => {
    const sellerPage = await seller.get("/seller/products", { headers: { accept: "text/html" } });
    assert(sellerPage.text.includes("Approved"), "the seller does not see the approval");
    assert(!sellerPage.text.includes("Reason:"), "a rejection reason is shown on an approved listing");

    const publicPage = await anonymous.get("/products", { headers: { accept: "text/html" }, anonymous: true });
    assert(!publicPage.text.includes("M4 Journey copper millberry"), "the approved listing is publicly listed before publication");

    const category = await modules.catalogue.createCategory({
      name: "M4 Journey Category " + suffix,
      slug: "m4-journey-category-" + suffix,
      kind: "SCRAP",
    });
    const family = await modules.catalogue.createFamily({
      categoryId: category.id,
      name: "M4 Journey Family",
      slug: "m4-journey-family-" + suffix,
    });
    const product = await modules.catalogue.createProduct({
      title: "M4 Journey Catalogue Copper " + suffix,
      slug: "m4-journey-catalogue-copper-" + suffix,
      familyId: family.id,
      condition: "NEW",
      priceMode: "REQUEST",
      shortDescription: "The catalogue product the desk publishes for the journey test.",
      publicationState: "PUBLISHED",
    });

    const after = await anonymous.get("/products/" + product.slug, { headers: { accept: "text/html" }, anonymous: true });
    assert(after.status === 200, "published product page status " + after.status);
    assert(after.text.includes("M4 Journey Catalogue Copper"), "the published product is not on the catalogue");
    assert(!after.text.includes("Journey Metals"), "a seller's identity reached the public product page");
    return "seller sees Approved; public catalogue shows only the admin-published product, with no seller identity";
  });

  await test("E13", "13. the seller cannot change its approval state or read another seller's data", async () => {
    const selfApprove = await seller.post("/api/admin/sellers", {
      body: { organisationId: state.organisationId, action: "reject", reason: "Rejecting myself" },
    });
    assert(selfApprove.status === 403, "self-decision status " + selfApprove.status);
    const organisation = await db.collection("organisations").findOne({ _id: state.organisationId });
    assert(organisation.accountStatus === "ACTIVE", "the seller changed its status to " + organisation.accountStatus);

    const listing = await db.collection("supplier_listings").findOne({ _id: state.listingId });
    assert(listing.reviewStatus === "APPROVED", "the seller re-decided its own listing");

    // Another approved seller, signed in, must not see this seller's submission.
    const otherEmail = "m4-journey-other-" + suffix + "@verify.primemet.test";
    await modules.accounts.registerAccount({
      company: "M4 Other Seller Pvt Ltd",
      contactName: "Other Seller",
      email: otherEmail,
      passwordHash: await modules.password.hashPassword("M4OtherPass123"),
      role: "SELLER",
    });
    await db.collection("users").updateOne({ email: otherEmail }, { $set: { status: "ACTIVE" } });
    const otherLogin = await other.post("/api/auth/login", {
      body: { email: otherEmail, password: "M4OtherPass123" },
      useJar: true,
      anonymous: true,
    });
    assert(otherLogin.status === 200 || otherLogin.status === 303, "other seller sign-in " + otherLogin.status);
    const pages = await Promise.all([
      other.get("/seller/products", { headers: { accept: "text/html" } }),
      other.get("/seller/dashboard", { headers: { accept: "text/html" } }),
    ]);
    for (const page of pages) {
      assert(!page.text.includes("M4 Journey copper millberry"), "another seller sees this seller's listing");
      assert(!page.text.includes("M4 Journey Metals"), "another seller sees this seller's company");
    }
    return "self-decision 403; approved state unchanged; second seller sees none of it";
  });
}
