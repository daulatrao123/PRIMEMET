/**
 * PRIMEMET — migration v002: the permission log gains REVOKE, ordering and attribution (D-ARCH-12).
 *
 * WHAT CHANGED IN THE DEFINITIONS, and why each one is here rather than in v001:
 *
 *   effect            `String` → `GrantEffect` (GRANT | DENY | REVOKE). The v001 validator carried a
 *                     `$in: ["GRANT","DENY"]` invariant, so a REVOKE row would have been *refused at
 *                     the database* while the resolver's contract said it was legal. The validator and
 *                     the resolver must agree, and this is the migration that makes them agree.
 *   seq, eventId      added: a total order for the resolver, and an idempotency key for retries.
 *   grantedById       optional → required, and `reason` optional → required: an access change with no
 *                     actor and no stated reason is not auditable.
 *   indexes           two added — `{adminId, eventId}` unique (a retried request must not invert the
 *                     outcome) and `{adminId, permission, createdAt:-1, seq:-1}` (the resolver's read).
 *
 * The collection was empty when this was written, so no existing row has to be backfilled.
 *
 * WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
 *   - it drops nothing. `{adminId, permission}` and `{expiresAt}` are now prefix-redundant but are
 *     retained: OD-16 records that `primemet_owner` holds no `drop*` action in any scope, and
 *     `dropIndex` on a collection would equally remove an index this migration relies on.
 *   - it rewrites no document. The collection is append-only; a row is never corrected in place.
 *
 * `up()` is idempotent — `collMod` then `createIndexes` — because `--reconcile` re-runs it. A validator
 * that an existing document violates is **not** reported by `collMod` itself: MongoDB applies a validator
 * to future writes only. That assumption was in the first version of this file and it was wrong (see
 * db/preflight.mjs and `check-adversarial.mjs` §K, which reproduces the surviving row). The pre-flight
 * below is what makes the failure loud: it inspects the documents that already exist against the rules
 * this version is about to enforce, and refuses before the validator is touched.
 */

import { COLLECTIONS_BY_NAME } from "../collections/index.mjs";
import { plansFor } from "../define.mjs";
import { assertCollectionConforms } from "../preflight.mjs";

/** Collections whose definition this version converges. Order is irrelevant; each is independent. */
const CONVERGED = ["admin_permission_grants"];

/**
 * What this version newly forbids, expressed as queries over the documents as they are stored.
 *
 * Each entry is a rule v002 introduces or tightens, so a document matching it is exactly a document that
 * the new validator would refuse — and that `collMod` would leave in place without comment.
 */
const PREFLIGHT = [
  {
    rule: "effect is GRANT, DENY or REVOKE",
    query: { effect: { $nin: ["GRANT", "DENY", "REVOKE"] } },
    remedy: "map the legacy effect onto the three-value set before applying v002",
  },
  {
    rule: "seq is a non-negative integer",
    query: {
      $or: [
        { seq: { $exists: false } },
        { seq: { $not: { $type: ["long", "int"] } } },
        { seq: { $lt: 0 } },
      ],
    },
    remedy: "assign each event its position in the admin's log",
  },
  {
    rule: "eventId is a string of at most 64 characters",
    query: {
      $or: [
        { eventId: { $not: { $type: "string" } } },
        {
          $expr: {
            $gt: [
              { $cond: [{ $eq: [{ $type: "$eventId" }, "string"] }, { $strLenCP: "$eventId" }, 0] },
              64,
            ],
          },
        },
      ],
    },
    remedy: "give each event its idempotency key",
  },
  {
    rule: "grantedById is present",
    query: { grantedById: { $not: { $type: "string" } } },
    remedy: "attribute the event to the admin who wrote it",
  },
  {
    rule: "reason is stated, not blank",
    query: {
      $or: [
        { reason: { $not: { $type: "string" } } },
        {
          $expr: {
            $eq: [
              {
                $cond: [
                  { $eq: [{ $type: "$reason" }, "string"] },
                  { $strLenCP: { $trim: { input: "$reason" } } },
                  1,
                ],
              },
              0,
            ],
          },
        },
      ],
    },
    remedy: "record why the access change was made",
  },
  {
    rule: "expiry, when set, is after the event instant",
    query: {
      $expr: {
        $and: [
          { $ne: [{ $ifNull: ["$expiresAt", null] }, null] },
          { $lte: ["$expiresAt", "$createdAt"] },
        ],
      },
    },
    remedy: "correct or remove the expired-on-arrival row",
  },
];

export const V002 = {
  version: 2,
  name: "v002_permission_grant_effects",
  description: "D-ARCH-12: permission grant effect becomes GRANT|DENY|REVOKE, with seq, eventId and reason",

  async up(db, { log = () => {} } = {}) {
    for (const name of CONVERGED) {
      const def = COLLECTIONS_BY_NAME[name];
      if (!def) throw new Error(`v002: collection "${name}" is not defined in db/collections`);

      const plan = plansFor(def);

      // Before the validator changes: prove the documents already stored satisfy the rules about to be
      // enforced. `collMod` will not do this, and a migration that skips it reports success over data it
      // cannot read.
      await assertCollectionConforms(db, plan.name, PREFLIGHT);
      log(`  \u2713 ${plan.name} conforms to the incoming definition`);

      await db.command({
        collMod: plan.name,
        validator: plan.validator,
        validationLevel: "strict",
        validationAction: "error",
      });
      log(`  ~ validator converged on ${plan.name}`);

      if (plan.indexes.length > 0) {
        await db.collection(plan.name).createIndexes(plan.indexes);
        log(`  ~ ${plan.indexes.length} index(es) ensured on ${plan.name}`);
      }
    }

    return [];
  },
};