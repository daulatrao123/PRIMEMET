/**
 * Group A — organisation isolation at the data layer, plus the fixtures groups B and C use.
 *
 * Two buyer organisations are created through the real registration path. Every assertion below calls the
 * real functions with a real `AuthUser`; none of them starts a server, because the data layer is where an
 * isolation rule must hold even if a future route forgets a guard.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules } = ctx;

  const suffix = randomUUID().slice(0, 6);
  const password = "M3BuyerPass123";

  const buyer = async (label, company) => {
    const email = `m3-${label}-${suffix}@verify.primemet.test`;
    const result = await modules.accounts.registerAccount({
      company,
      contactName: `${label} contact`,
      email,
      passwordHash: await modules.password.hashPassword(password),
      role: "BUYER",
    });
    const user = await db.collection("users").findOne({ _id: result.userId });
    const profile = await db.collection("buyer_profiles").findOne({ userId: user._id });
    return {
      user,
      profile,
      email,
      password,
      actor: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: "BUYER",
        status: "ACTIVE",
        organisationId: profile.organisationId,
        organisationName: company,
        organisationStatus: "ACTIVE",
        buyerProfileId: profile._id,
        supplierProfileId: null,
      },
    };
  };

  const buyerA = await buyer("alpha", "M3 Alpha Metals Pvt Ltd");
  const buyerB = await buyer("beta", "M3 Beta Alloys Pvt Ltd");

  // A catalogue the enquiries can point at.
  const category = await modules.catalogue.createCategory({ name: `M3 Category ${suffix}`, slug: `m3-category-${suffix}`, kind: "SCRAP" });
  const family = await modules.catalogue.createFamily({ categoryId: category.id, name: "Copper wire", slug: `m3-family-${suffix}` });
  const product = await modules.catalogue.createProduct({
    title: `M3 copper millberry ${suffix}`,
    slug: `m3-copper-${suffix}`,
    familyId: family.id,
    manufacturer: "Alex Metals",
    condition: "NEW",
    priceMode: "REQUEST",
    shortDescription: "Copper wire for the M3 buyer-portal fixtures.",
    publicationState: "PUBLISHED",
  });

  await test("A1", "a buyer profile resolves to exactly the session's organisation", async () => {
    const view = await modules.portal.getBuyerProfile(buyerA.actor);
    assert(view.organisation, "no organisation resolved");
    assert(view.organisation.id === buyerA.profile.organisationId, "the wrong organisation was resolved");
    assert(view.organisation.legalName === "M3 Alpha Metals Pvt Ltd", `legalName is ${view.organisation.legalName}`);
    assert(view.jobTitle === null, "an unset field was invented");
    return `${view.organisation.legalName} (${view.organisation.verificationStatus})`;
  });

  await test("A2", "a buyer can update only their own company record", async () => {
    await modules.portal.updateBuyerProfile(buyerA.actor, {
      company: "M3 Alpha Metals Ltd",
      city: "Pune",
      stateCode: "MH",
      jobTitle: "Head of procurement",
      department: "Procurement",
      contactName: "Alpha Contact",
      phone: "+91 90000 00001",
    });

    const alpha = await db.collection("organisations").findOne({ _id: buyerA.profile.organisationId });
    const beta = await db.collection("organisations").findOne({ _id: buyerB.profile.organisationId });
    assert(alpha.legalName === "M3 Alpha Metals Ltd", "the update did not land");
    assert(alpha.city === "Pune" && alpha.stateCode === "MH", "city/state were not stored");
    assert(beta.legalName === "M3 Beta Alloys Pvt Ltd", "the other organisation was modified");

    const alphaUser = await db.collection("users").findOne({ _id: buyerA.user._id });
    assert(alphaUser.fullName === "Alpha Contact", "the contact name was not updated");
    const alphaProfile = await db.collection("buyer_profiles").findOne({ _id: buyerA.profile._id });
    assert(alphaProfile.jobTitle === "Head of procurement", "the job title was not stored");
    return "own organisation + profile + contact updated; the other buyer untouched";
  });

  await test("A3", "the profile update writes an audit row naming the buyer", async () => {
    const rows = await db.collection("audit_logs").find({ action: "buyer.profile.updated" }).toArray();
    assert(rows.length >= 1, "no audit row");
    assert(rows.every((row) => row.actorUserId === buyerA.actor.id), "an audit row names another actor");
    assert(rows[0].entityId === buyerA.profile.organisationId, "the audit row names the wrong entity");
    return `${rows.length} audit row(s) for the buyer's own organisation`;
  });

  await test("A4", "two enquiries from two buyers are isolated by organisation", async () => {
    const a = await modules.enquiries.createEnquiry(buyerA.actor, {
      productId: product.id,
      quantity: 500,
      unit: "KG",
      requirements: "Alpha needs 500 kg of copper wire for a winding contract.",
      contactName: "Alpha Contact",
      contactEmail: buyerA.email,
    });
    const b = await modules.enquiries.createEnquiry(buyerB.actor, {
      productId: product.id,
      quantity: 750,
      unit: "KG",
      requirements: "Beta needs 750 kg of copper wire for a switchgear order.",
      contactName: "Beta Contact",
      contactEmail: buyerB.email,
    });

    const alphaRows = await modules.enquiries.listEnquiriesForOrganisation(buyerA.profile.organisationId);
    const betaRows = await modules.enquiries.listEnquiriesForOrganisation(buyerB.profile.organisationId);
    assert(alphaRows.length === 1 && betaRows.length === 1, `alpha=${alphaRows.length} beta=${betaRows.length}`);
    assert(alphaRows[0].reference === a.reference, "alpha's list holds the wrong enquiry");
    assert(betaRows[0].reference === b.reference, "beta's list holds the wrong enquiry");
    return `${alphaRows[0].reference} vs ${betaRows[0].reference}`;
  });

  await test("A5", "a buyer cannot read another buyer's enquiry by id", async () => {
    const betaEnquiry = await db.collection("enquiries").findOne({ buyerOrganisationId: buyerB.profile.organisationId });
    const viaAlpha = await modules.enquiries.getEnquiryForOrganisation(betaEnquiry._id, buyerA.profile.organisationId);
    assert(viaAlpha === null, "alpha read beta's enquiry");
    const viaBeta = await modules.enquiries.getEnquiryForOrganisation(betaEnquiry._id, buyerB.profile.organisationId);
    assert(viaBeta, "beta could not read its own enquiry");
    return "cross-organisation read returns null";
  });

  await test("A6", "the buyer view has no internal notes field at all", async () => {
    const betaEnquiry = await db.collection("enquiries").findOne({ buyerOrganisationId: buyerB.profile.organisationId });
    await modules.enquiries.updateEnquiryForAdmin(
      { id: "admin", email: "admin@verify.primemet.test", fullName: "Verifier", role: "ADMIN", status: "ACTIVE", organisationId: null, organisationName: null, organisationStatus: null, buyerProfileId: null, supplierProfileId: null },
      betaEnquiry._id,
      { internalNotes: "Desk-only: this buyer negotiates hard." },
    );
    const view = await modules.enquiries.listEnquiriesForOrganisation(buyerB.profile.organisationId);
    assert(!("internalNotes" in view[0]), "internalNotes is present on the buyer object");
    assert(JSON.stringify(view).includes("Desk-only") === false, "the internal note reached the buyer view");
    return "internal note stored, absent from the buyer projection";
  });

  await test("A7", "the dashboard counts only the session organisation's enquiries", async () => {
    const alpha = await modules.portal.buyerDashboard(buyerA.actor);
    const beta = await modules.portal.buyerDashboard(buyerB.actor);
    assert(alpha.total === 1, `alpha total ${alpha.total}`);
    assert(beta.total === 1, `beta total ${beta.total}`);
    assert(alpha.open === 1 && alpha.won === 0, `alpha open=${alpha.open} won=${alpha.won}`);
    assert(alpha.recent.length === 1, "recent list length");
    return "each buyer sees exactly their own one enquiry";
  });

  await test("A8", "a profile update without an organisation is refused", async () => {
    let refused = null;
    try {
      await modules.portal.updateBuyerProfile(
        { ...buyerA.actor, organisationId: null, role: "BUYER" },
        { company: "Nowhere Ltd" },
      );
    } catch (error) {
      refused = error;
    }
    assert(refused, "an organisation-less account was allowed to update a company");
    assert(/organisation/i.test(refused.message), `message: ${refused.message}`);
    return `refused: ${refused.name}`;
  });

  return {
    buyerA: { email: buyerA.email, password: buyerA.password, organisationId: buyerA.profile.organisationId },
    buyerB: { email: buyerB.email, password: buyerB.password, organisationId: buyerB.profile.organisationId },
    productId: product.id,
    productSlug: product.slug,
  };
}
