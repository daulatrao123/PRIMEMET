/**
 * PRIMEMET — migration v005: the protected platform identity, and the integrity tag (W2 + W3).
 *
 * TWO CHANGES, both of which close a way for a database write to become authority.
 *
 * 1. PLATFORM IDENTITY (W2). v004 put `orgKind: "PRIMEMET"` on `organisations` and made administrator
 *    resolution key on it. That marker lives on an ordinary mutable document, and a document validator
 *    cannot see a document's previous version, so "this field may never change" is not expressible. This
 *    version converges `_permission_guards` so it can hold the pointer, then seeds it from the database's
 *    own state. From then on `loadAdminActor` reads the pointer; relabelling an organisation changes a
 *    label, not who governs administrator access.
 *
 *    The seed refuses to choose. It records the pointer only when exactly one live organisation carries
 *    orgKind PRIMEMET — a restatement of what the schema already treats as the operator. Zero candidates
 *    leaves the pointer unset (reported); more than one refuses, because picking would be a guess.
 *
 * 2. EVENT INTEGRITY (W3). `admin_permission_grants` gains an optional `integrity` field: an HMAC over
 *    the row's decision-bearing fields, written by the application and verified by the resolver. A row
 *    written without it — by hand, by a compromised writer, by anything that is not the signing path — is
 *    refused by resolution rather than honoured. The field is optional in the VALIDATOR and required in
 *    PRACTICE by the resolver, because making it required here would invalidate every row written before
 *    this version; `scripts/resign-permissions.mjs` exists to migrate them.
 *
 * NOTHING IS DROPPED. Both changes are additive (OD-16: `primemet_owner` holds no `drop*` action).
 */

import { COLLECTIONS_BY_NAME } from "../collections/index.mjs";
import { plansFor } from "../define.mjs";
import { ensurePermissionGuards } from "../guards.mjs";
import { seedPlatformIdentity } from "../organisation-identity.mjs";

const CONVERGED = ["admin_permission_grants"];

export const V005 = {
  version: 5,
  name: "v005_platform_identity_and_event_integrity",
  description: "W2 + W3: a protected platform identity pointer, and an integrity tag on effective permission events",

  async up(db, { log = () => {}, now = new Date() } = {}) {
    // 1. The guard collection must accept the pointer before anything can write it.
    await ensurePermissionGuards(db, { log, now });

    // 2. Seed the pointer from unambiguous state only.
    const seeded = await seedPlatformIdentity(db, { log, now });
    log(`  ~ platform identity: ${seeded.reason}`);

    // 3. The integrity tag field on the log that decides access.
    for (const name of CONVERGED) {
      const def = COLLECTIONS_BY_NAME[name];
      if (!def) throw new Error(`v005: collection "${name}" is not defined in db/collections`);
      const plan = plansFor(def);

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
