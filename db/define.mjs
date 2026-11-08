/**
 * PRIMEMET — MongoDB collection definition DSL.
 *
 * Why this exists. The PostgreSQL schema enforced business rules with CHECK constraints, partial
 * unique indexes, an EXCLUDE constraint, composite foreign keys and triggers. MongoDB has none of
 * those. Rather than lose the rules, every one of them is re-expressed in the form MongoDB *does*
 * enforce server-side:
 *
 *   PostgreSQL                          MongoDB
 *   ----------------------------------  ------------------------------------------------------
 *   column type + NOT NULL              $jsonSchema bsonType + required
 *   enum type                           $jsonSchema enum
 *   CHECK (simple predicate)            a query operator in the collection validator
 *   CHECK (cross-field, same document)  $expr inside the validator
 *   CHECK (referring to another doc)    a denormalised gate written inside one transaction, plus a
 *                                       validator predicate proving the copy is self-consistent
 *   UNIQUE INDEX                        unique index
 *   partial UNIQUE INDEX WHERE …        unique index + partialFilterExpression
 *   EXCLUDE / btree_gist range overlap  unique index on (scope, range start) + a transactional
 *                                       overlap check in the write path (db/tax.mjs)
 *   FOREIGN KEY                         reference by _id + a transactional guard (db/refs.mjs);
 *                                       MongoDB cannot enforce it, so the residual risk is documented
 *   BEFORE UPDATE/DELETE trigger        no write method in the DAO + collection-level privilege
 *                                       separation (db/roles.mjs)
 *
 * A validator is data, so it lives here, version-controlled, rather than in a database console.
 *
 * Two vocabularies, kept apart on purpose:
 *   `optional: true`  — our marker: the field may be absent (a nullable PostgreSQL column)
 *   `required: [...]` — the JSON-Schema keyword, used only INSIDE a nested object
 * Conflating them silently deleted nested required lists, so they are separate keys.
 *
 * `_id` is the primary key and holds the UUID string. There is deliberately no second `id` field: two
 * copies of an identity can disagree, and only one can be indexed.
 */

export const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

const OPTIONAL = { optional: true };

/**
 * Resolve an enum's values, or refuse.
 *
 * WHY THIS THROWS. `enumOf` used to be written as `{ bsonType: "string", enum: ENUMS[name] }`. When the
 * name was unknown, `ENUMS[name]` was `undefined`, and `validatorFor()` serialises the definition
 * through `JSON.stringify`, which drops an undefined property — so the validator shipped as
 * `{ bsonType: "string" }`: every value accepted, no error, no warning. A typo silently removed a
 * constraint, and the same `undefined` spread into `enumOpt` produced `[null]`, a validator that
 * accepts nothing at all. Both directions are data-integrity failures, so both now fail at definition
 * time: the process cannot start with an unconstrained enum field.
 */
function enumValues(name, ENUMS) {
  const values = ENUMS?.[name];
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      `unknown or empty enum "${name}" — refusing to build a validator without its value set ` +
        `(db/enums.mjs is generated: run \`npm run db:enums\`)`,
    );
  }
  return values;
}

/**
 * Field factories. Each returns a JSON-Schema fragment plus our `optional` marker.
 *
 * Required by default, because the PostgreSQL columns were NOT NULL unless marked otherwise; making
 * optionality explicit and opt-in keeps the two schemas comparable field for field.
 */
export const f = {
  uuid: (o = {}) => ({ bsonType: "string", pattern: UUID_PATTERN, ...o }),

  str: (o = {}) => ({ bsonType: "string", ...o }),

  /** Nullable string — a PostgreSQL `text NULL`. */
  strOpt: (o = {}) => ({ bsonType: ["string", "null"], ...OPTIONAL, ...o }),

  bool: (o = {}) => ({ bsonType: "bool", ...o }),

  boolOpt: (o = {}) => ({ bsonType: ["bool", "null"], ...OPTIONAL, ...o }),

  int: (o = {}) => ({ bsonType: "int", ...o }),

  intOpt: (o = {}) => ({ bsonType: ["int", "null"], ...OPTIONAL, ...o }),

  /** PostgreSQL BigInt → BSON long. */
  long: (o = {}) => ({ bsonType: "long", ...o }),

  date: (o = {}) => ({ bsonType: "date", ...o }),

  dateOpt: (o = {}) => ({ bsonType: ["date", "null"], ...OPTIONAL, ...o }),

  /**
   * Money, rate, weight and quantity.
   *
   * `bsonType: "decimal"` is the whole point: a BSON double is refused by the database, so a float can
   * never reach a priced field. PostgreSQL used numeric(18,2)/(18,4)/(18,3); Decimal128 carries 34
   * significant digits, and scale discipline is enforced on the write path because a validator cannot
   * inspect a decimal's exponent.
   */
  decimal: (o = {}) => ({ bsonType: "decimal", ...o }),

  decimalOpt: (o = {}) => ({ bsonType: ["decimal", "null"], ...OPTIONAL, ...o }),

  /** PostgreSQL Json → a BSON document or array. */
  json: (o = {}) => ({ bsonType: ["object", "array"], ...o }),

  jsonOpt: (o = {}) => ({ bsonType: ["object", "array", "null"], ...OPTIONAL, ...o }),

  /** One of an enum's values. Throws on an unknown or empty enum name — see `enumValues`. */
  enumOf: (name, ENUMS, o = {}) => ({ bsonType: "string", enum: enumValues(name, ENUMS), ...o }),

  enumOpt: (name, ENUMS, o = {}) => ({
    bsonType: ["string", "null"],
    enum: [...enumValues(name, ENUMS), null],
    ...OPTIONAL,
    ...o,
  }),

  /**
   * An embedded sub-document with its own required fields (e.g. the equivalence gate).
   *
   * Note that `required` here is the JSON-Schema keyword for the CHILD fields, not our optionality
   * marker; optionality of the parent is set with `optional: true` in `o`.
   */
  object: (properties, o = {}) => ({
    bsonType: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(properties).map(([k, s]) => [k, stripInternal(s)]),
    ),
    required: Object.entries(properties)
      .filter(([, s]) => s.optional !== true)
      .map(([k]) => k),
    ...o,
  }),

  /** Array of strings, e.g. allowed values on a spec template attribute. */
  strArray: (o = {}) => ({ bsonType: "array", items: { bsonType: "string" }, ...o }),
};

