/**
 * PRIMEMET — every collection in one ordered list.
 *
 * 45 business collections plus the migration ledger. The list is the single input to the
 * initialization runner and to the verification suite, so a collection cannot exist in one and be
 * missing from the other.
 */

import { CATALOGUE_COLLECTIONS } from "./catalogue.mjs";
import { COMMERCE_COLLECTIONS } from "./commerce.mjs";
import { CORE_COLLECTIONS } from "./core.mjs";

export const COLLECTIONS = [...CORE_COLLECTIONS, ...CATALOGUE_COLLECTIONS, ...COMMERCE_COLLECTIONS];

/** Collection name → definition, for the verifier and the reference guard. */
export const COLLECTIONS_BY_NAME = Object.fromEntries(COLLECTIONS.map((c) => [c.name, c]));

/** Names only, sorted — used by tests to prove nothing was added or lost silently. */
export const COLLECTION_NAMES = COLLECTIONS.map((c) => c.name).sort();

/**
 * Collections that are infrastructure rather than business data: the migration ledger, the C3
 * continuity guard and the protected platform identity (W2.2). They have hand-written validators
 * (db/ledger.mjs, db/guards.mjs), no Prisma model
 * — `prisma/schema.prisma` is frozen at the PostgreSQL M1 datamodel — and are excluded from every
 * "is this a declared collection?" comparison.
 *
 * The literals are duplicated from those modules to avoid an import cycle (ledger.mjs → migrations →
 * this file, and guards.mjs → nothing). `scripts/check-adversarial.mjs` asserts they still match, so
 * the duplication cannot drift silently.
 */
export const INFRASTRUCTURE_COLLECTIONS = [
  "_schema_migrations",
  "_permission_guards",
  "_platform_identity",
];

/**
 * Append-only collections (D-2 and its equivalents). The DAO exposes insert + find for these and
 * nothing else, and the deployment grants the application role no update/delete privilege on them.
 */
export const IMMUTABLE_COLLECTIONS = COLLECTIONS.filter((c) => c.immutable).map((c) => c.name).sort();

/**
 * Prisma model → collection. `MigrationRun` is deliberately absent below: the D8 migration-run record
 * IS the `_schema_migrations` ledger, and maintaining a second ledger would let the two disagree.
 */
export const MODEL_TO_COLLECTION = Object.fromEntries(
  COLLECTIONS.filter((c) => c.model).map((c) => [c.model, c.name]),
);