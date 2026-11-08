/**
 * PRIMEMET — referential guard and the app-enforced half of D-1.
 *
 * MongoDB has no foreign keys, so "do not blindly convert PostgreSQL foreign keys into unenforced
 * references" is a design requirement, not a preference. Every reference is therefore validated here,
 * inside the same transaction as the write that sets it, before the document reaches the server.
 *
 * What this does and does not give you, stated plainly:
 *
 *   ENFORCED   a document written through this module cannot point at a missing parent, and cannot
 *              verify an alias using another alias's approval
 *   NOT        a write issued directly through mongosh or Atlas Data Explorer bypasses this module.
 *              MongoDB cannot prevent that, and it cannot express the cross-document rule in a
 *              collection validator either. The controls against it are least-privilege database
 *              users (db/provision-roles.mjs), no interactive console access in the deployment, and
 *              `reconcileVerifiedAliases()` in db/verify.mjs, which re-checks every stored VERIFIED
 *              alias against its real decision on every `db:verify` and every initialization — so a
 *              bypassed write is detected rather than trusted.
 *
 * The validators in db/collections/*.mjs are the other half: they enforce shape, types, enum
 * membership and every same-document rule, so even a bypassing writer cannot store a malformed or
 * self-contradictory document.
 */

import { COLLECTIONS_BY_NAME, IMMUTABLE_COLLECTIONS } from "./collections/index.mjs";

/** Fields on a collection definition that point at another collection. */
export function referenceFields(collectionName) {
  const def = COLLECTIONS_BY_NAME[collectionName];
  if (!def) throw new Error(`Unknown collection "${collectionName}"`);
  const out = [];
  for (const [field, spec] of Object.entries(def.fields)) {
    if (spec && typeof spec === "object" && typeof spec.ref === "string") {
      out.push({ field, target: spec.ref, optional: spec.optional === true });
    }
  }
  return out;
}

/**
 * Throw if any reference in `doc` points at a document that does not exist.
 *
 * Optional references are skipped when absent or null, mirroring a nullable PostgreSQL column.
 */
export async function assertReferences(db, collectionName, doc, options = {}) {
  const { session } = options;
  const refs = referenceFields(collectionName);

  for (const { field, target, optional } of refs) {
    const value = doc[field];
    if (value === undefined || value === null) {
      if (!optional) {
        throw new ReferenceError(
          `${collectionName}.${field} is required (REFERENCES ${target}) but was not provided.`,
        );
      }
      continue;
    }
    const found = await db.collection(target).findOne({ _id: value }, { session });
    if (!found) {
      throw new ReferenceError(
        `${collectionName}.${field} = ${value} does not exist in "${target}" (REFERENCES ${target}).`,
      );
    }
  }
}

/**
 * Insert with reference validation, in one transaction where the deployment supports it.
 *
 * Atlas runs as a replica set, so the transaction path is the normal path. A standalone local server
 * cannot start a transaction; in that case the guard still runs, just without atomicity, and the
 * caller is told so through `strictTransactions: false`.
 */
