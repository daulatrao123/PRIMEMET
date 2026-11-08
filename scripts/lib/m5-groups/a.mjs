/**
 * Group A — the control centre at the data layer, plus the fixtures every HTTP group signs in as.
 *
 * Every assertion calls the production function with a real `AuthUser`. The overview is compared against
 * direct `countDocuments` calls, not against itself, so a wrong aggregation cannot agree with a wrong
 * screen. The buyer, sellers and product created here are reused by groups B–E.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules } = ctx;

  const suffix = randomUUID().slice(0, 6);
  const password = "M5PortalPass123";

  const adminActor = {
    id: randomUUID(),
    email: `m5-admin-${suffix}@verify.primemet.test`,
    fullName: "M5 Administrator",
    role: "ADMIN",
    status: "ACTIVE",
    organisationId: null,
    organisationName: null,
    organisationStatus: null,
    buyerProfileId: null,
    supplierProfileId: null,
  };
  await db.collection("users").insertOne({
    _id: adminActor.id,
    email: adminActor.email,
    emailVerifiedAt: null,
    passwordHash: await modules.password.hashPassword(password),
    passwordChangedAt: new Date(),
    fullName: adminActor.fullName,
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

  const makeActor = (user, profile, organisation, role) => ({
    id: user._id,
    email: user.email,
    fullName: user.fullName,
    role,
    status: user.status,
    organisationId: organisation?._id ?? profile.organisationId,
    organisationName: organisation?.legalName ?? null,
    organisationStatus: organisation?.accountStatus ?? null,
    buyerProfileId: role === "BUYER" ? profile._id : null,
    supplierProfileId: role === "SELLER" ? profile._id : null,
  });

  const register = async (label, role, company, extra = {}) => {
    const email = `m5-${label}-${suffix}@verify.primemet.test`;
    const result = await modules.accounts.registerAccount({
      company,
      contactName: `${label} contact`,
      email,
      phone: "+91 90000 00031",
      gstin: extra.gstin,
      city: "Pune",
      stateCode: "MH",
      passwordHash: await modules.password.hashPassword(password),
      role,
      ...extra,
    });
    const user = await db.collection("users").findOne({ _id: result.userId });
    const profile = await db
      .collection(role === "BUYER" ? "buyer_profiles" : "supplier_profiles")
      .findOne({ userId: user._id });
    const organisation = await db.collection("organisations").findOne({ _id: profile.organisationId });
    return { user, profile, organisation, email, password, actor: makeActor(user, profile, organisation, role) };
  };

  const buyerA = await register("alpha-buyer", "BUYER", "M5 Alpha Buyers Pvt Ltd", {
    gstin: "27ABCDE1234F1Z5",
  });
  const buyerB = await register("beta-buyer", "BUYER", "M5 Beta Traders Pvt Ltd", {
    gstin: "29ABCDE1234F1Z6",
  });
  const sellerPending = await register("pending-seller", "SELLER", "M5 Pending Metals Pvt Ltd", {
    gstin: "27ABCDE1234F1Z7",
    businessType: "PROCESSOR",
    description: "Non-ferrous processing yard awaiting the desk's decision.",
  });
  const sellerApproved = await register("approved-seller", "SELLER", "M5 Approved Alloys Pvt Ltd", {
    gstin: "27ABCDE1234F1Z8",
    businessType: "TRADER",
    description: "Alloy trading desk with an approved application.",
  });
  await modules.admin.decideSeller(adminActor, sellerApproved.organisation._id, "APPROVE");
  sellerApproved.organisation = await db.collection("organisations").findOne({ _id: sellerApproved.organisation._id });
  sellerApproved.user = await db.collection("users").findOne({ _id: sellerApproved.user._id });

  const category = await modules.catalogue.createCategory({ name: `M5 Category ${suffix}`, slug: `m5-category-${suffix}`, kind: "SCRAP" });
  const family = await modules.catalogue.createFamily({ categoryId: category.id, name: `M5 Family ${suffix}`, slug: `m5-family-${suffix}` });
  const product = await modules.catalogue.adminCreateProduct(adminActor, {
    title: "M5 Verification Bearing 6205",
    familyId: family.id,
    condition: "NEW",
    priceMode: "REQUEST",
    publicationState: "PUBLISHED",
    partNumber: "M5-6205-2RS",
    manufacturer: `M5 Bearing Works ${suffix}`,
    brand: "M5",
    shortDescription: "A product created by the M5 verification gate.",
    images: [],
  });

  // Three enquiries in three different statuses, so the overview's grouping is exercised rather than
  // asserted against a single state.
  const enquiryNew = await modules.enquiries.createEnquiry(buyerA.actor, {
    productId: product.id,
    quantity: 2500,
    unit: "KG",
    requirements: "M5 verification enquiry that stays NEW.",
    contactName: "Alpha contact",
    contactEmail: buyerA.email,
  });
  const enquiryOpen = await modules.enquiries.createEnquiry(buyerA.actor, {
    productId: product.id,
    quantity: 1200,
    unit: "KG",
    requirements: "M5 verification enquiry moved into progress.",
    contactName: "Alpha contact",
    contactEmail: buyerA.email,
  });
  const enquiryWon = await modules.enquiries.createEnquiry(buyerB.actor, {
    productId: product.id,
    quantity: 800,
    unit: "KG",
    requirements: "M5 verification enquiry that completes as won.",
    contactName: "Beta contact",
    contactEmail: buyerB.email,
  });
  await modules.enquiries.updateEnquiryForAdmin(adminActor, enquiryOpen.id, { status: "UNDER_REVIEW" });
  await modules.enquiries.updateEnquiryForAdmin(adminActor, enquiryWon.id, { status: "WON" });

  await test("A1", "the overview counts equal direct MongoDB counts on every figure", async () => {
    const overview = await modules.adminConsole.adminOverview();
    const orgs = async (filter) => db.collection("organisations").countDocuments({ deletedAt: null, ...filter });
    const expected = {
      buyers: await orgs({ orgType: "BUYER" }),
      sellers: await orgs({ orgType: "SELLER" }),
      pendingSellers: await orgs({ orgType: "SELLER", accountStatus: "PENDING_APPROVAL" }),
      approvedSellers: await orgs({ orgType: "SELLER", accountStatus: "ACTIVE" }),
      products: await db.collection("products").countDocuments({ deletedAt: null }),
      publishedProducts: await db.collection("products").countDocuments({ deletedAt: null, publicationState: "PUBLISHED" }),
      pendingListings: await db.collection("supplier_listings").countDocuments({ reviewStatus: "PENDING" }),
      enquiries: await db.collection("enquiries").countDocuments({}),
      newEnquiries: await db.collection("enquiries").countDocuments({ status: "NEW" }),
      completedEnquiries: await db.collection("enquiries").countDocuments({ status: "WON" }),
      categories: await db.collection("categories").countDocuments({}),
    };
    for (const [key, value] of Object.entries(expected)) {
      assert(overview[key] === value, `${key}: screen ${overview[key]} vs database ${value}`);
    }
    assert(overview.buyers >= 2 && overview.sellers >= 2, `buyers ${overview.buyers}, sellers ${overview.sellers}`);
    assert(overview.inProgressEnquiries >= 1, `in-progress enquiries ${overview.inProgressEnquiries}`);
    assert(overview.completedEnquiries >= 1, `completed enquiries ${overview.completedEnquiries}`);
    return `${overview.buyers} buyers, ${overview.sellers} sellers, ${overview.enquiries} enquiries — all equal to the database`;
  });

  await test("A2", "the buyer register searches, filters and pages without mixing in sellers", async () => {
    const page = await modules.adminConsole.listBuyersPage({ pageSize: 1 });
    assert(page.items.length === 1, `${page.items.length} rows for pageSize 1`);
    assert(page.total === 2, `total ${page.total}`);
    const second = await modules.adminConsole.listBuyersPage({ pageSize: 1, page: 2 });
    assert(second.items[0]?.organisationId !== page.items[0]?.organisationId, "page 2 repeats page 1");

    const searched = await modules.adminConsole.listBuyersPage({ q: "Alpha" });
    assert(searched.total === 1, `search total ${searched.total}`);
    assert(searched.items[0].name.includes("Alpha"), searched.items[0].name);

    const byStatus = await modules.adminConsole.listBuyersPage({ status: "ACTIVE" });
    assert(byStatus.items.every((row) => row.accountStatus === "ACTIVE"), "status filter leaked another status");
    assert(!byStatus.items.some((row) => row.organisationId === sellerApproved.organisation._id), "a seller appears in the buyer register");
    return `total ${page.total}, search narrows to 1, no seller in the buyer register`;
  });

  await test("A3", "buyer detail carries the enquiry history, and the buyer projection never carries the desk's notes", async () => {
    const detail = await modules.adminConsole.getBuyerDetail(buyerA.organisation._id);
    assert(detail, "no buyer detail");
    assert(detail.organisation.name.includes("Alpha"), detail.organisation.name);
    assert(detail.enquiryHistory.length === 2, `${detail.enquiryHistory.length} enquiries in the history`);
    assert(detail.enquiryHistory.some((row) => row.reference === enquiryNew.reference), "the NEW enquiry is missing");

    await modules.enquiries.updateEnquiryForAdmin(adminActor, enquiryNew.id, {
      internalNotes: "M5 confidential desk note that the buyer must never read.",
    });
    const buyerView = await modules.enquiries.getEnquiryForOrganisation(enquiryNew.id, buyerA.organisation._id);
    assert(buyerView, "the buyer cannot read its own enquiry");
    assert(!("internalNotes" in buyerView), "the buyer projection exposes internalNotes");
    assert(!JSON.stringify(buyerView).includes("confidential desk note"), "the buyer projection contains the note");
    return `2 enquiries in history; buyer projection has no internalNotes`;
  });

  await test("A4", "suspension moves the organisation and its login together, and reactivation restores both", async () => {
    let refused = null;
    try {
      await modules.adminConsole.setAccountStatus(adminActor, buyerB.organisation._id, "SUSPEND", "no");
    } catch (error) {
      refused = error;
    }
    assert(refused, "a suspension without a reason was accepted");

    await modules.adminConsole.setAccountStatus(adminActor, buyerB.organisation._id, "SUSPEND", "Chargeback investigation");
    const organisation = await db.collection("organisations").findOne({ _id: buyerB.organisation._id });
    const user = await db.collection("users").findOne({ _id: buyerB.user._id });
    assert(organisation.accountStatus === "SUSPENDED", `accountStatus ${organisation.accountStatus}`);
    assert(user.status === "SUSPENDED", `user status ${user.status}`);
    assert(organisation.suspendedAt instanceof Date, "no suspension instant");
    assert(organisation.suspensionReason === "Chargeback investigation", `reason ${organisation.suspensionReason}`);
    const audit = await db.collection("audit_logs").findOne({
      action: "account.suspended",
      entityId: buyerB.organisation._id,
    });
    assert(audit && audit.beforeState?.accountStatus === "ACTIVE", "no suspension audit row with the before-state");

    let twice = null;
    try {
      await modules.adminConsole.setAccountStatus(adminActor, buyerB.organisation._id, "SUSPEND", "Again");
    } catch (error) {
      twice = error;
    }
    assert(twice, "a suspended account was suspended twice");

    await modules.adminConsole.setAccountStatus(adminActor, buyerB.organisation._id, "REACTIVATE");
    const restored = await db.collection("organisations").findOne({ _id: buyerB.organisation._id });
    const restoredUser = await db.collection("users").findOne({ _id: buyerB.user._id });
    assert(restored.accountStatus === "ACTIVE" && restoredUser.status === "ACTIVE", "reactivation did not restore ACTIVE");
    assert(restored.suspendedAt === undefined && restored.suspensionReason === undefined, "the suspension note survived reactivation");
    return "reason required; both records moved; audited; reactivated cleanly";
  });

  await test("A5", "only an administrator can change an account's standing", async () => {
    for (const actor of [buyerA.actor, sellerApproved.actor]) {
      let refused = null;
      try {
        await modules.adminConsole.setAccountStatus(actor, buyerA.organisation._id, "SUSPEND", "A buyer tried this");
      } catch (error) {
        refused = error;
      }
      assert(refused, `${actor.role} suspended an account through the data layer`);
    }
    const unchanged = await db.collection("organisations").findOne({ _id: buyerA.organisation._id });
    assert(unchanged.accountStatus === "ACTIVE", `buyer A is ${unchanged.accountStatus}`);
    return "buyer and seller refused; nothing written";
  });

  await test("A6", "a manufacturer rename updates the catalogue and preserves the product slug", async () => {
    const before = await db.collection("products").findOne({ _id: product.id });
    const next = `M5 Bearing Works Renamed ${suffix}`;
    const result = await modules.adminConsole.renameManufacturer(adminActor, before.manufacturer, next);
    assert(result.updated === 1, `updated ${result.updated}`);
    const after = await db.collection("products").findOne({ _id: product.id });
    assert(after.manufacturer === next, `manufacturer ${after.manufacturer}`);
    assert(after.slug === before.slug, `slug changed from ${before.slug} to ${after.slug}`);
    const audit = await db.collection("audit_logs").findOne({ action: "catalogue.manufacturer.renamed" });
    assert(audit && audit.afterState?.manufacturer === next, "no manufacturer audit row");

    let refused = null;
    try {
      await modules.adminConsole.renameManufacturer(buyerA.actor, next, "Nope");
    } catch (error) {
      refused = error;
    }
    assert(refused, "a buyer renamed a manufacturer");
    return `1 product renamed, slug ${after.slug} preserved, audited`;
  });

  await test("A7", "the audit read is paginated, searchable and bounded", async () => {
    const page = await modules.adminConsole.listAuditPage({ q: "account.", pageSize: 2 });
    assert(page.items.length <= 2, `${page.items.length} rows for pageSize 2`);
    assert(page.total >= 2, `total ${page.total}`);
    assert(page.items.every((row) => /account\./i.test(row.action)), "the search returned an unrelated action");
    assert(page.items.every((row) => !("beforeState" in row)), "a raw audit document leaked into the page row");
    const sellers = await modules.sellerAdmin.countSellerApplications({});
    assert(sellers >= 2, `seller queue counts ${sellers}`);
    return `${page.total} matching audit rows, pageSize honoured, seller queue ${sellers}`;
  });

  return {
    adminActor,
    adminPassword: password,
    buyerA,
    buyerB,
    sellerPending,
    sellerApproved,
    categoryId: category.id,
    familyId: family.id,
    productId: product.id,
    productSlug: product.slug,
    enquiryNew,
    enquiryOpen,
    enquiryWon,
  };
}
