/**
 * PRIMEMET — migration v006: Phase 1 portal collections and fields.
 *
 * WHY THIS VERSION EXISTS. Phase 1 needs three things the schema did not carry:
 *
 *   1. `enquiries` — a buyer request persisted with its owner organisation and a human reference.
 *   2. `supplier_listings.reviewStatus` — an explicit admin approval gate. `ListingStatus` alone is
 *      ambiguous: DRAFT can mean "seller still editing" or "waiting for approval", and a listing that
 *      looks merely unfinished is exactly how an unapproved listing reaches the public catalogue.
 *   3. `products.imageUrl` — a catalogue image reference without inventing an object store.
 *
 * WHAT IT DOES, IN ORDER.
 *
 *   - Converges the validators with `collMod` for the three collections (creating any that is absent).
 *   - Backfills the three new listing fields on documents that predate the rule. The backfill is
 *     deterministic and refuses to invent a review decision: it sets PENDING, never APPROVED.
 *   - Ensures every index, including the new review queue and research indexes.
 *
 * WHY CONVERGE BEFORE BACKFILLING (M6 blocker B2). The pre-v006 validator forbids additional
 * properties, so a backfill written before the convergence could only run with
 * `bypassDocumentValidation` — an administrative privilege that the least-privilege `primemet_owner`
 * identity deliberately does not hold (see `db/roles.mjs`: it is not in `KNOWN_ACTIONS`, and
 * `scripts/check-mongodb.mjs` treats a role carrying it as a rogue privilege). Applying the current
 * validator first removes the need for it: the backfill then writes documents the *current* validator
 * accepts, so nothing is bypassed and no privilege is granted or widened. A database mid-migration
 * (validator converged, backfill not yet run) is recoverable by simply re-running this `up()`.
 *
 * WHAT IT REFUSES. It never drops a collection, an index or a document, never disables a validator and
 * never marks anything approved. An existing listing enters the queue as PENDING, so the first thing an
 * admin sees after this migration is the real backlog rather than a silently approved catalogue.
 */

import { COLLECTIONS_BY_NAME } from "../collections/index.mjs";
import { plansFor } from "../define.mjs";

const CONVERGED = ["enquiries", "products", "supplier_listings"];

export const V006 = {
  version: 6,
  name: "v006_phase1_portal",
  description: "Phase 1: enquiries collection, seller-listing review state, product image reference",

  async up(db, { log = () => {} } = {}) {
    // 1. Converge each collection: create when absent, otherwise collMod. No drops, no relaxed levels.
    const existing = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
    );

    for (const name of CONVERGED) {
      const def = COLLECTIONS_BY_NAME[name];
      if (!def) throw new Error(`v006: collection "${name}" is not defined in db/collections`);
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

    // 2. Backfill under the converged validator. The update supplies exactly the fields the validator
    //    now requires, so the resulting document is valid and no validation bypass is needed. `title` is
    //    truncated to its declared maxLength so a long `notes` value cannot produce an invalid document.
    const result = await db.collection("supplier_listings").updateMany(
      { reviewStatus: { $exists: false } },
      [
        {
          $set: {
            reviewStatus: "PENDING",
            submittedAt: { $ifNull: ["$createdAt", "$$NOW"] },
            title: {
              $let: {
                vars: { source: { $ifNull: ["$notes", "Supplier listing"] } },
                in: { $substrCP: ["$$source", 0, 200] },
              },
            },
          },
        },
      ],
    );
    if (result.modifiedCount > 0) {
      log(`  ~ ${result.modifiedCount} pre-v006 listing(s) queued as PENDING for review`);
    }

    return [];
  },
};