export async function insertGuarded(db, collectionName, doc, options = {}) {
  const { strictTransactions = true } = options;
  const session = db.client.startSession();

  try {
    if (strictTransactions) {
      let result;
      await session.withTransaction(
        async () => {
          await assertReferences(db, collectionName, doc, { session });
          result = await db.collection(collectionName).insertOne(doc, { session });
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
      return result;
    }
    await assertReferences(db, collectionName, doc);
    return await db.collection(collectionName).insertOne(doc);
  } finally {
    await session.endSession();
  }
}

/**
 * Collections whose DAO surface is insert + find only (append-only history).
 *
 * Derived from the collection definitions rather than listed a second time: `immutable: true` is the
 * single declaration, so a collection cannot be append-only in one place and mutable in another. The
 * verification suite asserts this list equals IMMUTABLE_COLLECTIONS, so a guard that was never wired
 * becomes a failing test instead of something a reviewer has to notice (Task B).
 */
export const APPEND_ONLY = IMMUTABLE_COLLECTIONS;

export function assertAppendOnly(collectionName, operation) {
  if (APPEND_ONLY.includes(collectionName) && (operation === "update" || operation === "delete")) {
    throw new Error(
      `${collectionName} is append-only: ${operation} is not permitted (D-2). Record a new entry instead.`,
    );
  }
}

/**
 * Verify an alias (D-1) — the only supported path to `verification: "VERIFIED"`.
 *
 * Refuses unless a decision exists, is APPROVED, belongs to THIS alias, its basis matches, it names a
 * reviewer, and it carries technical evidence (a specification reference or an evidence document).
 * Then writes the alias update plus an append-only verification history row in one transaction. If any
 * step fails, none is applied.
 *
 * This function, not a collection validator, is where the rule is enforced: MongoDB validators see one
 * document at a time and therefore cannot read the decision at all. `db/verify.mjs` independently
 * re-checks anything that claims to be VERIFIED, which is what makes a bypass visible.
 *
 * @returns {{ok: true}} or throws with a precise reason.
 */
export async function verifyAlias(db, input) {
  const { aliasId, decisionId, basis, verifiedById, note = null, strictTransactions = true } = input;
  const session = db.client.startSession();

  const fail = (message) => {
    throw new Error(`ALIAS_VERIFICATION_REFUSED: ${message}`);
  };

  try {
    const run = async (txSession) => {
      const alias = await db.collection("material_aliases").findOne({ _id: aliasId }, { session: txSession });
      if (!alias) fail(`alias ${aliasId} does not exist`);
      if (alias.isRetired) fail(`alias ${aliasId} is retired`);

      const decision = await db
        .collection("material_alias_equivalence_decisions")
        .findOne({ _id: decisionId }, { session: txSession });
      if (!decision) fail(`equivalence decision ${decisionId} does not exist`);
      if (decision.aliasId !== aliasId) {
        fail(
          `equivalence decision ${decisionId} concerns alias ${decision.aliasId}, not ${aliasId} — ` +
            "an approval cannot be borrowed",
        );
      }
      if (decision.status !== "APPROVED") {
        fail(`equivalence decision ${decisionId} is ${decision.status}, not APPROVED`);
      }
      if (decision.basis !== basis) {
        fail(
          `basis ${basis} does not match the approved decision's basis ${decision.basis} — a claim ` +
            "cannot be relabelled to make it publishable",
        );
      }
      if (!decision.reviewedById) {
        fail(`equivalence decision ${decisionId} names no reviewer — an approval must be attributable`);
      }
      if (!decision.technicalReference && !decision.evidenceDocumentId) {
        fail(
          `equivalence decision ${decisionId} carries no technical reference and no evidence document ` +
            "— an approval without evidence is not an approval",
        );
      }
      if (!verifiedById) {
        fail("a verification must name the person who performed it");
      }

      const now = new Date();
      const result = await db.collection("material_aliases").updateOne(
        { _id: aliasId },
        {
          $set: {
            verification: "VERIFIED",
            equivalenceBasis: basis,
            equivalenceDecisionId: decisionId,
            verifiedById,
            verifiedAt: now,
            updatedAt: now,
          },
        },
        { session: txSession },
      );
      if (result.matchedCount !== 1) fail(`alias ${aliasId} could not be updated`);

      await db.collection("material_alias_verifications").insertOne(
        {
          _id: crypto.randomUUID(),
          aliasId,
          decision: "VERIFIED",
          previousVerification: alias.verification ?? null,
          newVerification: "VERIFIED",
          decidedById: verifiedById,
          decidedAt: now,
          note,
          createdAt: now,
        },
        { session: txSession },
      );
    };

    if (strictTransactions) {
      await session.withTransaction(run, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      });
    } else {
      await run(undefined);
    }
    return { ok: true };
  } finally {
    await session.endSession();
  }
}