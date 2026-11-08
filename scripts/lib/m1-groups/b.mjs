/**
 * Group B — authentication behaviour, tested against the running application.
 *
 * Every test goes through HTTP: the route handler, the data layer, MongoDB and the cookie it sets. Where
 * a property is about what is *stored* (a password hash, a revoked session) the test reads the isolated
 * database directly rather than trusting the response.
 */

import { randomUUID } from "node:crypto";

const PASSWORD = "BuyerPass123";
const SELLER_PASSWORD = "SellerPass123";

let ipCounter = 0;
/** Each test gets its own address so one test's rate-limit window cannot fail another. */
function nextIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

export function registration(role, overrides = {}) {
  const base = {
    role,
    company: role === "BUYER" ? "Verification Buyer Pvt Ltd" : "Verification Supplier Pvt Ltd",
    contactName: role === "BUYER" ? "Buyer Verification" : "Seller Verification",
    email: `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@verify.primemet.test`,
    phone: "9876543210",
    city: "Pune",
    stateCode: "27",
    password: role === "BUYER" ? PASSWORD : SELLER_PASSWORD,
    passwordConfirm: role === "BUYER" ? PASSWORD : SELLER_PASSWORD,
  };
  return { ...base, ...overrides };
}

export async function register(ctx, role, overrides = {}, options = {}) {
  const body = registration(role, overrides);
  const response = await ctx.client.post("/api/auth/register", {
    body,
    ip: options.ip ?? nextIp(),
    useJar: options.useJar ?? true,
  });
  return { ...response, requestBody: body };
}

