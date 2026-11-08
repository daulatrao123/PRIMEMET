/**
 * Group C — authorisation and isolation.
 *
 * Two layers are tested and both matter:
 *
 *   - **HTTP**: middleware and route guards decide before any page renders or any handler runs. A buyer
 *     must land on their own dashboard when they ask for an admin page, and an anonymous caller must be
 *     sent to the right sign-in screen.
 *   - **Data layer**: the ownership predicate inside each query. Middleware cannot protect a data
 *     function, so the function itself must confine a caller to their organisation. These tests call the
 *     real modules, not a copy of the rule.
 */

import { createClient } from "../m1-verify-core.mjs";
import { login, register } from "./b.mjs";

function expectRedirectTo(response, path, assert, label) {
  assert(response.status >= 300 && response.status < 400, `${label}: expected a redirect, got ${response.status}`);
  const location = response.location ? new URL(response.location, "http://127.0.0.1") : null;
  assert(location, `${label}: no Location header`);
  assert(location.pathname === path, `${label}: redirected to ${location.pathname}, expected ${path}`);
  return location;
}

function actorFrom(user, { organisationId = null, buyerProfileId = null, supplierProfileId = null } = {}) {
  return {
    id: user._id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    organisationId,
    organisationName: null,
    organisationStatus: "ACTIVE",
    buyerProfileId,
    supplierProfileId,
  };
}

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, baseUrl } = ctx;

  // ---- fixtures ---------------------------------------------------------------------------------
  const buyer = await register(ctx, "BUYER", { company: "C Buyer One Pvt Ltd" });
  const buyerCookie = buyer.cookie("pm_session")?.value;
  assert(buyer.status === 201 && buyerCookie, "buyer fixture could not be created");
  const buyerRow = await db.collection("users").findOne({ email: buyer.requestBody.email });
  const buyerProfile = await db.collection("buyer_profiles").findOne({ userId: buyerRow._id });
  const buyerActor = actorFrom(buyerRow, { organisationId: buyerProfile.organisationId, buyerProfileId: buyerProfile._id });

  const seller = await register(ctx, "SELLER", { company: "C Seller One Pvt Ltd" });
  const sellerRow = await db.collection("users").findOne({ email: seller.requestBody.email });
  const sellerProfile = await db.collection("supplier_profiles").findOne({ userId: sellerRow._id });
  // Approve the seller directly: the approval decision itself is verified in group F.
  await db.collection("users").updateOne({ _id: sellerRow._id }, { $set: { status: "ACTIVE" } });
  await db.collection("organisations").updateOne({ _id: sellerProfile.organisationId }, { $set: { accountStatus: "ACTIVE" } });
  const sellerLogin = await login(ctx, seller.requestBody.email, "SellerPass123");
  const sellerCookie = sellerLogin.cookie("pm_session")?.value;
  assert(sellerLogin.status === 200 && sellerCookie, `seller fixture could not sign in: ${sellerLogin.status}`);
  const sellerActor = actorFrom(sellerRow, {
    organisationId: sellerProfile.organisationId,
    supplierProfileId: sellerProfile._id,
  });

  const second = await register(ctx, "BUYER", { company: "C Buyer Two Pvt Ltd" });
  const secondRow = await db.collection("users").findOne({ email: second.requestBody.email });
  const secondProfile = await db.collection("buyer_profiles").findOne({ userId: secondRow._id });
  const secondActor = actorFrom(secondRow, { organisationId: secondProfile.organisationId, buyerProfileId: secondProfile._id });
  const secondOrgId = secondProfile.organisationId;

  const anonymous = createClient(baseUrl);
  const asBuyer = createClient(baseUrl);
  asBuyer.setCookie("pm_session", buyerCookie);
  const asSeller = createClient(baseUrl);
  asSeller.setCookie("pm_session", sellerCookie);

  await test("C1", "Anonymous API access answers 401, not a redirect", async () => {
    const response = await anonymous.get("/api/auth/me");
    assert(response.status === 401, `GET /api/auth/me returned ${response.status}`);
    assert(response.json?.authenticated === false, `body is ${response.text.slice(0, 120)}`);
    assert(!response.location, "an API answered with a redirect");
    return "401 JSON, no Location";
  });

  await test("C2", "Anonymous access to the admin area is refused", async () => {
    const response = await anonymous.get("/admin/audit-log");
    const location = expectRedirectTo(response, "/admin/login", assert, "admin/audit-log");
    assert(location.searchParams.get("next") === "/admin/audit-log", `next is ${location.searchParams.get("next")}`);
    return `307 → ${location.pathname}?next=/admin/audit-log`;
  });

  await test("C3", "Anonymous access to the buyer area is refused", async () => {
    const response = await anonymous.get("/buyer/enquiries");
    const location = expectRedirectTo(response, "/login", assert, "buyer/enquiries");
    assert(location.searchParams.get("next") === "/buyer/enquiries", "the destination is not preserved");
    return `307 → ${location.pathname}?next=/buyer/enquiries`;
  });

  await test("C4", "Anonymous access to the seller area is refused", async () => {
    const response = await anonymous.get("/seller/products");
    const location = expectRedirectTo(response, "/login", assert, "seller/products");
    assert(location.searchParams.get("next") === "/seller/products", "the destination is not preserved");
    return `307 → ${location.pathname}?next=/seller/products`;
  });

  await test("C5", "A buyer is confined to the buyer area, not the admin area", async () => {
    for (const pathname of ["/admin", "/admin/dashboard", "/admin/audit-log", "/admin/enquiries"]) {
      const response = await asBuyer.get(pathname);
      expectRedirectTo(response, "/buyer/dashboard", assert, pathname);
      assert(!response.text.includes("PRIMEMET admin"), `${pathname} leaked admin content`);
    }
    return "4 admin paths → /buyer/dashboard";
  });

  await test("C6", "A seller is confined to the seller area, not the admin area", async () => {
    expectRedirectTo(await asSeller.get("/admin/dashboard"), "/seller/dashboard", assert, "/admin/dashboard");
    expectRedirectTo(await asSeller.get("/admin/buyers"), "/seller/dashboard", assert, "/admin/buyers");
    return "admin paths → /seller/dashboard";
  });

  await test("C7", "A buyer cannot reach seller pages and vice versa", async () => {
    expectRedirectTo(await asBuyer.get("/seller/dashboard"), "/buyer/dashboard", assert, "buyer→seller");
    expectRedirectTo(await asSeller.get("/buyer/dashboard"), "/seller/dashboard", assert, "seller→buyer");
    return "cross-area requests redirect to the caller's own area";
  });

  await test("C8", "The role in a URL or payload cannot change the authorisation decision", async () => {
    for (const pathname of ["/admin/dashboard?role=ADMIN", "/admin/dashboard?as=ADMIN&role=ADMIN"]) {
      expectRedirectTo(await asBuyer.get(pathname), "/buyer/dashboard", assert, pathname);
    }
    const response = await ctx.client.post("/api/auth/login", {
      body: { email: buyer.requestBody.email, password: "BuyerPass123", role: "ADMIN" },
      ip: "198.51.100.61",
      useJar: false,
    });
    assert(response.status === 200, `login returned ${response.status}`);
    assert(response.json?.role === "BUYER", `login reported role ${response.json?.role}`);
    return "query substitution ignored; login role is re-derived as BUYER";
  });

  await test("C9", "No unguarded admin write endpoint is exposed for seller self-approval", async () => {
    const verificationBefore = (await db.collection("supplier_profiles").findOne({ _id: sellerProfile._id })).verification;
    const attempts = [
      "/api/admin/suppliers/approve",
      "/api/admin/listings/approve",
      "/api/admin/sellers/approve",
      "/api/admin/approve",
    ];
    for (const pathname of attempts) {
      const response = await asSeller.post(pathname, { body: { id: sellerProfile._id } });
      assert(response.status === 404 || response.status === 405, `${pathname} answered ${response.status}`);
    }
    const unchanged = await db.collection("supplier_profiles").findOne({ _id: sellerProfile._id });
    assert(unchanged.verification === verificationBefore, `a seller write changed verification from ${verificationBefore} to ${unchanged.verification}`);
    return "4 admin write paths → 404; seller profile unchanged";
  });

  await test("C10", "Buyer records are isolated: another buyer cannot read them", async () => {
    const created = await ctx.modules.enquiries.createEnquiry(buyerActor, {
      productId: ctx.fixture.productId,
      quantity: 5,
      unit: "MT",
      requirements: "C9 isolation fixture",
      contactName: "Buyer One",
      contactEmail: buyer.requestBody.email,
    });
    const mine = await ctx.modules.enquiries.getEnquiryForOrganisation(created.id, buyerActor.organisationId);
    assert(mine, "the owner cannot read their own enquiry");

    const foreign = await ctx.modules.enquiries.getEnquiryForOrganisation(created.id, secondOrgId);
    assert(foreign === null, "another organisation read the enquiry by id");

    const listed = await ctx.modules.enquiries.listEnquiriesForOrganisation(secondOrgId);
    assert(!listed.some((row) => row.id === created.id), "another organisation's list contains the enquiry");

    const own = await ctx.modules.enquiries.listEnquiriesForOrganisation(buyerActor.organisationId);
    assert(own.some((row) => row.id === created.id), "the owner's list is missing the enquiry");
    return "owner reads it; the other organisation gets null and an empty list";
  });

  await test("C11", "Organisation id substitution cannot change who owns a write", async () => {
    const created = await ctx.modules.enquiries.createEnquiry(buyerActor, {
      productId: ctx.fixture.productId,
      quantity: 1,
      unit: "MT",
      requirements: "C10 substitution attempt",
      contactName: "Buyer One",
      contactEmail: buyer.requestBody.email,
      buyerOrganisationId: secondOrgId,
      buyerUserId: secondRow._id,
      status: "CLOSED",
    });
    const stored = await db.collection("enquiries").findOne({ _id: created.id });
    assert(stored.buyerOrganisationId === buyerActor.organisationId, `stored organisation is ${stored.buyerOrganisationId}`);
    assert(stored.buyerUserId === buyerRow._id, "stored user id came from the payload");
    assert(stored.status === "NEW", `stored status is ${stored.status}, expected NEW`);
    return "organisation, user and status all come from the session, not the payload";
  });

  return {
    buyerActor,
    sellerActor,
    secondActor,
    buyerCookie,
    sellerCookie,
    sellerProfileId: sellerProfile._id,
  };
}