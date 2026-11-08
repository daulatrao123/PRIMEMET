#!/usr/bin/env node
/**
 * PRIMEMET — enum generation regression tests (defect C).
 *
 * The generator once harvested words out of Prisma `///` documentation comments, so
 * `EquivalenceBasis` carried `SAME, AISI, ISRI, A` alongside its three real values. This suite exists
 * so that cannot recur silently:
 *
 *   - the checked-in db/enums.mjs must equal a fresh render of its two sources
 *   - every generated value must really be a value line in the schema (nothing invented)
 *   - no word that appears only inside a comment may become a value
 *   - a locally declared enum must not shadow a Prisma enum, and must be well formed
 *   - the synthetic parser cases below pin the behaviour even if the real schema changes shape
 *
 *   npm run check:enums
 *
 * No database, no network.
 */

import { readFileSync } from "node:fs";

import { ENUMS } from "../db/enums.mjs";
import { LOCAL_ENUMS } from "../db/enums-local.mjs";
import { buildEnums, renderEnums } from "./lib/mongo-enums.mjs";
import { parsePrismaEnums } from "./lib/prisma-enums.mjs";

let passed = 0;
const failures = [];
let skipped = 0;

function ok(name) {
  passed += 1;
  process.stdout.write(`  \u2714 ${name}\n`);
}
function fail(name, detail) {
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  process.stdout.write(`  \u2716 ${name}${detail ? ` — ${detail}` : ""}\n`);
}
function check(name, condition, detail) {
  if (condition) ok(name);
  else fail(name, detail);
}

const schema = readFileSync("prisma/schema.prisma", "utf8");
const parsed = parsePrismaEnums(schema);
const generated = ENUMS;

process.stdout.write("PRIMEMET — enum generation regression\n\n");

// ---------------------------------------------------------------------------
// 1. Generated file matches its two sources
// ---------------------------------------------------------------------------
process.stdout.write("Generated file vs declared sources\n");

const prismaNames = Object.keys(parsed).sort();
const localNames = Object.keys(LOCAL_ENUMS).sort();
const declaredNames = Object.keys(buildEnums(parsed)).sort();
const generatedNames = Object.keys(generated).sort();

check(`the schema declares ${prismaNames.length} enums`, prismaNames.length > 0, "none found");
check(
  `db/enums.mjs exports exactly the ${declaredNames.length} declared enums ` +
    `(${prismaNames.length} Prisma + ${localNames.length} local)`,
  declaredNames.length === generatedNames.length &&
    declaredNames.every((n, i) => n === generatedNames[i]),
  `declared=${declaredNames.length} generated=${generatedNames.length}`,
);

const mismatches = [];
for (const name of declaredNames) {
  const want = buildEnums(parsed)[name];
  const got = generated[name];
  if (!got) {
    mismatches.push(`${name}: missing from db/enums.mjs`);
    continue;
  }
  if (got.length !== want.length || want.some((v, i) => v !== got[i])) {
    mismatches.push(`${name}: declared=${JSON.stringify(want)} generated=${JSON.stringify(got)}`);
  }
}
check(
  "every enum's values and order match its declaring source exactly",
  mismatches.length === 0,
  mismatches.slice(0, 3).join(" | "),
);

// A fresh serialisation must be byte-identical, so a hand-edit to db/enums.mjs is caught.
const onDisk = readFileSync("db/enums.mjs", "utf8");
check(
  "db/enums.mjs is byte-identical to a fresh generation (no hand-edits)",
  onDisk === renderEnums(buildEnums(parsed)),
  "run `npm run db:enums`",
);

// ---------------------------------------------------------------------------
// 2. Defect C specifically: EquivalenceBasis
// ---------------------------------------------------------------------------
process.stdout.write("\nDefect C — EquivalenceBasis\n");

const WANT_BASIS = ["EXACT_DESIGNATION", "ISRI_EQUIVALENT", "PROCESS_SYNONYM"];
check(
  "EquivalenceBasis has exactly its three real values",
  JSON.stringify(generated.EquivalenceBasis) === JSON.stringify(WANT_BASIS),
  JSON.stringify(generated.EquivalenceBasis),
);
for (const junk of ["SAME", "AISI", "ISRI", "A"]) {
  check(
    `the documentation word "${junk}" is not an EquivalenceBasis value`,
    !(generated.EquivalenceBasis ?? []).includes(junk),
    "still present",
  );
}

