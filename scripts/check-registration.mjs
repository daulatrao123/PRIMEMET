#!/usr/bin/env node
/**
 * PRIMEMET — registration role guard regression suite.
 *
 *   node scripts/check-registration.mjs
 *   node scripts/check-registration.mjs --port 3265
 *
 * WHY THIS SUITE EXISTS. `RegistrationInput.role` is typed `"BUYER" | "SELLER"`, and a TypeScript union
 * is erased before the code runs. Before this suite there was nothing in the repository that proved a
 * caller could not reach `registerAccount()` from plain JavaScript and mint an ADMIN: the only thing
 * standing in the way was the `users.role` and `organisations.orgType` validators, which are a property
 * of the collection rather than of the application, and which happened to refuse ADMIN only because
 * `orgType` has no ADMIN member.
 *
 * These tests assert the application-level guard, twice over:
 *
 *   R1–R4  direct data-layer calls with a privileged or malformed role are refused
 *   R5     a refused call writes nothing at all — no user, no organisation, no orphan profile
 *   R6     the public HTTP path refuses the same roles, and refuses them before any write
 *   R7     buyer registration still works end to end and signs the buyer in
 *   R8     seller registration still works, lands INVITED, and cannot sign in
 *   R9     a duplicate address is still a conflict, not a second account
 *
 * R5 is the part a status-code test cannot see: a guard placed after the first insert would leave an
 * account behind while returning 400. Every refusal therefore re-reads all six collections.
 *
 * Requires a production build (`npm run build`) and the MongoDB memory binary used by the other
 * verification suites. Nothing touches a real database: the name is a throwaway `scratchDb` name.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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

const { values } = parseArgs({ options: { port: { type: "string", default: "3265" } } });

const stamp = `${Date.now()}_${randomUUID().slice(0, 6)}`;
const dbName = scratchDb("registration", stamp);
const port = Number(values.port);
const reporter = createReporter("R");

/** The collections a single registration writes to. Every refusal is checked against all of them. */
const COLLECTIONS = [
  "users",
  "organisations",
  "organisation_contacts",
  "buyer_profiles",
  "supplier_profiles",
  "organisation_addresses",
];

/**
 * A stand-in for a password hash that is not one.
 *
 * The data layer never verifies or inspects this value: it is stored as given. Using a word rather than
 * a well-formed `scrypt$…` string keeps this file free of anything that looks like a credential, so the
 * bootstrap check's credential scan stays meaningful instead of needing an exemption for this suite.
 */
const UNUSED_HASH = "unused-registration-fixture-not-a-hash";

/** Roles a caller must never be able to grant through registration, whatever it sends. */
const PRIVILEGED_ROLES = ["ADMIN", "SUPER_ADMIN", "PRIMEMET", "PARTNER", "admin", "Buyer", "BOTH", "OTHER"];

let mongo = null;
let server = null;
let exitCode = 0;

