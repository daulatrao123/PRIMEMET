/**
 * PRIMEMET — least-privilege role definitions for MongoDB.
 *
 * MongoDB has no `BEFORE UPDATE OR DELETE` trigger, which is what PostgreSQL used to make the
 * verification and audit history append-only (D-2). The replacement is privilege separation: the
 * application's database user is granted `find` and `insert` on the append-only collections and no
 * `update` or `delete` at all. A bug, or a compromised app, then cannot rewrite history — the server
 * refuses.
 *
 * These definitions are DATA. They are applied by `db/provision-roles.mjs`, which an administrator runs
 * with cluster (owner) credentials — an owner action (see the manual steps in the migration plan).
 * Nothing in this repository provisions a database user by itself.
 *
 * TWO roles matter:
 *
 *   primemet_owner  initialization and structural change. Lives in the GitHub Actions secret only.
 *   primemet_app    the runtime identity. What Vercel uses, and nothing else.
 *
 * The owner credentials must never be the ones deployed to the application: the whole point of the
 * split is that the process serving requests cannot create a collection, change a validator or write
 * the migration ledger.
 *
 * WHY THE PRIVILEGES ARE SPELLED OUT COLLECTION BY COLLECTION (Task A, 2026-11-01)
 *
 * MongoDB is default-deny and privileges are ADDITIVE, so the effective privilege set for a collection
 * is the union of every grant whose resource matches it — including the database-wide grant that names
 * no collection. The previous definitions gave `primemet_owner` a database-wide `update`, which is
 * perfectly legal MongoDB but silently applied to all seven append-only collections. The audit could
 * not see it because it skipped wildcard grants before testing the append-only rule, so the suite
 * reported a clean result while every history collection was writable by the owner identity.
 *
 * The definitions below therefore grant `update` only on the mutable collections, by name, and the
 * audit expands every wildcard into effective per-collection privileges before judging. See
 * `audit.mjs` in this directory for the expansion, and `auditRoleDefinitions()` at the bottom of this
 * file for the rules.
 */

import { COLLECTIONS, IMMUTABLE_COLLECTIONS } from "./collections/index.mjs";
import { GUARDS, PLATFORM_IDENTITY_COLLECTION } from "./guards.mjs";

/** Collections the application may modify. */
export const MUTABLE_COLLECTIONS = COLLECTIONS.map((c) => c.name)
  .filter((n) => !IMMUTABLE_COLLECTIONS.includes(n))
  .sort();

/** The ledger is written only by the migration role, never by the request path. */
const LEDGER = "_schema_migrations";

/**
 * Action classes. Grouping them means the audit reasons about *what an action does* rather than
 * matching literal strings, and a new action cannot be introduced without being classified — an
 * unclassified action is itself an audit failure (fail closed, not "unknown means harmless").
 */
export const READ_ACTIONS = ["find", "listCollections", "listIndexes"];
export const APPEND_ACTIONS = ["insert"];
/** Rewrites an existing document. This is the action that can destroy history. */
export const MUTATE_ACTIONS = ["update"];
export const STRUCTURAL_ACTIONS = ["createCollection", "collMod", "createIndex"];
/**
 * Irreversible in the sense that matters here: they remove data or structure outright. No PRIMEMET
 * role holds any of these. `delete` is included deliberately — records are retired with `deletedAt`
 * (soft delete), so no identity needs the ability to remove a document.
 */
export const DESTRUCTIVE_ACTIONS = [
  "delete",
  "dropCollection",
  "dropIndex",
  "dropDatabase",
  "renameCollection",
  "convertToCapped",
];

export const KNOWN_ACTIONS = Object.freeze([
  ...READ_ACTIONS,
  ...APPEND_ACTIONS,
  ...MUTATE_ACTIONS,
  ...STRUCTURAL_ACTIONS,
  ...DESTRUCTIVE_ACTIONS,
]);

