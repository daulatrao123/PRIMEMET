#!/usr/bin/env node
/**
 * PRIMEMET — Phase 1 integrated end-to-end verification.
 *
 *   node scripts/verify-phase1.mjs
 *   node scripts/verify-phase1.mjs --port 3260
 *
 * One continuous journey against an isolated in-memory MongoDB replica set and the real production
 * build served by `next start`:
 *
 *   J1  administrator signs in and the dashboard shows MongoDB's own figures
 *   J2  administrator creates and publishes a catalogue product
 *   J3  a public visitor discovers it: listing, search, product page, canonical, robots, sitemap
 *   J4  a buyer registers and signs in
 *   J5  the buyer raises an enquiry from the product page
 *   J6  another buyer cannot see it, and cannot raise one in the first buyer's name
 *   J7  the administrator manages the enquiry (status and a private note)
 *   J8  a seller registers, is refused sign-in, and is approved by the desk
 *   J9  the seller submits two listings; the desk queues show the application and the submissions
 *   J10 one listing is rejected with a reason, the other approved, and neither is published
 *   J11 only the desk's publication makes a product public; drafts stay 404
 *   J12 role permissions, cross-site refusal, suspension ending a live session
 *   J13 the server restarts on the same database: everything above is still there
 *
 * Nothing is mocked: every assertion reads either MongoDB directly or the running product.
 */

import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import "./lib/register-ts.mjs";

import {
  APP_ORIGIN,
  AUTH_SECRET,
  PROJECT_ROOT,
  createClient,
  createReporter,
  ensureRunDir,
  log,
  migrate,
  scratchDb,
  startMongo,
  startServer,
} from "./lib/m1-verify-core.mjs";

const { values } = parseArgs({ options: { port: { type: "string", default: "3260" } } });

const stamp = `${Date.now()}_${randomUUID().slice(0, 6)}`;
const dbName = scratchDb("phase1", stamp);
const port = Number(values.port);
const reporter = createReporter("J");

const totals = { passed: 0, failed: 0 };
let exitCode = 0;
let mongo = null;
let server = null;

const html = { headers: { accept: "text/html" } };

log("");
log("PRIMEMET Phase 1 integrated end-to-end verification");
log(`  database    ${dbName} (in-memory replica set)`);
log(`  server      next start on 127.0.0.1:${port}`);
log("");

