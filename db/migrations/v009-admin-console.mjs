/**
 * PRIMEMET — migration v009: M5 admin control centre.
 *
 * WHY THIS VERSION EXISTS. M5 gives the desk operational control over accounts and a single overview.
 * Two things in the storage layer were missing for that, and neither is a new collection:
 *
 *   1. A SUSPENSION the desk can review. `accountStatus` already carried the state, but not why or when.
 *      `suspendedAt` and `suspensionReason` make a suspension attributable and reversible with its
 *      evidence intact, without reading the audit log to reconstruct it.
 *   2. The register indexes the console actually runs: every organisation of one type newest first
 *      (buyer and seller registers) and every enquiry newest first (the overview and the unfiltered
 *      desk queue). The per-status index added in v006 does not serve an unfiltered sort.
 *
 * WHAT IT DOES. Converges the `organisations` and `enquiries` validators with `collMod` and ensures
 * every declared index. Both new fields are optional, so no document is rewritten and no backfill is
 * needed: "absent" and "not suspended" are the same state, and the console reads absence as such.
 *
 * WHAT IT REFUSES. No drop, no rewrite, no participation-status change. Re-running it is a no-op.
 */

import { COLLECTIONS_BY_NAME } from "../collections/index.mjs";
import { plansFor } from "../define.mjs";

const CONVERGED = ["organisations", "enquiries"];

export const V009 = {
  version: 9,
  name: "v009_admin_console",
  description: "M5: organisation suspension record and admin register indexes",

  async up(db, { log = () => {} } = {}) {
    const existing = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
    );

    for (const name of CONVERGED) {
      const def = COLLECTIONS_BY_NAME[name];
      if (!def) throw new Error(`v009: collection "${name}" is not defined in db/collections`);
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

    return [];
  },
};
