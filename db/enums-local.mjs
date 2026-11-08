/**
 * PRIMEMET — enumerated value sets that Prisma does not declare.
 *
 * WHY THIS FILE EXISTS. `prisma/schema.prisma` is the single source of truth for enum membership, and
 * `db/enums.mjs` is generated from it (architecture §5.1 — an enum value is append-only). D-ARCH-12
 * introduces `REVOKE` as a third grant effect, but the Prisma model `AdminPermissionGrant` declares
 * `effect String` and the historical migrations that created it are frozen: adding a Prisma enum there
 * would either rewrite a shipped migration or leave the column type out of step with the enum.
 *
 * So the value set MongoDB must enforce is declared here, next to the MongoDB definition that uses it,
 * and merged into the generated enum file. The merge is fail-closed: `scripts/lib/mongo-enums.mjs`
 * throws if a name here also appears in the Prisma schema, so this file can never silently shadow or
 * contradict the schema of record. A future PostgreSQL enum is then a deliberate decision, not an
 * accidental duplicate.
 *
 * RULES FOR ADDING A NAME HERE
 *   1. The name must not exist in prisma/schema.prisma. (Enforced — the generator fails.)
 *   2. Values are UPPER_SNAKE, non-empty, unique, and append-only once shipped.
 *   3. A name added here is a fact the database enforces. Removing a value is a data migration, not a
 *      text edit; nothing here may be reordered after release.
 */

/**
 * AdminPermissionGrant.effect (D-ARCH-12, owner-approved 2026-11-01).
 *
 * GRANT  — the permission is held, whatever the tier default says.
 * DENY   — the permission is not held, whatever the tier default says.
 * REVOKE — the explicit override is removed; the admin tier default decides again.
 *
 * `REVOKE` is deliberately NOT a synonym for `DENY`: a deny-wins reading of this list is exactly the
 * contradiction D-ARCH-12 resolved, and `src/lib/permissions/resolve.ts` implements the approved
 * latest-event-wins semantics against these three values.
 */
export const GrantEffect = ["GRANT", "DENY", "REVOKE"];

/** Every locally declared enum, keyed by name. Merged into db/enums.mjs by the generator. */
export const LOCAL_ENUMS = { GrantEffect };