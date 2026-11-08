/**
 * PRIMEMET — migration v010: the protected platform identity collection (W2.2 + W2.6).
 *
 * WHAT WAS WRONG. v005 moved administrator resolution off the mutable `organisations.orgKind` marker and
 * onto a pointer document in `_permission_guards`. That closed the relabel attack, and it left the
 * pointer reachable by the runtime identity: `primemet_app` holds `update` on `_permission_guards`
 * because it must increment the continuity fence on every guarded transaction, and MongoDB has no
 * per-document privilege. The authenticated audit measured the consequence — the application identity
 * could re-point the governing organisation (W2.2), and two concurrent writes were both accepted with an
 * order-dependent survivor (W2.6).
 *
 * WHAT THIS DOES. Creates `_platform_identity`, a collection of its own, with a closed validator and one
 * document. `primemet_app` is granted `find` there and nothing else, so re-pointing the pointer becomes
 * an operation the SERVER refuses rather than one the application is trusted not to attempt. The fence
 * and the per-admin sequence stay in `_permission_guards`, where the runtime still needs `update`.
 *
 * SEEDING (F4). The pointer is seeded from ONE source the application cannot write: an organisation id
 * supplied by the owner running the migration (`PLATFORM_ORGANISATION_ID`), which must name an existing,
 * live, `orgKind: "PRIMEMET"` organisation. It is deliberately NOT copied from the v005 guard document
 * or derived from the operator marker any more: the runtime identity holds `update` on
 * `_permission_guards`, and the marker is an ordinary writable column, so both are things the
 * application can write — and nothing the application can write may decide who administers the platform.
 * Those documents are still READ, but only to report them as hints in the refusal message.
 *
 * FAILING (F3). If the pointer cannot be seeded while this database already claims an operator, `up()`
 * throws `PlatformIdentitySeedError` with the claims listed and the exact recovery command. The ledger
 * then records `failed` for version 10, the version stays pending, and a retry applies cleanly — the only
 * side effect of a failed attempt is the (empty) collection, which the retry converges with `collMod`.
 * The migration can therefore never be recorded as applied over an anchor it did not establish.
 *
 * The single non-failure is a fresh database with no operator claim at all: nothing exists to adopt and
 * no administrator exists to lock out, so seeding is skipped, logged, and reported by `db/verify` as an
 * outstanding bootstrap action. A fresh install therefore still applies v001–v010 in one run.
 *
 * An existing pointer is never overwritten, so re-running this migration (which `--reconcile` does)
 * cannot move the anchor.
 *
 * NOTHING IS DROPPED. The legacy guard document stays in place: no identity holds `drop*` (OD-16), and
 * `db/verify.mjs` asserts the two agree, so a hand edit of the legacy copy is reported rather than
 * silently obeyed.
 *
 * DEPLOYMENT ORDER. Provision roles (`db/provision-roles.mjs`) → apply this migration → deploy the
 * application. Reversing the first two steps leaves the runtime without `find` on the new collection,
 * and administrator resolution fails closed with NO_ORGANISATION until it is corrected.
 */

import { ensurePlatformIdentityCollection, PLATFORM_ORGANISATION_ENV } from "../guards.mjs";

export const V010 = {
  version: 10,
  name: "v010_protected_platform_identity",
  description:
    "W2.2 + W2.6: the platform identity pointer moves to a collection the runtime identity cannot write",

  async up(
    db,
    { log = () => {}, now = new Date(), platformOrganisationId = process.env[PLATFORM_ORGANISATION_ENV] } = {},
  ) {
    return ensurePlatformIdentityCollection(db, { log, now, organisationId: platformOrganisationId });
  },
};
