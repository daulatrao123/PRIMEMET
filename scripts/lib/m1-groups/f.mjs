/**
 * Group F — data-layer ownership and IDOR checks.
 *
 * These tests import the real modules and call them with real `AuthUser` objects. A data function is the
 * last place an ownership rule can live: middleware protects a URL, but a future route, server action or
 * script calls the function directly.
 */

import { randomUUID } from "node:crypto";

function actor(user, extra = {}) {
  return {
    id: user._id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    organisationId: null,
    organisationName: null,
    organisationStatus: "ACTIVE",
    buyerProfileId: null,
    supplierProfileId: null,
    ...extra,
  };
}

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules } = ctx;

  // ---- fixtures, created through the data layer (this group never starts a server) ------------------
  const makeAccount = async (role, company) => {
    const email = `f-${role.toLowerCase()}-${randomUUID().slice(0, 8)}@verify.primemet.test`;
    const passwordHash = await modules.password.hashPassword("BuyerPass123");
    const result = await modules.accounts.registerAccount({ company, contactName: company, email, passwordHash, role });
    const user = await db.collection("users").findOne({ _id: result.userId });
    const profile = await db.collection(role === "BUYER" ? "buyer_profiles" : "supplier_profiles").findOne({ userId: user._id });
    return { user, profile, email };
  };

  const category = await modules.catalogue.createCategory({ name: "F Verification Category", slug: `f-cat-${Date.now()}`, kind: "SCRAP" });
  const family = await modules.catalogue.createFamily({ categoryId: category.id, name: "F Verification Family", slug: `f-fam-${Date.now()}` });
  const published = await modules.catalogue.createProduct({
    title: "F Published Product",
    familyId: family.id,
    condition: "NEW",
    priceMode: "FIXED",
    publicationState: "PUBLISHED",
  });
  const draft = await modules.catalogue.createProduct({
    title: "F Draft Product",
    familyId: family.id,
    condition: "NEW",
    priceMode: "FIXED",
    publicationState: "DRAFT",
  });

  const buyerA = await makeAccount("BUYER", "F Buyer A Pvt Ltd");
  const buyerB = await makeAccount("BUYER", "F Buyer B Pvt Ltd");
  const sellerA = await makeAccount("SELLER", "F Seller A Pvt Ltd");
  const sellerB = await makeAccount("SELLER", "F Seller B Pvt Ltd");

  const buyerARow = buyerA.user;
  const buyerBRow = buyerB.user;
  const sellerARow = sellerA.user;
  const sellerBRow = sellerB.user;
  const buyerAProfile = buyerA.profile;
  const buyerBProfile = buyerB.profile;
  const sellerAProfile = sellerA.profile;
  const sellerBProfile = sellerB.profile;

  const buyerAActor = actor(buyerARow, { organisationId: buyerAProfile.organisationId, buyerProfileId: buyerAProfile._id });
  const buyerBActor = actor(buyerBRow, { organisationId: buyerBProfile.organisationId, buyerProfileId: buyerBProfile._id });
  const sellerAActor = actor(sellerARow, { organisationId: sellerAProfile.organisationId, supplierProfileId: sellerAProfile._id });
  const sellerBActor = actor(sellerBRow, { organisationId: sellerBProfile.organisationId, supplierProfileId: sellerBProfile._id });

  // An administrator exists only because this test writes one directly: no public path creates one.
  // The row carries no password at all. A hash literal here would be a credential-shaped string in the
  // repository that nothing needs: the group never signs the administrator in, it hands this row to the
  // data layer as an already-authenticated AuthUser. `passwordHash` is optional in the users validator,
  // so null is a legal, honest value — and it makes the fixture unusable if it ever leaked into a real
  // database, which a syntactically valid scrypt string would not.
  const adminId = randomUUID();
  const adminEmail = `f-admin-${randomUUID().slice(0, 8)}@verify.primemet.test`;
  await db.collection("users").insertOne({
    _id: adminId,
    email: adminEmail,
    emailVerifiedAt: null,
    passwordHash: null,
    passwordChangedAt: new Date(),
    fullName: "F Administrator",
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
  const adminActor = actor({ _id: adminId, email: adminEmail, fullName: "F Administrator", role: "ADMIN", status: "ACTIVE" });

  await test("F1", "accounts.ts: email identity is unique and normalised", async () => {
    const found = await modules.accounts.findUserByEmail(buyerA.email.toUpperCase());
    assert(found, "an upper-case address did not find the account");
    assert(found._id === buyerARow._id, "the wrong account was returned");

    let conflict = null;
    try {
      await modules.accounts.registerAccount({
        company: "F Duplicate Pvt Ltd",
        contactName: "Duplicate",
        email: buyerA.email,
        passwordHash: await modules.password.hashPassword("DuplicatePass123"),
        role: "BUYER",
      });
    } catch (error) {
      conflict = error;
    }
    assert(conflict, "a duplicate email was accepted");
    assert(conflict.name === "RegistrationConflictError", `error is ${conflict.name}`);
    assert((await db.collection("users").countDocuments({ email: buyerA.email })) === 1, "a second account was written");
    return "case-insensitive lookup; duplicate refused with RegistrationConflictError";
  });

  await test("F2", "catalogue.ts: unpublished products and unapproved listings stay out of the public read", async () => {
    const list = await modules.catalogue.listPublishedProducts({ limit: 200 });
    const ids = list.items.map((item) => item.id);
    assert(ids.includes(published.id), "the published product is missing");
    assert(!ids.includes(draft.id), "a DRAFT product is publicly listed");

    assert((await modules.catalogue.getPublishedProductBySlug(draft.slug)) === null, "a DRAFT product is readable by slug");
    assert((await modules.catalogue.getPublishedProductBySlug(published.slug))?.id === published.id, "the published product is not readable by slug");

    const pending = await modules.listings.createListing(sellerAActor, { title: "F pending listing", categoryLabel: "Scrap", productId: published.id, quantityKg: 10 });
    const approved = await modules.listings.createListing(sellerBActor, { title: "F approved listing", categoryLabel: "Scrap", productId: published.id, quantityKg: 20 });
    await modules.listings.decideListing(adminActor, approved.id, "APPROVE");

    const availability = await modules.catalogue.approvedAvailabilityByProduct([published.id]);
    const entry = availability.get(published.id);
    assert(entry, "no availability entry for the product");
    assert(entry.listings === 1, `${entry.listings} listings counted, expected only the approved one`);
    assert(Number(entry.quantityKg) === 20, `quantity is ${entry.quantityKg}, expected 20`);
    assert(pending.id !== approved.id, "fixture ids collided");
    return "DRAFT excluded from list and slug; availability counts only APPROVED+ACTIVE";
  });

  await test("F3", "enquiries.ts: buyer reads are confined and internal notes are not exposed", async () => {
    const created = await modules.enquiries.createEnquiry(buyerAActor, {
      productId: published.id,
      quantity: 2,
      unit: "MT",
      requirements: "F3 fixture",
      contactName: "Buyer A",
      contactEmail: buyerA.email,
    });
    await modules.enquiries.updateEnquiryForAdmin(adminActor, created.id, { status: "UNDER_REVIEW", internalNotes: "internal only" });

    const buyerView = await modules.enquiries.getEnquiryForOrganisation(created.id, buyerAActor.organisationId);
    assert(buyerView, "the owner cannot read the enquiry");
    assert(!("internalNotes" in buyerView), "the buyer view exposes internalNotes");
    assert(buyerView.status === "UNDER_REVIEW", `status is ${buyerView.status}`);

    const foreign = await modules.enquiries.getEnquiryForOrganisation(created.id, buyerBActor.organisationId);
    assert(foreign === null, "another buyer read the enquiry");

    const adminView = await modules.enquiries.getEnquiryForAdmin(created.id);
    assert(adminView?.internalNotes === "internal only", "the admin view lost the internal note");

    const list = await modules.enquiries.listEnquiriesForOrganisation(buyerBActor.organisationId);
    assert(!list.some((item) => item.id === created.id), "another buyer's list contains the enquiry");
    return "owner reads, other buyer null, internalNotes admin-only";
  });

  await test("F4", "listings.ts: a seller sees only their listings and cannot approve anything", async () => {
    const pending = await modules.listings.createListing(sellerAActor, {
      title: "F4 self-approval attempt",
      categoryLabel: "Scrap",
      productId: published.id,
      reviewStatus: "APPROVED",
      status: "ACTIVE",
    });

    const mine = await modules.listings.listListingsForSupplier(sellerAProfile._id);
    const other = await modules.listings.listListingsForSupplier(sellerBProfile._id);
    const mineIds = new Set(mine.map((item) => item.id));
    const otherIds = new Set(other.map((item) => item.id));
    assert(mineIds.has(pending.id), "supplier A cannot see their own listing");
    assert(!otherIds.has(pending.id), "supplier B sees supplier A's listing");
    assert(![...otherIds].some((id) => mineIds.has(id)), "the two suppliers' lists overlap");

    const stored = await db.collection("supplier_listings").findOne({ _id: pending.id });
    assert(stored.reviewStatus === "PENDING", `a seller wrote reviewStatus ${stored.reviewStatus}`);
    assert(stored.status === "DRAFT", `a seller wrote status ${stored.status}`);

    let refused = null;
    try {
      await modules.listings.decideListing(sellerAActor, pending.id, "APPROVE");
    } catch (error) {
      refused = error;
    }
    assert(refused, "a seller approved their own listing through the data layer");
    const after = await db.collection("supplier_listings").findOne({ _id: pending.id });
    assert(after.reviewStatus === "PENDING", "the listing was approved by a seller");
    return "own listings only; injected reviewStatus ignored; seller approval refused";
  });

  await test("F5", "admin.ts: party lists are separated and seller approval is admin-only", async () => {
    const buyers = await modules.admin.listBuyers();
    const sellers = await modules.admin.listSellers();
    const buyerOrgs = new Set(buyers.map((item) => item.organisationId));
    const sellerOrgs = new Set(sellers.map((item) => item.organisationId));
    assert(buyerOrgs.has(buyerAProfile.organisationId), "buyer A is missing from the buyer list");
    assert(!buyerOrgs.has(sellerAProfile.organisationId), "a seller appears in the buyer list");
    assert(sellerOrgs.has(sellerAProfile.organisationId), "seller A is missing from the seller list");
    assert(!sellerOrgs.has(buyerAProfile.organisationId), "buyer A appears in the seller list");

    let refused = null;
    try {
      await modules.admin.decideSeller(sellerAActor, sellerAProfile.organisationId, "APPROVE");
    } catch (error) {
      refused = error;
    }
    assert(refused, "a seller approved their own application through the data layer");

    let wrongType = null;
    try {
      await modules.admin.decideSeller(adminActor, buyerAProfile.organisationId, "APPROVE");
    } catch (error) {
      wrongType = error;
    }
    assert(wrongType, "a buyer organisation was approved as a seller");

    const verificationBefore = (await db.collection("supplier_profiles").findOne({ _id: sellerAProfile._id })).verification;
    await modules.admin.decideSeller(adminActor, sellerAProfile.organisationId, "APPROVE");
    const user = await db.collection("users").findOne({ _id: sellerARow._id });
    const organisation = await db.collection("organisations").findOne({ _id: sellerAProfile.organisationId });
    const profile = await db.collection("supplier_profiles").findOne({ _id: sellerAProfile._id });
    assert(user.status === "ACTIVE", `user status is ${user.status}`);
    assert(organisation.accountStatus === "ACTIVE", `organisation status is ${organisation.accountStatus}`);
    assert(profile.verification === verificationBefore, `GST verification changed from ${verificationBefore} to ${profile.verification}`);
    assert(profile.verification !== "VERIFIED", "approval marked the GST registration verified");

    const stats = await modules.admin.dashboardStats();
    assert(stats.buyers >= 2, `dashboard reports ${stats.buyers} buyers`);
    assert(stats.sellers >= 2, `dashboard reports ${stats.sellers} sellers`);
    return "lists separated; seller self-approval refused; approval activates account but not GST";
  });

  await test("F6", "admin.ts: audit log reads are bounded and carry no secrets", async () => {
    const rows = await modules.admin.listAuditLogs(5);
    assert(Array.isArray(rows), "listAuditLogs did not return an array");
    assert(rows.length <= 5, `${rows.length} rows returned for limit 5`);
    for (const entry of rows) {
      assert(!("passwordHash" in entry), "an audit row carries a password hash");
      assert(!JSON.stringify(entry).includes("scrypt$"), "an audit row carries a hash");
    }
    return `${rows.length} rows, no hashes`;
  });

  return {
    productId: published.id,
    draftProductId: draft.id,
    categoryId: category.id,
    familyId: family.id,
    adminId,
  };
}