export async function login(ctx, email, password, options = {}) {
  return ctx.client.post("/api/auth/login", {
    body: { email, password },
    ip: options.ip ?? nextIp(),
    useJar: options.useJar ?? true,
    headers: options.headers,
  });
}

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, client } = ctx;
  const fixtures = {};

  await test("B1", "Buyer registration creates an active account and a session", async () => {
    client.clearCookies();
    const response = await register(ctx, "BUYER", { company: "B1 Buyer Pvt Ltd" });
    assert(response.status === 201, `expected 201, got ${response.status}: ${response.text.slice(0, 200)}`);
    assert(response.json?.ok === true, "response is not ok");
    assert(response.json?.role === "BUYER", `role is ${response.json?.role}`);
    assert(response.json?.pendingApproval === false, "buyer was marked pending approval");
    const cookie = response.cookie("pm_session");
    assert(cookie && cookie.value, "no session cookie was issued");

    fixtures.buyerEmail = response.requestBody.email;
    const user = await db.collection("users").findOne({ email: fixtures.buyerEmail });
    assert(user, "the buyer user row was not written");
    assert(user.role === "BUYER", `stored role is ${user.role}`);
    assert(user.status === "ACTIVE", `stored status is ${user.status}`);
    fixtures.buyerId = user._id;

    const me = await client.get("/api/auth/me", { useJar: true });
    assert(me.status === 200, `GET /api/auth/me returned ${me.status}`);
    assert(me.json?.user?.role === "BUYER", "me does not report the buyer role");
    assert(me.json?.user?.organisationId, "me has no organisation id");
    fixtures.buyerOrgId = me.json.user.organisationId;
    fixtures.buyerCookie = client.jar.get("pm_session");
    return `user ${user._id.slice(0, 8)}…, org ${me.json.user.organisationId.slice(0, 8)}…`;
  });

  await test("B2", "Seller registration creates an INVITED account without a session", async () => {
    client.clearCookies();
    const body = registration("SELLER", { company: "B2 Supplier Pvt Ltd", gstin: "27ABCDE1234F1Z5" });
    const response = await ctx.client.post("/api/auth/register", { body, ip: nextIp(), useJar: true });
    assert(response.status === 201, `expected 201, got ${response.status}: ${response.text.slice(0, 200)}`);
    assert(response.json?.pendingApproval === true, "seller was not marked pending approval");
    assert(!response.cookie("pm_session"), "a seller was signed in before approval");

    fixtures.sellerEmail = body.email;
    const user = await db.collection("users").findOne({ email: body.email });
    assert(user, "the seller user row was not written");
    assert(user.status === "INVITED", `stored status is ${user.status}`);
    fixtures.sellerId = user._id;

    const organisation = await db.collection("organisations").findOne({ orgType: "SELLER", legalName: body.company });
    const profile = await db.collection("supplier_profiles").findOne({ userId: user._id });
    assert(profile, "no supplier profile was written");
    assert(profile.verification === "PENDING", `GST verification is ${profile.verification}, expected PENDING`);
    assert(!organisation || organisation.accountStatus === "PENDING_APPROVAL", "seller organisation is not pending approval");

    const attempt = await login(ctx, body.email, SELLER_PASSWORD);
    assert(attempt.status === 403, `seller login before approval returned ${attempt.status}`);
    assert(!attempt.cookie("pm_session"), "a refused seller login still set a session");
    return "INVITED, GST PENDING, login refused with 403 inactive";
  });

  await test("B3", "Duplicate email is rejected with 409 and leaves one account", async () => {
    const before = (await db.collection("users").countDocuments({})).valueOf();
    const response = await register(ctx, "BUYER", { email: fixtures.buyerEmail });
    assert(response.status === 409, `expected 409, got ${response.status}: ${response.text.slice(0, 200)}`);
    assert(response.json?.code === "duplicate_email", `code is ${response.json?.code}`);
    const after = await db.collection("users").countDocuments({});
    assert(after === before, `user count changed from ${before} to ${after}`);
    const matches = await db.collection("users").countDocuments({ email: fixtures.buyerEmail });
    assert(matches === 1, `${matches} accounts share the email`);
    return "409 duplicate_email, one account";
  });

  await test("B4", "Invalid registration input is rejected with 400", async () => {
    const cases = [
      { label: "no role", body: { ...registration("BUYER"), role: undefined }, code: "role" },
      { label: "short password", body: { ...registration("BUYER"), password: "short", passwordConfirm: "short" }, code: "password" },
      { label: "mismatched passwords", body: { ...registration("BUYER"), passwordConfirm: "Different123" }, code: "passwordConfirm" },
      { label: "bad email", body: { ...registration("BUYER"), email: "not-an-email" }, code: "email" },
      { label: "missing company", body: { ...registration("BUYER"), company: "" }, code: "company" },
      { label: "bad gstin", body: { ...registration("BUYER"), gstin: "NOTAGSTIN" }, code: "gstin" },
    ];
    const results = [];
    for (const item of cases) {
      const response = await ctx.client.post("/api/auth/register", { body: item.body, ip: nextIp() });
      assert(response.status === 400, `${item.label} returned ${response.status}, expected 400`);
      assert(typeof response.json?.code === "string", `${item.label} has no error code`);
      results.push(`${item.label}:400/${response.json.code}`);
    }
    return results.join(", ");
  });

  await test("B5", "Login with the correct password issues a session", async () => {
    client.clearCookies();
    const response = await login(ctx, fixtures.buyerEmail, PASSWORD);
    assert(response.status === 200, `expected 200, got ${response.status}: ${response.text.slice(0, 200)}`);
    assert(response.json?.role === "BUYER", `role is ${response.json?.role}`);
    assert(response.json?.redirect === "/buyer/dashboard", `redirect is ${response.json?.redirect}`);
    const cookie = response.cookie("pm_session");
    assert(cookie?.value, "no session cookie");
    const me = await client.get("/api/auth/me", { useJar: true });
    assert(me.status === 200, `me returned ${me.status}`);
    assert(me.json?.user?.email === fixtures.buyerEmail, "me reports another account");
    return "200, cookie issued, /api/auth/me 200";
  });

  await test("B6", "Login with the wrong password fails generically and sets no cookie", async () => {
    const response = await login(ctx, fixtures.buyerEmail, "WrongPassword123");
    assert(response.status === 401, `expected 401, got ${response.status}`);
    assert(response.json?.code === "invalid_credentials", `code is ${response.json?.code}`);
    assert(!response.cookie("pm_session"), "a failed login set a cookie");
    assert(!/password/i.test(response.json?.message ?? "") || /incorrect/i.test(response.json?.message ?? ""), "message names the password");

    const unknown = await login(ctx, `nobody-${randomUUID().slice(0, 6)}@verify.primemet.test`, "WrongPassword123");
    assert(unknown.status === 401, `unknown account returned ${unknown.status}`);
    assert(unknown.json?.message === response.json?.message, "unknown account and wrong password answer differently");
    return "401 invalid_credentials, identical wording for unknown account";
  });

  await test("B7", "Logout revokes the session server-side and clears the cookie", async () => {
    client.clearCookies();
    const signIn = await login(ctx, fixtures.buyerEmail, PASSWORD);
    const cookieValue = signIn.cookie("pm_session")?.value;
    assert(cookieValue, "login did not set a cookie");

    const currentHash = ctx.sha256Hex(cookieValue.split(".")[1]);
    const before = await db.collection("sessions").find({ tokenHash: currentHash }).toArray();
    assert(before.length > 0, "no live session rows before logout");
    const tokenHashBefore = before.map((row) => row.tokenHash);

    const response = await client.post("/api/auth/logout", { useJar: true });
    assert(response.status === 200 || response.status === 303, `logout returned ${response.status}`);
    const cleared = response.cookie("pm_session");
    assert(cleared, "logout did not emit a cookie directive");
    assert(cleared.attributes["max-age"] === "0" || cleared.value === "", "logout did not clear the cookie");

    const revoked = await db.collection("sessions").find({ tokenHash: { $in: tokenHashBefore } }).toArray();
    assert(revoked.every((row) => row.revokedAt instanceof Date), "the session row was not marked revoked");
    assert(revoked.every((row) => row.revokedReason), "no revocation reason was recorded");

    const replay = await ctx.client.get("/api/auth/me", {
      headers: { cookie: `pm_session=${cookieValue}` },
    });
    assert(replay.status === 401, `replayed cookie returned ${replay.status}, expected 401`);
    return "cookie cleared, row revoked with reason, replay 401";
  });

  await test("B8", "Expired sessions are rejected (cookie expiry and database expiry)", async () => {
    const past = Date.now() - 60_000;
    // B8a — the cookie itself is expired.
    const expiredCookie = await ctx.signClaims({ tokenId: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""), role: "BUYER", expiresAt: past }, ctx.secret);
    const a = await ctx.client.get("/api/auth/me", { headers: { cookie: `pm_session=${expiredCookie}` } });
    assert(a.status === 401, `expired cookie returned ${a.status}`);

    // B8b — the cookie is live but the database row expired: server-side expiry must decide.
    const tokenId = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    await db.collection("sessions").insertOne({
      _id: randomUUID(),
      userId: fixtures.buyerId,
      tokenHash: ctx.sha256Hex(tokenId),
      roleAtIssue: "BUYER",
      ipHash: null,
      userAgentHash: null,
      createdAt: new Date(past - 1000),
      lastSeenAt: new Date(past - 1000),
      expiresAt: new Date(past),
      revokedAt: null,
      revokedReason: null,
    });
    const liveCookie = await ctx.signClaims({ tokenId, role: "BUYER", expiresAt: Date.now() + 3_600_000 }, ctx.secret);
    const b = await ctx.client.get("/api/auth/me", { headers: { cookie: `pm_session=${liveCookie}` } });
    assert(b.status === 401, `session with a past expiresAt returned ${b.status}`);
    return "401 for expired cookie and for expired session row";
  });

  await test("B9", "Tampered and forged session cookies are rejected", async () => {
    client.clearCookies();
    const signIn = await login(ctx, fixtures.buyerEmail, PASSWORD);
    const valid = signIn.cookie("pm_session")?.value;
    assert(valid, "no cookie from login");

    const parts = valid.split(".");
    const last = parts[4];
    const flipped = `${last.slice(0, -1)}${last.endsWith("A") ? "B" : "A"}`;
    const tampered = [...parts.slice(0, 4), flipped].join(".");
    const a = await ctx.client.get("/api/auth/me", { headers: { cookie: `pm_session=${tampered}` } });
    assert(a.status === 401, `tampered signature returned ${a.status}`);

    const created = parts.slice(0, 4).join(".");
    const unsigned = `${created}.${"a".repeat(last.length)}`;
    const b = await ctx.client.get("/api/auth/me", { headers: { cookie: `pm_session=${unsigned}` } });
    assert(b.status === 401, `unsigned payload returned ${b.status}`);

    const forged = await ctx.signClaims(
      { tokenId: parts[1], role: "ADMIN", expiresAt: Date.now() + 3_600_000 },
      "attacker-secret-000000000000000000000000000000",
    );
    const c = await ctx.client.get("/api/auth/me", { headers: { cookie: `pm_session=${forged}` } });
    assert(c.status === 401, `cookie signed with a foreign secret returned ${c.status}`);

    // A correctly signed cookie naming ADMIN for a buyer's token must fail on the database role check.
    const escalated = await ctx.signClaims({ tokenId: parts[1], role: "ADMIN", expiresAt: Date.now() + 3_600_000 }, ctx.secret);
    const d = await ctx.client.get("/api/auth/me", { headers: { cookie: `pm_session=${escalated}` } });
    assert(d.status === 401, `re-signed ADMIN claim for a buyer token returned ${d.status}`);
    return "tampered 401, unsigned 401, foreign secret 401, re-signed role 401";
  });

  await test("B10", "Passwords are stored as scrypt hashes and never returned", async () => {
    const user = await db.collection("users").findOne({ email: fixtures.buyerEmail });
    assert(user?.passwordHash, "no password hash stored");
    assert(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(user.passwordHash), `unexpected hash format: ${String(user.passwordHash).slice(0, 24)}…`);
    assert(!user.passwordHash.includes(PASSWORD), "the stored hash contains the password");

    const signIn = await login(ctx, fixtures.buyerEmail, PASSWORD);
    const bodies = [signIn.text];
    const me = await ctx.client.get("/api/auth/me", { useJar: true, headers: { cookie: `pm_session=${signIn.cookie("pm_session")?.value}` } });
    bodies.push(me.text);
    const fail = await login(ctx, fixtures.buyerEmail, "WrongPassword123");
    bodies.push(fail.text);
    for (const body of bodies) {
      assert(!body.includes("passwordHash"), "a response contains passwordHash");
      assert(!body.includes(PASSWORD), "a response contains the password");
    }
    const authEvent = await db.collection("auth_events").findOne({ emailAttempted: fixtures.buyerEmail, success: true });
    assert(authEvent, "no successful auth event was recorded");
    assert(!JSON.stringify(authEvent).includes(PASSWORD), "the auth event log contains the password");
    return "hash scrypt$32768$8$1$…, no password in responses or auth events";
  });

  await test("B11", "Public registration cannot create ADMIN or SUPER_ADMIN accounts", async () => {
    const before = await db.collection("users").countDocuments({ role: "ADMIN" });

    const asAdmin = await register(ctx, "BUYER", { role: "ADMIN" });
    assert(asAdmin.status === 400, `role=ADMIN returned ${asAdmin.status}`);
    assert(asAdmin.json?.code === "role", `code is ${asAdmin.json?.code}`);

    const asSuper = await register(ctx, "BUYER", { role: "SUPER_ADMIN" });
    assert(asSuper.status === 400, `role=SUPER_ADMIN returned ${asSuper.status}`);

    const mixedCase = await register(ctx, "BUYER", { role: "admin" });
    assert(mixedCase.status === 400, `role=admin returned ${mixedCase.status}`);

    const injected = await register(ctx, "SELLER", { status: "ACTIVE", isAdmin: true, roleHint: "ADMIN" });
    assert(injected.status === 201, `seller with injected fields returned ${injected.status}`);
    const seller = await db.collection("users").findOne({ email: injected.requestBody.email });
    assert(seller && seller.role === "SELLER", "injected payload changed the stored role");
    assert(seller.status === "INVITED", `injected status produced ${seller.status}, expected INVITED`);
    assert(!("isAdmin" in seller), "an unknown field was persisted");

    const after = await db.collection("users").countDocuments({ role: "ADMIN" });
    assert(after === before, `ADMIN accounts changed from ${before} to ${after}`);
    return "ADMIN/SUPER_ADMIN/admin rejected, injected fields ignored";
  });

  await test("B12", "Registration rate limit answers 429 after the window's allowance", async () => {
    const ip = "198.51.100.240";
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await register(ctx, "BUYER", {}, { ip });
      statuses.push(response.status);
      if (response.status === 429) {
        assert(response.json?.code === "rate_limited", `429 code is ${response.json?.code}`);
        break;
      }
    }
    assert(statuses.includes(429), `no 429 after: ${statuses.join(",")}`);
    assert(statuses.filter((status) => status === 201).length <= 5, `allowance exceeded: ${statuses.join(",")}`);
    return `statuses ${statuses.join(",")}`;
  });
}