// ---------------------------------------------------------------------------
// 3. Nothing invented: every value must be a real value line
// ---------------------------------------------------------------------------
process.stdout.write("\nNo invented values\n");

/** Raw `enum Name { … }` bodies, for an independent look at the source text. */
function rawBodies(text) {
  const out = {};
  const re = /^enum\s+(\w+)\s*(?:@\w+(?:\([^)]*\))?\s*)*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(text)) !== null) out[m[1]] = m[2];
  return out;
}

const bodies = rawBodies(schema);
const invented = [];
for (const [name, values] of Object.entries(generated)) {
  const body = bodies[name];
  if (body === undefined) {
    // A local enum has no Prisma body by construction; section 4 checks the merge instead.
    if (name in LOCAL_ENUMS) continue;
    invented.push(`${name}: no body`);
    continue;
  }
  // Leading tokens of lines that are not comments and not block attributes.
  const realValues = new Set(
    body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("///") && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.slice(0, l.indexOf("//") === -1 ? undefined : l.indexOf("//")).trim())
      .map((l) => l.split(/[\s@]+/)[0])
      .filter(Boolean),
  );
  for (const value of values) {
    if (!realValues.has(value)) invented.push(`${name}.${value}`);
  }
}
check(
  "every generated value is a genuine value line in the schema",
  invented.length === 0,
  invented.slice(0, 5).join(", "),
);

// ---------------------------------------------------------------------------
// 4. D-ARCH-12: locally declared enums
// ---------------------------------------------------------------------------
process.stdout.write("\nLocal enums — D-ARCH-12\n");

const shadowing = localNames.filter((n) => n in parsed);
check(
  "no local enum shadows an enum declared in prisma/schema.prisma",
  shadowing.length === 0,
  shadowing.join(", "),
);
check(
  "no local enum has a Prisma body (the merge is genuinely disjoint)",
  localNames.every((n) => !(n in bodies)),
  localNames.filter((n) => n in bodies).join(", "),
);

let buildError = null;
try {
  buildEnums(parsed);
} catch (error) {
  buildError = error;
}
check("the merged enum set builds without error", buildError === null, buildError?.message);

// The rejection rules are proven on deliberate violations, rather than assumed from the happy path.
const REJECTED_LOCALS = [
  ["a local name that Prisma already declares", { AdminTier: ["SHADOW"] }],
  ["an empty value set", { EmptySet: [] }],
  ["a non-PascalCase name", { bad_name: ["VALUE"] }],
  ["a lower-case value", { LowerCase: ["lower_case"] }],
  ["a repeated value", { Duplicated: ["A", "A"] }],
  ["a non-string value", { WrongType: [1] }],
];
for (const [label, localEnums] of REJECTED_LOCALS) {
  let rejected = false;
  try {
    buildEnums(parsed, localEnums);
  } catch {
    rejected = true;
  }
  check(`the merge refuses ${label}`, rejected, "it was accepted");
}

let acceptedWellFormed = null;
try {
  acceptedWellFormed = buildEnums(parsed, { ProbeEffect: ["ALLOW", "REVOKE"] }).ProbeEffect;
} catch (error) {
  acceptedWellFormed = error.message;
}
check(
  "the merge accepts a well-formed local set and keeps its order",
  JSON.stringify(acceptedWellFormed) === JSON.stringify(["ALLOW", "REVOKE"]),
  JSON.stringify(acceptedWellFormed),
);
const localShape = Object.entries(LOCAL_ENUMS).every(([name, values]) => {
  const pascal = /^[A-Z][A-Za-z0-9]*$/.test(name);
  const nonEmpty = Array.isArray(values) && values.length > 0;
  const upperSnake = nonEmpty && values.every((v) => /^[A-Z][A-Z0-9_]*$/.test(v));
  const unique = nonEmpty && new Set(values).size === values.length;
  return pascal && nonEmpty && upperSnake && unique;
});
check(
  "every local enum name is PascalCase and every value UPPER_SNAKE, unique and non-empty",
  localShape,
  JSON.stringify(LOCAL_ENUMS),
);

