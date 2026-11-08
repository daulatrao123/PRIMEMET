/**
 * PRIMEMET — pre-flight inspection before a migration tightens a validator.
 *
 * THE ASSUMPTION THIS FILE EXISTS TO REMOVE. A migration that adds a rule reads as if the database
 * enforces it from that moment. It does not. MongoDB applies a validator to **future writes only**:
 * `collMod` with `validationLevel: "strict"` succeeds on a collection whose existing documents violate
 * the new schema, and nothing reports it. The migration then looks applied while the data underneath it
 * is incompatible with the rules the resolver is about to rely on. Verified against a real mongod in
 * `scripts/check-adversarial.mjs` §K: a row with `effect: "OWN"` survives the `collMod` that forbids it.
 *
 * So the check has to be explicit, it has to run **before** the validator is changed, and it has to
 * refuse rather than warn: a migration that cannot prove the existing data conforms must not proceed and
 * claim success. A refusal is recorded by the ledger as `failed`, the version stays unreused, and the
 * next attempt is a normal retry once the offending rows are corrected — which is the difference between
 * a migration that fails closed and one that quietly widens the gap.
 *
 * The queries are written by the migration, not derived from the definition: a definition describes what
 * a document may look like, and the question here is what the documents *do* look like. Deriving one from
 * the other would reproduce the same "it looks fine" problem in a second place.
 */

/**
 * @param {import("mongodb").Db} db
 * @param {string} name            collection to inspect
 * @param {Array<{rule: string, query: object, remedy: string}>} checks
 * @returns {Promise<{checked: number}>}  resolves only when every check found zero violations
 * @throws  when the collection holds a document the new definition would refuse
 */
export async function assertCollectionConforms(db, name, checks) {
  // A collection that does not exist yet has no documents that could disagree with the new definition;
  // v001 may not have created it on a database that is being built for the first time.
  const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
  if (!exists) return { checked: 0 };

  const violations = [];
  for (const check of checks) {
    const count = await db.collection(name).countDocuments(check.query);
    if (count > 0) violations.push({ rule: check.rule, remedy: check.remedy, count });
  }

  if (violations.length > 0) {
    const detail = violations
      .map((v) => `${v.count} document(s) fail "${v.rule}" — ${v.remedy}`)
      .join("; ");
    throw new Error(
      `PREFLIGHT_FAILED: ${name} contains documents the new definition would refuse: ${detail}. ` +
        "The validator was NOT changed and the migration was not recorded as applied. Correct or " +
        "export those documents, then retry the migration.",
    );
  }

  return { checked: checks.length };
}