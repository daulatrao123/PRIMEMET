/**
 * PRIMEMET — migration v007: M2 catalogue media.
 *
 * WHY THIS VERSION EXISTS. M2 makes the catalogue real, and three things follow from that:
 *
 *   1. `products.images` — an ordered gallery. `imageUrl` (v006) is the single hero image; a buyer
 *      comparing parts needs more than one view, and the alternative — one collection per image — would
 *      turn every product page into a join.
 *   2. A public listing that pages, filters and sorts needs indexes that match the query it runs, or
 *      every catalogue page is a full collection scan that grows with the catalogue.
 *   3. `product_specifications` becomes a write target (the admin specification editor), so its read
 *      index has to exist before the first admin save, not after the first slow page.
 *
 * WHAT IT DOES, IN ORDER.
 *
 *   - Converges the validators with `collMod` for `products` and `product_specifications`.
 *   - Backfills `images: []` on existing products. The field is declared optional, so a document that
 *     somehow escapes the backfill still validates; the backfill exists so the gallery editor never has
 *     to treat "absent" and "empty" as different states.
 *   - Ensures every index, including the two new catalogue-listing indexes.
 *
 * WHY CONVERGE BEFORE BACKFILLING (M6 blocker B2). The pre-v007 validator forbids additional properties,
 * so the backfill could only run with `bypassDocumentValidation` if it ran first — a privilege the
 * least-privilege `primemet_owner` identity deliberately does not hold. Converging the validator first
 * lets the backfill run under normal validation, so nothing is bypassed and no privilege is granted.
 * A database left mid-migration (validator converged, backfill not yet run) is recoverable by re-running.
 *
 * WHAT IT REFUSES. It never drops a collection, an index or a document, never disables a validator and
 * never rewrites a price, a publication state or an image reference. Re-running it is a no-op.
 */

import { COLLECTIONS_BY_NAME } from "../collections/index.mjs";
import { plansFor } from "../define.mjs";

const CONVERGED = ["products", "product_specifications"];

export const V007 = {
  version: 7,
  name: "v007_catalogue_media",
  description: "M2: product image gallery and catalogue listing indexes",

  async up(db, { log = () => {} } = {}) {
    // 1. Converge each collection: create when absent, otherwise collMod. No drops, no relaxed levels.
    const existing = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
    );

    for (const name of CONVERGED) {
      const def = COLLECTIONS_BY_NAME[name];
      if (!def) throw new Error(`v007: collection "${name}" is not defined in db/collections`);
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
    const result = await db.collection("products").updateMany(
      { images: { $exists: false } },
      { $set: { images: [] } },
    );
    if (result.modifiedCount > 0) {
      log(`  ~ ${result.modifiedCount} pre-v007 product(s) given an empty image gallery`);
    }

    return [];
  },
};
