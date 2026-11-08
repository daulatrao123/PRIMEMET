/**
 * PRIMEMET — migration v001: create the collections this milestone defines.
 *
 * Idempotent convergence, not a one-shot script:
 *   - absent collection  → create it with its validator
 *   - present collection → `collMod` the validator (so a corrected rule reaches an existing database)
 *   - either way         → ensure every declared index exists
 *
 * It never drops a collection, an index or a document.
 *
 * The *definition* lives in db/collections/*.mjs and is code-reviewed like any other source. This file
 * records that v001 introduced those collections, and the ledger stores a checksum covering this file
 * and every definition module, so an edit after application is detected as drift rather than applied
 * silently.
 */

import { COLLECTIONS } from "../collections/index.mjs";
import { plansFor } from "../define.mjs";

export const V001 = {
  version: 1,
  name: "v001_initial_collections",
  description: "Create the 45 business collections with validators and indexes",

  async up(db, { log = () => {} } = {}) {
    const created = [];
    const existing = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
    );

    for (const def of COLLECTIONS) {
      const plan = plansFor(def);

      if (!existing.has(plan.name)) {
        await db.createCollection(plan.name, {
          validator: plan.validator,
          validationLevel: "strict",
          validationAction: "error",
        });
        created.push(plan.name);
        log(`  + collection ${plan.name}`);
      } else {
        // Converge the validator without touching data. If an existing document violates the new
        // rule, this is where it fails — loudly, and before anything else runs.
        await db.command({
          collMod: plan.name,
          validator: plan.validator,
          validationLevel: "strict",
          validationAction: "error",
        });
      }

      if (plan.indexes.length > 0) {
        await db.collection(plan.name).createIndexes(plan.indexes);
      }
    }

    return created;
  },
};