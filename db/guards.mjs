/**
 * PRIMEMET — the guard documents that make a cross-instance invariant enforceable.
 *
 * WHY THIS COLLECTION EXISTS. C3 is a write-skew problem, not a read problem. Two application
 * instances, each handling one DENY of `ACCESS_GRANT_PERMISSION` against a *different* super admin,
 * can both count the same remaining holders in the same instant and both commit. Snapshot isolation
 * permits that, because the two transactions write different documents: `admin_permission_grants`
 * gets one row per target and nothing collides. The count is then wrong by the time it is acted on.
 *
 * The fix is to give every guarded transaction a document it must write. WiredTiger allows only one
 * writer on a document at a time, so the second transaction gets a WriteConflict, the driver retries
 * it, and on the retry it observes the first transaction's committed denial — the count it reads is
 * now correct, and the second denial is refused. One document, `_id: "last-super-admin"`, is enough:
 * it is not a lock on data, it is a rendezvous point that serialises *decisions about the invariant*.
 *
 * WHY IT IS NOT A BUSINESS COLLECTION. It is infrastructure with no Prisma model and no product
 * meaning, exactly like `_schema_migrations`: the PostgreSQL datamodel is frozen at M1 and a table
 * for this would be a table for a MongoDB-only mechanism. It therefore lives outside
 * `COLLECTIONS`, keeps the leading underscore convention, and is granted by name in `db/roles.mjs`
 * rather than through the mutable/append-only split.
 *
 * THE DOCUMENT IS SEEDED BY A MIGRATION, NOT LAZILY BY THE APPLICATION. `src/lib/permissions/store.ts`
 * refuses the guarded operation when the document is absent (GUARD_UNAVAILABLE). A missing guard is
 * a deployment that skipped a migration, and the one unacceptable outcome is proceeding without the
 * protection because the protection was hard to reach.
 */

/** The collection name. Duplicated as a literal in store.ts, asserted equal by the test suite. */
export const GUARDS = "_permission_guards";

/** The only guard document today: at least one super admin must keep ACCESS_GRANT_PERMISSION. */
export const GUARD_LAST_SUPER_ADMIN = "last-super-admin";

/**
 * W2 remediation: the platform identity pointer.
 *
 * The pointer lives here rather than in a collection of its own because it has exactly the property a
 * guard document has — it is a singleton infrastructure fact that must be readable atomically and must
 * not be business data. Reusing the collection avoids a second infrastructure grant, a second validator
 * and a second "is this declared?" question for one string.
 */
export const GUARD_PLATFORM_IDENTITY = "platform-identity";
/**
 * W2.2/W2.6 remediation: the protected platform identity collection.
 *
 * WHY A COLLECTION OF ITS OWN. v005 put the pointer in `_permission_guards` because it is a singleton
 * infrastructure fact. That was the right shape and the wrong address. The runtime identity needs
 * `update` on `_permission_guards` to increment the continuity fence on every guarded transaction, and
 * MongoDB has no per-document privilege: a grant that can write the fence can also write the pointer
 * that names the governing organisation. The audit reproduced exactly that — `primemet_app` could
 * re-point the pointer, and two concurrent writes left an order-dependent survivor.
 *
 * Privileges are per collection, so the only way to make "the runtime identity must not re-point the
 * pointer" a property the SERVER enforces is to put the pointer somewhere the runtime identity cannot
 * write. Here. `primemet_app` gets `find` (it must read the pointer to resolve administrator access)
 * and nothing else — no `insert`, no `update`, no `delete`. `primemet_owner` keeps
 * find/insert/update so a migration or an operator decision can seed and re-anchor it.
 *
 * The legacy document in `_permission_guards` is NOT removed and NOT read: no identity holds `drop*`
 * (OD-16), so it stays where v005 put it, and it is no longer a source of authority for anyone. Two
 * reasons, both of them the same reason:
 *
 *   - the runtime identity holds `find/update` on `_permission_guards` (it must increment the fence), so
 *     a pointer stored there is writable by the application — app-writable data cannot be the thing an
 *     application is judged against;
 *   - an `orgKind: "PRIMEMET"` marker on `organisations` is app-writable for the same reason, and W3.1
 *     (a relabel is still accepted once no competing marker exists) is still open.
 *
 * So v010 seeds the pointer from ONE source that the application cannot write: an explicit organisation
 * id supplied by the owner running the migration (`PLATFORM_ORGANISATION_ID`). Everything else is
 * reported as a hint and never adopted. See `ensurePlatformIdentityCollection`.
 */

