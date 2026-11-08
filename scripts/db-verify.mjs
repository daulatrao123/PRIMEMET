#!/usr/bin/env node
/**
 * PRIMEMET — offline validation of the MongoDB definitions.
 *
 *   node scripts/db-verify.mjs --validate-only   no database required
 *   node scripts/db-verify.mjs                   also connects and verifies the live database
 *
 * `--validate-only` answers a different question from `npm run db:verify`:
 *
 *   db-verify --validate-only   "is the DEFINITION internally sound?"        — no server, no network
 *   db-verify (default)         "does the LIVE database match the definition?"
 *
 * The offline half exists because a validator bug is invisible until something writes. A wrong
 * `bsonType` name (e.g. "boolean" instead of "bool") or a `ref` pointing at a missing collection
 * produces a database that refuses every insert — and the failure appears at runtime, in production,
 * not here. Each check below corresponds to a bug this project actually hit or could hit.
 */

import { COLLECTIONS, COLLECTION_NAMES, IMMUTABLE_COLLECTIONS, MODEL_TO_COLLECTION } from "../db/collections/index.mjs";
import { plansFor, UUID_PATTERN } from "../db/define.mjs";
import { ENUMS } from "../db/enums.mjs";
import { auditRoleDefinitions, buildRoleDefinitions } from "../db/roles.mjs";
import { checkTarget } from "./db-guard.mjs";

const validateOnly = process.argv.includes("--validate-only");

let passed = 0;
const failures = [];
function ok(name) {
  passed += 1;
  if (!validateOnly) process.stdout.write(`  \u2714 ${name}\n`);
}
function fail(name, detail) {
  failures.push(detail ? `${name} — ${detail}` : name);
  process.stdout.write(`  \u2716 ${name}${detail ? ` — ${detail}` : ""}\n`);
}

// The BSON types MongoDB accepts in $jsonSchema. "boolean" is NOT one of them — using it makes every
// write fail with "Unknown type name alias", which is exactly the defect this check was added after.
const BSON_TYPES = new Set([
  "double", "string", "object", "array", "binData", "undefined", "objectId", "bool", "date", "null",
  "regex", "dbPointer", "javascript", "symbol", "javascriptWithScope", "int", "timestamp", "long",
  "decimal", "minKey", "maxKey",
]);

const SCHEMA_KEYWORDS = new Set([
  "bsonType", "required", "properties", "additionalProperties", "enum", "pattern", "minLength",
  "maxLength", "minimum", "maximum", "items", "description", "minItems", "maxItems",
]);

/**
 * A collection validator is a QUERY, not a bare schema: its top level is {$jsonSchema} or {$and:[…]}.
 * Walking it as if it were a schema rejected every real validator — the checker was wrong, not the
 * definitions.
 */
function walkValidator(query, path, problems) {
  if (!query || typeof query !== "object") return;
  for (const [key, value] of Object.entries(query)) {
    if (key === "$jsonSchema") {
      walkSchema(value, path, problems);
    } else if (key === "$and" || key === "$or" || key === "$nor") {
      if (!Array.isArray(value)) {
        problems.push(`${path}: ${key} must be an array`);
        continue;
      }
      value.forEach((clause, i) => walkValidator(clause, `${path}.${key}[${i}]`, problems));
    }
    // Other top-level query operators (field predicates, $expr) are not JSON-Schema keywords and are
    // validated by the server; this checker only guards the schema vocabulary and type names.
  }
}

function walkSchema(schema, path, problems) {
  if (!schema || typeof schema !== "object") return;
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties") {
      for (const [prop, sub] of Object.entries(value)) walkSchema(sub, `${path}.${prop}`, problems);
      continue;
    }
    if (key === "items") {
      walkSchema(value, `${path}[]`, problems);
      continue;
    }
    if (!SCHEMA_KEYWORDS.has(key)) problems.push(`${path}: unknown schema keyword "${key}"`);
    if (key === "bsonType") {
      for (const t of Array.isArray(value) ? value : [value]) {
        if (!BSON_TYPES.has(t)) problems.push(`${path}: unknown bsonType "${t}"`);
      }
    }
    if (key === "pattern") {
      try {
        new RegExp(value);
      } catch {
        problems.push(`${path}: invalid pattern ${value}`);
      }
    }
  }
}

