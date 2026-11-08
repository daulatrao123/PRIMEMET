/**
 * PRIMEMET — ordered migration registry.
 *
 * ## Migration identity (F-1 remediation)
 *
 * A migration's `source` is **its own file, and nothing else**. `checksumOf(source)` is therefore an
 * immutable, migration-specific identity: editing any shared definition cannot change the checksum of
 * a migration that has already been applied.
 *
 * This replaces the previous design, which hashed the migration file **plus** every collection
 * definition, `define.mjs` and `enums.mjs` into `v001`. That made `v001`'s identity a function of
 * mutable files, and the independent audit reproduced the consequence: correcting one collection
 * definition changed `v001`'s checksum, so `v001` failed the drift check, `v002` was never reached and
 * reconciliation failed identically. There was no supported way to evolve the schema (defect F-1).
 *
 * ## Shared definitions are a target state, not an identity
 *
 * `db/collections/*.mjs`, `define.mjs` and `enums.mjs` still describe what the database should look
 * like — they are what `up()` converges to and what `verify` compares against. They are summarised by
 * `DEFINITIONS_DIGEST`, which is recorded in the ledger **when a migration is applied** (see
 * `db/ledger.mjs`), never inside a migration's checksum.
 *
 * That gives three distinct controls, each answering a different question:
 *
 *   | Question                                   | Answered by                        |
 *   | ------------------------------------------ | ---------------------------------- |
 *   | Has this applied migration been edited?    | migration checksum (its own file)  |
 *   | Has the declared schema moved on?          | `DEFINITIONS_DIGEST` vs the ledger |
 *   | Does the live database match the schema?   | `db/verify.mjs`                    |
 *
 * So a schema change is expressed the only safe way: edit the definitions **and** add a new version
 * whose `up()` converges them. `v002` records the new digest; `v001`'s identity is untouched.
 *
 * ## What a new migration must do
 *
 *   1. Add `v00N-<topic>.mjs` exporting `{ version, name, description, up }`.
 *   2. Register it below. Its `source` is read from its own file — never from a shared module.
 *   3. Make `up()` idempotent: create-if-absent, `collMod`, `createIndexes`. No drops.
 *
 * Applying is ordered by `version`, and `up()` is re-run by `--reconcile` for applied versions, so an
 * idempotent `up()` is a correctness requirement, not a style preference.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { V001 } from "./v001-initial-collections.mjs";
import { V002 } from "./v002-permission-grant-effects.mjs";
import { V003 } from "./v003-super-admin-continuity-guard.mjs";
import { V004 } from "./v004-organisation-kind.mjs";
import { V005 } from "./v005-platform-identity.mjs";
import { V006 } from "./v006-phase1-portal.mjs";
import { V007 } from "./v007-catalogue-media.mjs";
import { V008 } from "./v008-seller-portal.mjs";
import { V009 } from "./v009-admin-console.mjs";
import { V010 } from "./v010-platform-identity-collection.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dbRoot = join(here, "..");

function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Every collection definition module, concatenated in a stable order. */
function definitionSource() {
  const dir = join(dbRoot, "collections");
  return readdirSync(dir)
    .filter((n) => n.endsWith(".mjs"))
    .sort()
    .map((n) => readIfPresent(join(dir, n)))
    .join("\n");
}

/**
 * The declared schema, as text. Used ONLY to compute `DEFINITIONS_DIGEST` — never as a migration's
 * `source`. Keeping this out of migration identity is the whole point of the F-1 fix.
 */
export const DEFINITIONS_SOURCE = [
  definitionSource(),
  readIfPresent(join(dbRoot, "define.mjs")),
  readIfPresent(join(dbRoot, "enums.mjs")),
].join("\n");

/**
 * SHA-256 of the declared schema at this commit.
 *
 * Recorded in the ledger when a migration is applied and compared by `--verify-only`, `--reconcile`
 * and `apply`. A difference means the definitions moved without a version to carry the change, which
 * is exactly the situation that must not be resolved by reconcile.
 */
export const DEFINITIONS_DIGEST = createHash("sha256")
  .update(DEFINITIONS_SOURCE, "utf8")
  .digest("hex");

/**
 * A migration's immutable identity: the contents of its own file, and nothing else.
 *
 * `up` is a function and cannot be hashed meaningfully, so the file it is declared in is the unit of
 * identity. Anything that changes behaviour must therefore change the file, which is what the drift
 * check detects.
 */
function migrationFileSource(fileName) {
  const text = readIfPresent(join(here, fileName));
  if (text === "") throw new Error(`Migration file ${fileName} is missing or empty.`);
  return text;
}

export const MIGRATIONS = [
  {
    ...V001,
    file: "v001-initial-collections.mjs",
    source: migrationFileSource("v001-initial-collections.mjs"),
  },
  {
    ...V002,
    file: "v002-permission-grant-effects.mjs",
    source: migrationFileSource("v002-permission-grant-effects.mjs"),
  },
  {
    ...V003,
    file: "v003-super-admin-continuity-guard.mjs",
    source: migrationFileSource("v003-super-admin-continuity-guard.mjs"),
  },
  {
    ...V004,
    file: "v004-organisation-kind.mjs",
    source: migrationFileSource("v004-organisation-kind.mjs"),
  },
  {
    ...V005,
    file: "v005-platform-identity.mjs",
    source: migrationFileSource("v005-platform-identity.mjs"),
  },
  {
    ...V006,
    file: "v006-phase1-portal.mjs",
    source: migrationFileSource("v006-phase1-portal.mjs"),
  },
  {
    ...V007,
    file: "v007-catalogue-media.mjs",
    source: migrationFileSource("v007-catalogue-media.mjs"),
  },
  {
    ...V008,
    file: "v008-seller-portal.mjs",
    source: migrationFileSource("v008-seller-portal.mjs"),
  },
  {
    ...V009,
    file: "v009-admin-console.mjs",
    source: migrationFileSource("v009-admin-console.mjs"),
  },
  {
    ...V010,
    file: "v010-platform-identity-collection.mjs",
    source: migrationFileSource("v010-platform-identity-collection.mjs"),
  },
];

export function migrationSummary() {
  return MIGRATIONS.map((m) => ({
    version: m.version,
    name: m.name,
    file: m.file,
    description: m.description,
  }));
}