/** The collection name. Duplicated as a literal in store.ts, asserted equal by the test suite. */
export const PLATFORM_IDENTITY_COLLECTION = "_platform_identity";

/**
 * One document, one field that matters.
 *
 * `additionalProperties: false` because a closed shape makes a stray field visible instead of ignored,
 * and `kind` is pinned to the single value this collection may hold, so a document cannot be added
 * here that claims to be something else. `organisationId` carries the same pattern as the legacy guard
 * pointer: the id of an organisation, never an arbitrary string.
 */
export const PLATFORM_IDENTITY_VALIDATOR = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "kind", "organisationId", "updatedAt"],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "string", enum: [GUARD_PLATFORM_IDENTITY] },
      kind: { bsonType: "string", enum: ["PLATFORM_IDENTITY"] },
      organisationId: { bsonType: "string", pattern: "^[0-9a-fA-F][0-9a-fA-F-]{7,39}$" },
      updatedAt: { bsonType: "date" },
    },
  },
};

/**
 * The environment variable an owner uses to name the platform organisation explicitly (F4).
 *
 * This is the ONLY authority v010 will seed from. It is read inside the migration rather than threaded
 * through every call site, so `db-init`, `--reconcile` and a direct `v010.up(db)` in a test all behave
 * the same way.
 */
export const PLATFORM_ORGANISATION_ENV = "PLATFORM_ORGANISATION_ID";

/**
 * Raised when v010 cannot safely establish the pointer. A migration that cannot decide must fail: the
 * ledger records a failure, the version stays pending, and a retry is safe.
 */
export class PlatformIdentitySeedError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlatformIdentitySeedError";
  }
}

/**
 * Observations a human can act on, and that the migration must NEVER act on itself.
 *
 * Both sources here are writable by the APPLICATION identity: the legacy pointer lives in
 * `_permission_guards`, where the runtime holds `update` in order to increment the fence, and the marker
 * is an ordinary column on `organisations`. Reporting them helps an operator decide which id to pass;
 * adopting either one would make an application-writable document the authority over administration,
 * which is the defect W2.2 exists to remove.
 */
async function observeOperatorClaims(db) {
  const claims = [];

  try {
    const legacy = await db
      .collection(GUARDS)
      .findOne({ _id: GUARD_PLATFORM_IDENTITY }, { projection: { organisationId: 1 } });
    if (typeof legacy?.organisationId === "string" && legacy.organisationId.length > 0) {
      claims.push("the legacy _permission_guards pointer names " + legacy.organisationId);
    }
  } catch {
    // Collection absent or unreadable: nothing to report.
  }

  try {
    const markers = await db
      .collection("organisations")
      .find({ orgKind: "PRIMEMET", deletedAt: null }, { projection: { _id: 1 } })
      .limit(10)
      .toArray();
    for (const marker of markers) {
      claims.push("organisations/" + marker._id + ' carries orgKind "PRIMEMET"');
    }
  } catch {
    // Same: absent or unreadable is not a claim.
  }

  return claims;
}

/**
 * Validate an owner-supplied organisation id before it can become the anchor.
 *
 * A typo here would stay invisible until every administrator lost access, so the id must name a real,
 * live, operator organisation. Each refusal names a different fix on purpose: "not found" and "found
 * but not an operator" send an operator to two different places.
 */
