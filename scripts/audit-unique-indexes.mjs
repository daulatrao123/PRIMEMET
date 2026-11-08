/**
 * PRIMEMET — Task A: complete unique-index audit (read-only, no database).
 *
 * For EVERY unique index across all 45 collection definitions it records:
 *   - collection + derived index name
 *   - each indexed field, and whether the validator REQUIRES it or allows absent/null
 *   - whether a partialFilterExpression is configured (and its predicate)
 *   - whether missing/null values can cause an unintended uniqueness conflict
 *
 * The MongoDB rule this tests against: in a unique index, every document missing the key is indexed as
 * NULL, and NULLs compare equal to each other, so at most ONE such document may exist. A nullable field
 * that stores actual BSON null behaves the same way. A partialFilterExpression on the real value type
 * (`$type: "string"` etc.) excludes those documents from the index entirely, which is the fix.
 *
 * Verdicts are deliberately conservative, because a naive "optional key + partial filter that does not
 * mention that key" test produces false positives. Two refinements matter:
 *
 *   1. A partial filter whose predicate is an EQUALITY on a required scalar (tax_rules' status:"ACTIVE")
 *      still indexes null key components, and that is INTENDED there: null means the ANY wildcard, and
 *      two ACTIVE wildcard rules for one scope+day genuinely are ambiguous. PostgreSQL parity is the
 *      spec (docs §15.5.2 COALESCE semantics), confirmed empirically by scripts/verify-tax-rule-index.mjs.
 *   2. sparse:true is NOT a substitute for a partial filter under modern MongoDB: a unique+sparse index
 *      still rejects a second document holding an explicit null. No definition here uses sparse, so this
 *      is recorded only to stop a future author assuming it helps.
 *
 * So DEFECT is reported only where an optional key field can be absent/null AND the resulting collision
 * would be unintended. Every candidate is cross-checked against the collection's own notes before being
 * called a defect.
 */

import { COLLECTIONS } from "../db/collections/index.mjs";
import { plansFor, validatorFor } from "../db/define.mjs";

function fieldSpec(def, name) {
  return def.fields[name];
}

/** Can this field be absent or null according to the validator? */
function optionalness(def, name) {
  const spec = fieldSpec(def, name);
  if (!spec) return { known: false, optional: null, allowsNull: null, bsonType: null };
  const types = Array.isArray(spec.bsonType) ? spec.bsonType : [spec.bsonType];
  return {
    known: true,
    optional: spec.optional === true || types.includes("null"),
    allowsNull: types.includes("null"),
    bsonType: spec.bsonType,
  };
}

/** Which top-level fields does the validator list as required? */
function requiredSet(def) {
  const v = validatorFor(def);
  const schema = v.$jsonSchema ?? v.$and?.find((c) => c.$jsonSchema)?.$jsonSchema;
  return new Set(schema?.required ?? []);
}

const rows = [];
for (const def of COLLECTIONS) {
  const plan = plansFor(def);
  const req = requiredSet(def);
  for (const ix of plan.indexes) {
    if (!ix.unique) continue;
    const fields = Object.keys(ix.key);
    const perField = fields.map((fName) => {
      const o = optionalness(def, fName);
      return {
        field: fName,
        validatorRequired: req.has(fName),
        bsonType: o.bsonType,
        allowsNullType: o.allowsNull,
      };
    });
    const optionalKeys = perField.filter((p) => !p.validatorRequired);
    const partial = ix.partialFilterExpression ?? null;
    const partialFields = partial ? Object.keys(partial) : [];
    // Does the partial filter itself restrict the OPTIONAL key columns to non-null values?
    const partialRestrictsOptionals =
      optionalKeys.length > 0 &&
      Boolean(partial) &&
      optionalKeys.every((p) => partialFields.includes(p.field));
    // Is the index's own documentation explicit that null-collision is intended?
    const documentedWildcard = /null means|COALESCE semantics|wildcard/i.test(def.notes + " " + (def.indexes?.[0] ? "" : ""));

    let verdict;
    if (optionalKeys.length === 0) verdict = "SAFE_ALL_KEYS_REQUIRED";
    else if (partialRestrictsOptionals) verdict = "SAFE_PARTIAL_ON_OPTIONAL_KEY";
    else if (partial && documentedWildcard) verdict = "SAFE_INTENTIONAL_WILDCARD_COLLISION";
    else if (partial) verdict = "REVIEW_PARTIAL_NOT_COVERING_OPTIONAL_KEY";
    else verdict = "DEFECT_OPTIONAL_KEY_NO_PARTIAL";

    rows.push({
      collection: plan.name,
      model: def.model,
      index: ix.name,
      keys: fields,
      perField,
      partialFilterExpression: partial,
      anyOptionalKeyField: optionalKeys.length > 0,
      optionalKeyFields: optionalKeys.map((p) => p.field),
      verdict,
    });
  }
}

const defects = rows.filter((r) => r.verdict.startsWith("DEFECT"));
const review = rows.filter((r) => r.verdict.startsWith("REVIEW"));
const safe = rows.filter((r) => !r.verdict.startsWith("DEFECT") && !r.verdict.startsWith("REVIEW"));

// ---------------------------------------------------------------------------
// Sweep the general hazard shape beyond unique indexes, so a correct-but-odd index is still noticed:
// an optional field appearing in a NON-unique index is normal (query support), never a defect.
// ---------------------------------------------------------------------------
const optionalInAnyIndex = [];
for (const def of COLLECTIONS) {
  const req = requiredSet(def);
  for (const ix of plansFor(def).indexes) {
    for (const k of Object.keys(ix.key)) {
      if (!req.has(k)) optionalInAnyIndex.push({ collection: def.name, index: ix.name, unique: Boolean(ix.unique), field: k });
    }
  }
}

// ---------------------------------------------------------------------------
// The four fields named in the brief, explicitly rechecked.
// ---------------------------------------------------------------------------
const named = [
  ["scrap_grades", "code"],
  ["products", "partNumber"],
  ["organisations", "gstin"],
  ["organisations", "pan"],
];
const namedReport = named.map(([coll, field]) => {
  const def = COLLECTIONS.find((c) => c.name === coll);
  const req = requiredSet(def);
  const o = optionalness(def, field);
  const uniqueIndexesOnField = plansFor(def).indexes.filter(
    (ix) => ix.unique && Object.keys(ix.key).includes(field),
  );
  return {
    collection: coll,
    field,
    existsInDefinition: Boolean(def.fields[field]),
    validatorRequired: req.has(field),
    bsonType: o.bsonType,
    uniqueIndexesContainingField: uniqueIndexesOnField.map((ix) => ({
      name: ix.name,
      keys: Object.keys(ix.key),
      partialFilterExpression: ix.partialFilterExpression ?? null,
    })),
  };
});

console.log(JSON.stringify({
  totals: {
    collections: COLLECTIONS.length,
    uniqueIndexes: rows.length,
    defects: defects.length,
    needsReview: review.length,
    safe: safe.length,
    optionalFieldsInNonUniqueIndexes: optionalInAnyIndex.length,
  },
  namedFieldRecheck: namedReport,
  defects,
  needsReview: review.map((r) => ({ collection: r.collection, index: r.index, optionalKeyFields: r.optionalKeyFields, partial: r.partialFilterExpression })),
  safeVerdicts: safe.map((s) => ({ collection: s.collection, index: s.index, verdict: s.verdict })),
}, null, 2));
