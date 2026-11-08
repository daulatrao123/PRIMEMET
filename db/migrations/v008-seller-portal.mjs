/**
 * PRIMEMET — migration v008: M4 seller onboarding and listing submissions.
 *
 * WHY THIS VERSION EXISTS. M4 turns the seller side from a preview into a working application desk.
 * Three things follow, and each needs storage that did not exist before:
 *
 *   1. An APPLICATION the desk can review. A seller declares a business type and describes the company;
 *      the admin records a decision note the seller may read back. Those belong on the organisation
 *      (the party being approved), not on the user (the login) — one company can have several people.
 *   2. A SUBMISSION that carries enough detail to review. `supplier_listings` already had the approval
 *      gate (v006 `reviewStatus`) but not the content: manufacturer, description, technical
 *      specification, supporting information and image REFERENCES. A reviewer deciding on a title and
 *      a category alone would be approving a name.
 *   3. The queue indexes for both screens, or every admin page is a collection scan that grows with
 *      the estate.
 *
 * WHAT IT DOES, IN ORDER.
 *
 *   - Converges the validators with `collMod` for `organisations` and `supplier_listings`.
 *   - Backfills `images: []` on existing `supplier_listings`. Every field added here is declared
 *     optional, so a document that escapes the backfill still validates; the backfill exists so the
 *     seller history and the admin reviewer never distinguish "absent" from "empty".
 *   - Ensures every index, including the two new queue indexes.
 *
 * WHY CONVERGE BEFORE BACKFILLING (M6 blocker B2). The pre-v008 validator forbids additional properties,
 * so the backfill could only run with `bypassDocumentValidation` if it ran first — a privilege the
 * least-privilege `primemet_owner` identity deliberately does not hold. Converging the validator first
 * lets the backfill run under normal validation, so nothing is bypassed and no privilege is granted.
 * A database left mid-migration (validator converged, backfill not yet run) is recoverable by re-running.
 *
 * WHAT IT REFUSES. It never drops a collection, an index or a document, never disables a validator and
 * never rewrites an approval decision, a review status, a GSTIN or a listing's acceptance. Re-running it
 * is a no-op.
 */

import { COLLECTIONS_BY_NAME } from "../collections/index.mjs";
import { plansFor } from "../define.mjs";

const CONVERGED = ["organisations", "supplier_listings"];

export const V008 = {
  version: 8,
  name: "v008_seller_portal",
  description: "M4: seller application fields, listing submission detail and review queue indexes",

  async up(db, { log = () => {} } = {}) {
    // 1. Converge each collection: create when absent, otherwise collMod. No drops, no relaxed levels.
    const existing = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
    );

    for (const name of CONVERGED) {
      const def = COLLECTIONS_BY_NAME[name];
      if (!def) throw new Error(`v008: collection "${name}" is not defined in db/collections`);
      const plan = plansFor(def);

      if (!existing.has(plan.name)) {
        await db.createCollection(plan.name, {
          validator: plan.validator,
          validationLevel: "strict",
          validationAction: "error",
        });
        log(`  + collection ${plan.name}`);
      } else {
        await db.command({
          collMod: plan.name,
          validator: plan.validator,
          validationLevel: "strict",
          validationAction: "error",
        });
        log(`  ~ validator converged on ${plan.name}`);
      }

      await db.collection(plan.name).createIndexes(plan.indexes);
      log(`  ~ ${plan.indexes.length} index(es) ensured on ${plan.name}`);
    }

    // 2. Backfill under the converged validator. Deterministic, additive, no content invented.
    const result = await db.collection("supplier_listings").updateMany(
      { images: { $exists: false } },
      { $set: { images: [] } },
    );
    if (result.modifiedCount > 0) {
      log(`  ~ ${result.modifiedCount} pre-v008 listing(s) given an empty image list`);
    }

    return [];
  },
};