async function validateOperatorOrganisation(db, organisationId) {
  if (!/^[0-9a-fA-F][0-9a-fA-F-]{7,39}$/.test(organisationId)) {
    throw new PlatformIdentitySeedError(
      "PLATFORM_IDENTITY_INVALID_ID: " + PLATFORM_ORGANISATION_ENV + '="' + String(organisationId).slice(0, 64) +
        '" is not an organisation id (expected a UUID-shaped value).',
    );
  }

  let organisation;
  try {
    organisation = await db
      .collection("organisations")
      .findOne({ _id: organisationId }, { projection: { orgKind: 1, deletedAt: 1 } });
  } catch (error) {
    throw new PlatformIdentitySeedError(
      "PLATFORM_IDENTITY_UNREADABLE: the organisations collection could not be read while validating " +
        PLATFORM_ORGANISATION_ENV + " (" + String(error?.message ?? error).slice(0, 120) + ").",
    );
  }

  if (!organisation) {
    throw new PlatformIdentitySeedError(
      "PLATFORM_IDENTITY_NOT_FOUND: " + PLATFORM_ORGANISATION_ENV + " names " + organisationId +
        ", which is not an organisation in this database. Create the platform organisation first, then re-run.",
    );
  }
  if (organisation.orgKind !== "PRIMEMET") {
    throw new PlatformIdentitySeedError(
      "PLATFORM_IDENTITY_NOT_OPERATOR: organisations/" + organisationId + ' has orgKind "' +
        String(organisation.orgKind ?? "(unset)") + '", not "PRIMEMET". The pointer may only name the operator.',
    );
  }
  if (organisation.deletedAt !== null && organisation.deletedAt !== undefined) {
    throw new PlatformIdentitySeedError(
      "PLATFORM_IDENTITY_RETIRED: organisations/" + organisationId +
        " is soft-deleted, so it cannot govern administrator access. Re-anchor to the live operator organisation.",
    );
  }

  return organisation;
}

/**
 * Converge the protected platform identity collection and, while it is unset, seed it.
 *
 * Idempotent: called from migration v010 and therefore re-run by `--reconcile`. An existing pointer is
 * NEVER overwritten — that is what makes this a boundary rather than a convention. The seed is written
 * with `$setOnInsert` plus `upsert`, so two concurrent reconciles converge on one document.
 *
 * WHERE THE VALUE COMES FROM (F4). One source only: `PLATFORM_ORGANISATION_ID`, set by the owner running
 * the migration, naming an existing live `orgKind: "PRIMEMET"` organisation. Nothing the application can
 * write is consulted for a decision, because nothing the application can write may decide who administers
 * the platform.
 *
 * WHEN IT REFUSES (F3). If the pointer cannot be seeded while this database already claims an operator —
 * a legacy pointer, or any live PRIMEMET marker — the migration throws and the ledger records a failure.
 * It never records `applied` over an anchor it could not establish: the next deploy would then leave every
 * administrator resolving to NO_ORGANISATION with nothing pointing at the cause.
 *
 * THE ONE CASE THAT IS NOT A FAILURE. A database with no operator claim at all has not been bootstrapped:
 * there is no anchor to lose and no administrator to lock out. Seeding is skipped, the log says so, and
 * `db/verify.mjs` reports it as an outstanding bootstrap action. Making that fatal would mean a fresh
 * install could never apply its own schema, since v001–v010 are what create the collections an
 * organisation would live in.
 *
 * Returns the collections this call CREATED, so the ledger records what the migration actually did.
 */
export async function ensurePlatformIdentityCollection(
  db,
  { log = () => {}, now = new Date(), organisationId = process.env[PLATFORM_ORGANISATION_ENV] } = {},
) {
  const created = [];

  if (await collectionExists(db, PLATFORM_IDENTITY_COLLECTION)) {
    await db.command({
      collMod: PLATFORM_IDENTITY_COLLECTION,
      validator: PLATFORM_IDENTITY_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error",
    });
    log("  ~ validator converged on " + PLATFORM_IDENTITY_COLLECTION);
  } else {
    await db.createCollection(PLATFORM_IDENTITY_COLLECTION, {
      validator: PLATFORM_IDENTITY_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error",
    });
    created.push(PLATFORM_IDENTITY_COLLECTION);
    log("  + " + PLATFORM_IDENTITY_COLLECTION + " created");
  }

  const existing = await db
    .collection(PLATFORM_IDENTITY_COLLECTION)
    .findOne({ _id: GUARD_PLATFORM_IDENTITY });
  if (existing) {
    log("  = " + PLATFORM_IDENTITY_COLLECTION + "/" + GUARD_PLATFORM_IDENTITY + " already names " + existing.organisationId);
    return created;
  }

  const supplied = typeof organisationId === "string" ? organisationId.trim() : "";
  if (supplied.length > 0) {
    await validateOperatorOrganisation(db, supplied);
    const seeded = await db.collection(PLATFORM_IDENTITY_COLLECTION).updateOne(
      { _id: GUARD_PLATFORM_IDENTITY },
      { $setOnInsert: { kind: "PLATFORM_IDENTITY", organisationId: supplied, updatedAt: now } },
      { upsert: true },
    );
    if (seeded.upsertedCount === 1) {
      log("  + " + PLATFORM_IDENTITY_COLLECTION + " seeded from " + PLATFORM_ORGANISATION_ENV + "=" + supplied);
    }
    return created;
  }

  // No explicit id. This is where F3 and F4 meet: an operator claim exists that only a human can settle,
  // so the migration refuses rather than adopting something the application could have written.
  const claims = await observeOperatorClaims(db);
  if (claims.length > 0) {
    throw new PlatformIdentitySeedError(
      "PLATFORM_IDENTITY_UNSEEDED: this database claims an operator identity, but " +
        PLATFORM_ORGANISATION_ENV +
        " was not supplied, so the protected pointer cannot be established.\n" +
        "          Observed claims (hints only — none of these is adopted, because the application can write them):\n" +
        claims.map((claim) => "            - " + claim).join("\n") +
        "\n          Recovery: re-run the migration as the owner identity with the live operator organisation named\n" +
        "          explicitly, e.g.  " + PLATFORM_ORGANISATION_ENV + "=<organisation-id> node scripts/db-init.mjs --apply\n" +
        "          The id must name an organisation whose orgKind is PRIMEMET and that is not soft-deleted.\n" +
        "          The migration stays pending, so retrying is safe and nothing was overwritten.",
    );
  }

  // No claim anywhere: a database that has not been bootstrapped. Nothing can be lost by leaving the
  // pointer unset, and failing here would make a fresh install unable to apply its own schema.
  log(
    "  ! " + PLATFORM_IDENTITY_COLLECTION + " left unseeded: no operator organisation exists yet " +
      "(bootstrap pending — set " + PLATFORM_ORGANISATION_ENV + " and re-run once the platform organisation exists)",
  );
  return created;
}

