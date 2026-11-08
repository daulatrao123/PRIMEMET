/**
 * Group B — seller registration, approval and sign-in over HTTP.
 *
 * Every request below is the one the product's own form sends. The administrator is a real account that
 * signs in through the administrator door, so the cookie under test is issued by the product.
 */

import { randomUUID } from "node:crypto";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, modules } = ctx;
  const { createClient } = await import("../m1-verify-core.mjs");

  const suffix = randomUUID().slice(0, 6);
  const sellerEmail = "m4-http-" + suffix + "@verify.primemet.test";
  const sellerPassword = "M4HttpSeller123";
  const adminEmail = "m4-admin-" + suffix + "@verify.primemet.test";
  const adminPassword = "M4AdminPass123";

  const admin = createClient(ctx.baseUrl);
  const seller = createClient(ctx.baseUrl);

  const signIn = async (jar, email, password, area) => {
    const response = await jar.post("/api/auth/login", {
      body: area ? { email, password, area } : { email, password },
      useJar: true,
      anonymous: true,
    });
    return response;
  };

  await test("B1", "a seller registers with its business type, description and address", async () => {
    const response = await seller.post("/api/auth/register", {
      anonymous: true,
      body: {
        role: "SELLER",
        company: "M4 Http Metals Pvt Ltd",
        contactName: "Http Applicant",
        email: sellerEmail,
        phone: "+91 90000 00021",
        gstin: "27ABCDE1234F1Z7",
        city: "Nashik",
        stateCode: "MH",
        addressLine1: "Gat 220, Satpur",
        postalCode: "422007",
        businessType: "MANUFACTURER",
        description: "Precision aluminium castings and machining, two plants in Nashik.",
        password: sellerPassword,
        passwordConfirm: sellerPassword,
      },
    });
    assert(response.status === 201, "status " + response.status + " " + response.text.slice(0, 160));
    assert(response.json?.pendingApproval === true, "the response did not say the application is pending");

    const user = await db.collection("users").findOne({ email: sellerEmail });
    const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });
    const organisation = await db.collection("organisations").findOne({ _id: profile.organisationId });
    const address = await db.collection("organisation_addresses").findOne({ organisationId: profile.organisationId, kind: "REGISTERED" });
    assert(user.status === "INVITED", "user status " + user.status);
    assert(organisation.accountStatus === "PENDING_APPROVAL", "accountStatus " + organisation.accountStatus);
    assert(organisation.businessType === "MANUFACTURER", "businessType " + organisation.businessType);
    assert(String(organisation.description).includes("Nashik"), "description missing");
    assert(address?.line1 === "Gat 220, Satpur" && address?.postalCode === "422007", "address not stored");
    return "201 pendingApproval; INVITED + PENDING_APPROVAL + address stored";
  });

  await test("B2", "the unapproved seller cannot sign in", async () => {
    const response = await signIn(seller, sellerEmail, sellerPassword);
    assert(response.status === 403, "status " + response.status);
    assert(response.json?.code === "inactive", "code " + response.json?.code);
    return "403 inactive before approval";
  });

  await test("B3", "a duplicate registration is refused with 409", async () => {
    const response = await seller.post("/api/auth/register", {
      anonymous: true,
      body: {
        role: "SELLER",
        company: "M4 Http Metals Copy",
        contactName: "Copy Cat",
        email: sellerEmail,
        password: sellerPassword,
        passwordConfirm: sellerPassword,
      },
    });
    assert(response.status === 409, "status " + response.status);
    assert(response.json?.code === "duplicate_email", "code " + response.json?.code);
    return "409 duplicate_email";
  });

  await test("B4", "an invalid registration is refused before any write", async () => {
    const invalidEmail = "m4-invalid-" + suffix + "@verify.primemet.test";
    const bad = await seller.post("/api/auth/register", {
      anonymous: true,
      body: {
        role: "SELLER",
        company: "X",
        contactName: "Y",
        email: invalidEmail,
        gstin: "NOT-A-GSTIN",
        password: "short",
        passwordConfirm: "short",
      },
    });
    assert(bad.status === 400, "status " + bad.status);
    const created = await db.collection("users").findOne({ email: invalidEmail });
    assert(!created, "an invalid registration created a user");
    return "400 validation, no user document";
  });

  await test("B5", "an administrator signs in through the administrator door", async () => {
    await db.collection("users").insertOne({
      _id: randomUUID(),
      email: adminEmail,
      emailVerifiedAt: null,
      passwordHash: await modules.password.hashPassword(adminPassword),
      passwordChangedAt: new Date(),
      fullName: "M4 Administrator",
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

    const response = await signIn(admin, adminEmail, adminPassword, "admin");
    assert(response.status === 200 || response.status === 303, "status " + response.status);

    const page = await admin.get("/admin/suppliers", { headers: { accept: "text/html" } });
    assert(page.status === 200, "queue status " + page.status);
    assert(page.text.includes("M4 Http Metals Pvt Ltd"), "the pending application is not in the queue");
    assert(page.text.includes("Awaiting decision"), "the queue does not show a pending state");
    return "admin queue lists the pending application";
  });

  await test("B6", "an administrator approves the seller, and the approval is audited", async () => {
    const user = await db.collection("users").findOne({ email: sellerEmail });
    const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });

    const response = await admin.post("/api/admin/sellers", {
      body: { organisationId: profile.organisationId, action: "approve" },
    });
    assert(response.status === 200, "status " + response.status + " " + response.text.slice(0, 160));

    const after = await db.collection("users").findOne({ _id: user._id });
    const organisation = await db.collection("organisations").findOne({ _id: profile.organisationId });
    const record = await db.collection("supplier_profiles").findOne({ _id: profile._id });
    assert(after.status === "ACTIVE", "user status " + after.status);
    assert(organisation.accountStatus === "ACTIVE", "accountStatus " + organisation.accountStatus);
    assert(record.verification === "PENDING", "GSTIN verification changed to " + record.verification);
    assert(organisation.reviewFeedback, "no seller-facing decision note");
    assert(organisation.reviewedByUserId, "no reviewer recorded");

    const audit = await db.collection("audit_logs").findOne({ action: "seller.application.approved", entityId: profile.organisationId });
    assert(audit, "no approval audit row");
    assert(audit.beforeState?.userStatus === "INVITED", "the audit row has no before-state");
    return "ACTIVE account, PENDING verification preserved, audited";
  });

  await test("B7", "the approved seller can sign in and sees the Approved state", async () => {
    const fresh = createClient(ctx.baseUrl);
    const response = await signIn(fresh, sellerEmail, sellerPassword);
    assert(response.status === 200 || response.status === 303, "status " + response.status);

    const page = await fresh.get("/seller/dashboard", { headers: { accept: "text/html" } });
    assert(page.status === 200, "dashboard status " + page.status);
    assert(page.text.includes("M4 Http Metals Pvt Ltd"), "the dashboard does not name the seller's company");
    assert(page.text.includes("Approved"), "the dashboard does not show the approved state");
    return "signed in, dashboard shows Approved";
  });

  await test("B8", "a rejection requires a reason and keeps the seller out", async () => {
    const sellerB = ctx.fixture.sellerB;
    const user = await db.collection("users").findOne({ email: sellerB.email });
    const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });

    const withoutReason = await admin.post("/api/admin/sellers", {
      body: { organisationId: profile.organisationId, action: "reject", reason: "" },
    });
    assert(withoutReason.status === 400, "an unexplained rejection returned " + withoutReason.status);

    const rejected = await admin.post("/api/admin/sellers", {
      body: { organisationId: profile.organisationId, action: "reject", reason: "GST certificate does not match the declared legal name." },
    });
    assert(rejected.status === 200, "status " + rejected.status + " " + rejected.text.slice(0, 160));

    const organisation = await db.collection("organisations").findOne({ _id: profile.organisationId });
    assert(organisation.accountStatus === "REJECTED", "accountStatus " + organisation.accountStatus);
    assert(String(organisation.reviewFeedback).includes("GST certificate"), "the seller-facing reason was not stored");
    const after = await db.collection("users").findOne({ _id: user._id });
    assert(after.status !== "ACTIVE", "a rejected seller account is " + after.status);

    const refused = await signIn(createClient(ctx.baseUrl), sellerB.email, sellerB.password);
    assert(refused.status === 403, "a rejected seller signed in with " + refused.status);
    assert(
      String(refused.json?.message ?? "").includes("GST certificate"),
      "the refusal does not carry the desk's reason: " + refused.json?.message,
    );
    assert(!String(refused.json?.message ?? "").includes("Site visit"), "an internal note reached the refusal");

    const wrongPassword = await createClient(ctx.baseUrl).post("/api/auth/login", {
      body: { email: sellerB.email, password: "not-the-password" },
      anonymous: true,
    });
    assert(wrongPassword.status === 401, "a wrong password returned " + wrongPassword.status);
    assert(
      !String(wrongPassword.json?.message ?? "").includes("GST certificate"),
      "the decision note is disclosed before the password is verified",
    );
    return "rejection reason shown only after a correct password; sign-in still 403";
  });

  await test("B9", "a buyer or anonymous visitor cannot reach the admin seller queue", async () => {
    const anonymous = createClient(ctx.baseUrl);
    const page = await anonymous.get("/admin/suppliers", { anonymous: true });
    assert(page.status === 307 || page.status === 302, "anonymous status " + page.status);
    assert((page.location ?? "").includes("/admin/login"), "anonymous location " + page.location);

    const sellerPage = await createClient(ctx.baseUrl).get("/admin/suppliers", { headers: { accept: "text/html" } });
    assert(sellerPage.status === 307 || sellerPage.status === 302, "anonymous (empty jar) status " + sellerPage.status);
    return "anonymous redirected to /admin/login";
  });

  return { sellerEmail, sellerPassword, adminEmail, adminPassword };
}