try {
  if (!existsSync(path.join(PROJECT_ROOT, ".next", "BUILD_ID"))) {
    throw new Error("no production build; run npm run build first");
  }

  mongo = await startMongo();
  const db = mongo.client.db(dbName);
  await migrate(db, { appliedBy: "registration-check" });

  process.env.MONGODB_URI = mongo.uri;
  process.env.MONGODB_DB = dbName;
  process.env.PRIMEMET_ENV = "test";
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
  process.env.NODE_ENV = "production";

  const accounts = await import("../src/lib/data/accounts.ts");

  log("");
  log("PRIMEMET registration role guard");
  log(`  database    ${dbName} (in-memory replica set)`);
  log(`  server      next start on 127.0.0.1:${port}`);
  log("");

  const counts = async () => {
    const out = {};
    for (const name of COLLECTIONS) out[name] = await db.collection(name).countDocuments();
    return out;
  };
  const empty = (current) => COLLECTIONS.every((name) => current[name] === 0);
  const describe = (current) =>
    COLLECTIONS.filter((name) => current[name] !== 0)
      .map((name) => `${name}=${current[name]}`)
      .join(", ");

  // ---- R1: the allowlist is the one the route and the tests both read -------------------------------
  await reporter.test("R1", "accounts.ts: REGISTRABLE_ROLES is exactly BUYER and SELLER", async ({ assert }) => {
    assert(Array.isArray(accounts.REGISTRABLE_ROLES), "REGISTRABLE_ROLES is not exported");
    assert(
      JSON.stringify([...accounts.REGISTRABLE_ROLES]) === JSON.stringify(["BUYER", "SELLER"]),
      `allowlist is ${JSON.stringify(accounts.REGISTRABLE_ROLES)}`,
    );
    return "BUYER, SELLER";
  });

  // ---- R2: direct data-layer calls, no server involved ---------------------------------------------
  const directBase = {
    company: "Regression Direct Pvt Ltd",
    contactName: "Direct Caller",
    email: `direct-${stamp}@verify.primemet.test`,
    passwordHash: UNUSED_HASH,
  };

  for (const role of PRIVILEGED_ROLES) {
    await reporter.test("R2", `accounts.ts: registerAccount refuses role ${role}`, async ({ assert }) => {
      let error = null;
      try {
        await accounts.registerAccount({ ...directBase, role });
      } catch (caught) {
        error = caught;
      }
      assert(error, `registerAccount accepted role ${role}`);
      assert(
        error.name === "RegistrationRoleError",
        `refused with ${error.name} — the database validator, not the application guard`,
      );
      const current = await counts();
      assert(empty(current), `a refused ${role} registration wrote records: ${describe(current)}`);
      return "RegistrationRoleError, 0 documents written";
    });
  }

  // ---- R3: a role that is not a string at all ------------------------------------------------------
  await reporter.test("R3", "accounts.ts: registerAccount refuses a missing or non-string role", async ({ assert }) => {
    for (const role of [undefined, null, "", 1, {}, ["BUYER"]]) {
      let error = null;
      try {
        await accounts.registerAccount({ ...directBase, role });
      } catch (caught) {
        error = caught;
      }
      assert(error, `registerAccount accepted role ${JSON.stringify(role)}`);
      assert(error.name === "RegistrationRoleError", `role ${JSON.stringify(role)} failed with ${error.name}`);
    }
    const current = await counts();
    assert(empty(current), `a malformed-role registration wrote records: ${describe(current)}`);
    return "6 malformed roles refused, 0 documents";
  });

  // ---- R4: the guard runs before the database is touched -------------------------------------------
  await reporter.test("R4", "accounts.ts: the guard is reached before getDb() hands out a handle", async ({ assert }) => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(path.join(PROJECT_ROOT, "src", "lib", "data", "accounts.ts"), "utf8"),
    );
    const body = source.slice(source.indexOf("export async function registerAccount"));
    const guard = body.indexOf("requireRegistrableRole(input.role)");
    // Anchored on the call: the function's comment explains that the guard sits ahead of `getDb()`, so
    // searching for the bare name would match the prose instead of the statement.
    const handle = body.indexOf("await getDb()");
    assert(guard !== -1, "registerAccount does not call requireRegistrableRole");
    assert(handle !== -1, "registerAccount no longer opens a database handle — the check is stale");
    assert(guard < handle, "the role guard runs after getDb(): a refusal would open a connection first");
    return "allowlist precedes getDb()";
  });

  server = await startServer({ port, uri: mongo.uri, dbName });

  // ---- R5: the public HTTP path refuses the same roles ---------------------------------------------
  const httpBody = {
    company: "Regression Http Pvt Ltd",
    contactName: "Http Caller",
    email: `http-${stamp}@verify.primemet.test`,
    password: "BuyerPass123",
    passwordConfirm: "BuyerPass123",
  };

  for (const role of ["ADMIN", "SUPER_ADMIN", "PRIMEMET", "SUPERUSER"]) {
    await reporter.test("R5", `POST /api/auth/register refuses role ${role}`, async ({ assert }) => {
      const probe = createClient(server.baseUrl);
      const response = await probe.post("/api/auth/register", { body: { ...httpBody, role }, useJar: true });
      assert(response.status === 400, `status is ${response.status}, expected 400`);
      assert(response.json?.ok === false, "the response did not report failure");
      assert(response.json?.code === "role", `code is ${response.json?.code}, expected role`);
      assert(
        !/ADMIN|SUPER_ADMIN|PRIMEMET|privileg/i.test(String(response.json?.message ?? "")),
        "the refusal names the privileged role back to the caller",
      );
      assert(probe.jar.size === 0, "a refused registration still issued a session cookie");
      const current = await counts();
      assert(empty(current), `a refused ${role} registration wrote records: ${describe(current)}`);
      return "400 role, no session, 0 documents";
    });
  }

  // ---- R6: buyer registration still works ----------------------------------------------------------
  let buyerEmail = null;
  await reporter.test("R6", "POST /api/auth/register creates an active buyer and signs them in", async ({ assert }) => {
    buyerEmail = `buyer-${stamp}@verify.primemet.test`;
    const buyer = createClient(server.baseUrl);
    const response = await buyer.post("/api/auth/register", {
      body: { ...httpBody, email: buyerEmail, role: "BUYER" },
      useJar: true,
    });
    assert(response.status === 201, `status is ${response.status}`);
    assert(response.json?.role === "BUYER", `role is ${response.json?.role}`);
    assert(response.json?.pendingApproval === false, "a buyer was reported as pending approval");
    assert(buyer.jar.size > 0, "no session cookie was issued to the buyer");

    const user = await db.collection("users").findOne({ email: buyerEmail });
    assert(user, "no user document was written");
    assert(user.role === "BUYER", `stored role is ${user.role}`);
    assert(user.status === "ACTIVE", `stored status is ${user.status}`);
    assert(user.passwordHash && user.passwordHash !== "BuyerPass123", "the password was stored in clear");

    const contact = await db.collection("organisation_contacts").findOne({ email: buyerEmail });
    assert(contact, "no contact document was written");
    const organisation = await db.collection("organisations").findOne({ _id: contact.organisationId });
    assert(organisation, "no buyer organisation was written");
    assert(organisation.accountStatus === "ACTIVE", `organisation status is ${organisation.accountStatus}`);
    assert(
      organisation.orgType === "BUYER" && organisation.orgKind === "BUYER",
      `organisation types are ${organisation.orgType}/${organisation.orgKind}`,
    );
    assert((await db.collection("buyer_profiles").countDocuments({ organisationId: organisation._id })) === 1, "no buyer profile");
    assert((await db.collection("supplier_profiles").countDocuments({})) === 0, "a supplier profile was written for a buyer");
    return "201, ACTIVE buyer, session issued, 5 documents";
  });

  // ---- R7: seller registration still works and is INVITED ------------------------------------------
  const sellerEmail = `seller-${stamp}@verify.primemet.test`;
  await reporter.test("R7", "POST /api/auth/register creates an INVITED seller who cannot sign in", async ({ assert }) => {
    const seller = createClient(server.baseUrl);
    const response = await seller.post("/api/auth/register", {
      body: { ...httpBody, email: sellerEmail, role: "SELLER", businessType: "TRADER" },
      useJar: true,
    });
    assert(response.status === 201, `status is ${response.status}`);
    assert(response.json?.pendingApproval === true, "a seller was reported as active");
    assert(seller.jar.size === 0, "a seller was signed in before approval");

    const user = await db.collection("users").findOne({ email: sellerEmail });
    assert(user.role === "SELLER", `stored role is ${user.role}`);
    assert(user.status === "INVITED", `stored status is ${user.status}`);

    const login = await createClient(server.baseUrl).post("/api/auth/login", {
      body: { email: sellerEmail, password: "BuyerPass123" },
    });
    assert(login.status >= 400, `an unapproved seller signed in with status ${login.status}`);
    return "201, INVITED, sign-in refused";
  });

  // ---- R8: duplicate address is a conflict, not a second account -----------------------------------
  await reporter.test("R8", "POST /api/auth/register refuses a duplicate address", async ({ assert }) => {
    const again = await createClient(server.baseUrl).post("/api/auth/register", {
      body: { ...httpBody, email: buyerEmail, role: "BUYER" },
    });
    assert(again.status === 409, `status is ${again.status}, expected 409`);
    assert((await db.collection("users").countDocuments({ email: buyerEmail })) === 1, "a second account was written");
    return "409, one account";
  });

  // ---- R9: exactly two accounts exist at the end ---------------------------------------------------
  await reporter.test("R9", "the database holds only the two accounts this suite registered", async ({ assert }) => {
    const current = await counts();
    assert(current.users === 2, `users=${current.users}`);
    assert(current.organisations === 2, `organisations=${current.organisations}`);
    assert(current.buyer_profiles === 1, `buyer_profiles=${current.buyer_profiles}`);
    assert(current.supplier_profiles === 1, `supplier_profiles=${current.supplier_profiles}`);
    assert(current.organisation_contacts === 2, `organisation_contacts=${current.organisation_contacts}`);
    return COLLECTIONS.map((name) => `${name}=${current[name]}`).join(", ");
  });

  const summary = reporter.summary();
  ensureRunDir();
  exitCode = summary.failed === 0 ? 0 : 1;
  if (exitCode !== 0) log(`  ${summary.failed} registration check(s) failed`);
} catch (error) {
  log(`\n  FAILED TO RUN: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  try {
    await server?.stop();
  } catch {
    /* ignore */
  }
  try {
    await mongo?.stop();
  } catch {
    /* ignore */
  }
}

process.exit(exitCode);