/**
 * F1: there is no fallback ladder here any more.
 *
 * This module used to export `readProtectedPlatformIdentity`, which read the protected collection and then
 * fell back to the legacy `_permission_guards` pointer when the collection was absent. That function had no
 * caller and, more importantly, its premise was false: the runtime identity holds no `listCollections`
 * action, so it can never distinguish "collection absent" from "collection empty" and can never reach the
 * legacy branch. A fallback nobody can reach is not a compatibility mechanism; it is a documented
 * behaviour that does not exist.
 *
 * The read path is now stated in exactly one place — `readPlatformPointer` in
 * `src/lib/permissions/store.ts` — and it has one rule: a usable pointer or fail closed. v010 being a
 * deployment prerequisite is the price of that, and it is stated in the migration and in `db/README.md`.
 */


/**
 * A guard document is a fence, not a lock with an owner.
 *
 * Two kinds share the collection because they share a property: each is infrastructure that must be
 * reachable atomically across instances, and neither is business data.
 *
 *   SUPER_ADMIN_CONTINUITY  `fence` is incremented by every guarded transaction. Nothing reads its value
 *                           to make a decision — the decision comes from the event log — so a stale value
 *                           cannot cause a wrong answer. Its only job is to be written by everyone, which
 *                           is what creates the conflict that serialises them.
 *   PERMISSION_SEQUENCE     `value` is the last position handed out in one admin's event log (`$inc` is
 *                           atomic, so no two appends share a position). `_id` is `seq-<adminId>`.
 *
 * The two `required` lists differ by kind, so the shape stays closed: an invariant rejects a document
 * that claims a kind without the field that kind exists to carry.
 */
export const GUARD_VALIDATOR = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "kind", "updatedAt"],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "string", pattern: "^[a-z][a-z0-9-]{2,39}$" },
      kind: { bsonType: "string", enum: ["SUPER_ADMIN_CONTINUITY", "PERMISSION_SEQUENCE", "PLATFORM_IDENTITY"] },
      // Present only on the PLATFORM_IDENTITY guard: the organisations._id that governs administrator
      // access. It is the value `loadAdminActor` reads, so a relabelled organisation cannot change it.
      organisationId: { bsonType: "string", pattern: "^[0-9a-fA-F][0-9a-fA-F-]{7,39}$" },
      // Every guarded transaction increments this. An int and a long are both accepted because the
      // driver encodes a JS number as int32 until it overflows; the counter is expected to be a long.
      fence: { bsonType: ["int", "long"], minimum: 0 },
      // The last sequence position handed out. Starts at 1, so 0 is never a valid counter value.
      value: { bsonType: ["int", "long"], minimum: 1 },
      updatedAt: { bsonType: "date" },
    },
  },
  $expr: {
    $or: [
      {
        $and: [
          { $eq: ["$kind", "SUPER_ADMIN_CONTINUITY"] },
          { $ne: [{ $type: "$fence" }, "missing"] },
        ],
      },
      {
        $and: [
          { $eq: ["$kind", "PERMISSION_SEQUENCE"] },
          { $ne: [{ $type: "$value" }, "missing"] },
        ],
      },
      {
        $and: [
          { $eq: ["$kind", "PLATFORM_IDENTITY"] },
          { $ne: [{ $type: "$organisationId" }, "missing"] },
        ],
      },
    ],
  },
};

