/**
 * Group D — enquiry management over HTTP.
 *
 * The buyer raises the enquiry through the product's own endpoint; the desk then lists it, filters it,
 * moves its status and writes a private note. The note is asserted absent from every buyer-readable
 * surface, because "internal" is a claim that has to be tested where the buyer looks.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, fixture } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  const admin = createClient(ctx.baseUrl);
  const buyer = createClient(ctx.baseUrl);
  const seller = createClient(ctx.baseUrl);
  const anonymous = createClient(ctx.baseUrl);

  const signIn = async (jar, email, password, area, ip) =>
    jar.post("/api/auth/login", {
      body: area ? { email, password, area } : { email, password },
      useJar: true,
      anonymous: true,
      ip,
    });

  assert([200, 303].includes((await signIn(admin, fixture.adminActor.email, fixture.adminPassword, "admin", "198.51.100.41")).status), "admin sign-in failed");
  assert([200, 303].includes((await signIn(buyer, fixture.buyerA.email, fixture.buyerA.password, undefined, "198.51.100.42")).status), "buyer sign-in failed");
  assert([200, 303].includes((await signIn(seller, fixture.sellerApproved.email, fixture.sellerApproved.password, undefined, "198.51.100.43")).status), "seller sign-in failed");

  const suffix = randomUUID().slice(0, 6);
  let reference = null;
  let enquiryId = null;

  await test("D1", "a buyer raises an enquiry and the desk sees it", async () => {
    const response = await buyer.post("/api/enquiries", {
      body: {
        productId: fixture.productId,
        quantity: "750",
        unit: "KG",
        requirements: "M5 verification requirement: 750 kg of bearing scrap for a trial run.",
        deliveryLocation: "Pune",
        contactName: "M5 Alpha Buyer",
        contactEmail: fixture.buyerA.email,
      },
    });
    assert(response.status === 201, `status ${response.status} ${response.text.slice(0, 200)}`);
    reference = response.json.reference;
    assert(/^ENQ-\d{4}-\d{6}$/.test(reference ?? ""), `reference ${reference}`);
    const stored = await db.collection("enquiries").findOne({ reference });
    assert(stored, "the enquiry was not stored");
    enquiryId = stored._id;

    const listed = await admin.get(`/admin/enquiries?q=${encodeURIComponent(reference)}`, { headers: { accept: "text/html" } });
    assert(listed.status === 200, `admin list ${listed.status}`);
    assert(listed.text.includes(reference), "the desk list does not contain the new enquiry");
    assert(listed.text.includes(fixture.buyerA.organisation.legalName), "the desk list does not name the buyer");
    return `${reference} raised and visible on the desk`;
  });

  await test("D2", "the enquiry queue filters by status and pages", async () => {
    const filtered = await admin.get("/admin/enquiries?status=NEW", { headers: { accept: "text/html" } });
    assert(filtered.status === 200, `filtered status ${filtered.status}`);
    assert(filtered.text.includes(reference), "the NEW filter dropped a new enquiry");

    const won = await admin.get("/admin/enquiries?status=WON", { headers: { accept: "text/html" } });
    assert(!won.text.includes(reference), "the WON filter returned a NEW enquiry");

    const second = await admin.get("/admin/enquiries?page=2", { headers: { accept: "text/html" } });
    assert(second.status === 200, `page 2 status ${second.status}`);
    return "status filter narrows both ways; page 2 renders";
  });

  await test("D3", "an administrator moves the enquiry's status, and the buyer sees it", async () => {
    const response = await admin.post("/api/admin/enquiries", {
      body: { id: enquiryId, status: "UNDER_REVIEW" },
    });
    assert([200, 303].includes(response.status), `status ${response.status} ${response.text.slice(0, 160)}`);

    const stored = await db.collection("enquiries").findOne({ _id: enquiryId });
    assert(stored.status === "UNDER_REVIEW", `status ${stored.status}`);
    const audit = await db.collection("audit_logs").findOne({ action: "enquiry.status_changed", entityId: enquiryId });
    assert(audit, "no status-change audit row");
    assert(audit.beforeState?.status === "NEW", `before-state ${JSON.stringify(audit.beforeState)}`);

    const buyerPage = await buyer.get(`/buyer/enquiries/${enquiryId}`, { headers: { accept: "text/html" } });
    assert(buyerPage.status === 200, `buyer page ${buyerPage.status}`);
    assert(/Under review/i.test(buyerPage.text), "the buyer page does not show the new status");
    return "UNDER_REVIEW stored, audited, visible to the buyer";
  });

  await test("D4", "a private note stays private on every buyer-readable surface", async () => {
    const note = `M5 private desk note ${suffix}: margin and supplier identity must not leak.`;
    const response = await admin.post("/api/admin/enquiries", { body: { id: enquiryId, internalNotes: note } });
    assert([200, 303].includes(response.status), `note ${response.status} ${response.text.slice(0, 160)}`);

    const stored = await db.collection("enquiries").findOne({ _id: enquiryId });
    assert(stored.internalNotes === note, "the note was not stored on the enquiry");

    for (const path of [`/buyer/enquiries/${enquiryId}`, "/buyer/enquiries", "/buyer/dashboard"]) {
      const page = await buyer.get(path, { headers: { accept: "text/html" } });
      assert(page.status === 200, `${path} returned ${page.status}`);
      assert(!page.text.includes("margin and supplier identity"), `${path} rendered the internal note`);
    }

    const adminPage = await admin.get(`/admin/enquiries/${enquiryId}`, { headers: { accept: "text/html" } });
    assert(adminPage.text.includes("margin and supplier identity"), "the desk cannot read its own note");
    return "note stored, invisible on 3 buyer screens, visible to the desk";
  });

  await test("D5", "a buyer, a seller and an anonymous caller cannot change an enquiry", async () => {
    const attempt = { id: enquiryId, status: "WON" };
    const asBuyer = await buyer.post("/api/admin/enquiries", { body: attempt });
    assert(asBuyer.status === 403, `buyer ${asBuyer.status}`);
    const asSeller = await seller.post("/api/admin/enquiries", { body: attempt });
    assert(asSeller.status === 403, `seller ${asSeller.status}`);
    const asAnonymous = await anonymous.post("/api/admin/enquiries", { body: attempt });
    assert(asAnonymous.status === 401, `anonymous ${asAnonymous.status}`);

    const stored = await db.collection("enquiries").findOne({ _id: enquiryId });
    assert(stored.status === "UNDER_REVIEW", `status changed to ${stored.status}`);
    return "buyer 403, seller 403, anonymous 401, status unchanged";
  });

  await test("D6", "the buyer's own list contains only its organisation's enquiries", async () => {
    const own = await buyer.get("/buyer/enquiries", { headers: { accept: "text/html" } });
    assert(own.status === 200, `buyer list ${own.status}`);
    assert(own.text.includes(reference), "the buyer cannot see its own enquiry");
    assert(!own.text.includes(fixture.enquiryWon.reference), "the buyer sees another organisation's enquiry");

    await signIn(buyer, fixture.buyerB.email, fixture.buyerB.password, undefined, "198.51.100.44");
    const other = await buyer.get("/buyer/enquiries", { headers: { accept: "text/html" } });
    assert(other.status === 200, `second buyer list ${other.status}`);
    assert(!other.text.includes(reference), "the second buyer sees the first buyer's enquiry");
    return "each buyer sees only its own enquiries";
  });

  ctx.fixture.enquiryId = enquiryId;
  ctx.fixture.enquiryReference = reference;
  return { enquiryId, enquiryReference: reference };
}