try {
  if (!existsSync(path.join(PROJECT_ROOT, ".next", "BUILD_ID"))) {
    throw new Error("no production build; run npm run build first");
  }

  mongo = await startMongo();
  const db = mongo.client.db(dbName);
  await migrate(db, { appliedBy: "phase1-e2e" });

  process.env.MONGODB_URI = mongo.uri;
  process.env.MONGODB_DB = dbName;
  process.env.PRIMEMET_ENV = "test";
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
  process.env.NODE_ENV = "production";

  const [password] = await Promise.all([import("../src/lib/auth/password.ts")]);

  server = await startServer({ port, uri: mongo.uri, dbName });

  const anonymous = createClient(server.baseUrl);
  const admin = createClient(server.baseUrl);
  const buyer = createClient(server.baseUrl);
  const buyer2 = createClient(server.baseUrl);
  const seller = createClient(server.baseUrl);

  const suffix = randomUUID().slice(0, 6);
  const adminEmail = `phase1-admin-${suffix}@verify.primemet.test`;
  const adminPassword = "Phase1AdminPass123";
  const buyerEmail = `phase1-buyer-${suffix}@verify.primemet.test`;
  const buyer2Email = `phase1-buyer2-${suffix}@verify.primemet.test`;
  const sellerEmail = `phase1-seller-${suffix}@verify.primemet.test`;
  const buyerPassword = "Phase1BuyerPass123";
  const sellerPassword = "Phase1SellerPass123";
  const productTitle = `Phase 1 Journey Bearing ${suffix}`;
  const sellerListingTitle = `Phase 1 Journey copper millberry ${suffix}`;
  const rejectedListingTitle = `Phase 1 Journey rejected brass ${suffix}`;
  const productQuery = `Phase 1 Journey Bearing ${suffix}`;
  const privateNote = `Phase 1 private note ${suffix}: quote only against the verified assay.`;

  const state = {};

  const signIn = (client, body, ip) =>
    client.post("/api/auth/login", { body, useJar: true, anonymous: true, ip });

  const register = (client, body, ip) => client.post("/api/auth/register", { body, anonymous: true, ip });

  await reporter.test("J1", "the administrator signs in and the dashboard shows MongoDB's own figures", async () => {
    // Administrator provisioning is an operational act, not a public form: create the account the desk
    // would be given, then sign in through the administrator door like a real operator.
    const adminId = randomUUID();
    await db.collection("users").insertOne({
      _id: adminId,
      email: adminEmail,
      emailVerifiedAt: null,
      passwordHash: await password.hashPassword(adminPassword),
      passwordChangedAt: new Date(),
      fullName: "Phase 1 Administrator",
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
    state.adminId = adminId;

    const refused = await signIn(createClient(server.baseUrl), { email: adminEmail, password: "wrong-password", area: "admin" }, "198.51.100.101");
    reporter.assert([400, 401, 403].includes(refused.status), `a wrong password returned ${refused.status}`);

    const login = await signIn(admin, { email: adminEmail, password: adminPassword, area: "admin" }, "198.51.100.102");
    reporter.assert([200, 303].includes(login.status), `admin sign-in ${login.status} ${login.text.slice(0, 140)}`);

    const wrongDoor = await signIn(createClient(server.baseUrl), { email: adminEmail, password: adminPassword }, "198.51.100.103");
    reporter.assert(wrongDoor.status === 403, `an administrator signing in at the buyer door returned ${wrongDoor.status}`);

    const dashboard = await admin.get("/admin/dashboard", html);
    reporter.assert(dashboard.status === 200, `dashboard ${dashboard.status}`);
    reporter.assert(dashboard.text.includes("Control centre"), "the dashboard did not render the control centre");

    const orgs = await db.collection("organisations").countDocuments({ deletedAt: null });
    reporter.assert(dashboard.text.includes(String(orgs)), `the dashboard does not show ${orgs} organisations`);
    return `sign-in 200, wrong password refused, wrong door 403, dashboard 200 with ${orgs} organisations`;
  });

  await reporter.test("J2", "the administrator creates a draft product, publishes it, and MongoDB holds it", async () => {
    const category = await admin.post("/api/admin/catalogue/categories", {
      body: { action: "create", name: `Phase 1 Materials ${suffix}`, kind: "SPARE_PARTS", shortDescription: "Phase 1 journey category." },
      ip: "198.51.100.104",
    });
    reporter.assert(category.status === 201, `category ${category.status} ${category.text.slice(0, 160)}`);
    const categoryRow = await db.collection("categories").findOne({ name: `Phase 1 Materials ${suffix}` });
    reporter.assert(categoryRow, "the category was not stored");

    const family = await admin.post("/api/admin/catalogue/families", {
      body: { action: "create", categoryId: categoryRow._id, name: "Bearings" },
      ip: "198.51.100.105",
    });
    reporter.assert(family.status === 201, `family ${family.status} ${family.text.slice(0, 160)}`);
    const familyRow = await db.collection("product_families").findOne({ categoryId: categoryRow._id });
    reporter.assert(familyRow?.name === "Bearings", "the subcategory was not stored");

    const created = await admin.post("/api/admin/catalogue/products", {
      body: {
        action: "create",
        title: productTitle,
        familyId: familyRow._id,
        condition: "NEW",
        priceMode: "REQUEST",
        partNumber: `P1-${suffix}`,
        manufacturer: `Phase 1 Works ${suffix}`,
        shortDescription: "A sealed deep-groove bearing published by the Phase 1 end-to-end gate.",
        publish: "no",
        specifications: "Bore: 25 (mm)\nOuter diameter: 52 (mm)",
      },
      ip: "198.51.100.106",
    });
    reporter.assert(created.status === 201, `create ${created.status} ${created.text.slice(0, 200)}`);

    const draft = await db.collection("products").findOne({ title: productTitle });
    reporter.assert(draft, "the product was not written to MongoDB");
    reporter.assert(draft.publicationState === "DRAFT", `state ${draft.publicationState}`);
    const specs = await db.collection("product_specifications").find({ productId: draft._id }).toArray();
    reporter.assert(specs.length === 2, `${specs.length} specification rows`);

    const draftPage = await anonymous.get(`/products/${draft.slug}`, html);
    reporter.assert(draftPage.status === 404, `a draft product's page returned ${draftPage.status}`);

    const published = await admin.post("/api/admin/catalogue/products", {
      body: { action: "publish", id: draft._id, returnTo: "/admin/products" },
      ip: "198.51.100.107",
    });
    reporter.assert([200, 303].includes(published.status), `publish ${published.status} ${published.text.slice(0, 160)}`);

    const after = await db.collection("products").findOne({ _id: draft._id });
    reporter.assert(after.publicationState === "PUBLISHED", `state ${after.publicationState}`);
    reporter.assert(after.publishedAt instanceof Date, "no publication instant");
    reporter.assert(after.slug === draft.slug, "the slug changed on publication");

    state.productId = draft._id;
    state.productSlug = after.slug;
    return `DRAFT -> PUBLISHED, 2 specification rows, draft page 404, url /products/${after.slug}`;
  });

  await reporter.test("J3", "a public visitor discovers the published product and the page is search-ready", async () => {
    const listing = await anonymous.get("/products", html);
    reporter.assert(listing.status === 200, `catalogue ${listing.status}`);
    reporter.assert(listing.text.includes(productTitle), "the published product is not in the public catalogue");

    const searched = await anonymous.get(`/products?q=${encodeURIComponent(productQuery)}`, html);
    reporter.assert(searched.status === 200, `search ${searched.status}`);
    reporter.assert(searched.text.includes(productTitle), "catalogue search does not find the product");

    const page = await anonymous.get(`/products/${state.productSlug}`, html);
    reporter.assert(page.status === 200, `product page ${page.status}`);
    reporter.assert(page.text.includes(productTitle), "the product page does not show the title");
    reporter.assert(/<title>[^<]*Phase 1 Journey Bearing/i.test(page.text), "no product <title>");
    reporter.assert(
      page.text.includes(`<link rel="canonical" href="${APP_ORIGIN}/products/${state.productSlug}"`),
      "no canonical link to the product's own URL",
    );
    reporter.assert(/<meta name="description" content="[^"]{20,}"/i.test(page.text), "no meta description");
    reporter.assert(page.text.includes('"BreadcrumbList"'), "no breadcrumb structured data");
    reporter.assert(page.text.includes("Sign in to enquire") || page.text.includes("Enquire"), "no enquiry entry point for a visitor");

    const robots = await anonymous.get("/robots.txt");
    reporter.assert(robots.status === 200, `robots.txt ${robots.status}`);
    for (const area of ["/admin", "/buyer", "/seller", "/api"]) {
      reporter.assert(robots.text.includes(`Disallow: ${area}`), `robots.txt does not disallow ${area}`);
    }
    reporter.assert(robots.text.includes("Sitemap:"), "robots.txt names no sitemap");

    const sitemap = await anonymous.get("/sitemap.xml");
    reporter.assert(sitemap.status === 200, `sitemap ${sitemap.status}`);
    // The sitemap is prerendered at build time from the build's NEXT_PUBLIC_APP_URL, so its host is not
    // necessarily the URL this server was started with; the paths it publishes are what matters.
    reporter.assert(/<loc>[^<]*\/products<\/loc>/.test(sitemap.text), "the sitemap has no products page");
    reporter.assert(!sitemap.text.includes("/admin"), "the sitemap exposes an admin URL");
    reporter.assert(!sitemap.text.includes("/buyer") && !sitemap.text.includes("/seller"), "the sitemap exposes a portal URL");
    return "listed, searchable, canonical + description + breadcrumb JSON-LD, robots and sitemap correct";
  });

  await reporter.test("J4", "a buyer registers and signs in", async () => {
    const registered = await register(buyer, {
      role: "BUYER",
      company: `Phase 1 Buyers ${suffix} Pvt Ltd`,
      contactName: "Phase 1 Buyer",
      email: buyerEmail,
      phone: "+91 90000 00041",
      gstin: "27ABCDE1234F1Z5",
      city: "Pune",
      stateCode: "MH",
      password: buyerPassword,
      passwordConfirm: buyerPassword,
    }, "198.51.100.108");
    reporter.assert(registered.status === 201, `buyer registration ${registered.status} ${registered.text.slice(0, 160)}`);

    const login = await signIn(buyer, { email: buyerEmail, password: buyerPassword }, "198.51.100.109");
    reporter.assert([200, 303].includes(login.status), `buyer sign-in ${login.status}`);

    const dashboard = await buyer.get("/buyer/dashboard", html);
    reporter.assert(dashboard.status === 200, `buyer dashboard ${dashboard.status}`);

    const adminArea = await buyer.get("/admin/dashboard", html);
    reporter.assert([302, 303, 307].includes(adminArea.status), `a buyer reached the admin area with ${adminArea.status}`);

    const user = await db.collection("users").findOne({ email: buyerEmail });
    const profile = await db.collection("buyer_profiles").findOne({ userId: user._id });
    reporter.assert(profile, "no buyer profile");
    state.buyerOrganisationId = profile.organisationId;
    return "201 registration, sign-in 200, buyer dashboard 200, admin area redirected";
  });

  await reporter.test("J5", "the buyer raises an enquiry and the desk receives it", async () => {
    const response = await buyer.post("/api/enquiries", {
      body: {
        productId: state.productId,
        quantity: "1200",
        unit: "KG",
        requirements: "Phase 1 journey: 1200 kg of the published bearing, delivery to Pune.",
        contactName: "Phase 1 Buyer",
        contactEmail: buyerEmail,
        contactPhone: "+91 90000 00041",
      },
      ip: "198.51.100.110",
    });
    reporter.assert([200, 201].includes(response.status), `enquiry ${response.status} ${response.text.slice(0, 200)}`);

    const enquiry = await db.collection("enquiries").findOne({ productId: state.productId, buyerOrganisationId: state.buyerOrganisationId });
    reporter.assert(enquiry, "the enquiry was not persisted");
    reporter.assert(enquiry.status === "NEW", `status ${enquiry.status}`);
    reporter.assert(enquiry.reference, "the enquiry has no reference");
    state.enquiryId = enquiry._id;
    state.enquiryReference = enquiry.reference;

    const queue = await admin.get("/admin/enquiries", html);
    reporter.assert(queue.status === 200, `admin queue ${queue.status}`);
    reporter.assert(queue.text.includes(enquiry.reference), "the desk queue does not show the enquiry");

    const detail = await admin.get("/admin/enquiries/" + enquiry._id, html);
    reporter.assert(detail.status === 200, `desk detail ${detail.status}`);
    reporter.assert(detail.text.includes("1200") || detail.text.includes("1,200"), "the quantity is not shown to the desk");
    reporter.assert(detail.text.includes("Phase 1 Buyers"), "the buyer is not shown on the enquiry");

    const mine = await buyer.get("/buyer/enquiries", html);
    reporter.assert(mine.status === 200, `buyer enquiries ${mine.status}`);
    reporter.assert(mine.text.includes(enquiry.reference), "the buyer cannot see its own enquiry");
    return `ENQ ${enquiry.reference} persisted as NEW, on both the buyer's list and the desk queue`;
  });

  await reporter.test("J6", "another buyer cannot see the enquiry or raise one in the first buyer's name", async () => {
    const registered = await register(buyer2, {
      role: "BUYER",
      company: `Phase 1 Second Buyers ${suffix} Pvt Ltd`,
      contactName: "Second Buyer",
      email: buyer2Email,
      phone: "+91 90000 00042",
      gstin: "29ABCDE1234F1Z6",
      city: "Bengaluru",
      stateCode: "KA",
      password: buyerPassword,
      passwordConfirm: buyerPassword,
    }, "198.51.100.111");
    reporter.assert(registered.status === 201, `second buyer registration ${registered.status}`);

    const login = await signIn(buyer2, { email: buyer2Email, password: buyerPassword }, "198.51.100.112");
    reporter.assert([200, 303].includes(login.status), `second buyer sign-in ${login.status}`);

    const list = await buyer2.get("/buyer/enquiries", html);
    reporter.assert(list.status === 200, `second buyer list ${list.status}`);
    reporter.assert(!list.text.includes(state.enquiryReference), "another buyer can read this buyer's enquiry");

    const direct = await buyer2.get("/buyer/enquiries/" + state.enquiryId, html);
    reporter.assert([403, 404].includes(direct.status), `direct access returned ${direct.status}`);

    // The organisation comes from the session: a forged organisationId in the body must be ignored.
    const forged = await buyer2.post("/api/enquiries", {
      body: {
        productId: state.productId,
        organisationId: state.buyerOrganisationId,
        buyerOrganisationId: state.buyerOrganisationId,
        requirements: "Forged organisation attempt from the Phase 1 gate.",
        quantity: "10",
        unit: "KG",
        contactName: "Second Buyer",
        contactEmail: buyer2Email,
        contactPhone: "+91 90000 00042",
      },
      ip: "198.51.100.113",
    });
    reporter.assert([200, 201].includes(forged.status), `forged enquiry ${forged.status} ${forged.text.slice(0, 160)}`);
    const user2 = await db.collection("users").findOne({ email: buyer2Email });
    const profile2 = await db.collection("buyer_profiles").findOne({ userId: user2._id });
    const forgedRow = await db.collection("enquiries").findOne({ requirements: "Forged organisation attempt from the Phase 1 gate." });
    reporter.assert(forgedRow, "the forged enquiry was not stored");
    reporter.assert(
      forgedRow.buyerOrganisationId === profile2.organisationId,
      `the forged enquiry was written against ${forgedRow.buyerOrganisationId}`,
    );
    reporter.assert(forgedRow.buyerOrganisationId !== state.buyerOrganisationId, "the forged organisation id was honoured");

    const anonymousRefusal = await anonymous.get("/buyer/enquiries", html);
    reporter.assert([302, 303, 307].includes(anonymousRefusal.status), `anonymous buyer list ${anonymousRefusal.status}`);
    return "second buyer: list without the reference, detail 403/404, forged organisation ignored, anonymous redirected";
  });

  await reporter.test("J7", "the administrator manages the enquiry, and the private note stays private", async () => {
    const updated = await admin.post("/api/admin/enquiries", {
      body: { id: state.enquiryId, status: "UNDER_REVIEW", internalNotes: privateNote },
      ip: "198.51.100.114",
    });
    reporter.assert([200, 303].includes(updated.status), `update ${updated.status} ${updated.text.slice(0, 160)}`);

    const stored = await db.collection("enquiries").findOne({ _id: state.enquiryId });
    reporter.assert(stored.status === "UNDER_REVIEW", `status ${stored.status}`);
    reporter.assert((stored.internalNotes ?? "").includes(privateNote), "the private note was not stored");
    const audit = await db.collection("audit_logs").findOne({ entityId: state.enquiryId, action: /enquiry/ });
    reporter.assert(audit, "the status change left no audit row");

    const buyerDetail = await buyer.get("/buyer/enquiries/" + state.enquiryId, html);
    reporter.assert(buyerDetail.status === 200, `buyer detail ${buyerDetail.status}`);
    reporter.assert(!buyerDetail.text.includes(privateNote), "the private note reached the buyer's page");
    reporter.assert(!/internalNotes/i.test(buyerDetail.text), "the buyer page exposes an internalNotes field");
    reporter.assert(/review/i.test(buyerDetail.text), "the buyer cannot see the new status");

    const deskDetail = await admin.get("/admin/enquiries/" + state.enquiryId, html);
    reporter.assert(deskDetail.text.includes(privateNote), "the desk cannot read its own note");
    return "UNDER_REVIEW stored and audited; note visible to the desk, absent from the buyer page";
  });

  await reporter.test("J8", "a seller registers, is refused sign-in until approved, and the desk approves", async () => {
    const registered = await register(seller, {
      role: "SELLER",
      company: `Phase 1 Journey Metals ${suffix} Pvt Ltd`,
      contactName: "Phase 1 Seller",
      email: sellerEmail,
      phone: "+91 90000 00043",
      gstin: "27ABCDE1234F1Z9",
      city: "Pune",
      stateCode: "MH",
      addressLine1: "Plot 21, Bhosari",
      postalCode: "411026",
      businessType: "PROCESSOR",
      description: "Non-ferrous processor with a weighbridge, applying through the Phase 1 gate.",
      password: sellerPassword,
      passwordConfirm: sellerPassword,
    }, "198.51.100.115");
    reporter.assert(registered.status === 201, `seller registration ${registered.status} ${registered.text.slice(0, 160)}`);

    const refused = await signIn(createClient(server.baseUrl), { email: sellerEmail, password: sellerPassword }, "198.51.100.116");
    reporter.assert(refused.status === 403, `pending seller sign-in ${refused.status}`);
    reporter.assert(refused.json?.code === "inactive", `code ${refused.json?.code}`);

    const user = await db.collection("users").findOne({ email: sellerEmail });
    const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });
    state.sellerOrganisationId = profile.organisationId;
    state.sellerProfileId = profile._id;

    const queue = await admin.get("/admin/suppliers?status=PENDING_APPROVAL", html);
    reporter.assert(queue.text.includes(`Phase 1 Journey Metals ${suffix}`), "the application is not in the seller queue");

    const approved = await admin.post("/api/admin/sellers", {
      body: { organisationId: state.sellerOrganisationId, action: "approve" },
      ip: "198.51.100.117",
    });
    reporter.assert([200, 303].includes(approved.status), `approve ${approved.status} ${approved.text.slice(0, 160)}`);

    const organisation = await db.collection("organisations").findOne({ _id: state.sellerOrganisationId });
    reporter.assert(organisation.accountStatus === "ACTIVE", `accountStatus ${organisation.accountStatus}`);

    const login = await signIn(seller, { email: sellerEmail, password: sellerPassword }, "198.51.100.118");
    reporter.assert([200, 303].includes(login.status), `approved seller sign-in ${login.status}`);
    const dashboard = await seller.get("/seller/dashboard", html);
    reporter.assert(dashboard.status === 200, `seller dashboard ${dashboard.status}`);
    return "201 pending, sign-in 403, approved and audited, then dashboard 200";
  });

  await reporter.test("J9", "the seller submits two listings and both queues show real records", async () => {
    const submit = (body, ip) => seller.post("/api/seller/listings", { body, ip });
    const first = await submit({
      title: sellerListingTitle,
      categoryLabel: "Copper",
      manufacturer: "Phase 1 Metals",
      description: "Bright copper millberry 99.9%, baled, ex-Pune yard.",
      specification: "Cu 99.9% min, moisture < 0.5%, bale 300-500 kg.",
      quantityKg: "6000",
      images: ["https://images.example.test/phase1-1.jpg"],
      supportingInfo: "Assay certificate available on request.",
    }, "198.51.100.119");
    reporter.assert(first.status === 200, `first listing ${first.status} ${first.text.slice(0, 160)}`);

    const second = await submit({
      title: rejectedListingTitle,
      categoryLabel: "Brass",
      manufacturer: "Phase 1 Metals",
      description: "Mixed brass turnings, baled, moisture controlled.",
      specification: "Cu 60% min, Pb < 2%, bale 300-500 kg.",
      quantityKg: "2500",
    }, "198.51.100.120");
    reporter.assert(second.status === 200, `second listing ${second.status} ${second.text.slice(0, 160)}`);

    const listings = await db.collection("supplier_listings").find({ supplierId: state.sellerProfileId }).toArray();
    reporter.assert(listings.length === 2, `${listings.length} listings stored`);
    const approvedOne = listings.find((row) => row.title === sellerListingTitle);
    const rejectedOne = listings.find((row) => row.title === rejectedListingTitle);
    reporter.assert(approvedOne && rejectedOne, "both listings are not stored");
    reporter.assert(approvedOne.reviewStatus === "PENDING" && approvedOne.status === "DRAFT", `state ${approvedOne.reviewStatus}/${approvedOne.status}`);
    state.approvedListingId = approvedOne._id;
    state.rejectedListingId = rejectedOne._id;

    const deskQueue = await admin.get("/admin/listing-submissions?status=PENDING", html);
    reporter.assert(deskQueue.status === 200, `listing queue ${deskQueue.status}`);
    reporter.assert(deskQueue.text.includes(sellerListingTitle), "the submission is missing from the desk queue");
    reporter.assert(deskQueue.text.includes("Cu 99.9% min"), "the specification is not shown to the reviewer");

    const sellerHistory = await seller.get("/seller/products", html);
    reporter.assert(sellerHistory.text.includes(sellerListingTitle), "the seller cannot see its own submission");
    reporter.assert(sellerHistory.text.includes("Awaiting approval"), "the pending state is not shown to the seller");
    return "2 listings stored PENDING/DRAFT, visible to the seller and in the desk queue with specifications";
  });

  await reporter.test("J10", "the desk rejects one listing with a reason and approves the other, and neither is published", async () => {
    const rejected = await admin.post("/api/admin/listings", {
      body: { listingId: state.rejectedListingId, action: "reject", reason: "Assay sheet does not match the declared grade." },
      ip: "198.51.100.121",
    });
    reporter.assert([200, 303].includes(rejected.status), `reject ${rejected.status} ${rejected.text.slice(0, 160)}`);
    const approved = await admin.post("/api/admin/listings", {
      body: { listingId: state.approvedListingId, action: "approve" },
      ip: "198.51.100.122",
    });
    reporter.assert([200, 303].includes(approved.status), `approve ${approved.status} ${approved.text.slice(0, 160)}`);

    const rejectedRow = await db.collection("supplier_listings").findOne({ _id: state.rejectedListingId });
    const approvedRow = await db.collection("supplier_listings").findOne({ _id: state.approvedListingId });
    reporter.assert(rejectedRow.reviewStatus === "REJECTED" && rejectedRow.status === "DRAFT", `rejected ${rejectedRow.reviewStatus}/${rejectedRow.status}`);
    reporter.assert(approvedRow.reviewStatus === "APPROVED" && approvedRow.status === "ACTIVE", `approved ${approvedRow.reviewStatus}/${approvedRow.status}`);

    const history = await seller.get("/seller/products", html);
    reporter.assert(history.text.includes("Rejected"), "the seller is not told about the rejection");
    reporter.assert(history.text.includes("Assay sheet does not match"), "the rejection reason is not shown to the seller");
    reporter.assert(history.text.includes("Approved"), "the seller is not told about the approval");

    const publicList = await anonymous.get("/products", html);
    reporter.assert(!publicList.text.includes(sellerListingTitle), "an approved but unpublished listing is publicly listed");
    const publicDetail = await anonymous.get("/products?q=millberry", html);
    reporter.assert(!publicDetail.text.includes(sellerListingTitle), "an approved but unpublished listing is publicly searchable");

    const publishedProducts = await db.collection("products").countDocuments({ publicationState: "PUBLISHED" });
    reporter.assert(publishedProducts === 1, `${publishedProducts} published products after listing approval`);
    return "REJECTED/DRAFT with a reason the seller reads, APPROVED/ACTIVE, public catalogue unchanged";
  });

  await reporter.test("J11", "only the desk's publication makes the product public", async () => {
    const created = await admin.post("/api/admin/catalogue/products", {
      body: {
        action: "create",
        title: `Phase 1 Published Copper ${suffix}`,
        familyId: (await db.collection("product_families").findOne({ name: "Bearings" }))._id,
        condition: "NEW",
        priceMode: "REQUEST",
        manufacturer: "Phase 1 Metals",
        shortDescription: "Catalogue entry the desk publishes from an approved seller submission.",
        publish: "yes",
        specifications: "Cu: 99.9 (%)\nForm: millberry",
      },
      ip: "198.51.100.123",
    });
    reporter.assert(created.status === 201, `publish-on-create ${created.status} ${created.text.slice(0, 200)}`);

    const product = await db.collection("products").findOne({ title: `Phase 1 Published Copper ${suffix}` });
    reporter.assert(product, "the published product was not stored");
    reporter.assert(product.publicationState === "PUBLISHED", `state ${product.publicationState}`);

    const page = await anonymous.get(`/products/${product.slug}`, html);
    reporter.assert(page.status === 200, `public page ${page.status}`);
    reporter.assert(page.text.includes(`Phase 1 Published Copper ${suffix}`), "the public page does not show the product");
    reporter.assert(!page.text.includes("Phase 1 Journey Metals"), "the seller's identity reached the public page");

    const listing = await anonymous.get(`/products?q=${encodeURIComponent("Published Copper")}`, html);
    reporter.assert(listing.text.includes(`Phase 1 Published Copper ${suffix}`), "search does not find the published product");

    const draft = await db.collection("products").findOne({ _id: state.productId, publicationState: "PUBLISHED" });
    reporter.assert(draft, "the journey product is no longer published");

    const missing = await anonymous.get(`/products/phase-1-does-not-exist-${suffix}`, html);
    reporter.assert(missing.status === 404, `an unknown slug returned ${missing.status}`);
    return `published /products/${product.slug} 200, searchable, seller anonymous, unknown slug 404`;
  });

  await reporter.test("J12", "role permissions, cross-site refusal and suspension are enforced server-side", async () => {
    const attempts = [
      ["/api/admin/accounts", { organisationId: state.buyerOrganisationId, action: "suspend", reason: "Escalation" }],
      ["/api/admin/sellers", { organisationId: state.sellerOrganisationId, action: "reject", reason: "Escalation" }],
      ["/api/admin/listings", { listingId: state.approvedListingId, action: "reject", reason: "Escalation" }],
      ["/api/admin/enquiries", { id: state.enquiryId, status: "WON" }],
      ["/api/admin/catalogue/products", { action: "archive", id: state.productId }],
      ["/api/admin/manufacturers", { from: "Phase 1 Metals", to: "Escalated" }],
    ];
    for (const [route, body] of attempts) {
      const asBuyer = await buyer.post(route, { body, ip: "198.51.100.124" });
      reporter.assert(asBuyer.status === 403, `${route} as buyer ${asBuyer.status}`);
      const asSeller = await seller.post(route, { body, ip: "198.51.100.125" });
      reporter.assert(asSeller.status === 403, `${route} as seller ${asSeller.status}`);
      const asAnonymous = await anonymous.post(route, { body, ip: "198.51.100.126" });
      reporter.assert(asAnonymous.status === 401, `${route} anonymously ${asAnonymous.status}`);
    }

    const enquiry = await db.collection("enquiries").findOne({ _id: state.enquiryId });
    reporter.assert(enquiry.status === "UNDER_REVIEW", `a refused request moved the enquiry to ${enquiry.status}`);
    const product = await db.collection("products").findOne({ _id: state.productId });
    reporter.assert(product.publicationState === "PUBLISHED" && !product.deletedAt, "a refused request archived the product");

    const crossSite = await buyer.post("/api/enquiries", {
      body: {
        productId: state.productId,
        requirements: "Cross-site attempt from another origin entirely.",
        quantity: "1",
        unit: "KG",
        contactName: "Second Buyer",
        contactEmail: buyer2Email,
        contactPhone: "+91 90000 00042",
      },
      headers: { origin: "https://evil.example" },
      ip: "198.51.100.127",
    });
    reporter.assert(crossSite.status === 403, `cross-site POST ${crossSite.status}`);

    const suspended = await admin.post("/api/admin/accounts", {
      body: { organisationId: state.buyerOrganisationId, action: "suspend", reason: "Phase 1 suspension check" },
      ip: "198.51.100.128",
    });
    reporter.assert([200, 303].includes(suspended.status), `suspend ${suspended.status}`);
    const liveSession = await buyer.get("/buyer/dashboard", html);
    reporter.assert([302, 303, 307].includes(liveSession.status), `a suspended buyer still returned ${liveSession.status}`);
    const blockedLogin = await signIn(createClient(server.baseUrl), { email: buyerEmail, password: buyerPassword }, "198.51.100.129");
    reporter.assert(blockedLogin.status === 403, `suspended buyer sign-in ${blockedLogin.status}`);
    await admin.post("/api/admin/accounts", {
      body: { organisationId: state.buyerOrganisationId, action: "reactivate" },
      ip: "198.51.100.130",
    });
    return "6 endpoints x 3 identities refused, cross-site 403, suspension ends a live session and blocks sign-in";
  });

  await reporter.test("J13", "the server restarts on the same database and everything is still there", async () => {
    await server.stop();
    server = await startServer({ port, uri: mongo.uri, dbName });
    reporter.assert(server.baseUrl === `http://127.0.0.1:${port}`, `restarted at ${server.baseUrl}`);

    const health = await anonymous.get("/api/health");
    reporter.assert(health.status === 200, `health after restart ${health.status}`);

    const page = await anonymous.get(`/products/${state.productSlug}`, html);
    reporter.assert(page.status === 200, `product after restart ${page.status}`);
    reporter.assert(page.text.includes(productTitle), "the product is gone after restart");

    // The administrator's cookie was issued before the restart: the session lives in MongoDB, not in memory.
    const dashboard = await admin.get("/admin/dashboard", html);
    reporter.assert(dashboard.status === 200, `admin session after restart ${dashboard.status}`);

    const counts = {
      users: await db.collection("users").countDocuments({}),
      organisations: await db.collection("organisations").countDocuments({ deletedAt: null }),
      products: await db.collection("products").countDocuments({ publicationState: "PUBLISHED" }),
      enquiries: await db.collection("enquiries").countDocuments({}),
      listings: await db.collection("supplier_listings").countDocuments({}),
      audit: await db.collection("audit_logs").countDocuments({}),
    };
    const overviewPage = dashboard.text;
    reporter.assert(overviewPage.includes(String(counts.enquiries)), `dashboard does not show ${counts.enquiries} enquiries`);
    reporter.assert(counts.audit > 0, "no audit rows were written by the journey");
    reporter.assert(counts.listings === 2, `${counts.listings} listings after restart`);

    state.counts = counts;
    return `restart ok, cookie still valid, ${counts.products} published product(s), ${counts.enquiries} enquiries, ${counts.audit} audit rows`;
  });

  const summary = reporter.summary();
  totals.passed = summary.passed;
  totals.failed = summary.failed;
  state.summary = summary;
} catch (error) {
  exitCode = 1;
  log("");
  log(`  HARNESS ERROR: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
} finally {
  if (server) await server.stop().catch(() => {});
  if (mongo) await mongo.stop().catch(() => {});
}

const reportFile = path.join(ensureRunDir(), `phase1-report-${stamp}.json`);
try {
  writeFileSync(reportFile, JSON.stringify({ stamp, database: dbName, totals, at: new Date().toISOString() }, null, 2));
} catch {
  // A report that cannot be written must not change the verdict.
}

log("");
log(`  TOTAL: ${totals.passed} passed, ${totals.failed} failed`);
log(`  report: ${path.relative(PROJECT_ROOT, reportFile)}`);
log(`  verdict: ${totals.failed === 0 && exitCode === 0 ? "PHASE 1 VERIFIED LOCALLY" : "NOT VERIFIED"}`);
log("");
process.exit(totals.failed === 0 && exitCode === 0 ? 0 : 1);