/** Roles expected to append to history. A read-only identity is exempt by design. */
export const HISTORY_WRITING_ROLES = Object.freeze(["primemet_app", "primemet_owner"]);

/** Actions that rewrite or remove stored documents. Forbidden on append-only history. */
export const HISTORY_WRITE_ACTIONS = Object.freeze([...MUTATE_ACTIONS, "delete"]);

export function buildRoleDefinitions() {
  return [
    {
      role: "primemet_app",
      description:
        "Runtime role for the Next.js application. Read/write on business collections; insert+find " +
        "only on append-only history; no access to the migration ledger beyond reading it.",
      privileges: [
        { resource: { db: "", collection: "" }, actions: ["find"] },
        // Business collections: read, append and amend — never remove. Retirement is soft (`deletedAt`).
        ...MUTABLE_COLLECTIONS.map((collection) => ({
          resource: { db: "", collection },
          actions: ["find", "insert", "update"],
        })),
        ...IMMUTABLE_COLLECTIONS.map((collection) => ({
          resource: { db: "", collection },
          actions: ["find", "insert"],
        })),
        { resource: { db: "", collection: LEDGER }, actions: ["find"] },
        // The continuity guard (C3). `update` is what increments the fence, so without it every
        // guarded access change would deadlock on a permission error instead of serialising. `insert`
        // is deliberately withheld: the guard document is seeded by migration v003, and an identity
        // that could conjure one could also replace the rendezvous point with a document nobody else
        // touches. Missing document → GUARD_UNAVAILABLE → the change is refused, not waved through.
        { resource: { db: "", collection: GUARDS }, actions: ["find", "update"] },
        // W2.2/W2.6: the platform identity pointer is NOT here, and that is the whole fix. The
        // `update` above is what increments the fence, and MongoDB has no per-document privilege, so
        // a pointer stored in this collection was writable by the same grant. It now lives in
        // `_platform_identity`, where this identity holds only the database-wide `find` — re-pointing
        // it is refused by the server. `auditRoleDefinitions` rule 7 keeps it that way.
      ],
      roles: [],
    },
    {
      role: "primemet_owner",
      description:
        "Initialization and structural-change role. May create collections, modify validators and create " +
        "indexes, and write the migration ledger. Lives in the GitHub secret only — never in Vercel.",
      privileges: [
        // Reads and appends database-wide; structure database-wide because a migration may create or
        // run `collMod` on a collection that does not exist yet. `update` is NOT here: a wildcard
        // update is what made every append-only collection writable (Task A).
        {
          resource: { db: "", collection: "" },
          actions: [
            "find",
            "insert",
            "createCollection",
            "collMod",
            "createIndex",
            "listCollections",
            "listIndexes",
          ],
        },
        // Amendment, by name, on the business collections only.
        ...MUTABLE_COLLECTIONS.map((collection) => ({
          resource: { db: "", collection },
          actions: ["find", "insert", "update"],
        })),
        { resource: { db: "", collection: LEDGER }, actions: ["find", "insert", "update"] },
        { resource: { db: "", collection: GUARDS }, actions: ["find", "insert", "update"] },
        // W2.2: the owner seeds and re-anchors the protected pointer. The runtime identity cannot.
        { resource: { db: "", collection: PLATFORM_IDENTITY_COLLECTION }, actions: ["find", "insert", "update"] },
        { resource: { db: "", collection: "system.js" }, actions: ["find"] },
      ],
      roles: [],
    },
    {
      role: "primemet_readonly",
      description:
        "Reporting/verification role. Read-only across the database; cannot write any document.",
      privileges: [{ resource: { db: "", collection: "" }, actions: ["find"] }],
      roles: [],
    },
  ];
}

