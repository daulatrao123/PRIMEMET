/**
 * Group C — the seller portal over HTTP, and the refusals around it.
 *
 * The session is real and the writes are the forms the pages render. Every "seller cannot" test posts the
 * request a determined seller would post, and then reads the database to prove nothing moved.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  const suffix = randomUUID().slice(0, 6);
  const seller = createClient(ctx.baseUrl);
  const anonymous = createClient(ctx.baseUrl);
  const buyer = createClient(ctx.baseUrl);
  const secondSeller = createClient(ctx.baseUrl);

  const sellerEmail = ctx.fixture.sellerEmail;
  const sellerPassword = ctx.fixture.sellerPassword;
  assert(sellerEmail, "group B did not provide the approved seller");

  const signIn = async (jar, email, password, area) => {
    const response = await jar.post("/api/auth/login", {
      body: area ? { email, password, area } : { email, password },
      useJar: true,
      anonymous: true,
    });
    assert(response.status === 200 || response.status === 303, "sign-in for " + email + " returned " + response.status);
  };

  await signIn(seller, sellerEmail, sellerPassword);

  const supplierProfile = async (email) => {
    const user = await db.collection("users").findOne({ email });
    const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });
    const organisation = await db.collection("organisations").findOne({ _id: profile.organisationId });
    return { user, profile, organisation };
  };

  const mine = await supplierProfile(sellerEmail);
  // The real administrator row group B created, so a reviewer id is a real user id (the field is a ref).
  const adminUser = await db.collection("users").findOne({ email: ctx.fixture.adminEmail });
  assert(adminUser, "group B did not provide the administrator");

  await test("C1", "an anonymous visitor is redirected away from every seller page", async () => {
    for (const path of ["/seller/dashboard", "/seller/profile", "/seller/products", "/seller/tax"]) {
      const page = await anonymous.get(path, { anonymous: true });
      assert(page.status === 307 || page.status === 302, path + " returned " + page.status);
      assert((page.location ?? "").includes("/login"), path + " redirected to " + page.location);
    }
    return "4 seller pages redirect to /login";
  });

  await test("C2", "a buyer cannot open a seller page", async () => {
    const buyerEmail = "m4-buyer-" + suffix + "@verify.primemet.test";
    await modules.accounts.registerAccount({
      company: "M4 Buyer Pvt Ltd",
      contactName: "Buyer Contact",
      email: buyerEmail,
      passwordHash: await modules.password.hashPassword("M4BuyerPass123"),
      role: "BUYER",
    });
    await signIn(buyer, buyerEmail, "M4BuyerPass123");
    const page = await buyer.get("/seller/dashboard", { headers: { accept: "text/html" } });
    assert(page.status === 307 || page.status === 302, "status " + page.status);
    assert(!(page.location ?? "").includes("/seller"), "a buyer stayed on " + page.location);
    return "redirected to " + page.location;
  });

  await test("C3", "a seller saves its own company and address, and cannot change its status", async () => {
    const response = await seller.post("/api/seller/profile", {
      body: {
        company: "M4 Http Metals Limited",
        tradeName: "Http Metals",
        businessType: "PROCESSOR",
        description: "Castings, machining and an in-house spectro lab.",
        city: "Nashik",
        stateCode: "MH",
        line1: "Gat 221, Satpur",
        postalCode: "422007",
        website: "https://http-metals.example.test",
        contactName: "Http Applicant",
        phone: "+91 90000 00022",
        // Fields a seller must never be able to write:
        accountStatus: "ACTIVE",
        verificationStatus: "VERIFIED",
        reviewFeedback: "Self-approved",
        gstin: "00AAAAA0000A1Z0",
      },
    });
    assert(response.status === 200, "status " + response.status + " " + response.text.slice(0, 160));

    const { organisation } = await supplierProfile(sellerEmail);
    const address = await db.collection("organisation_addresses").findOne({ organisationId: organisation._id, kind: "REGISTERED" });
    assert(organisation.legalName === "M4 Http Metals Limited", "legalName " + organisation.legalName);
    assert(organisation.tradeName === "Http Metals", "tradeName " + organisation.tradeName);
    assert(organisation.businessType === "PROCESSOR", "businessType " + organisation.businessType);
    assert(organisation.gstin === "27ABCDE1234F1Z7", "the GSTIN was changed to " + organisation.gstin);
    assert(organisation.verificationStatus === "PENDING", "verificationStatus " + organisation.verificationStatus);
    assert(organisation.reviewFeedback !== "Self-approved", "the seller wrote its own decision note");
    assert(address.line1 === "Gat 221, Satpur" && address.postalCode === "422007", "the address was not updated");
    return "company/address saved; GSTIN, status, verification and feedback untouched";
  });

  await test("C4", "the profile page renders the saved values", async () => {
    const page = await seller.get("/seller/profile", { headers: { accept: "text/html" } });
    assert(page.status === 200, "status " + page.status);
    assert(page.text.includes("M4 Http Metals Limited"), "legal name missing");
    assert(page.text.includes("Gat 221, Satpur"), "address missing");
    assert(page.text.includes("Awaiting PRIMEMET approval") || page.text.includes("Approved"), "status badge missing");
    return "200 with company, address and status";
  });

  await test("C5", "a listing submission is accepted as PENDING and DRAFT", async () => {
    const response = await seller.post("/api/seller/listings", {
      body: {
        title: "M4 Http aluminium ingots",
        categoryLabel: "Aluminium",
        manufacturer: "Http Metals",
        description: "Foundry-grade aluminium ingots, 12 kg bars, spectro tested each heat.",
        specification: "Al 99.7%, Fe < 0.2%, Si < 0.1%.",
        supportingInfo: "Test certificates available on request.",
        images: ["https://images.example.test/ingot-1.jpg", "https://images.example.test/ingot-2.jpg"],
        quantityKg: "8500",
        notes: "Desk note: can ship weekly.",
        // Attempts to self-approve:
        reviewStatus: "APPROVED",
        status: "ACTIVE",
        reviewedByUserId: mine.user._id,
      },
    });
    assert(response.status === 200, "status " + response.status + " " + response.text.slice(0, 200));

    const listing = await db.collection("supplier_listings").findOne({ supplierId: mine.profile._id, title: "M4 Http aluminium ingots" });
    assert(listing, "the listing was not written");
    assert(listing.reviewStatus === "PENDING", "reviewStatus " + listing.reviewStatus);
    assert(listing.status === "DRAFT", "status " + listing.status);
    assert(listing.reviewedByUserId == null, "the seller recorded itself as reviewer");
    assert(listing.manufacturer === "Http Metals", "manufacturer missing");
    assert(listing.images.length === 2, "images missing");
    assert(String(listing.specification).includes("99.7"), "specification missing");
    return "stored PENDING/DRAFT with manufacturer, specification and images";
  });

  await test("C6", "the history page shows the seller's own submission and no other seller's", async () => {
    const page = await seller.get("/seller/products", { headers: { accept: "text/html" } });
    assert(page.status === 200, "status " + page.status);
    assert(page.text.includes("M4 Http aluminium ingots"), "own submission missing");
    assert(!page.text.includes("M4 Alpha aluminium turnings"), "another seller's submission is visible");
    return "own listing rendered, other seller's absent";
  });

  await test("C7", "a second approved seller sees only its own data", async () => {
    // Approve the group-A seller through the real decision function, so the second session is genuine.
    await modules.admin.decideSeller(
      {
        id: mine.user._id,
        email: ctx.fixture.adminEmail,
        fullName: "M4 Administrator",
        role: "ADMIN",
        status: "ACTIVE",
        organisationId: null,
        organisationName: null,
        organisationStatus: null,
        buyerProfileId: null,
        supplierProfileId: null,
      },
      ctx.fixture.sellerA.organisationId,
      "APPROVE",
    );
    await signIn(secondSeller, ctx.fixture.sellerA.email, ctx.fixture.sellerA.password);
    const page = await secondSeller.get("/seller/products", { headers: { accept: "text/html" } });
    assert(page.status === 200, "status " + page.status);
    assert(page.text.includes("M4 Alpha aluminium turnings"), "the seller's own listing is missing");
    assert(!page.text.includes("M4 Http aluminium ingots"), "a second seller's listing is visible");
    return "each seller sees exactly its own history";
  });

  await test("C8", "a seller cannot approve itself through the admin routes", async () => {
    const asSellerDecision = await seller.post("/api/admin/sellers", {
      body: { organisationId: mine.organisation._id, action: "approve" },
    });
    assert(asSellerDecision.status === 403, "seller → /api/admin/sellers returned " + asSellerDecision.status);

    const listing = await db.collection("supplier_listings").findOne({ supplierId: mine.profile._id, title: "M4 Http aluminium ingots" });
    const asListingDecision = await seller.post("/api/admin/listings", {
      body: { listingId: listing._id, action: "approve" },
    });
    assert(asListingDecision.status === 403, "seller → /api/admin/listings returned " + asListingDecision.status);

    const after = await db.collection("supplier_listings").findOne({ _id: listing._id });
    assert(after.reviewStatus === "PENDING", "the listing moved to " + after.reviewStatus);
    return "both admin routes 403; listing still PENDING";
  });

  await test("C9", "a seller cannot write a listing as an anonymous or buyer client", async () => {
    const body = {
      title: "M4 Unauthorised listing",
      categoryLabel: "Copper",
      description: "A listing from a client that is not a seller session at all.",
    };
    const anon = await anonymous.post("/api/seller/listings", { body, anonymous: true });
    assert(anon.status === 401, "anonymous status " + anon.status);
    const asBuyer = await buyer.post("/api/seller/listings", { body });
    assert(asBuyer.status === 403, "buyer status " + asBuyer.status);
    const created = await db.collection("supplier_listings").findOne({ title: "M4 Unauthorised listing" });
    assert(!created, "an unauthorised listing was written");
    return "401 anonymous, 403 buyer, nothing written";
  });

  await test("C10", "an unsafe image reference is refused", async () => {
    const response = await seller.post("/api/seller/listings", {
      body: {
        title: "M4 Unsafe image listing",
        categoryLabel: "Copper",
        description: "This submission carries a javascript: image reference.",
        images: ["javascript:alert(1)"],
      },
    });
    assert(response.status === 400, "status " + response.status);
    const created = await db.collection("supplier_listings").findOne({ title: "M4 Unsafe image listing" });
    assert(!created, "a listing with an unsafe image was written");
    return "400, nothing written";
  });

  await test("C11", "nothing a seller submits is visible in the public catalogue", async () => {
    const listing = await seller.get("/products?q=aluminium%20ingots", { headers: { accept: "text/html" }, anonymous: true });
    assert(listing.status === 200, "catalogue status " + listing.status);
    assert(!listing.text.includes("M4 Http aluminium ingots"), "the seller's product name is on the public catalogue");
    const detail = await seller.get("/products", { headers: { accept: "text/html" }, anonymous: true });
    assert(!detail.text.includes("M4 Http aluminium ingots"), "the catalogue page lists the submission");
    return "public /products shows no seller submission";
  });

  await test("C12", "a rejected submission can be corrected and resubmitted", async () => {
    const created = await seller.post("/api/seller/listings", {
      body: {
        title: "M4 Edit loop draft",
        categoryLabel: "Copper",
        description: "Copper granules for the edit loop, first submission without a grade.",
        quantityKg: "1500",
      },
    });
    assert(created.status === 200, "submission status " + created.status);
    const listing = await db.collection("supplier_listings").findOne({ supplierId: mine.profile._id, title: "M4 Edit loop draft" });
    assert(listing, "the draft was not written");

    const adminActor = {
      id: adminUser._id,
      email: ctx.fixture.adminEmail,
      fullName: "M4 Administrator",
      role: "ADMIN",
      status: "ACTIVE",
      organisationId: null,
      organisationName: null,
      organisationStatus: null,
      buyerProfileId: null,
      supplierProfileId: null,
    };
    await modules.listings.decideListing(adminActor, listing._id, "REJECT", "State the copper grade and moisture limit.");

    const page = await seller.get("/seller/products/" + listing._id, { headers: { accept: "text/html" } });
    assert(page.status === 200, "edit page status " + page.status);
    assert(page.text.includes("State the copper grade"), "the rejection reason is not shown on the edit page");

    const resubmitted = await seller.post("/api/seller/listings/update", {
      body: {
        listingId: listing._id,
        title: "M4 Edit loop draft",
        categoryLabel: "Copper",
        description: "Copper granules, grade 99.5%, moisture below 0.4%, packed in bags.",
        specification: "Cu 99.5% min, moisture < 0.4%.",
        quantityKg: "1500",
      },
    });
    assert(resubmitted.status === 200, "resubmission status " + resubmitted.status + " " + resubmitted.text.slice(0, 160));

    const after = await db.collection("supplier_listings").findOne({ _id: listing._id });
    assert(after.reviewStatus === "PENDING", "reviewStatus " + after.reviewStatus);
    assert(after.status === "DRAFT", "status " + after.status);
    assert(after.rejectionReason == null, "the old rejection reason survived the resubmission");
    assert(after.reviewedAt == null && after.reviewedByUserId == null, "the old reviewer survived the resubmission");
    assert(String(after.specification).includes("99.5"), "the corrected specification was not stored");

    const audit = await db.collection("audit_logs").findOne({ action: "listing.resubmitted", entityId: listing._id });
    assert(audit, "no audit row for the resubmission");
    return "reason shown, correction stored, back to PENDING with the decision cleared and audited";
  });

  await test("C13", "a seller cannot edit another seller's submission or an approved one", async () => {
    const listing = await db.collection("supplier_listings").findOne({ supplierId: mine.profile._id, reviewStatus: "PENDING" });
    assert(listing, "no pending listing to work with");

    // Another approved seller, using its own session (the client signed in as the second seller in C7),
    // points at this listing id.
    const intruder = await secondSeller.post("/api/seller/listings/update", {
      body: { listingId: listing._id, title: "Hijacked", categoryLabel: "Copper", description: "A cross-seller edit attempt that must be refused." },
    });
    assert(intruder.status === 400 || intruder.status === 404, "cross-seller edit returned " + intruder.status);
    const untouched = await db.collection("supplier_listings").findOne({ _id: listing._id });
    assert(untouched.title !== "Hijacked", "another seller rewrote the submission");

    // Now approve it as the desk, and try to edit it from the owner's session.
    await modules.listings.decideListing(
      {
        id: adminUser._id,
        email: ctx.fixture.adminEmail,
        fullName: "M4 Administrator",
        role: "ADMIN",
        status: "ACTIVE",
        organisationId: null,
        organisationName: null,
        organisationStatus: null,
        buyerProfileId: null,
        supplierProfileId: null,
      },
      listing._id,
      "APPROVE",
    );
    const afterApproval = await seller.post("/api/seller/listings/update", {
      body: { listingId: listing._id, title: "Edited after approval", categoryLabel: "Copper", description: "An edit after approval that must be refused." },
    });
    assert(afterApproval.status === 400, "edit after approval returned " + afterApproval.status);
    const approved = await db.collection("supplier_listings").findOne({ _id: listing._id });
    assert(approved.reviewStatus === "APPROVED" && approved.title !== "Edited after approval", "an approved listing was rewritten");
    return "cross-seller edit refused, approved listing immutable, nothing rewritten";
  });

  await test("C14", "a seller cannot flood the listing queue past the declared quota", async () => {
    const before = await db.collection("supplier_listings").countDocuments({ supplierId: mine.profile._id });
    const statuses = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await seller.post("/api/seller/listings", {
        body: { title: "x", categoryLabel: "Copper", description: "too short" },
      });
      statuses.push(response.status);
      if (response.status === 429) break;
    }
    assert(statuses.includes(429), "30 submissions produced no 429: " + [...new Set(statuses)].join(","));
    const after = await db.collection("supplier_listings").countDocuments({ supplierId: mine.profile._id });
    assert(after === before, "a refused submission was still written (" + before + " → " + after + ")");
    const refusal = await seller.post("/api/seller/profile", { body: { company: "M4 Http Metals Limited" } });
    assert([200, 429].includes(refusal.status), "profile write status " + refusal.status);
    return "429 after the quota, nothing written by refused attempts";
  });

  return { sellerEmail, listingTitle: "M4 Http aluminium ingots" };
}