process.stdout.write("PRIMEMET — offline definition validation\n\n");

// ---------------------------------------------------------------------------
// 1. Shape
// ---------------------------------------------------------------------------
for (const def of COLLECTIONS) {
  if (!def.name || typeof def.name !== "string") fail(`collection has a name`, String(def.name));
  else if (!/^[a-z][a-z0-9_]*$/.test(def.name)) fail(`collection name is snake_case`, def.name);
  else ok(`collection name ${def.name}`);

  if (!def.model) fail(`collection ${def.name} declares its Prisma model`);
  else ok(`collection ${def.name} declares model ${def.model}`);

  if (typeof def.notes !== "string") fail(`collection ${def.name} declares notes as text`);
  else ok(`collection ${def.name} declares notes as text`);
}

// Duplicate names would mean one collection silently shadows another.
const dupes = COLLECTION_NAMES.filter((n, i) => COLLECTION_NAMES.indexOf(n) !== i);
if (dupes.length === 0) ok(`no duplicate collection name (${COLLECTION_NAMES.length} collections)`);
else fail("no duplicate collection name", dupes.join(", "));

// ---------------------------------------------------------------------------
// 2. Validators
// ---------------------------------------------------------------------------
for (const def of COLLECTIONS) {
  const plan = plansFor(def);
  const problems = [];
  walkValidator(plan.validator, def.name, problems);
  if (problems.length === 0) ok(`validator for ${def.name} uses only valid schema keywords`);
  else fail(`validator for ${def.name} is well-formed`, problems.slice(0, 3).join(" | "));

  if (!("_id" in def.fields)) fail(`collection ${def.name} declares _id`);
  else ok(`collection ${def.name} declares _id`);
}

