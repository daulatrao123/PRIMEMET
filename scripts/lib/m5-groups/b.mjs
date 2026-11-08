/**
 * Group B — administrator access over HTTP: the admin door, the guarded area, the registers, a seller
 * decision and a suspension.
 *
 * The administrator is a real account that signs in through the administrator door, so the cookie under
 * test is issued by the product. The buyer and seller sessions are real too: a refusal is only meaningful
 * when the caller could otherwise do the thing.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules, fixture } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  const admin = createClient(ctx.baseUrl);
  const buyer = createClient(ctx.baseUrl);
  const anonymous = createClient(ctx.baseUrl);

  const signIn = async (jar, email, password, area, ip) => {
    const body = area ? { email, password, area } : { email, password };
    return jar.post("/api/auth/login", { body, useJar: true, anonymous: true, ip });
  };

  const signInFixtureBuyer = async () => {
    const response = await signIn(buyer, fixture.buyerA.email, fixture.buyerA.password, undefined, "198.51.100.21");
    assert([200, 303].includes(response.status), `buyer sign-in ${response.status} ${response.text.slice(0, 120)}`);
  };

  await test("B1", "the admin area is closed to anonymous visitors and to a buyer", async () => {
    const anon = await anonymous.get("/admin/dashboard", { headers: { accept: "text/html" } });
    assert([302, 303, 307].includes(anon.status), `anonymous status ${anon.status}`);
    assert((anon.location ?? "").includes("/admin/login"), `anonymous redirected to ${anon.location}`);

    await signInFixtureBuyer();
    const refused = await buyer.get("/admin/dashboard", { headers: { accept: "text/html" } });
    assert([302, 303, 307].includes(refused.status), `buyer status ${refused.status}`);
    assert((refused.location ?? "").includes("/buyer/"), `buyer redirected to ${refused.location}`);

    const response = await signIn(admin, fixture.adminActor.email, fixture.adminPassword, "admin", "198.51.100.22");
    assert([200, 303].includes(response.status), `admin sign-in ${response.status}`);
    const page = await admin.get("/admin/dashboard", { headers: { accept: "text/html" } });
    assert(page.status === 200, `admin dashboard ${page.status}`);
    assert(page.text.includes("Control centre"), "the dashboard did not render");
    return "anonymous 307 to /admin/login, buyer 307 to /buyer, admin 200";
  });

  await test("B2", "the dashboard shows the figures MongoDB holds", async () => {
    const page = await admin.get("/admin/dashboard", { headers: { accept: "text/html" } });
    assert(page.status === 200, `status ${page.status}`);
    const overview = await modules.adminConsole.adminOverview();
    assert(page.text.includes("Control centre"), "no title");
    for (const label of ["Buyers", "Sellers", "Products", "Enquiries", "Pending listings"]) {
      assert(page.text.includes(label), `the overview has no ${label} tile`);
    }
    assert(page.text.includes(fixture.buyerA.organisation.legalName), "the buyer registration is not in recent activity");
    assert(page.text.includes(fixture.sellerPending.organisation.legalName), "the pending seller is not in recent activity");
    assert(page.text.includes(fixture.enquiryNew.reference), "the newest enquiry is not in recent activity");
    assert(page.text.includes(String(overview.buyers)), "the buyer count is not on the page");
    return `dashboard 200, ${overview.buyers} buyers / ${overview.sellers} sellers shown`;
  });

  await test("B3", "the buyer register searches, filters and pages over HTTP", async () => {
    const all = await admin.get("/admin/buyers", { headers: { accept: "text/html" } });
    assert(all.status === 200, `status ${all.status}`);
    assert(all.text.includes(fixture.buyerA.organisation.legalName), "buyer A missing from the register");
    assert(all.text.includes(fixture.buyerB.organisation.legalName), "buyer B missing from the register");
    assert(!all.text.includes(fixture.sellerApproved.organisation.legalName), "a seller appears in the buyer register");

    const searched = await admin.get("/admin/buyers?q=Alpha", { headers: { accept: "text/html" } });
    assert(searched.text.includes(fixture.buyerA.organisation.legalName), "search dropped the matching buyer");
    assert(!searched.text.includes(fixture.buyerB.organisation.legalName), "search did not narrow the register");

    const second = await admin.get("/admin/buyers?page=2", { headers: { accept: "text/html" } });
    assert(second.status === 200, `page 2 status ${second.status}`);

    const suspended = await admin.get("/admin/buyers?status=SUSPENDED", { headers: { accept: "text/html" } });
    assert(suspended.text.includes("No buyer organisation matches"), "the suspended filter did not show an empty state");
    return "all, search, page 2 and an empty status filter all render";
  });

  await test("B4", "the buyer detail page shows the company and its enquiry history", async () => {
    const page = await admin.get(`/admin/buyers/${fixture.buyerA.organisation._id}`, { headers: { accept: "text/html" } });
    assert(page.status === 200, `status ${page.status}`);
    assert(page.text.includes(fixture.buyerA.organisation.legalName), "the company name is missing");
    assert(page.text.includes(fixture.enquiryNew.reference), "the enquiry history is missing");
    assert(page.text.includes("Enquiry history"), "no enquiry history panel");
    assert(page.text.includes("GSTIN"), "the company record has no GSTIN row");

    const refused = await buyer.get(`/admin/buyers/${fixture.buyerA.organisation._id}`, { headers: { accept: "text/html" } });
    assert([302, 303, 307].includes(refused.status), `buyer status ${refused.status}`);
    return "200 with history for the admin; buyer redirected";
  });

  await test("B5", "an administrator approves a seller and rejects another, each decision audited", async () => {
    const approve = await admin.post("/api/admin/sellers", {
      body: { organisationId: fixture.sellerPending.organisation._id, action: "approve" },
    });
    assert([200, 303].includes(approve.status), `approve ${approve.status} ${approve.text.slice(0, 160)}`);
    const approvedOrg = await db.collection("organisations").findOne({ _id: fixture.sellerPending.organisation._id });
    const approvedUser = await db.collection("users").findOne({ _id: fixture.sellerPending.user._id });
    assert(approvedOrg.accountStatus === "ACTIVE" && approvedUser.status === "ACTIVE", "approval did not activate both records");
    assert(approvedOrg.reviewedByUserId === fixture.adminActor.id, "the reviewer is not recorded");

    const suffix = randomUUID().slice(0, 6);
    const rejectEmail = `m5-reject-${suffix}@verify.primemet.test`;
    const password = "M5RejectPass123";
    const registered = await modules.accounts.registerAccount({
      company: "M5 Rejected Metals Pvt Ltd",
      contactName: "Rejected Applicant",
      email: rejectEmail,
      gstin: "27ABCDE1234F1Z9",
      city: "Pune",
      stateCode: "MH",
      passwordHash: await modules.password.hashPassword(password),
      role: "SELLER",
    });
    const rejectOrg = await db.collection("organisations").findOne({ _id: registered.organisationId });

    const refusedShort = await admin.post("/api/admin/sellers", {
      body: { organisationId: registered.organisationId, action: "reject", reason: "no" },
    });
    assert(refusedShort.status === 400, `a short rejection reason returned ${refusedShort.status}`);

    const reject = await admin.post("/api/admin/sellers", {
      body: { organisationId: registered.organisationId, action: "reject", reason: "GST certificate does not match the declared legal name." },
    });
    assert([200, 303].includes(reject.status), `reject ${reject.status} ${reject.text.slice(0, 160)}`);
    const rejected = await db.collection("organisations").findOne({ _id: registered.organisationId });
    assert(rejected.accountStatus === "REJECTED", `accountStatus ${rejected.accountStatus}`);
    assert(rejected.reviewFeedback.includes("GST certificate"), "the seller-facing reason was not stored");

    const audit = await db.collection("audit_logs").findOne({ action: "seller.application.rejected", entityId: rejectOrg._id });
    assert(audit, "no rejection audit row");
    return "approve and reject over HTTP, both audited, short reason refused";
  });

  await test("B6", "suspension and reactivation work through the form endpoint, and only for an admin", async () => {
    const suspend = await admin.post("/api/admin/accounts", {
      body: {
        organisationId: fixture.buyerB.organisation._id,
        action: "suspend",
        reason: "Unpaid invoices under review",
        returnTo: "/admin/buyers",
      },
    });
    assert(allowed(suspend.status), `suspend ${suspend.status} ${suspend.text.slice(0, 160)}`);
    const suspended = await db.collection("organisations").findOne({ _id: fixture.buyerB.organisation._id });
    assert(suspended.accountStatus === "SUSPENDED", `accountStatus ${suspended.accountStatus}`);

    const forbidden = await buyer.post("/api/admin/accounts", {
      body: { organisationId: fixture.buyerA.organisation._id, action: "suspend", reason: "A buyer tried this" },
    });
    assert(forbidden.status === 403, `buyer endpoint returned ${forbidden.status}`);
    const untouched = await db.collection("organisations").findOne({ _id: fixture.buyerA.organisation._id });
    assert(untouched.accountStatus === "ACTIVE", "a buyer suspended an account");

    const anon = await anonymous.post("/api/admin/accounts", {
      body: { organisationId: fixture.buyerA.organisation._id, action: "suspend", reason: "Anonymous attempt" },
    });
    assert(anon.status === 401, `anonymous endpoint returned ${anon.status}`);

    const reactivate = await admin.post("/api/admin/accounts", {
      body: { organisationId: fixture.buyerB.organisation._id, action: "reactivate", returnTo: "/admin/buyers" },
    });
    assert(allowed(reactivate.status), `reactivate ${reactivate.status}`);
    const restored = await db.collection("organisations").findOne({ _id: fixture.buyerB.organisation._id });
    assert(restored.accountStatus === "ACTIVE", "reactivation did not restore ACTIVE");
    return "suspend 303, buyer 403, anonymous 401, reactivate 303";
  });

  return { adminSignedIn: true };
}

function allowed(status) {
  return [200, 303].includes(status);
}