check(
  "GrantEffect is present in db/enums.mjs",
  Array.isArray(generated.GrantEffect),
  "missing",
);
check(
  "GrantEffect declares exactly GRANT, DENY and REVOKE, in that order",
  JSON.stringify(generated.GrantEffect) === JSON.stringify(["GRANT", "DENY", "REVOKE"]),
  JSON.stringify(generated.GrantEffect),
);
check(
  "REVOKE is reachable as a validator value (D-ARCH-12)",
  (generated.GrantEffect ?? []).includes("REVOKE"),
  "REVOKE absent — the resolver and the validator would disagree",
);
check(
  "GrantEffect declares no effect the resolver does not implement",
  (generated.GrantEffect ?? []).every((v) => ["GRANT", "DENY", "REVOKE"].includes(v)),
  JSON.stringify(generated.GrantEffect),
);

// ---------------------------------------------------------------------------
// 5. Comment words can never become values (synthetic, schema-independent)
// ---------------------------------------------------------------------------
process.stdout.write("\nComments cannot become values\n");

const synthetic = `enum Synthetic {
  /// The phrase is a designation of the SAME material, e.g. AISI 304.
  SAME_MEANING
  // An ordinary comment mentioning BOGUS TEXT.
  SECOND
  /// ISRI grade names are A COMMERCIAL equivalence
  THIRD @map("third")
  FOURTH // trailing COMMENT_WORD
  @@map("synthetic_enum")
}
`;
let syntheticValues = null;
try {
  syntheticValues = parsePrismaEnums(synthetic).Synthetic;
} catch (error) {
  fail("the parser handles a synthetic enum", error.message);
}
check(
  "only the four real values survive parsing",
  JSON.stringify(syntheticValues) === JSON.stringify(["SAME_MEANING", "SECOND", "THIRD", "FOURTH"]),
  JSON.stringify(syntheticValues),
);
for (const word of ["The", "SAME", "AISI", "BOGUS", "TEXT", "ISRI", "A", "COMMERCIAL", "COMMENT_WORD"]) {
  check(
    `the comment word "${word}" is ignored`,
    !(syntheticValues ?? []).includes(word),
    "became a value",
  );
}
check(
  "`@map` on a value does not change the value",
  (syntheticValues ?? []).includes("THIRD") && !(syntheticValues ?? []).includes("third"),
  JSON.stringify(syntheticValues),
);
check(
  "`@@map` on the enum is not treated as a value",
  !(syntheticValues ?? []).some((v) => v.startsWith("@@")),
  JSON.stringify(syntheticValues),
);

// ---------------------------------------------------------------------------
// 6. Every MongoDB enum reference resolves
// ---------------------------------------------------------------------------
process.stdout.write("\nValidator references resolve\n");

const collectionsSource = ["catalogue", "core", "index"]
  .map((n) => readFileSync(`db/collections/${n}.mjs`, "utf8"))
  .join("\n");
const referenced = [...collectionsSource.matchAll(/(?:enumOf|enumOpt|enumArray)\(\s*"(\w+)"/g)].map((m) => m[1]);
const uniqueReferenced = [...new Set(referenced)];
const missing = uniqueReferenced.filter((n) => !(n in generated));
check(
  `${uniqueReferenced.length} enum reference(s) in the collection definitions all resolve`,
  missing.length === 0,
  missing.join(", "),
);

// No collection may reference an enum with an empty value set — that validator would accept nothing.
const empty = uniqueReferenced.filter((n) => (generated[n] ?? []).length === 0);
check("no referenced enum has an empty value set", empty.length === 0, empty.join(", "));

check(
  "the permission grant collection validates its effect against GrantEffect",
  /effect:\s*f\.enumOf\(\s*"GrantEffect"/.test(collectionsSource),
  "admin_permission_grants.effect is not enum-constrained",
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failures.length} failed`);
if (skipped) process.stdout.write(`, ${skipped} skipped`);
process.stdout.write("\n");
if (failures.length > 0) {
  for (const f of failures) process.stdout.write(`  \u2716 ${f}\n`);
  process.exit(1);
}
process.exit(0);