/**
 * Expand a role's privileges into the effective action set for one collection.
 *
 * This is the whole of Task A in one function. MongoDB privileges are additive and a grant whose
 * `collection` is `""` (or omitted) applies to *every* collection in the database, so the effective
 * set is the union of all grants naming this collection plus all wildcard grants. Asking "does any
 * single privilege look wrong?" — which is what the previous audit did — cannot answer "can this
 * identity write this collection?", and that is the only question that matters.
 */
export function effectivePrivilegesFor(role, collection) {
  const actions = new Set();
  for (const privilege of role?.privileges ?? []) {
    const target = privilege.resource?.collection ?? "";
    if (target !== "" && target !== collection) continue;
    for (const action of privilege.actions ?? []) actions.add(action);
  }
  return [...actions].sort();
}

/**
 * Assert the definitions actually separate history from ordinary data, and separate the owner from the
 * runtime identity. Used by the verification suite so the property cannot silently regress.
 *
 * Accepts an explicit role list so a test can inject a rogue definition and prove the audit *fails* —
 * an audit that has never been seen to fail is an audit nobody can trust.
 *
 * Returns a list of human-readable problems; empty means "passes".
 */
export function auditRoleDefinitions(roleDefinitions = buildRoleDefinitions()) {
  const problems = [];
  const roles = roleDefinitions ?? [];
  const byName = Object.fromEntries(roles.map((r) => [r.role, r]));

  for (const required of ["primemet_app", "primemet_owner"]) {
    if (!byName[required]) problems.push(`${required} is not defined`);
  }

  // Fail closed on anything the audit cannot reason about.
  for (const role of roles) {
    for (const privilege of role.privileges ?? []) {
      for (const action of privilege.actions ?? []) {
        if (!KNOWN_ACTIONS.includes(action)) {
          problems.push(`${role.role} holds unclassified action "${action}"`);
        }
      }
    }
    if ((role.privileges ?? []).length === 0) problems.push(`${role.role} has no privileges`);
  }

  // 1. No identity may hold a destructive action, in any scope.
  for (const role of roles) {
    for (const action of DESTRUCTIVE_ACTIONS) {
      const holders = (role.privileges ?? []).filter((p) => (p.actions ?? []).includes(action));
      if (holders.length > 0) {
        const scopes = holders.map((p) => p.resource?.collection || "(database-wide)");
        problems.push(`${role.role} may ${action} on ${scopes.join(", ")}`);
      }
    }
  }

  // 2. The central rule: expand every wildcard, then judge each append-only collection on its
  //    effective privileges. This is what catches a database-wide `update` (Task A, requirement 1/2/7).
  for (const role of roles) {
    for (const collection of IMMUTABLE_COLLECTIONS) {
      const effective = effectivePrivilegesFor(role, collection);
      const writes = effective.filter((a) => HISTORY_WRITE_ACTIONS.includes(a));
      if (writes.length > 0) {
        problems.push(
          `${role.role} may ${writes.join("/")} on append-only ${collection} (effective privilege)`,
        );
      }
      // Requirement 4: read and append must survive the scoping. A role that legitimately writes
      // history must therefore still be able to seed it — an owner that can no longer insert is
      // broken, just differently. Read-only roles are exempt from the insert half by design.
      if (!effective.includes("find")) {
        problems.push(`${role.role} cannot find append-only ${collection}`);
      }
      if (HISTORY_WRITING_ROLES.includes(role.role) && !effective.includes("insert")) {
        problems.push(`${role.role} cannot insert append-only ${collection}`);
      }
    }
  }

  // 3. The runtime identity must not be able to change structure. This is what makes "owner
  //    credentials are never deployed" a testable statement rather than a deployment convention.
  const app = byName.primemet_app;
  if (app) {
    for (const collection of ["", ...MUTABLE_COLLECTIONS, ...IMMUTABLE_COLLECTIONS]) {
      const effective = effectivePrivilegesFor(app, collection);
      const structural = effective.filter((a) => STRUCTURAL_ACTIONS.includes(a));
      if (structural.length > 0) {
        problems.push(
          `primemet_app may ${structural.join("/")} on ${collection || "(database-wide)"}`,
        );
      }
    }
  }

  // 4. Requirement 6: mutable collections keep read/append/amend and nothing more.
  const mutableOrImmutableOverlap = MUTABLE_COLLECTIONS.filter((n) =>
    IMMUTABLE_COLLECTIONS.includes(n),
  );
  if (mutableOrImmutableOverlap.length > 0) {
    problems.push(
      `collection classified as both mutable and append-only: ${mutableOrImmutableOverlap.join(", ")}`,
    );
  }
  for (const role of roles) {
    for (const collection of MUTABLE_COLLECTIONS) {
      const effective = effectivePrivilegesFor(role, collection);
      const unexpected = effective.filter(
        (a) => !READ_ACTIONS.includes(a) && !APPEND_ACTIONS.includes(a) && !MUTATE_ACTIONS.includes(a),
      );
      if (unexpected.length > 0 && role.role !== "primemet_owner") {
        problems.push(`${role.role} holds ${unexpected.join("/")} on mutable ${collection}`);
      }
    }
  }

  // 5. Every collection must be reachable by the runtime identity, or code will fail at run time in a
  //    way no test would predict. A collection with no explicit grant is a latent outage.
  if (app) {
    const wildcardFind = (app.privileges ?? []).some(
      (p) => (p.resource?.collection ?? "") === "" && (p.actions ?? []).includes("find"),
    );
    if (!wildcardFind) {
      for (const collection of [...MUTABLE_COLLECTIONS, ...IMMUTABLE_COLLECTIONS, LEDGER]) {
        const effective = effectivePrivilegesFor(app, collection);
        if (!effective.includes("find")) {
          problems.push(`primemet_app cannot read ${collection}`);
        }
      }
    }
  }

  // 6. The continuity guard (C3) has to stay usable by the identities that write it, and unusable as
  //    a way around the append-only rules. A guard nobody can write turns every access change into an
  //    outage; a guard that is also history is not a guard. Both are latent failures, so both are
  //    asserted rather than assumed.
  for (const roleName of ["primemet_app", "primemet_owner"]) {
    const role = byName[roleName];
    if (!role) continue;
    const effective = effectivePrivilegesFor(role, GUARDS);
    if (!effective.includes("find") || !effective.includes("update")) {
      problems.push(`${roleName} cannot reach the continuity guard ${GUARDS}`);
    }
  }

  // 7. W2.2/W2.6: the platform identity pointer must be readable by the runtime and writable by nobody
  //    but the owner. This is the rule that keeps the fix a boundary rather than a convention: if a
  //    future grant hands `primemet_app` update on the pointer's collection, the audit fails here
  //    instead of the weakness reappearing in production.
  for (const roleName of ["primemet_app", "primemet_readonly"]) {
    const role = byName[roleName];
    if (!role) continue;
    const effective = effectivePrivilegesFor(role, PLATFORM_IDENTITY_COLLECTION);
    if (!effective.includes("find")) {
      problems.push(
        `${roleName} cannot read the protected platform identity ${PLATFORM_IDENTITY_COLLECTION}`,
      );
    }
    const writes = effective.filter((a) => a === "insert" || HISTORY_WRITE_ACTIONS.includes(a));
    if (writes.length > 0) {
      problems.push(
        `${roleName} may ${writes.join("/")} on the protected platform identity ${PLATFORM_IDENTITY_COLLECTION}`,
      );
    }
  }
  const ownerRole = byName.primemet_owner;
  if (ownerRole) {
    const effective = effectivePrivilegesFor(ownerRole, PLATFORM_IDENTITY_COLLECTION);
    for (const action of ["find", "insert", "update"]) {
      if (!effective.includes(action)) {
        problems.push(
          `primemet_owner cannot ${action} the protected platform identity ${PLATFORM_IDENTITY_COLLECTION}`,
        );
      }
    }
  }

  return problems;
}
