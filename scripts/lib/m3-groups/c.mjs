/**
 * Group C — the administrator's view of buyer enquiries, and the boundary between what the desk writes
 * and what the buyer may read.
 */

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, fixture } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  // An administrator exists only because this test writes one: no public path creates an ADMIN account.
  const adminEmail = `m3-admin-${fixture.productId.slice(0, 6)}@verify.primemet.test`;
  const adminPassword = "M3AdminPass123";
  const { randomUUID } = await import("node:crypto");
  await db.collection("users").insertOne({
    _id: randomUUID(),
    email: adminEmail,
    emailVerifiedAt: null,
    passwordHash: await ctx.modules.password.hashPassword(adminPassword),
    passwordChangedAt: new Date(),
    fullName: "M3 Administrator",
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

  const admin = createClient(ctx.baseUrl);
  const signIn = await admin.post("/api/auth/login", {
    body: { email: adminEmail, password: adminPassword, area: "admin" },
    useJar: true,
    anonymous: true,
  });
  assert(signIn.status === 200 || signIn.status === 303, `admin sign-in ${signIn.status}`);

  await test("C1", "the desk lists enquiries submitted by buyers", async () => {
    const page = await admin.get("/admin/enquiries", { headers: { accept: "text/html" } });
    assert(page.status === 200, `status ${page.status}`);
    assert(page.text.includes(fixture.portalEnquiryReference), "the buyer's reference is missing from the queue");
    // The rendered name is compared with the organisation as stored, not with a literal: an earlier group
    // renames the company, and a test that pinned the name would fail for the wrong reason.
    const alphaOrganisation = await db.collection("organisations").findOne({ _id: fixture.buyerA.organisationId });
    assert(page.text.includes(alphaOrganisation.legalName), `the buying organisation (${alphaOrganisation.legalName}) is missing`);

    const other = await db.collection("enquiries").findOne({ buyerOrganisationId: fixture.buyerB.organisationId });
    assert(page.text.includes(other.reference), "the second buyer's enquiry is missing from the queue");
    return "both buyers' enquiries visible to the desk";
  });

  await test("C2", "the queue filters by status and by search term", async () => {
    const byReference = await admin.get(`/admin/enquiries?q=${encodeURIComponent(fixture.portalEnquiryReference)}`, {
      headers: { accept: "text/html" },
    });
    assert(byReference.text.includes(fixture.portalEnquiryReference), "search by reference failed");

    const byStatus = await admin.get("/admin/enquiries?status=NEW", { headers: { accept: "text/html" } });
    assert(byStatus.status === 200, `status ${byStatus.status}`);
    assert(byStatus.text.includes(fixture.portalEnquiryReference), "the NEW filter dropped a new enquiry");

    const empty = await admin.get("/admin/enquiries?status=WON", { headers: { accept: "text/html" } });
    assert(empty.text.includes("No enquiry matches"), "an empty result does not say so");
    return "reference search, status filter and empty state all behave";
  });

  await test("C3", "the desk updates a status and the buyer sees it", async () => {
    const response = await admin.post("/api/admin/enquiries", {
      body: { id: fixture.portalEnquiryId, status: "MATCHING_SUPPLIERS" },
      headers: { accept: "application/json" },
    });
    assert(response.status === 200, `status ${response.status}: ${response.text.slice(0, 200)}`);

    const stored = await db.collection("enquiries").findOne({ _id: fixture.portalEnquiryId });
    assert(stored.status === "MATCHING_SUPPLIERS", `stored status ${stored.status}`);

    const buyerView = await fixture.alphaClient?.get?.(`/buyer/enquiries/${fixture.portalEnquiryId}`, { headers: { accept: "text/html" } });
    if (buyerView) {
      assert(buyerView.status === 200, `buyer detail ${buyerView.status}`);
      assert(buyerView.text.includes("Matching suppliers"), "the buyer does not see the new status");
    }
    return "status MATCHING_SUPPLIERS stored and shown to the buyer";
  });

  await test("C4", "an internal note is stored and never reaches the buyer", async () => {
    const note = "Desk-only: route through the Pune warehouse; buyer is price sensitive.";
    const response = await admin.post("/api/admin/enquiries", {
      body: { id: fixture.portalEnquiryId, internalNotes: note },
      headers: { accept: "application/json" },
    });
    assert(response.status === 200, `status ${response.status}`);

    const stored = await db.collection("enquiries").findOne({ _id: fixture.portalEnquiryId });
    assert(stored.internalNotes === note, "the note was not stored");

    const detail = await admin.get(`/admin/enquiries/${fixture.portalEnquiryId}`, { headers: { accept: "text/html" } });
    assert(detail.text.includes("price sensitive"), "the desk cannot see its own note");

    const buyerList = await fixture.alphaClient.get("/buyer/enquiries", { headers: { accept: "text/html" } });
    assert(!buyerList.text.includes("price sensitive"), "the internal note leaked into the buyer's history");
    const buyerDetail = await fixture.alphaClient.get(`/buyer/enquiries/${fixture.portalEnquiryId}`, { headers: { accept: "text/html" } });
    assert(!buyerDetail.text.includes("price sensitive"), "the internal note leaked into the buyer's detail page");
    return "note visible to the desk, absent from both buyer screens";
  });

  await test("C5", "a status change is written to the audit trail", async () => {
    const response = await admin.post("/api/admin/enquiries", {
      body: { id: fixture.portalEnquiryId, status: "QUOTES_REQUESTED" },
      headers: { accept: "application/json" },
    });
    assert(response.status === 200, `status ${response.status}`);

    const stored = await db.collection("enquiries").findOne({ _id: fixture.portalEnquiryId });
    assert(stored.status === "QUOTES_REQUESTED", `stored status ${stored.status}`);

    const row = await db
      .collection("audit_logs")
      .findOne({ action: "enquiry.status_changed", entityId: fixture.portalEnquiryId }, { sort: { occurredAt: -1 } });
    assert(row, "no audit row for the status change");
    assert(row.beforeState?.status === "MATCHING_SUPPLIERS", `before is ${row.beforeState?.status}`);
    assert(row.afterState?.status === "QUOTES_REQUESTED", `after is ${row.afterState?.status}`);
    assert(row.actorUserId, "the audit row names no actor");
    assert(row.actorRole === "ADMIN", `actorRole is ${row.actorRole}`);
    return "QUOTES_REQUESTED recorded with before/after and the acting administrator";
  });

  await test("C6", "a buyer cannot reach the admin enquiry endpoints or desk pages", async () => {
    const post = await fixture.alphaClient.post("/api/admin/enquiries", {
      body: { id: fixture.portalEnquiryId, status: "WON" },
      headers: { accept: "application/json" },
    });
    assert(post.status === 403, `admin endpoint status ${post.status}`);

    const page = await fixture.alphaClient.get("/admin/enquiries", { headers: { accept: "text/html" } });
    assert(page.status === 307 || page.status === 302, `desk page status ${page.status}`);

    const stored = await db.collection("enquiries").findOne({ _id: fixture.portalEnquiryId });
    assert(stored.status !== "WON", "a buyer changed the status");
    return "403 on the endpoint, redirect on the page, nothing changed";
  });

  await test("C7", "an anonymous request cannot read or write the desk", async () => {
    const post = await (await import("../m1-verify-core.mjs")).createClient(ctx.baseUrl).post("/api/admin/enquiries", {
      body: { id: fixture.portalEnquiryId, status: "WON" },
      anonymous: true,
      headers: { accept: "application/json" },
    });
    assert(post.status === 401, `status ${post.status}`);
    return "401";
  });

  await test("C8", "an unknown enquiry id is refused rather than created", async () => {
    const response = await admin.post("/api/admin/enquiries", {
      body: { id: "99999999-9999-4999-8999-999999999999", status: "WON" },
      headers: { accept: "application/json" },
    });
    assert(response.status === 400, `status ${response.status}`);
    assert(/does not exist/i.test(response.json?.message ?? ""), `message: ${response.json?.message}`);
    return "400 with a readable message";
  });
}
