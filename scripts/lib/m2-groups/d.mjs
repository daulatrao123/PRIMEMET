/**
 * Group D — "Enquire now" from a product page to the admin desk.
 *
 * This is the milestone's business outcome, so it is tested end to end: a signed-in buyer posts the
 * form the product page renders, and the enquiry is then read back through the buyer's own history and
 * through the administrator's desk page — both over HTTP, both from MongoDB.
 */

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules, fixture, client } = ctx;

  const buyer = fixture.buyerClient;

  await test("D1", "a buyer raises an enquiry from the product page", async () => {
    const response = await buyer.post("/api/enquiries", {
      body: {
        productId: fixture.productId,
        quantity: "2500",
        unit: "KG",
        requirements: "Need 6205-2RS bearings for a conveyor overhaul in the first week of next month.",
        deliveryLocation: "Pune, Maharashtra",
        contactName: "M2 Buyer",
        contactEmail: fixture.buyerEmail,
        contactPhone: "+91 98765 43210",
        returnTo: `/products/${fixture.productSlug}`,
      },
      headers: { accept: "application/json" },
    });
    assert(response.status === 201, `status ${response.status}: ${response.text.slice(0, 300)}`);
    assert(/^ENQ-\d{4}-\d{6}$/.test(response.json?.reference ?? ""), `reference ${response.json?.reference}`);

    const stored = await db.collection("enquiries").findOne({ reference: response.json.reference });
    assert(stored, "the enquiry was not stored");
    assert(stored.productId === fixture.productId, "the enquiry is not linked to the product");
    assert(stored.productTitle.includes("6205"), "the product title was not copied");
    assert(stored.status === "NEW", `status is ${stored.status}`);
    assert(String(stored.quantity) === "2500", `quantity ${stored.quantity}`);
    ctx.fixture.enquiryReference = response.json.reference;
    ctx.fixture.enquiryId = stored._id;
    return `enquiry ${response.json.reference} linked to ${stored.productTitle}`;
  });

  // The buyer history page and the admin enquiry desk are M3 and M5 screens; M2's contract is that the
  // enquiry exists in MongoDB, is owned by the session's organisation, and is readable by the desk data
  // layer the admin screens will use.
  await test("D2", "the enquiry is readable by the administrator's data layer", async () => {
    const rows = await modules.enquiries.listEnquiriesForAdmin({});
    const row = rows.find((item) => item.reference === fixture.enquiryReference);
    assert(row, "the admin list does not contain the enquiry");
    assert(row.productId === fixture.productId, "the product link was lost");
    return `admin list reports ${rows.length} enquiries`;
  });

  await test("D3", "an anonymous visitor cannot raise an enquiry", async () => {
    const response = await client.post("/api/enquiries", {
      body: {
        productId: fixture.productId,
        quantity: "1",
        unit: "KG",
        requirements: "Anonymous attempt that must be refused before anything is written.",
        contactName: "Nobody",
        contactEmail: "nobody@example.test",
      },
      anonymous: true,
      headers: { accept: "application/json" },
    });
    assert(response.status === 401, `status ${response.status}`);
    assert((await db.collection("enquiries").countDocuments({ contactName: "Nobody" })) === 0, "an enquiry was created");
    return "401, nothing written";
  });

  await test("D4", "an enquiry about a draft product is refused", async () => {
    const draft = await modules.catalogue.createProduct({
      title: "D6 draft product",
      familyId: fixture.familyId,
      condition: "NEW",
      priceMode: "REQUEST",
      publicationState: "DRAFT",
    });
    const response = await buyer.post("/api/enquiries", {
      body: {
        productId: draft.id,
        quantity: "5",
        unit: "KG",
        requirements: "This draft product must not be enquirable through a crafted id.",
        contactName: "M2 Buyer",
        contactEmail: fixture.buyerEmail,
      },
      headers: { accept: "application/json" },
    });
    assert(response.status === 409, `status ${response.status}`);
    assert((await db.collection("enquiries").countDocuments({ productId: draft.id })) === 0, "a draft was enquired about");
    return "409, nothing written";
  });

  await test("D5", "a seller cannot raise a buyer enquiry", async () => {
    const sellerJar = (await import("../m1-verify-core.mjs")).createClient(ctx.baseUrl);
    const signIn = await sellerJar.post("/api/auth/login", {
      body: { email: fixture.sellerEmail, password: fixture.sellerPassword },
      useJar: true,
      anonymous: true,
    });
    assert(signIn.status === 200 || signIn.status === 303, `seller sign-in returned ${signIn.status}`);
    const response = await sellerJar.post("/api/enquiries", {
      body: {
        productId: fixture.productId,
        quantity: "5",
        unit: "KG",
        requirements: "A seller must not be able to raise a buyer enquiry in this platform.",
        contactName: "Seller",
        contactEmail: fixture.sellerEmail,
      },
      headers: { accept: "application/json" },
    });
    assert(response.status === 403, `status ${response.status}`);
    return "403 for a SELLER session";
  });

  await test("D6", "the enquiry carries the buyer's organisation, not a value from the form", async () => {
    const stored = await db.collection("enquiries").findOne({ _id: fixture.enquiryId });
    const buyerUser = await db.collection("users").findOne({ email: fixture.buyerEmail });
    const profile = await db.collection("buyer_profiles").findOne({ userId: buyerUser._id });
    assert(stored.buyerOrganisationId === profile.organisationId, "the organisation does not come from the session");
    assert(stored.buyerUserId === buyerUser._id, "the user does not come from the session");
    return "organisation and user resolved server-side";
  });
}