async function collectionExists(db, name) {
  return db.listCollections({ name }, { nameOnly: true }).hasNext();
}

/**
 * Converge the guard collection and its seed document. Idempotent; called from migration v003 and
 * therefore re-run by `--reconcile`.
 *
 * Returns the collections this call CREATED, so the ledger records what the migration actually did.
 * An existing collection is re-converged with `collMod`, and the seed row is only ever inserted —
 * an existing fence value is never reset, because resetting it would be the one write that could
 * make two in-flight transactions believe they were alone.
 */
export async function ensurePermissionGuards(db, { log = () => {}, now = new Date() } = {}) {
  const created = [];

  if (await collectionExists(db, GUARDS)) {
    await db.command({
      collMod: GUARDS,
      validator: GUARD_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error",
    });
    log(`  ~ validator converged on ${GUARDS}`);
  } else {
    await db.createCollection(GUARDS, {
      validator: GUARD_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error",
    });
    created.push(GUARDS);
    log(`  + ${GUARDS} created`);
  }

  const seeded = await db.collection(GUARDS).updateOne(
    { _id: GUARD_LAST_SUPER_ADMIN },
    {
      $setOnInsert: {
        kind: "SUPER_ADMIN_CONTINUITY",
        fence: 0,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  if (seeded.upsertedCount === 1) log(`  + guard document ${GUARD_LAST_SUPER_ADMIN} seeded`);

  return created;
}

/**
 * Offline validation of the definitions above, in the same shape as `scripts/db-verify.mjs`.
 * Exported so the guard definition is checked by a suite rather than trusted.
 */
export function validateGuardDefinition() {
  const problems = [];
  if (!/^_[a-z_]+$/.test(GUARDS)) problems.push(`collection name "${GUARDS}" is not an infrastructure name`);
  if (!/^[a-z][a-z0-9-]{2,39}$/.test(GUARD_LAST_SUPER_ADMIN)) {
    problems.push(`guard id "${GUARD_LAST_SUPER_ADMIN}" does not match the validator pattern`);
  }
  const schema = GUARD_VALIDATOR.$jsonSchema;
  if (schema.additionalProperties !== false) problems.push("the guard document shape is not closed");
  for (const key of schema.required ?? []) {
    if (!(key in schema.properties)) problems.push(`required field "${key}" has no type`);
  }
  for (const [key, spec] of Object.entries(schema.properties)) {
    const types = Array.isArray(spec.bsonType) ? spec.bsonType : [spec.bsonType];
    for (const type of types) {
      if (!["object", "string", "int", "long", "date", "bool", "array"].includes(type)) {
        problems.push(`field "${key}" declares an unknown bsonType "${type}"`);
      }
    }
  }
  // W2.2: the protected platform identity validator is held to the same standard as the guard's, because
  // a permissive shape on the pointer would let a document be added that names something else entirely.
  if (!/^_[a-z_]+$/.test(PLATFORM_IDENTITY_COLLECTION)) {
    problems.push(`collection name "${PLATFORM_IDENTITY_COLLECTION}" is not an infrastructure name`);
  }
  if (PLATFORM_IDENTITY_COLLECTION === GUARDS) {
    problems.push("the protected platform identity reuses the guard collection, so the fence grant reaches it");
  }
  const identity = PLATFORM_IDENTITY_VALIDATOR.$jsonSchema;
  if (identity.additionalProperties !== false) {
    problems.push("the protected platform identity shape is not closed");
  }
  for (const key of identity.required ?? []) {
    if (!(key in identity.properties)) problems.push(`platform identity field "${key}" has no type`);
  }
  if (!(identity.properties?._id?.enum ?? []).includes(GUARD_PLATFORM_IDENTITY)) {
    problems.push("the protected platform identity does not pin its own document id");
  }

  return problems;
}