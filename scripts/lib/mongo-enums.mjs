/**
 * PRIMEMET — enum assembly and serialisation, shared by the generator and its checker.
 *
 * WHY A SHARED MODULE. `scripts/gen-mongo-enums.mjs` writes `db/enums.mjs` and
 * `scripts/check-enums.mjs` proves it has not drifted. Before this module they each built the target
 * text themselves, so a change to one header or one ordering rule could make the checker disagree with
 * the generator about what "correct" means. Parsing already lives in `scripts/lib/prisma-enums.mjs` for
 * the same reason; assembly and rendering live here.
 *
 * The merge is FAIL-CLOSED in both directions:
 *   - a local name that Prisma also declares is an error (two sources of truth for one value set)
 *   - a local value set that is empty, duplicated, or not UPPER_SNAKE is an error (a validator that
 *     accepts everything, or nothing, is worse than no validator)
 */

import { LOCAL_ENUMS } from "../../db/enums-local.mjs";

const VALUE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

/**
 * Merge locally declared enums into the parsed Prisma enums.
 *
 * @param {Record<string, string[]>} prismaEnums values parsed from prisma/schema.prisma
 * @param {Record<string, string[]>} [localEnums] defaults to the declared local set; the checker
 *   passes deliberate violations here to prove each rule actually rejects
 * @returns {Record<string, string[]>} the complete value sets MongoDB must enforce
 * @throws {Error} on a name collision, an empty set, a duplicate, or a malformed name or value
 */
export function buildEnums(prismaEnums, localEnums = LOCAL_ENUMS) {
  const merged = { ...prismaEnums };

  for (const [name, values] of Object.entries(localEnums)) {
    if (Object.prototype.hasOwnProperty.call(prismaEnums, name)) {
      throw new Error(
        `local enum "${name}" is already declared in prisma/schema.prisma — ` +
          `remove it from db/enums-local.mjs, or rename it. One value set has one source of truth.`,
      );
    }
    if (!NAME_PATTERN.test(name)) {
      throw new Error(`local enum name "${name}" is not PascalCase`);
    }
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`local enum "${name}" has no values — a validator that accepts nothing is a bug`);
    }
    const seen = new Set();
    for (const value of values) {
      if (typeof value !== "string" || !VALUE_PATTERN.test(value)) {
        throw new Error(`local enum "${name}" value ${JSON.stringify(value)} is not UPPER_SNAKE_CASE`);
      }
      if (seen.has(value)) throw new Error(`local enum "${name}" repeats the value "${value}"`);
      seen.add(value);
    }
    merged[name] = [...values];
  }

  return merged;
}

/**
 * Render `db/enums.mjs` for a complete set of value sets.
 *
 * Names are sorted so the file is stable under regeneration, and each export is one line so a diff
 * shows exactly which value set changed.
 *
 * @param {Record<string, string[]>} enums
 * @returns {string} the whole file
 */
export function renderEnums(enums) {
  const names = Object.keys(enums).sort();
  const localCount = Object.keys(LOCAL_ENUMS).length;

  let out = `/**
 * PRIMEMET — enumerated value sets, for MongoDB validators.
 *
 * GENERATED from prisma/schema.prisma by scripts/gen-mongo-enums.mjs. Do not hand-edit: the Prisma
 * schema remains the single source of truth for enum membership (architecture §5.1 — an enum value is
 * append-only), and MongoDB validators enforce those sets on every insert and update.
 *
 * ${localCount === 0 ? "No local additions." : `${localCount} locally declared name(s) are merged in from db/enums-local.mjs (Prisma declares no such enum).`}
 * ${names.length} enums. Regenerate with: npm run db:enums
 * Verify with:     npm run check:enums
 */

`;
  for (const name of names) out += `export const ${name} = ${JSON.stringify(enums[name])};\n`;
  out += `
/** Every enum, keyed by its Prisma name. Used by validator generation and by tests. */
export const ENUMS = {
${names.map((n) => `  ${n},`).join("\n")}
};
`;
  return out;
}
