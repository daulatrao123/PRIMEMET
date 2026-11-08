/**
 * Group E — the whole seller relationship through the control centre, and the refusals around it.
 *
 * This is the only group that drives a company from an application to an approved account, a listing
 * submission to a rejection the seller can read, and a suspension back to a working portal — over HTTP,
 * with the sessions the product itself issues. The private surfaces are checked from the other side too:
 * a buyer must not read the desk's notes, another seller must not read a competitor's rejection, and an
 * anonymous visitor must not reach the approval endpoints at all.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules, fixture } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  const suffix = randomUUID().slice(0, 6);
  const email = `m5-journey-${suffix}@verify.primemet.test`;
  const password = "M5JourneyPass123";
  const company = `M5 Journey Metals ${suffix} Pvt Ltd`;
  const rejectedTitle = `M5 Journey rejected copper millberry ${suffix}`;
  const rejectionReason = `Assay sheet ${suffix} does not match the declared grade, so the listing cannot be published.`;
  const privateNote = `M5 internal note ${suffix}: confirm the weighbridge ticket before any publication.`;

  const seller = createClient(ctx.baseUrl);
  const admin = createClient(ctx.baseUrl);
  const buyer = createClient(ctx.baseUrl);
  const otherSeller = createClient(ctx.baseUrl);
  const anonymous = createClient(ctx.baseUrl);

  const state = {};

  const signIn = (jar, who, area, ip) =>
    jar.post("/api/auth/login", {
      body: area ? { email: who.email, password: who.password, area } : { email: who.email, password: who.password },
      useJar: true,
      anonymous: true,
      ip,
    });

  const html = { headers: { accept: "text/html" } };

  await test("E1", "an application reaches the desk, and the approval moves the overview and opens the portal", async () => {
    const before = await modules.adminConsole.adminOverview();

    const registered = await seller.post("/api/auth/register", {
      anonymous: true,
      ip: "198.51.100.61",
      body: {
        role: "SELLER",
        company,
        contactName: "Journey Applicant",
        email,
        phone: "+91 90000 00031",
        gstin: `27ABCDE${suffix.slice(0, 4).replace(/\D/g, "7").padEnd(4, "7")}F1Z9`,
        city: "Pune",
        stateCode: "MH",
        addressLine1: "Plot 11, Bhosari",
        postalCode: "411026",
        businessType: "PROCESSOR",
        description: "Copper and brass processing yard with an in-house weighbridge.",
        password,
        passwordConfirm: password,
      },
    });
    assert(registered.status === 201, `registration ${registered.status} ${registered.text.slice(0, 160)}`);

    const user = await db.collection("users").findOne({ email });
    const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });
    assert(user && profile, "registration did not create the user and the supplier profile");
    const organisationId = profile.organisationId;
    state.organisationId = organisationId;
    state.profileId = profile._id;

    const queued = await modules.adminConsole.adminOverview();
    assert(
      queued.pendingSellers === before.pendingSellers + 1,
      `the application did not enter the pending queue: ${before.pendingSellers} -> ${queued.pendingSellers}`,
    );

    const pendingLogin = await signIn(seller, { email, password }, undefined, "198.51.100.62");
    assert(pendingLogin.status === 403, `pending sign-in ${pendingLogin.status}`);
    assert(pendingLogin.json?.code === "inactive", `pending code ${pendingLogin.json?.code}`);
    assert(/awaiting/i.test(pendingLogin.json?.message ?? ""), `pending message: ${pendingLogin.json?.message}`);

    const adminLogin = await signIn(admin, { email: fixture.adminActor.email, password: fixture.adminPassword }, "admin", "198.51.100.63");
    assert([200, 303].includes(adminLogin.status), `admin sign-in ${adminLogin.status}`);

    const queue = await admin.get("/admin/suppliers?status=PENDING_APPROVAL", html);
    assert(queue.status === 200, `queue ${queue.status}`);
    assert(queue.text.includes(company), "the new application is not in the pending queue");
    assert(queue.text.includes("Awaiting decision"), "the queue does not show the pending state");

    const detail = await admin.get("/admin/suppliers/" + organisationId, html);
    assert(detail.status === 200, `detail ${detail.status}`);
    assert(detail.text.includes(email), "the review page does not show the applicant's contact address");
    assert(detail.text.includes("Internal notes"), "the review page has no internal-notes panel");

    const approved = await admin.post("/api/admin/sellers", { body: { organisationId, action: "approve" }, ip: "198.51.100.64" });
    assert([200, 303].includes(approved.status), `approve ${approved.status} ${approved.text.slice(0, 160)}`);

    const organisation = await db.collection("organisations").findOne({ _id: organisationId });
    const activeUser = await db.collection("users").findOne({ _id: user._id });
    assert(organisation.accountStatus === "ACTIVE", `accountStatus ${organisation.accountStatus}`);
    assert(activeUser.status === "ACTIVE", `user status ${activeUser.status}`);
    const audit = await db.collection("audit_logs").findOne({ action: "seller.application.approved", entityId: organisationId });
    assert(audit, "the approval left no audit row");

    const after = await modules.adminConsole.adminOverview();
    assert(after.pendingSellers === before.pendingSellers, `pending sellers ${before.pendingSellers} -> ${after.pendingSellers}`);
    assert(after.approvedSellers === before.approvedSellers + 1, `approved sellers ${before.approvedSellers} -> ${after.approvedSellers}`);
    assert(after.sellers === before.sellers + 1, `seller total ${before.sellers} -> ${after.sellers}, expected one new seller`);

    const stillPending = await admin.get("/admin/suppliers?status=PENDING_APPROVAL", html);
    assert(!stillPending.text.includes(company), "the approved seller is still in the pending queue");
    return "201 registration, 403 pending sign-in, approved, overview pending-1/approved+1, audited";
  });

  await test("E2", "the approved seller signs in and submits a listing the review queue shows in full", async () => {
    const before = await modules.adminConsole.adminOverview();

    const login = await signIn(seller, { email, password }, undefined, "198.51.100.65");
    assert([200, 303].includes(login.status), `seller sign-in ${login.status} ${login.text.slice(0, 160)}`);

    const dashboard = await seller.get("/seller/dashboard", html);
    assert(dashboard.status === 200, `seller dashboard ${dashboard.status}`);
    assert(dashboard.text.includes(company), "the dashboard does not name the seller's company");

    const submitted = await seller.post("/api/seller/listings", {
      body: {
        title: rejectedTitle,
        categoryLabel: "Copper",
        manufacturer: "Journey Metals",
        description: "Bright copper millberry 99.9%, baled, ex-Pune yard.",
        specification: "Cu 99.9% min, moisture < 0.5%, bale 300-500 kg.",
        quantityKg: "6000",
        images: ["https://images.example.test/journey-1.jpg"],
        supportingInfo: "Assay certificate available on request.",
      },
    });
    assert(submitted.status === 200, `submission ${submitted.status} ${submitted.text.slice(0, 160)}`);

    const listing = await db.collection("supplier_listings").findOne({ supplierId: state.profileId, title: rejectedTitle });
    assert(listing, "the submission was not written to MongoDB");
    assert(listing.reviewStatus === "PENDING" && listing.status === "DRAFT", `state ${listing.reviewStatus}/${listing.status}`);
    state.listingId = listing._id;

    const history = await seller.get("/seller/products", html);
    assert(history.status === 200, `seller products ${history.status}`);
    assert(history.text.includes(rejectedTitle), "the seller's own history does not show the submission");
    assert(history.text.includes("Awaiting approval"), "the pending state is not shown to the seller");

    const queue = await admin.get("/admin/listing-submissions?status=PENDING", html);
    assert(queue.status === 200, `listing queue ${queue.status}`);
    assert(queue.text.includes(rejectedTitle), "the listing is not in the review queue");
    assert(queue.text.includes("Cu 99.9% min"), "the specification is not shown to the reviewer");
    assert(queue.text.includes(company), "the supplier is not named in the review queue");

    const after = await modules.adminConsole.adminOverview();
    assert(after.pendingListings === before.pendingListings + 1, `pending listings ${before.pendingListings} -> ${after.pendingListings}`);
    return "signed in, stored PENDING/DRAFT, visible to seller and desk, overview pending listings +1";
  });

  await test("E3", "a rejection carries a reason only its own seller can read, and nothing is published", async () => {
    const before = await modules.adminConsole.adminOverview();

    const rejected = await admin.post("/api/admin/listings", {
      body: { listingId: state.listingId, action: "reject", reason: rejectionReason },
      ip: "198.51.100.66",
    });
    assert([200, 303].includes(rejected.status), `reject ${rejected.status} ${rejected.text.slice(0, 160)}`);

    const listing = await db.collection("supplier_listings").findOne({ _id: state.listingId });
    assert(listing.reviewStatus === "REJECTED", `reviewStatus ${listing.reviewStatus}`);
    assert(listing.rejectionReason === rejectionReason, `reason ${listing.rejectionReason}`);
    assert(listing.status === "DRAFT", `listing status ${listing.status}`);
    const audit = await db.collection("audit_logs").findOne({ action: "listing.rejected", entityId: state.listingId });
    assert(audit, "the rejection left no audit row");

    const ownView = await seller.get("/seller/products", html);
    assert(ownView.text.includes(rejectedTitle), "the rejected listing vanished from the seller's history");
    assert(ownView.text.includes("Rejected"), "the seller is not told the listing was rejected");
    assert(ownView.text.includes(rejectionReason), "the rejection reason is not shown to its own seller");

    const otherLogin = await signIn(otherSeller, { email: fixture.sellerApproved.email, password: fixture.sellerApproved.password }, undefined, "198.51.100.67");
    assert([200, 303].includes(otherLogin.status), `other seller sign-in ${otherLogin.status}`);
    const otherView = await otherSeller.get("/seller/products", html);
    assert(otherView.status === 200, `other seller products ${otherView.status}`);
    assert(!otherView.text.includes(rejectionReason), "another seller can read this seller's rejection reason");
    assert(!otherView.text.includes(rejectedTitle), "another seller can read this seller's listing");

    const publicPage = await anonymous.get("/products", html);
    assert(publicPage.status === 200, `public catalogue ${publicPage.status}`);
    assert(!publicPage.text.includes(rejectedTitle), "a rejected listing reached the public catalogue");
    const publicSearch = await anonymous.get("/products?q=millberry", html);
    assert(!publicSearch.text.includes(rejectedTitle), "a rejected listing is searchable");

    const after = await modules.adminConsole.adminOverview();
    assert(after.pendingListings === before.pendingListings - 1, `pending listings ${before.pendingListings} -> ${after.pendingListings}`);
    assert(after.publishedProducts === before.publishedProducts, "a rejection changed the published product count");
    return "REJECTED/DRAFT, reason shown to its seller only, absent from another seller and the public catalogue, audited";
  });

  await test("E4", "the desk's private note stays on the desk", async () => {
    const noted = await admin.post("/api/admin/sellers", {
      body: { organisationId: state.organisationId, action: "note", note: privateNote },
      ip: "198.51.100.68",
    });
    assert([200, 303].includes(noted.status), `note ${noted.status} ${noted.text.slice(0, 160)}`);

    const organisation = await db.collection("organisations").findOne({ _id: state.organisationId });
    assert((organisation.internalNotes ?? "").includes(privateNote), "the note was not stored on the organisation");
    const audit = await db.collection("audit_logs").findOne({ action: "seller.note_added", entityId: state.organisationId });
    assert(audit, "the note left no audit row");

    const detail = await admin.get("/admin/suppliers/" + state.organisationId, html);
    assert(detail.text.includes(privateNote), "the desk cannot read its own note");

    for (const path of ["/seller/dashboard", "/seller/profile", "/seller/products", "/seller/tax"]) {
      const page = await seller.get(path, html);
      assert(page.status === 200, `${path} ${page.status}`);
      assert(!page.text.includes(privateNote), `the internal note appears on ${path}`);
    }

    const api = await seller.get("/api/seller/profile");
    assert(!api.text.includes(privateNote), "the internal note appears in the seller profile API");
    return "stored and audited; absent from three seller pages and the seller API";
  });

  await test("E5", "suspension ends the live session and blocks sign-in; reactivation restores the portal", async () => {
    const suspended = await admin.post("/api/admin/accounts", {
      body: { organisationId: state.organisationId, action: "suspend", reason: "M5 journey suspension" },
      ip: "198.51.100.69",
    });
    assert([200, 303].includes(suspended.status), `suspend ${suspended.status} ${suspended.text.slice(0, 160)}`);

    const organisation = await db.collection("organisations").findOne({ _id: state.organisationId });
    assert(organisation.accountStatus === "SUSPENDED", `accountStatus ${organisation.accountStatus}`);

    // The seller's existing cookie was issued before the suspension: it must stop working now.
    const live = await seller.get("/seller/dashboard", html);
    assert([302, 303, 307].includes(live.status), `suspended session still returns ${live.status}`);
    assert((live.location ?? "").includes("/login"), `suspended session redirected to ${live.location}`);

    const refused = await signIn(createClient(ctx.baseUrl), { email, password }, undefined, "198.51.100.70");
    assert(refused.status === 403, `suspended sign-in ${refused.status}`);
    assert(/suspended/i.test(refused.json?.message ?? ""), `suspended message: ${refused.json?.message}`);

    const page = await admin.get("/admin/suppliers/" + state.organisationId, html);
    assert(page.text.includes("Suspended"), "the review page does not show the suspended standing");
    assert(page.text.includes("M5 journey suspension"), "the review page does not show the suspension reason");

    const reactivated = await admin.post("/api/admin/accounts", {
      body: { organisationId: state.organisationId, action: "reactivate" },
      ip: "198.51.100.71",
    });
    assert([200, 303].includes(reactivated.status), `reactivate ${reactivated.status}`);

    const restored = createClient(ctx.baseUrl);
    const login = await signIn(restored, { email, password }, undefined, "198.51.100.72");
    assert([200, 303].includes(login.status), `post-reactivation sign-in ${login.status}`);
    const dashboard = await restored.get("/seller/dashboard", html);
    assert(dashboard.status === 200, `post-reactivation dashboard ${dashboard.status}`);
    assert(dashboard.text.includes(company), "the restored dashboard does not name the company");
    return "live session 307 to /login, sign-in 403, reason on the review page, reactivated 200";
  });

  await test("E6", "every administrative endpoint refuses a buyer, a seller and an anonymous caller", async () => {
    const bystander = await modules.accounts.registerAccount({
      company: `M5 Bystander Metals ${suffix} Pvt Ltd`,
      contactName: "Bystander Applicant",
      email: `m5-bystander-${suffix}@verify.primemet.test`,
      phone: "+91 90000 00031",
      city: "Pune",
      stateCode: "MH",
      passwordHash: await modules.password.hashPassword("M5BystanderPass123"),
      role: "SELLER",
      businessType: "TRADER",
      description: "A pending application that no refused request may approve.",
    });

    const attempts = [
      ["/api/admin/accounts", { organisationId: fixture.buyerA.organisation._id, action: "suspend", reason: "Escalation attempt" }],
      ["/api/admin/manufacturers", { from: "Nobody", to: "Anybody" }],
      ["/api/admin/sellers", { organisationId: bystander.organisationId, action: "approve" }],
      ["/api/admin/listings", { listingId: state.listingId, action: "approve" }],
      ["/api/admin/enquiries", { id: fixture.enquiryNew.id, status: "WON" }],
    ];

    const buyerLogin = await signIn(buyer, { email: fixture.buyerA.email, password: fixture.buyerA.password }, undefined, "198.51.100.73");
    assert([200, 303].includes(buyerLogin.status), `buyer sign-in ${buyerLogin.status}`);

    for (const [path, body] of attempts) {
      const asBuyer = await buyer.post(path, { body, ip: "198.51.100.74" });
      assert(asBuyer.status === 403, `${path} as buyer returned ${asBuyer.status}`);
      const asSeller = await otherSeller.post(path, { body, ip: "198.51.100.75" });
      assert(asSeller.status === 403, `${path} as seller returned ${asSeller.status}`);
      const asAnonymous = await anonymous.post(path, { body, ip: "198.51.100.76" });
      assert(asAnonymous.status === 401, `${path} anonymously returned ${asAnonymous.status}`);
    }

    const pending = await db.collection("organisations").findOne({ _id: bystander.organisationId });
    assert(pending.accountStatus === "PENDING_APPROVAL", `a refused request approved a seller: ${pending.accountStatus}`);
    const enquiry = await db.collection("enquiries").findOne({ _id: fixture.enquiryNew.id });
    assert(enquiry.status === "NEW", `a refused request moved the enquiry to ${enquiry.status}`);
    const listing = await db.collection("supplier_listings").findOne({ _id: state.listingId });
    assert(listing.reviewStatus === "REJECTED", `a refused request moved the listing to ${listing.reviewStatus}`);

    const auditLog = await buyer.get("/admin/audit-log", html);
    assert([302, 303, 307].includes(auditLog.status), `buyer reached /admin/audit-log with ${auditLog.status}`);
    const buyerDetail = await buyer.get("/admin/buyers/" + fixture.buyerA.organisation._id, html);
    assert([302, 303, 307].includes(buyerDetail.status), `buyer reached another admin page with ${buyerDetail.status}`);
    return "5 endpoints x 3 identities refused (403/403/401); no decision was written; admin pages redirect";
  });

  await test("E7", "the desk's record of the journey is real: counts match MongoDB and the audit trail names it", async () => {
    const overview = await modules.adminConsole.adminOverview();
    const expected = {
      sellers: await db.collection("organisations").countDocuments({ deletedAt: null, orgType: "SELLER" }),
      pendingSellers: await db
        .collection("organisations")
        .countDocuments({ deletedAt: null, orgType: "SELLER", accountStatus: "PENDING_APPROVAL" }),
      approvedSellers: await db
        .collection("organisations")
        .countDocuments({ deletedAt: null, orgType: "SELLER", accountStatus: "ACTIVE" }),
      pendingListings: await db.collection("supplier_listings").countDocuments({ reviewStatus: "PENDING" }),
      enquiries: await db.collection("enquiries").countDocuments({}),
    };
    for (const [key, value] of Object.entries(expected)) {
      assert(overview[key] === value, `${key}: screen ${overview[key]} vs database ${value}`);
    }

    const feed = await modules.adminConsole.recentActivity(8);
    assert(
      feed.registrations.some((row) => row.name === company && row.orgType === "SELLER"),
      "the new registration is not in the activity feed",
    );
    assert(
      feed.approvals.some((row) => row.action === "seller.application.approved" && row.entityName === company),
      "the approval is not in the activity feed",
    );

    const trail = await admin.get("/admin/audit-log?q=seller.application", html);
    assert(trail.status === 200, `audit log ${trail.status}`);
    assert(trail.text.includes("seller.application.approved"), "the approval is not in the audit log page");
    assert(trail.text.includes(state.organisationId), "the audit row does not identify the seller's organisation");
    assert(trail.text.includes(fixture.adminActor.email), "the audit row does not name the administrator who decided");

    const dashboard = await admin.get("/admin/dashboard", html);
    assert(dashboard.status === 200, `dashboard ${dashboard.status}`);
    assert(dashboard.text.includes(company), "the journey is not on the dashboard's activity feed");
    return `overview equals MongoDB on 5 figures; approval and registration on the feed and the audit page`;
  });

  await test("E8", "a record that does not exist is a clean 404, not a blank screen or a stack trace", async () => {
    const missing = randomUUID();
    for (const path of [`/admin/buyers/${missing}`, `/admin/suppliers/${missing}`, `/admin/enquiries/${missing}`]) {
      const page = await admin.get(path, html);
      // A streamed dynamic page has already committed its status line, so the not-found boundary is what
      // proves the refusal here, not the HTTP code.
      assert([200, 404].includes(page.status), `${path} returned ${page.status}`);
      assert(!/MongoServerError|MongoExpiredSessionError|at Object\./.test(page.text), `${path} leaked a server stack`);
      assert(page.text.includes("This record is not in the control centre"), `${path} did not render the admin not-found page`);
      assert(page.text.includes("Control centre overview"), `${path} left the administrator without a way back`);
    }
    return "three unknown ids render the admin not-found page inside the control centre, no stack";
  });

  return { journeyOrganisationId: state.organisationId, journeyListingId: state.listingId, journeyEmail: email, journeyPassword: password };
}
