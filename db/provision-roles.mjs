#!/usr/bin/env node
/**
 * PRIMEMET — repeatable role provisioning.
 *
 * Referenced from db/refs.mjs, db/roles.mjs and the migration plan; this file is that procedure.
 *
 * Two database roles carry the whole access model:
 *
 *   primemet_owner  initialization and structural change. Deployed NOWHERE. It exists only in the
 *                   GitHub Actions secret used by the one-time `db:init` workflow.
 *   primemet_app    the runtime identity. This is the only MongoDB user Vercel ever sees, and it
 *                   cannot create a collection, change a validator, write the ledger, or update or
 *                   delete any of the append-only history collections.
 *
 * Being a script rather than a paragraph of instructions matters: role definitions drift the same way
 * validators do, and "the operator remembers to grant the right thing" is not a control.
 *
 *   node db/provision-roles.mjs              print the plan (default; changes nothing)
 *   node db/provision-roles.mjs --apply      create/update the roles (needs OWNER credentials)
 *   node db/provision-roles.mjs --check      assert the connected identity is NOT the owner role
 *
 * `--apply` uses MONGODB_URI, so it must be run with owner credentials (locally, or by the workflow).
 * `--check` is meant to be run against the *application* connection string: it fails if the deployed
 * identity can provision roles, which is the one mistake this split exists to prevent.
 */

import { MongoClient } from "mongodb";
import { pathToFileURL } from "node:url";

import { buildRoleDefinitions, auditRoleDefinitions } from "./roles.mjs";
import { checkTarget } from "../scripts/db-guard.mjs";

const ROLE_CREATE_ERROR = 51002; // Location51002: role already exists

/** The full provisioning plan for one database. Pure data, so it can be asserted in tests. */
export function provisionPlan(dbName = "primemet") {
  const problems = auditRoleDefinitions();
  if (problems.length > 0) {
    throw new Error(`role definitions are unsound: ${problems.join("; ")}`);
  }

  const roles = buildRoleDefinitions().map((role) => ({
    name: role.role,
    description: role.description,
    privileges: role.privileges,
    roles: role.roles ?? [],
  }));

  return {
    database: dbName,
    roles,
    // Assignment is separate from definition on purpose: a role can exist without a human bound to it,
    // and the operator must name the user explicitly in Atlas → Database Access.
    assignments: [
      {
        role: "primemet_app",
        target: "the application user (Vercel)",
        note: "Grant this and nothing else. Do not grant primemet_owner to it.",
      },
      {
        role: "primemet_owner",
        target: "the initialization user (GitHub Actions secret only)",
        note: "Never configured in Vercel.",
      },
    ],
  };
}

/**
 * Create or update every role. Idempotent: `createRole` when absent, `updateRole` when present, so
 * running it twice converges instead of failing on the second run.
 */
export async function applyRoles(db, options = {}) {
  const { log = () => {} } = options;
  const plan = provisionPlan(db.databaseName);
  const applied = [];

  for (const role of plan.roles) {
    try {
      await db.command({
        createRole: role.name,
        privileges: role.privileges,
        roles: role.roles,
      });
      log(`  + created role ${role.name}`);
      applied.push({ role: role.name, action: "created" });
    } catch (error) {
      if (error && error.code === ROLE_CREATE_ERROR) {
        await db.command({
          updateRole: role.name,
          privileges: role.privileges,
          roles: role.roles,
        });
        log(`  ~ updated role ${role.name}`);
        applied.push({ role: role.name, action: "updated" });
      } else {
        throw error;
      }
    }
  }

  return applied;
}

/**
 * Assert the identity behind this connection is not allowed to provision or change structure.
 *
 * Run against the application's connection string before trusting a deployment.
 */
export async function checkRuntimeIdentity(db) {
  const status = await db.command({ connectionStatus: 1 });
  const roles = (status?.authInfo?.authenticatedUserRoles ?? []).map((r) => r.role);
  const privileged = roles.filter((r) => r === "primemet_owner" || r === "root" || r === "atlasAdmin");
  if (privileged.length > 0) {
    throw new Error(
      `the connected identity holds ${privileged.join(", ")} — this is an owner credential and must ` +
        "not be used by the application runtime",
    );
  }
  return { roles };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const check = argv.includes("--check");
  // Remediation P1.2/P1.5: the target no longer defaults to "primemet". `--db=` or `MONGODB_DB` must
  // name it, and `--apply` (which creates roles on a real cluster) also needs PRIMEMET_ENV.
  const dbFlag = (argv.find((a) => a.startsWith("--db=")) ?? "").split("=")[1];
  const target = checkTarget(
    { ...process.env, MONGODB_DB: dbFlag || process.env.MONGODB_DB },
    { requiresEnvironment: apply },
  );
  if (!target.ok) {
    console.error(`\n✖ ${target.reason}`);
    process.exit(1);
  }
  const dbName = target.target.database;

  if (!check) {
    const plan = provisionPlan(dbName);
    console.log("PRIMEMET — database role provisioning plan");
    console.log(`  database  ${plan.database}`);
    console.log("");
    for (const role of plan.roles) {
      console.log(`  ${role.name}`);
      console.log(`    ${role.description}`);
      for (const privilege of role.privileges) {
        console.log(`      ${(privilege.actions ?? []).join(", ")}  on  ${privilege.resource?.collection || "<database>"}`);
      }
    }
    console.log("");
    console.log("  Assignments (Atlas → Database Access):");
    for (const a of plan.assignments) console.log(`    ${a.role} → ${a.target} — ${a.note}`);
    console.log("");
  }

  if (!apply && !check) {
    console.log("Plan only: nothing was changed. Add --apply (owner credentials) to provision.");
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("✖ MONGODB_URI is not set. Nothing was changed.");
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  const db = client.db(dbName);

  try {
    await client.connect();
    if (check) {
      const { roles } = await checkRuntimeIdentity(db);
      console.log(`✔ the connected identity is not an owner role (roles: ${roles.join(", ") || "none"}).`);
      await client.close();
      process.exit(0);
    }

    console.log("Applying roles…");
    const applied = await applyRoles(db, { log: (m) => console.log(m) });
    console.log(`\n✔ ${applied.length} role(s) provisioned in "${dbName}".`);
    console.log("Next: bind users to these roles in Atlas → Database Access, then run `db:init`.");
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error(`\n✖ ${error && error.message ? error.message : error}`);
    try {
      await client.close();
    } catch {
      /* nothing useful to do */
    }
    process.exit(1);
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) await main();