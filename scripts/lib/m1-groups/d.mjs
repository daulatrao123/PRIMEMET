/**
 * Group D — session and cookie security, observed on real responses.
 *
 * The harness runs the application with `NEXT_PUBLIC_APP_URL=https://primemet.test` and talks to it over
 * loopback. That is deliberate: the `Secure` attribute is a property of the deployment's configured
 * origin, and asserting it on a server that believes it is served over HTTPS is the honest test. The
 * client stores cookies itself, so it can still send them over loopback.
 */

import { readFileSync } from "node:fs";

import { register } from "./b.mjs";

export async function run(ctx, reporter) {
  const { test, assert } = reporter;
  const { db, client, baseUrl } = ctx;

  client.clearCookies();
  const account = await register(ctx, "BUYER", { company: "D Cookie Buyer Pvt Ltd" });
  assert(account.status === 201, `fixture registration returned ${account.status}`);
  const email = account.requestBody.email;
  const password = "BuyerPass123";

  let issued = null;
  let issuedRow = null;

  await test("D1", "The session cookie is HttpOnly, Secure and SameSite=Lax", async () => {
    client.clearCookies();
    const response = await ctx.client.post("/api/auth/login", {
      body: { email, password },
      ip: "198.51.100.71",
      useJar: true,
    });
    assert(response.status === 200, `login returned ${response.status}`);
    const cookie = response.cookie("pm_session");
    assert(cookie, "no session cookie");
    issued = cookie.value;
    assert("httponly" in cookie.attributes, `HttpOnly missing: ${cookie.raw}`);
    assert("secure" in cookie.attributes, `Secure missing: ${cookie.raw}`);
    assert(cookie.attributes.samesite?.toLowerCase() === "lax", `SameSite is ${cookie.attributes.samesite}`);

    const row = await db.collection("sessions").findOne({ tokenHash: ctx.sha256Hex(issued.split(".")[1]) });
    assert(row, "the cookie does not correspond to a session row");
    issuedRow = row;
    return cookie.raw.replace(/pm_session=[^;]+/, "pm_session=…");
  });

  await test("D2", "The cookie is scoped to /, expires with the session, and is not persistent beyond it", async () => {
    // Re-issue and read the attributes from the fresh response.
    const response = await ctx.client.post("/api/auth/login", {
      body: { email, password },
      ip: "198.51.100.72",
      useJar: false,
    });
    const fresh = response.cookie("pm_session");
    assert(fresh, "no cookie on re-login");
    assert(fresh.attributes.path === "/", `path is ${fresh.attributes.path}`);
    const expires = Date.parse(fresh.attributes.expires ?? "");
    assert(Number.isFinite(expires), `expires is ${fresh.attributes.expires}`);
    const ttl = expires - Date.now();
    assert(ttl > 6 * 24 * 3600_000 && ttl <= 7 * 24 * 3600_000 + 60_000, `ttl is ${Math.round(ttl / 3600_000)}h, expected ≈168h`);
    assert(!fresh.attributes["max-age"] || fresh.attributes["max-age"] === "0", "a Max-Age keeps the cookie after the session row expires");

    const row = await db.collection("sessions").findOne({ tokenHash: ctx.sha256Hex(fresh.value.split(".")[1]) });
    assert(row, "no session row for the fresh cookie");
    assert(Math.abs(new Date(row.expiresAt).getTime() - expires) < 2000, "the cookie and the session row expire at different times");
    assert(row.createdAt instanceof Date && row.expiresAt > row.createdAt, "the session row has no lifetime");
    return `path=/, expires in ${(ttl / 3600_000).toFixed(1)}h, row and cookie agree`;
  });

  await test("D3", "Only a hash of the session token is stored", async () => {
    assert(issuedRow, "no session row from D1");
    const tokenId = issued.split(".")[1];
    assert(issuedRow.tokenHash !== tokenId, "the raw token id is stored");
    assert(/^[0-9a-f]{64}$/.test(issuedRow.tokenHash), "the stored token hash is not SHA-256 hex");
    assert(!JSON.stringify(issuedRow).includes(tokenId), "the row contains the raw token id");
    assert(issuedRow.ipHash && issuedRow.ipHash !== "198.51.100.71", "the raw address is stored");
    return "tokenHash SHA-256 hex, raw token absent, address hashed";
  });

  await test("D4", "Each sign-in issues a new token and a new session row", async () => {
    const first = await ctx.client.post("/api/auth/login", { body: { email, password }, ip: "198.51.100.73", useJar: false });
    const second = await ctx.client.post("/api/auth/login", { body: { email, password }, ip: "198.51.100.74", useJar: false });
    assert(first.status === 200 && second.status === 200, `logins returned ${first.status}/${second.status}`);
    const a = first.cookie("pm_session")?.value;
    const b = second.cookie("pm_session")?.value;
    assert(a && b && a !== b, "the token was reused across sign-ins");
    const rows = await db.collection("sessions").find({ tokenHash: { $in: [ctx.sha256Hex(a.split(".")[1]), ctx.sha256Hex(b.split(".")[1])] } }).toArray();
    assert(rows.length === 2, `${rows.length} session rows for two sign-ins`);
    return "distinct tokens, one row each";
  });

  await test("D5", "Cookie-authenticated state changes refuse cross-site requests", async () => {
    const evil = { origin: "https://evil.example" };
    const loginCross = await ctx.client.post("/api/auth/login", { body: { email, password }, ip: "198.51.100.75", headers: evil, useJar: false });
    assert(loginCross.status === 403, `cross-site login returned ${loginCross.status}`);
    assert(loginCross.json?.code === "cross_site", `code is ${loginCross.json?.code}`);

    const registerCross = await ctx.client.post("/api/auth/register", {
      body: { ...account.requestBody, email: `cross-${Date.now()}@verify.primemet.test` },
      ip: "198.51.100.76",
      headers: evil,
      useJar: false,
    });
    assert(registerCross.status === 403, `cross-site registration returned ${registerCross.status}`);

    const logoutCross = await ctx.client.post("/api/auth/logout", { headers: evil, useJar: false });
    assert(logoutCross.status === 403, `cross-site logout returned ${logoutCross.status}`);

    // A same-origin origin header is accepted, so the rule is not "always refuse".
    const same = await ctx.client.post("/api/auth/login", {
      body: { email, password },
      ip: "198.51.100.77",
      headers: { origin: baseUrl },
      useJar: false,
    });
    assert(same.status === 200, `same-origin login returned ${same.status}`);
    return "cross-site login/register/logout 403 cross_site; same-origin accepted";
  });

  await test("D6", "No session token appears in a response or in the server log", async () => {
    client.clearCookies();
    const response = await ctx.client.post("/api/auth/login", { body: { email, password }, ip: "198.51.100.78", useJar: true });
    const token = response.cookie("pm_session")?.value;
    assert(token, "no cookie");
    const tokenId = token.split(".")[1];
    const bodies = [response.text];
    const me = await ctx.client.get("/api/auth/me", { useJar: true });
    bodies.push(me.text);
    const logout = await ctx.client.post("/api/auth/logout", { useJar: true });
    bodies.push(logout.text);
    for (const body of bodies) {
      assert(!body.includes(tokenId), "a response body contains the session token");
      assert(!body.includes(token), "a response body contains the cookie value");
    }
    const log = readFileSync(ctx.serverLogFile, "utf8");
    assert(!log.includes(tokenId), "the server log contains the session token");
    return "absent from 3 response bodies and the server log";
  });
}