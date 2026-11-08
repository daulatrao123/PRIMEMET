/**
 * Group B — the buyer portal over HTTP, as a browser uses it.
 *
 * The sessions are real: each buyer signs in through `/api/auth/login` and carries the cookie the product
 * issued. Every page below is fetched as HTML and every write is the form the page renders.
 */

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, fixture } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  const client = createClient(ctx.baseUrl);
  const alpha = createClient(ctx.baseUrl);
  const beta = createClient(ctx.baseUrl);

  const signIn = async (jar, email, password) => {
    const response = await jar.post("/api/auth/login", { body: { email, password }, useJar: true, anonymous: true });
    assert(response.status === 200 || response.status === 303, `sign-in for ${email} returned ${response.status}`);
  };

  await test("B1", "both buyers sign in and reach their own dashboard", async () => {
    await signIn(alpha, fixture.buyerA.email, fixture.buyerA.password);
    await signIn(beta, fixture.buyerB.email, fixture.buyerB.password);

    const page = await alpha.get("/buyer/dashboard", { headers: { accept: "text/html" } });
    assert(page.status === 200, `dashboard status ${page.status}`);
    assert(page.text.includes("M3 Alpha Metals"), "the dashboard does not name the buyer's company");
    assert(!page.text.includes("M3 Beta Alloys"), "the dashboard names another company");
    return "200, own company only";
  });

  await test("B2", "an anonymous visitor is redirected away from the buyer portal", async () => {
    const page = await client.get("/buyer/dashboard", { anonymous: true });
    assert(page.status === 307 || page.status === 302, `status ${page.status}`);
    assert((page.location ?? "").includes("/login"), `location ${page.location}`);
    return `${page.status} → ${page.location}`;
  });

  await test("B3", "a seller cannot open a buyer page", async () => {
    const sellerEmail = `m3-seller-${fixture.productId.slice(0, 6)}@verify.primemet.test`;
    const registered = await ctx.modules.accounts.registerAccount({
      company: "M3 Seller Pvt Ltd",
      contactName: "Seller",
      email: sellerEmail,
      passwordHash: await ctx.modules.password.hashPassword("M3SellerPass123"),
      role: "SELLER",
    });
    await db.collection("users").updateOne({ _id: registered.userId }, { $set: { status: "ACTIVE" } });

    const seller = createClient(ctx.baseUrl);
    await signIn(seller, sellerEmail, "M3SellerPass123");
    const page = await seller.get("/buyer/dashboard", { headers: { accept: "text/html" } });
    assert(page.status === 307 || page.status === 302, `status ${page.status}`);
    assert(!(page.location ?? "").includes("/buyer"), `location ${page.location}`);
    return `redirected to ${page.location}`;
  });

  await test("B4", "the company profile page renders the stored values", async () => {
    const page = await alpha.get("/buyer/profile", { headers: { accept: "text/html" } });
    assert(page.status === 200, `status ${page.status}`);
    assert(page.text.includes("M3 Alpha Metals Ltd"), "the legal name is missing");
    assert(page.text.includes("Pune"), "the city is missing");
    assert(page.text.includes("Head of procurement"), "the job title is missing");
    return "legal name, city and job title all rendered";
  });

  await test("B5", "a profile save through the form persists and is audited", async () => {
    const response = await alpha.post("/api/buyer/profile", {
      body: {
        company: "M3 Alpha Metals Limited",
        city: "Mumbai",
        stateCode: "MH",
        website: "https://alpha.example.test",
        contactName: "Alpha Buyer",
        phone: "+91 90000 00002",
        jobTitle: "Procurement lead",
        department: "Procurement",
      },
      headers: { accept: "application/json" },
    });
    assert(response.status === 200, `status ${response.status}: ${response.text.slice(0, 200)}`);

    const organisation = await db.collection("organisations").findOne({ _id: fixture.buyerA.organisationId });
    assert(organisation.legalName === "M3 Alpha Metals Limited", "the legal name was not saved");
    assert(organisation.city === "Mumbai", "the city was not saved");
    assert(organisation.website === "https://alpha.example.test", "the website was not saved");

    const betaOrganisation = await db.collection("organisations").findOne({ _id: fixture.buyerB.organisationId });
    assert(betaOrganisation.legalName === "M3 Beta Alloys Pvt Ltd", "the other buyer's company changed");

    const audit = await db.collection("audit_logs").find({ action: "buyer.profile.updated" }).toArray();
    assert(audit.length >= 2, `${audit.length} audit rows`);
    return "saved, other buyer untouched, audit row written";
  });

  await test("B6", "a profile save cannot retarget another organisation", async () => {
    const response = await alpha.post("/api/buyer/profile", {
      body: {
        company: "Hijacked Ltd",
        organisationId: fixture.buyerB.organisationId,
        id: fixture.buyerB.organisationId,
      },
      headers: { accept: "application/json" },
    });
    assert(response.status === 200, `status ${response.status}`);
    const betaOrganisation = await db.collection("organisations").findOne({ _id: fixture.buyerB.organisationId });
    assert(betaOrganisation.legalName === "M3 Beta Alloys Pvt Ltd", "the payload retargeted the update");
    const alphaOrganisation = await db.collection("organisations").findOne({ _id: fixture.buyerA.organisationId });
    assert(alphaOrganisation.legalName === "Hijacked Ltd", "the update did not apply to the caller's own organisation");
    return "organisationId in the payload ignored; the caller's own record changed";
  });

  await test("B7", "a buyer raises an enquiry from the portal form", async () => {
    const page = await alpha.get("/buyer/enquiries/new", { headers: { accept: "text/html" } });
    assert(page.status === 200, `status ${page.status}`);
    assert(page.text.includes("M3 copper millberry"), "the published product is not offered");

    const response = await alpha.post("/api/enquiries", {
      body: {
        productId: fixture.productId,
        quantity: "1200",
        unit: "KG",
        requirements: "Portal-raised request: 1.2 tonnes of copper wire, delivery in three weeks.",
        deliveryLocation: "Mumbai, Maharashtra",
        contactName: "Alpha Buyer",
        contactEmail: fixture.buyerA.email,
        contactPhone: "+91 90000 00002",
      },
      headers: { accept: "application/json" },
    });
    assert(response.status === 201, `status ${response.status}: ${response.text.slice(0, 200)}`);
    assert(/^ENQ-\d{4}-\d{6}$/.test(response.json?.reference ?? ""), `reference ${response.json?.reference}`);

    const stored = await db.collection("enquiries").findOne({ reference: response.json.reference });
    assert(stored.buyerOrganisationId === fixture.buyerA.organisationId, "the enquiry is not owned by the buyer's organisation");
    ctx.fixture.portalEnquiryId = stored._id;
    ctx.fixture.portalEnquiryReference = stored.reference;
    return `enquiry ${stored.reference} owned by the buyer's organisation`;
  });

  await test("B8", "the enquiry appears in the buyer's history and detail page", async () => {
    const list = await alpha.get("/buyer/enquiries", { headers: { accept: "text/html" } });
    assert(list.status === 200, `status ${list.status}`);
    assert(list.text.includes(fixture.portalEnquiryReference), "the reference is missing from the history");
    assert(list.text.includes("M3 copper millberry"), "the product is missing from the history");

    const detail = await alpha.get(`/buyer/enquiries/${fixture.portalEnquiryId}`, { headers: { accept: "text/html" } });
    assert(detail.status === 200, `detail status ${detail.status}`);
    assert(detail.text.includes("Portal-raised request"), "the requirement text is missing");
    assert(detail.text.includes("Received"), "the status is missing");
    return "history and detail both render the enquiry";
  });

  await test("B9", "another buyer's enquiry id is a 404, not a leak", async () => {
    const response = await beta.get(`/buyer/enquiries/${fixture.portalEnquiryId}`, { headers: { accept: "text/html" } });
    assert(response.status === 404, `status ${response.status}`);
    assert(!response.text.includes("Portal-raised request"), "the other buyer's requirement leaked");
    return "404 with no content";
  });

  await test("B10", "the dashboard reflects the new enquiry", async () => {
    const page = await alpha.get("/buyer/dashboard", { headers: { accept: "text/html" } });
    assert(page.status === 200, `status ${page.status}`);
    assert(page.text.includes(fixture.portalEnquiryReference), "the latest enquiry is not on the dashboard");
    return "latest enquiry listed";
  });

  await test("B11", "a seller cannot post a buyer profile or an enquiry", async () => {
    const sellerEmail = `m3-seller2-${fixture.productId.slice(0, 6)}@verify.primemet.test`;
    const registered = await ctx.modules.accounts.registerAccount({
      company: "M3 Seller Two Pvt Ltd",
      contactName: "Seller Two",
      email: sellerEmail,
      passwordHash: await ctx.modules.password.hashPassword("M3SellerPass123"),
      role: "SELLER",
    });
    await db.collection("users").updateOne({ _id: registered.userId }, { $set: { status: "ACTIVE" } });
    const seller = createClient(ctx.baseUrl);
    await signIn(seller, sellerEmail, "M3SellerPass123");

    const profile = await seller.post("/api/buyer/profile", { body: { legalName: "Nope" }, headers: { accept: "application/json" } });
    assert(profile.status === 403, `profile status ${profile.status}`);
    const enquiry = await seller.post("/api/enquiries", {
      body: { productId: fixture.productId, quantity: "1", unit: "KG", requirements: "A seller must not raise a buyer enquiry here.", contactName: "S", contactEmail: sellerEmail },
      headers: { accept: "application/json" },
    });
    assert(enquiry.status === 403, `enquiry status ${enquiry.status}`);
    return "403 on both buyer endpoints";
  });

  await test("B12", "an anonymous visitor cannot post a profile or an enquiry", async () => {
    const profile = await client.post("/api/buyer/profile", { body: { legalName: "Anon" }, anonymous: true, headers: { accept: "application/json" } });
    assert(profile.status === 401, `profile status ${profile.status}`);
    const enquiry = await client.post("/api/enquiries", {
      body: { productId: fixture.productId, quantity: "1", unit: "KG", requirements: "Anonymous attempt that must be refused outright.", contactName: "A", contactEmail: "a@example.test" },
      anonymous: true,
      headers: { accept: "application/json" },
    });
    assert(enquiry.status === 401, `enquiry status ${enquiry.status}`);
    return "401 on both";
  });

  return { alphaClient: alpha, betaClient: beta };
}
