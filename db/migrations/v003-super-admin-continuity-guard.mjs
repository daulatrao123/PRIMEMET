/**
 * PRIMEMET — migration v003: the super-admin continuity guard.
 *
 * WHAT THIS CREATES, and why it needs a version at all.
 *
 * C3 is a write-skew defect: two application instances can each DENY `ACCESS_GRANT_PERMISSION` to a
 * *different* super admin, each count the other as still holding it, and both commit — leaving the
 * platform with no identity able to write another access event. The count alone cannot prevent it,
 * because snapshot isolation lets both transactions read the same pre-write state.
 *
 * The repair is a rendezvous document that every guarded transaction must write (see db/guards.mjs).
 * That is a stored object, so it is a schema change, and a schema change travels as a new migration
 * version rather than as a definition edit (F-1). v001's and v002's identities are untouched.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - it drops nothing, deletes nothing and rewrites no event;
 *   - it does not reset `fence` on an existing guard document, because a reset is the one write that
 *     could convince two concurrent transactions that they were alone;
 *   - it touches no business collection.
 *
 * `up()` is idempotent — create-if-absent, `collMod`, insert-if-absent — because `--reconcile`
 * re-runs every applied version.
 */

import { GUARDS, ensurePermissionGuards } from "../guards.mjs";

export const V003 = {
  version: 3,
  name: "v003_super_admin_continuity_guard",
  description: "C3: a guard document that serialises changes to the last-super-admin invariant",

  async up(db, { log = () => {} } = {}) {
    log(`  ~ ${GUARDS}: continuity guard`);
    return ensurePermissionGuards(db, { log });
  },
};