// ---------------------------------------------------------------------------
// 3. References
// ---------------------------------------------------------------------------
const names = new Set(COLLECTION_NAMES);
for (const def of COLLECTIONS) {
  for (const [field, spec] of Object.entries(def.fields)) {
    if (!spec || typeof spec !== "object" || !spec.ref) continue;
    if (!names.has(spec.ref)) {
      fail(`reference ${def.name}.${field} has a target`, `"${spec.ref}" is not a known collection`);
    } else {
      ok(`reference ${def.name}.${field} → ${spec.ref}`);
    }
    // A reference must not force UUID shape onto a natural-key target.
    const naturalKeyTargets = ["tax_components_ref", "reference_sequences"];
    if (naturalKeyTargets.includes(spec.ref) && spec.pattern === UUID_PATTERN) {
      fail(
        `reference ${def.name}.${field} does not impose a UUID pattern on a natural-key target`,
        `"${spec.ref}" is keyed by a code, not a UUID`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Enum references
// ---------------------------------------------------------------------------
for (const def of COLLECTIONS) {
  for (const [field, spec] of Object.entries(def.fields)) {
    if (!spec || !Array.isArray(spec.enum)) continue;
    const stillHasNull = spec.enum.includes(null);
    if (stillHasNull && spec.bsonType === "string") {
      fail(`enum on ${def.name}.${field} matches its bsonType`, "enum allows null but bsonType is string only");
    } else {
      ok(`enum on ${def.name}.${field} is consistent (${spec.enum.filter((v) => v !== null).length} values)`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Index names — globally unique, inside MongoDB's 128-byte limit
// ---------------------------------------------------------------------------
const seenIndex = new Map();
let indexCount = 0;
for (const def of COLLECTIONS) {
  for (const index of plansFor(def).indexes) {
    indexCount += 1;
    if (!index.name) {
      fail(`index on ${def.name} is named`);
      continue;
    }
    if (Buffer.byteLength(index.name, "utf8") > 128) {
      fail(`index name ${index.name} is within 128 bytes`, `${Buffer.byteLength(index.name, "utf8")} bytes`);
    }
    if (seenIndex.has(index.name)) {
      fail(
        `index name ${index.name} is unique`,
        `also used on ${seenIndex.get(index.name)} — PostgreSQL truncated such collisions onto one identifier`,
      );
    } else {
      seenIndex.set(index.name, def.name);
      ok(`index ${index.name} is unique and well-sized`);
    }
    if (!index.key || Object.keys(index.key).length === 0) fail(`index ${index.name} has a key`);
    else ok(`index ${index.name} has a key`);
  }
}

// ---------------------------------------------------------------------------
// 6. Mapping completeness — every Prisma model, no orphans
// ---------------------------------------------------------------------------
const mapped = new Set(Object.keys(MODEL_TO_COLLECTION));
if (mapped.size === COLLECTIONS.length) ok(`all ${mapped.size} collections declare a distinct Prisma model`);
else fail("every collection declares a distinct Prisma model", `${mapped.size} models for ${COLLECTIONS.length} collections`);

// ---------------------------------------------------------------------------
// 7. Append-only set and role separation
// ---------------------------------------------------------------------------
if (IMMUTABLE_COLLECTIONS.length === 0) fail("the append-only set is not empty");
else ok(`${IMMUTABLE_COLLECTIONS.length} collections are marked append-only`);

const roleProblems = auditRoleDefinitions();
if (roleProblems.length === 0) ok("no role grants update/delete on an append-only collection");
else fail("no role grants update/delete on an append-only collection", roleProblems.join("; "));

const roles = buildRoleDefinitions();
if (roles.some((r) => r.role === "primemet_app") && roles.some((r) => r.role === "primemet_owner")) {
  ok(`role definitions cover the application identity and the owner identity (${roles.length} roles)`);
} else fail("role definitions cover the application identity and the owner identity");

if (roles.some((r) => r.role === "primemet_migrator")) {
  fail("the initialization role is named primemet_owner", "a stale primemet_migrator role is still defined");
} else ok("the initialization role is named primemet_owner");

// ---------------------------------------------------------------------------
// 8. Enumerations came from the Prisma schema
// ---------------------------------------------------------------------------
if (Object.keys(ENUMS).length > 0) ok(`${Object.keys(ENUMS).length} enums available to validators`);
else fail("enums are generated", "db/enums.mjs is empty — run npm run db:enums");

process.stdout.write(
  `\nOffline validation: ${passed} passed, ${failures.length} failed (${COLLECTIONS.length} collections, ${indexCount} indexes)\n`,
);

if (failures.length > 0) {
  for (const f of failures) process.stdout.write(`  \u2716 ${f}\n`);
  process.exit(1);
}

if (validateOnly) {
  process.stdout.write("No database was contacted (--validate-only).\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Optional: also verify the live database.
// ---------------------------------------------------------------------------
const uri = process.env.MONGODB_URI;
if (!uri) {
  process.stdout.write(
    "\nNo MONGODB_URI set, so live verification was skipped. Run with --validate-only for the offline\n" +
      "check only, or set MONGODB_URI to compare the database against these definitions.\n",
  );
  process.exit(0);
}

const { MongoClient } = await import("mongodb");
const { verifyDatabase } = await import("../db/verify.mjs");

// Remediation P1.2/P1.5: no implicit database name. A live verification without `MONGODB_DB` used to
// read the production database name and compare it against these definitions, which is the one thing
// a staging check must never do by accident.
const target = checkTarget(process.env, { requiresEnvironment: false });
if (!target.ok) {
  process.stdout.write(`\n\u2716 ${target.reason}\n`);
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
try {
  await client.connect();
  const db = client.db(target.target.database);
  const result = await verifyDatabase(db, { collections: COLLECTION_NAMES });
  process.stdout.write(`\nLive verification: ${result.passed} passed, ${result.failed} failed\n`);
  for (const f of result.failures) process.stdout.write(`  \u2716 ${f}\n`);
  await client.close();
  process.exit(result.failed > 0 ? 1 : 0);
} catch (error) {
  process.stdout.write(`\n\u2716 Live verification failed: ${error && error.message ? error.message : error}\n`);
  try {
    await client.close();
  } catch {
    /* nothing useful to do */
  }
  process.exit(1);
}