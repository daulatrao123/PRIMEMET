/**
 * PRIMEMET — migration v004: the operator marker returns to `organisations` (defect S-1).
 *
 * WHAT WAS WRONG. The PostgreSQL datamodel carries two distinct columns:
 *
 *   org_type   BUYER | SELLER | BOTH          the counterparty kind
 *   org_kind   PRIMEMET | BUYER | ...         the operator marker, with a partial unique index
 *                                             guaranteeing exactly one live PRIMEMET row
 *
 * The first MongoDB port kept only `org_type` and moved the single-PRIMEMET index onto it. Two
 * consequences, both silent:
 *
 *   1. `OrgType` has no PRIMEMET value, so a platform organisation could not be stored at all. Since
 *      `src/lib/permissions/store.ts` refuses to resolve any admin without one (NO_ORGANISATION), admin
 *      authorization was unsatisfiable against a valid database — the whole permission model was inert.
 *   2. The partial unique index filtered on `{orgType: "PRIMEMET"}`, a value the enum forbids, so its
 *      "exactly one PRIMEMET organisation" guarantee could never match a document. A uniqueness
 *      constraint that can never fire reads exactly like one that always passes.
 *
 * WHAT THIS VERSION DOES. Adds `orgKind` (enumerated, required) and creates the index that actually
 * expresses the rule. Nothing is dropped: OD-16 records that `primemet_owner` holds no `drop*` action in
 * any scope, so the superseded `{orgType: "PRIMEMET"}` index remains as dead structure whose filter
 * matches no document.
 *
 * WHY IT FAILS CLOSED. `orgKind` is required, so any organisation stored before this version would be
 * unreadable by the new definition. The pre-flight refuses in that case rather than adding a rule over
 * rows it cannot vouch for — the same discipline v002 gained from `db/preflight.mjs`.
 */

import { COLLECTIONS_BY_NAME } from "../collections/index.mjs";
import { plansFor } from "../define.mjs";
import { assertCollectionConforms } from "../preflight.mjs";
import { applyLegacyOrganisationBackfill } from "../organisation-identity.mjs";

const CONVERGED = ["organisations"];

const PREFLIGHT = [
  {
    rule: "the operator marker is one of PRIMEMET, BUYER, SELLER, PARTNER, OTHER",
    query: { orgKind: { $nin: ["PRIMEMET", "BUYER", "SELLER", "PARTNER", "OTHER"] } },
    remedy: "classify each existing organisation before applying v004 (the platform row is PRIMEMET)",
  },
];

export const V004 = {
  version: 4,
  name: "v004_organisation_kind",
  description: "S-1: organisations regains orgKind, and the single-PRIMEMET guarantee moves onto it",

  async up(db, { log = () => {} } = {}) {
    for (const name of CONVERGED) {
      const def = COLLECTIONS_BY_NAME[name];
      if (!def) throw new Error(`v004: collection "${name}" is not defined in db/collections`);

      const plan = plansFor(def);

      // A second PRIMEMET row would make the new unique index fail mid-migration, leaving the validator
      // converged and the index missing. Cheaper to refuse first, with the offending rows named.
      const livePlatform = await db.collection(plan.name).countDocuments({ orgKind: "PRIMEMET", deletedAt: null });
      if (livePlatform > 1) {
        throw new Error(
          `PREFLIGHT_FAILED: organisations holds ${livePlatform} live PRIMEMET rows; the invariant is exactly one. ` +
            "Mark the duplicates deleted (soft delete) before applying v004.",
        );
      }
      // W4-a. `orgKind` is required by the definition this migration is about to converge, so every
      // organisation stored before v004 fails the pre-flight. Previously that was a dead end: an operator
      // was told to "classify each existing organisation" with no report, no dry run and no ledger entry.
      // The backfill now classifies deterministically, refuses to guess platform identity, and throws with
      // the full report when a row needs a human decision. It is idempotent, so a reconcile re-runs it.
      const bothAs = process.env.PRIMEMET_BACKFILL_BOTH_AS || null;
      await applyLegacyOrganisationBackfill(db, { bothAs, log });

      await assertCollectionConforms(db, plan.name, PREFLIGHT);
      log(`  \u2713 ${plan.name} carries one operator marker per organisation`);

      await db.command({
        collMod: plan.name,
        validator: plan.validator,
        validationLevel: "strict",
        validationAction: "error",
      });
      log(`  ~ validator converged on ${plan.name}`);

      await db.collection(plan.name).createIndexes(plan.indexes);
      log(`  ~ ${plan.indexes.length} index(es) ensured on ${plan.name}`);
    }

    return [];
  },
};