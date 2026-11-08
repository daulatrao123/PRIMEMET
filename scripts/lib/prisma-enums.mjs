/**
 * PRIMEMET — Prisma enum parser.
 *
 * One parser, used by the generator (`scripts/gen-mongo-enums.mjs`) and by the regression test
 * (`scripts/check-enums.mjs`). Sharing it is deliberate: a test that reimplements the parser can only
 * prove that two implementations agree, not that the generated file is correct.
 *
 * Defect C (independent audit): the previous generator split each enum body on whitespace and kept
 * every token matching `/^[A-Z][A-Z0-9_]*$/`. Prisma `///` documentation comments live *inside* the
 * enum body, so `/// The phrase is a designation of the SAME material` contributed `SAME`, and
 * `/// The phrase names an ISRI specification grade` contributed `ISRI` and `A`. Four words of English
 * prose became valid enum values in the MongoDB validators.
 *
 * The rule now: a line that is a comment contributes nothing, and only the leading token of a real
 * value line is a value.
 */

const VALUE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Parse every `enum Name { … }` block from a Prisma schema.
 *
 * Handles: `///` doc comments (whole line), `//` comments (whole line and trailing), blank lines,
 * block attributes (`@@map`), and field attributes (`@map`) on a value.
 *
 * @param {string} schemaText
 * @returns {Record<string, string[]>} enum name → values, in declaration order
 */
export function parsePrismaEnums(schemaText) {
  const enums = {};
  const enumRe = /^enum\s+(\w+)\s*(?:@\w+(?:\([^)]*\))?\s*)*\{([\s\S]*?)^\}/gm;

  let match;
  while ((match = enumRe.exec(schemaText)) !== null) {
    const [, name, body] = match;
    const values = [];
    const seen = new Set();

    for (const rawLine of body.split(/\r?\n/)) {
      let line = rawLine.trim();

      if (line === "") continue;
      // Whole-line comments: Prisma documentation (`///`) and ordinary comments (`//`).
      if (line.startsWith("///") || line.startsWith("//")) continue;
      // Block attributes such as `@@map("...")` are not values.
      if (line.startsWith("@@")) continue;

      // A trailing comment on a value line: `ACTIVE @map("active") // note`
      const commentAt = line.indexOf("//");
      if (commentAt !== -1) line = line.slice(0, commentAt).trim();
      if (line === "") continue;

      // The value is the leading token; anything after it is a field attribute.
      const token = line.split(/[\s@]+/)[0];
      if (!VALUE.test(token)) continue;
      if (seen.has(token)) continue;

      seen.add(token);
      values.push(token);
    }

    if (values.length === 0) {
      throw new Error(`Enum "${name}" parsed to zero values — the parser or the schema is wrong.`);
    }
    enums[name] = values;
  }

  if (Object.keys(enums).length === 0) {
    throw new Error("No enums found — is prisma/schema.prisma present and unchanged in shape?");
  }
  return enums;
}