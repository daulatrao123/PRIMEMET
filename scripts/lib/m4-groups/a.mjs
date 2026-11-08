/**
 * Group A — seller onboarding at the data layer, plus the fixtures the HTTP groups use.
 *
 * Two sellers are registered through the real registration path. Every assertion calls the real function
 * with a real `AuthUser`; none of them starts a server, because the isolation and the approval gate must
 * hold even if a future route forgets a guard.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules } = ctx;

  const suffix = randomUUID().slice(0, 6);
  const password = "M4SellerPass123";

  const registerSeller = async (label, company, extra = {}) => {
    const email = "m4-" + label + "-" + suffix + "@verify.primemet.test";
    const result = await modules.accounts.registerAccount({
      company,
      contactName: label + " contact",
      email,
      phone: "+91 90000 0000" + (label === "alpha" ? "1" : "2"),
      gstin: "27ABCDE1234F1Z" + (label === "alpha" ? "5" : "6"),
      city: "Pune",
      stateCode: "MH",
      passwordHash: await modules.password.hashPassword(password),
      role: "SELLER",
      ...extra,
    });
    const user = await db.collection("users").findOne({ _id: result.userId });
    const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });
    return {
      user,
      profile,
      email,
      password,
      actor: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: "SELLER",
        status: user.status,
        organisationId: profile.organisationId,
        organisationName: company,
        organisationStatus: null,
        buyerProfileId: null,
        supplierProfileId: profile._id,
      },
    };
  };

  const sellerA = await registerSeller("alpha", "M4 Alpha Processors Pvt Ltd", {
    businessType: "PROCESSOR",
    description: "Aluminium processing yard with a weighbridge and baling line in Pune.",
    addressLine1: "Plot 12, MIDC Bhosari",
    postalCode: "411026",
  });
  const sellerB = await registerSeller("beta", "M4 Beta Traders Pvt Ltd", {
    businessType: "TRADER",
    description: "Non-ferrous scrap trading desk serving western India.",
    addressLine1: "Unit 4, Kalamboli",
    postalCode: "410218",
  });

  await test("A1", "a seller registration is PENDING_APPROVAL and cannot sign in yet", async () => {
    const organisation = await db.collection("organisations").findOne({ _id: sellerA.profile.organisationId });
    assert(sellerA.user.status === "INVITED", "user status is " + sellerA.user.status);
    assert(organisation.accountStatus === "PENDING_APPROVAL", "accountStatus is " + organisation.accountStatus);
    assert(organisation.orgType === "SELLER", "orgType is " + organisation.orgType);
    assert(organisation.verificationStatus === "PENDING", "verificationStatus is " + organisation.verificationStatus);
    assert(sellerA.profile.verification === "PENDING", "GSTIN was auto-verified");
    return "INVITED user, PENDING_APPROVAL organisation, PENDING verification";
  });

  await test("A2", "the declared business type and description are stored, not verified", async () => {
    const organisation = await db.collection("organisations").findOne({ _id: sellerA.profile.organisationId });
    assert(organisation.businessType === "PROCESSOR", "businessType is " + organisation.businessType);
    assert(String(organisation.description).includes("weighbridge"), "description was not stored");
    assert(organisation.reviewFeedback == null, "a decision note exists before any decision");
    return organisation.businessType + ", description stored, no decision recorded";
  });

  await test("A3", "a registered office address is created for the applicant", async () => {
    const address = await db.collection("organisation_addresses").findOne({
      organisationId: sellerA.profile.organisationId,
      kind: "REGISTERED",
    });
    assert(address, "no REGISTERED address");
    assert(address.line1 === "Plot 12, MIDC Bhosari", "line1 is " + address.line1);
    assert(address.postalCode === "411026", "postalCode is " + address.postalCode);
    assert(address.countryCode === "IN", "countryCode is " + address.countryCode);
    return "REGISTERED address with line1, PIN and country";
  });

  await test("A4", "a duplicate email is refused and creates nothing", async () => {
    let refused = null;
    try {
      await modules.accounts.registerAccount({
        company: "M4 Duplicate Pvt Ltd",
        contactName: "Duplicate",
        email: sellerA.email,
        passwordHash: await modules.password.hashPassword("M4SellerPass123"),
        role: "SELLER",
      });
    } catch (error) {
      refused = error;
    }
    assert(refused, "a duplicate registration succeeded");
    assert(refused.name === "RegistrationConflictError", "error is " + refused.name);
    const organisations = await db.collection("organisations").find({ legalName: "M4 Duplicate Pvt Ltd" }).toArray();
    assert(organisations.length === 0, "the failed registration left an organisation behind");
    return "RegistrationConflictError, no orphan organisation";
  });

  await test("A5", "a seller profile update is scoped to the session and cannot change status", async () => {
    await modules.sellerPortal.updateSellerProfile(sellerA.actor, {
      company: "M4 Alpha Processors Limited",
      businessType: "RECYCLER",
      description: "Aluminium and copper processing, 40 t/month.",
      line1: "Plot 14, MIDC Bhosari",
      city: "Pune",
      stateCode: "MH",
      postalCode: "411026",
      contactName: "Alpha Owner",
      phone: "+91 90000 00011",
      // A seller attempting to write its own decision. The allow-list must drop these.
      accountStatus: "ACTIVE",
      verificationStatus: "VERIFIED",
      reviewFeedback: "Approved by me",
    });

    const alpha = await db.collection("organisations").findOne({ _id: sellerA.profile.organisationId });
    const beta = await db.collection("organisations").findOne({ _id: sellerB.profile.organisationId });
    assert(alpha.legalName === "M4 Alpha Processors Limited", "the update did not land");
    assert(alpha.businessType === "RECYCLER", "businessType was not updated");
    assert(alpha.accountStatus === "PENDING_APPROVAL", "the seller changed its own account status to " + alpha.accountStatus);
    assert(alpha.verificationStatus === "PENDING", "the seller changed its own verification");
    assert(alpha.reviewFeedback == null, "the seller wrote a decision note");
    assert(beta.legalName === "M4 Beta Traders Pvt Ltd", "another seller was modified");

    const address = await db.collection("organisation_addresses").findOne({
      organisationId: sellerA.profile.organisationId,
      kind: "REGISTERED",
    });
    assert(address.line1 === "Plot 14, MIDC Bhosari", "the registered address was not updated");
    assert(address.postalCode === "411026", "the PIN was lost on update");
    return "own company + address updated; status, verification and feedback untouched";
  });

  await test("A6", "a submitted listing is always PENDING and DRAFT, whatever the payload says", async () => {
    const submitted = await modules.listings.submitMyListing(sellerA.actor, {
      title: "M4 Alpha aluminium turnings",
      categoryLabel: "Aluminium",
      manufacturer: "Alpha Works",
      description: "Clean 6061 turnings, baled, free of coolant, ex-Pune yard.",
      specification: "Al 6061, moisture < 1%, bale weight 250-400 kg.",
      quantityKg: 12000,
      supportingInfo: "Internal lab report available on request.",
      images: ["https://images.example.test/alpha-1.jpg"],
      // A seller attempting to approve its own submission.
      reviewStatus: "APPROVED",
      status: "ACTIVE",
    });

    const doc = await db.collection("supplier_listings").findOne({ _id: submitted.id });
    assert(doc, "the listing was not written");
    assert(doc.reviewStatus === "PENDING", "reviewStatus is " + doc.reviewStatus);
    assert(doc.status === "DRAFT", "status is " + doc.status);
    assert(doc.supplierId === sellerA.profile._id, "the listing is not attached to the seller's profile");
    assert(doc.manufacturer === "Alpha Works", "manufacturer was not stored");
    assert(String(doc.description).length > 20, "description was not stored");
    assert(Array.isArray(doc.images) && doc.images.length === 1, "images were not stored");
    assert(doc.reviewedAt == null && doc.reviewedByUserId == null, "a review decision was recorded by the seller");
    return "PENDING/DRAFT despite reviewStatus=APPROVED in the payload";
  });

  await test("A7", "each seller sees only its own submissions", async () => {
    const betaListing = await modules.listings.submitMyListing(sellerB.actor, {
      title: "M4 Beta copper millberry",
      categoryLabel: "Copper",
      description: "Bright copper millberry, 99.9%, packed in one-tonne bags.",
      quantityKg: 4000,
    });

    const alphaList = await modules.listings.listMyListings(sellerA.actor);
    const betaList = await modules.listings.listMyListings(sellerB.actor);
    assert(alphaList.length === 1, "alpha sees " + alphaList.length + " listings");
    assert(betaList.length === 1, "beta sees " + betaList.length + " listings");
    assert(alphaList[0].title.includes("aluminium"), "alpha's list holds the wrong listing");
    assert(betaList[0].id === betaListing.id, "beta's list holds the wrong listing");
    assert(!alphaList.some((listing) => listing.id === betaListing.id), "alpha sees beta's listing");
    return "one listing each, no cross-seller leak";
  });

  await test("A8", "a seller cannot decide its own listing", async () => {
    const listing = await db.collection("supplier_listings").findOne({ supplierId: sellerA.profile._id });
    let refused = null;
    try {
      await modules.listings.decideListing(sellerA.actor, listing._id, "APPROVE");
    } catch (error) {
      refused = error;
    }
    assert(refused, "a seller approved its own listing");
    assert(/administrator/i.test(refused.message), "message: " + refused.message);
    const after = await db.collection("supplier_listings").findOne({ _id: listing._id });
    assert(after.reviewStatus === "PENDING", "the listing moved to " + after.reviewStatus);
    return "refused at the data layer: " + refused.name;
  });

  await test("A9", "a seller cannot approve its own application", async () => {
    let refused = null;
    try {
      await modules.admin.decideSeller(sellerA.actor, sellerA.profile.organisationId, "APPROVE");
    } catch (error) {
      refused = error;
    }
    assert(refused, "a seller approved its own organisation");
    assert(/administrator/i.test(refused.message), "message: " + refused.message);
    const organisation = await db.collection("organisations").findOne({ _id: sellerA.profile.organisationId });
    assert(organisation.accountStatus === "PENDING_APPROVAL", "the application moved to " + organisation.accountStatus);
    const user = await db.collection("users").findOne({ _id: sellerA.user._id });
    assert(user.status === "INVITED", "the login moved to " + user.status);
    return "refused at the data layer, account still INVITED";
  });

  await test("A10", "a seller account with no supplier profile cannot write", async () => {
    let refused = null;
    try {
      await modules.sellerPortal.updateSellerProfile(
        { ...sellerA.actor, supplierProfileId: null },
        { company: "Nowhere Ltd" },
      );
    } catch (error) {
      refused = error;
    }
    assert(refused, "a profile-less seller account wrote a company");
    assert(/supplier profile/i.test(refused.message), "message: " + refused.message);
    return "refused: " + refused.name;
  });

  return {
    sellerA: { email: sellerA.email, password: sellerA.password, organisationId: sellerA.profile.organisationId, supplierProfileId: sellerA.profile._id },
    sellerB: { email: sellerB.email, password: sellerB.password, organisationId: sellerB.profile.organisationId, supplierProfileId: sellerB.profile._id },
  };
}