/** Remove our markers (`optional`, `ref`) before handing a fragment to `$jsonSchema`. */
function stripInternal(spec) {
  // Copied rather than destructured: `const { optional, ref, ...json }` leaves unused bindings that
  // the project's lint rules reject, and omitting them with a throwaway name is no clearer.
  const json = { ...spec };
  delete json.optional;
  delete json.ref;
  return json;
}

/**
 * Define a collection.
 *
 * @param {object} def
 * @param {string} def.name       MongoDB collection name (snake_case, matching the PG table).
 * @param {string} def.model      Prisma model name — traceability between the two schemas.
 * @param {object} def.fields     Field name → `f.*` fragment.
 * @param {Array}  def.indexes    `{ keys, unique?, partialFilterExpression?, name? }`.
 * @param {Array}  def.invariants `{ rule, query }` — extra validator predicates, ANDed.
 * @param {boolean} def.immutable Append-only: the DAO exposes insert + find only.
 * @param {string} def.notes      Human note carried into documentation and the ledger.
 */
export function collection(def) {
  return { indexes: [], invariants: [], immutable: false, notes: "", ...def };
}

/** Build the `validator` document. A write is accepted only if the stored document matches it. */
export function validatorFor(def) {
  const properties = {};
  const required = [];

  for (const [key, spec] of Object.entries(def.fields)) {
    properties[key] = stripInternal(spec);
    if (spec.optional !== true) required.push(key);
  }

  const jsonSchema = { bsonType: "object", required, additionalProperties: false, properties };
  const clauses = [{ $jsonSchema: jsonSchema }];
  for (const inv of def.invariants) clauses.push(inv.query);

  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

/** Turn one collection definition into the create/index specs the migration runner applies. */
export function plansFor(def) {
  return {
    name: def.name,
    validator: validatorFor(def),
    indexes: def.indexes.map((ix) => ({
      key: ix.keys,
      name: ix.name ?? defaultIndexName(def.name, ix.keys, ix.unique, ix.partialFilterExpression),
      ...(ix.unique ? { unique: true } : {}),
      ...(ix.partialFilterExpression ? { partialFilterExpression: ix.partialFilterExpression } : {}),
      ...(ix.expireAfterSeconds !== undefined ? { expireAfterSeconds: ix.expireAfterSeconds } : {}),
    })),
  };
}

/**
 * Deterministic index names in the architecture document's `ix_<collection>_<cols>` convention (§8.1).
 *
 * PostgreSQL silently truncated several Prisma-generated names onto one identifier; naming them here
 * keeps every index distinguishable and makes a future index change unambiguous.
 */
export function defaultIndexName(coll, keys, unique, partial) {
  const cols = Object.keys(keys).join("_");
  let name = `ix_${coll}_${cols}`;
  if (unique) name += "_u";
  if (partial) name += "_p";
  return name.length > 100 ? name.slice(0, 100) : name;
}

// ---------------------------------------------------------------------------
// Reference vocabulary. Every field listed here was a foreign key in PostgreSQL, and every one is
// checked by db/refs.mjs inside the same transaction as the write that sets it.
// ---------------------------------------------------------------------------

/** A required reference to another collection. The value is that document's `_id`. */
export function ref(target, o = {}) {
  return { bsonType: "string", pattern: UUID_PATTERN, ref: target, ...o };
}

/**
 * A reference to a collection whose primary key is a NATURAL KEY, not a UUID (e.g. tax_components_ref,
 * keyed by the component code "GST"). Applying UUID_PATTERN to these rejected every valid value — the
 * pattern must follow the target's key shape, not a blanket assumption.
 */
export function refKey(target, o = {}) {
  return { bsonType: "string", ref: target, minLength: 1, ...o };
}

/** A nullable reference — a PostgreSQL `REFERENCES` on a nullable column. */
export function refOpt(target) {
  return { bsonType: ["string", "null"], pattern: UUID_PATTERN, ref: target, ...OPTIONAL };
}