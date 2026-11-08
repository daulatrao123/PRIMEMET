/**
 * PRIMEMET — Task A: empirical verification of unique-index semantics.
 *
 * The static audit (scripts/audit-unique-indexes.mjs) contradicted the v002 proposal, so this harness
 * settles the question against a REAL mongod rather than by reasoning about MongoDB's rules. It runs on
 * throwaway in-memory replica sets; nothing is persisted and no project database is touched.
 *
 * Questions it answers with observed behaviour:
 *   Q1  Does a plain unique index reject the SECOND document that omits the key? (the hazard claim)
 *   Q2  Same for an explicit BSON null.
 *   Q3  Does partialFilterExpression {field:{$type:"string"}} exclude absent AND null documents,
 *       while still enforcing uniqueness among real strings?
 *   Q4  For tax_rules specifically: does its ACTIVE-scoped partial index treat a NULL transactionModel
 *       as a value that collides with another NULL (the documented COALESCE-equivalent intent), or does
 *       the second wildcard rule get rejected unintentionally?
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";

const results = [];
let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; results.push(["PASS", name, detail]); }
  else { failed++; results.push(["FAIL", name, detail]); }
}
function codeOf(err) { return err?.code ?? err?.codeName ?? String(err?.message).slice(0, 60); }
const isDup = (err) => err?.code === 11000 || err?.codeName === "DuplicateKey";

const server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
const client = new MongoClient(server.getUri());
await client.connect();

try {
  // -------------------------------------------------------------------------
  // Q1 / Q2 — plain unique index over an optional field
  // -------------------------------------------------------------------------
  const dbA = client.db("t_a_plain");
  await dbA.createCollection("c", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["_id", "name"],
        additionalProperties: false,
        properties: {
          _id: { bsonType: "string" },
          name: { bsonType: "string" },
          code: { bsonType: ["string", "null"] },
        },
      },
    },
    validationLevel: "strict",
    validationAction: "error",
  });
  await dbA.collection("c").createIndexes([{ key: { code: 1 }, name: "ix_code_u", unique: true }]);

  const r1 = await dbA.collection("c").insertOne({ _id: "a", name: "first-no-code" }).catch((e) => e);
  check("Q1 first document WITHOUT the key is accepted", !r1?.code, `got ${codeOf(r1)}`);

  const r2 = await dbA.collection("c").insertOne({ _id: "b", name: "second-no-code" }).catch((e) => e);
  check("Q1 second document WITHOUT the key is REJECTED (hazard confirmed)", isDup(r2), `got ${codeOf(r2)}`);

  const r3 = await dbA.collection("c").insertOne({ _id: "c", name: "explicit-null", code: null }).catch((e) => e);
  check("Q2 explicit null after a missing-key doc also REJECTED", isDup(r3), `got ${codeOf(r3)}`);

  const r4 = await dbA.collection("c").insertOne({ _id: "d", name: "real-code", code: "X1" }).catch((e) => e);
  check("Q2b a real string value is accepted alongside them", !r4?.code, `got ${codeOf(r4)}`);

  const r5 = await dbA.collection("c").insertOne({ _id: "e", name: "dup-code", code: "X1" }).catch((e) => e);
  check("Q2c duplicate real string still rejected", isDup(r5), `got ${codeOf(r5)}`);

  // -------------------------------------------------------------------------
  // Q3 — the proposed fix: partial index on $type:"string"
  // -------------------------------------------------------------------------
  const dbB = client.db("t_a_partial");
  await dbB.createCollection("c", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["_id", "name"],
        additionalProperties: false,
        properties: {
          _id: { bsonType: "string" },
          name: { bsonType: "string" },
          code: { bsonType: ["string", "null"] },
        },
      },
    },
    validationLevel: "strict",
    validationAction: "error",
  });
  await dbB.collection("c").createIndexes([{
    key: { code: 1 }, name: "ix_code_u_p", unique: true,
    partialFilterExpression: { code: { $type: "string" } },
  }]);

  const p1 = await dbB.collection("c").insertOne({ _id: "a", name: "no-code" }).catch((e) => e);
  const p2 = await dbB.collection("c").insertOne({ _id: "b", name: "also-no-code" }).catch((e) => e);
  const p3 = await dbB.collection("c").insertOne({ _id: "c", name: "null-code", code: null }).catch((e) => e);
  check("Q3 many absent-key docs coexist under the partial index", !p1?.code && !p2?.code && !p3?.code,
    `${codeOf(p1)}/${codeOf(p2)}/${codeOf(p3)}`);
  const p4 = await dbB.collection("c").insertOne({ _id: "d", name: "code-Y", code: "Y" }).catch((e) => e);
  const p5 = await dbB.collection("c").insertOne({ _id: "e", name: "code-Y-dup", code: "Y" }).catch((e) => e);
  check("Q3b uniqueness among real strings is preserved", !p4?.code && isDup(p5), `${codeOf(p4)}/${codeOf(p5)}`);
  const n = await dbB.collection("c").countDocuments();
  check("Q3c all four non-conflicting documents stored", n === 4, `count=${n}`);

  // -------------------------------------------------------------------------
  // Q4 — tax_rules' actual index: is the collision intended or a defect?
  //
  // The definition's own comment says null means 'every model/state' and "collides with another null,
  // exactly the COALESCE semantics". So a second ACTIVE rule with the same scope and same start date
  // SHOULD be rejected. What matters for correctness is whether two rules that are meant to be
  // DIFFERENT wildcards can coexist at all — they cannot, which is the documented PostgreSQL parity.
  // -------------------------------------------------------------------------
  const dbT = client.db("t_a_tax");
  await dbT.createCollection("tax_rules", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["_id", "componentCode", "invoiceRole", "effectiveFrom", "status"],
        additionalProperties: false,
        properties: {
          _id: { bsonType: "string" },
          componentCode: { bsonType: "string" },
          transactionModel: { bsonType: ["string", "null"] },
          invoiceRole: { bsonType: "string" },
          jurisdictionStateId: { bsonType: ["string", "null"] },
          effectiveFrom: { bsonType: "date" },
          status: { bsonType: "string" },
        },
      },
    },
    validationLevel: "strict",
    validationAction: "error",
  });
  await dbT.collection("tax_rules").createIndexes([{
    key: { componentCode: 1, transactionModel: 1, invoiceRole: 1, jurisdictionStateId: 1, effectiveFrom: 1 },
    name: "ix_scope_start_u_p", unique: true, partialFilterExpression: { status: "ACTIVE" },
  }]);

  const day = (d) => new Date(`2026-0${d}-01T00:00:00Z`);
  const t1 = await dbT.collection("tax_rules").insertOne({
    _id: "r1", componentCode: "GST", invoiceRole: "ANY", jurisdictionStateId: null,
    transactionModel: null, effectiveFrom: day(4), status: "ACTIVE",
  }).catch((e) => e);
  check("Q4 first ACTIVE wildcard rule accepted", !t1?.code, `got ${codeOf(t1)}`);

  const t2 = await dbT.collection("tax_rules").insertOne({
    _id: "r2", componentCode: "GST", invoiceRole: "ANY", jurisdictionStateId: null,
    transactionModel: null, effectiveFrom: day(4), status: "ACTIVE",
  }).catch((e) => e);
  check("Q4 identical-scope same-day ACTIVE rule REJECTED (matches the documented intent)", isDup(t2), `got ${codeOf(t2)}`);

  const t3 = await dbT.collection("tax_rules").insertOne({
    _id: "r3", componentCode: "GST", invoiceRole: "ANY", jurisdictionStateId: null,
    transactionModel: null, effectiveFrom: day(7), status: "ACTIVE",
  }).catch((e) => e);
  check("Q4b a rate change on a DIFFERENT start date is allowed", !t3?.code, `got ${codeOf(t3)}`);

  const t4 = await dbT.collection("tax_rules").insertOne({
    _id: "r4", componentCode: "GST", invoiceRole: "ANY", jurisdictionStateId: null,
    transactionModel: "PRINCIPAL", effectiveFrom: day(4), status: "ACTIVE",
  }).catch((e) => e);
  check("Q4c a PRINCIPAL-specific rule coexists with the wildcard one", !t4?.code, `got ${codeOf(t4)}`);

  const t5 = await dbT.collection("tax_rules").insertOne({
    _id: "r5", componentCode: "GST", invoiceRole: "ANY", jurisdictionStateId: null,
    transactionModel: "AGENCY", effectiveFrom: day(4), status: "ACTIVE",
  }).catch((e) => e);
  check("Q4d a second specific model also coexists", !t5?.code, `got ${codeOf(t5)}`);

  // The one case worth naming explicitly: two wildcards for DIFFERENT states.
  const t6 = await dbT.collection("tax_rules").insertOne({
    _id: "r6", componentCode: "GST", invoiceRole: "ANY", jurisdictionStateId: "MH",
    transactionModel: null, effectiveFrom: day(4), status: "ACTIVE",
  }).catch((e) => e);
  const t7 = await dbT.collection("tax_rules").insertOne({
    _id: "r7", componentCode: "GST", invoiceRole: "ANY", jurisdictionStateId: "DL",
    transactionModel: null, effectiveFrom: day(4), status: "ACTIVE",
  }).catch((e) => e);
  check("Q4e different jurisdictions do not collide", !t6?.code && !t7?.code, `${codeOf(t6)}/${codeOf(t7)}`);

  // -------------------------------------------------------------------------
  // Q5 — does the v002 proposal's premise hold for scrap_grades.code?
  // The proposal assumed code is optional. Test the real shape: REQUIRED string + plain unique index.
  // -------------------------------------------------------------------------
  const dbS = client.db("t_a_scrap");
  await dbS.createCollection("scrap_grades", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["_id", "code", "slug", "name"],
        additionalProperties: false,
        properties: {
          _id: { bsonType: "string" },
          code: { bsonType: "string" },
          slug: { bsonType: "string" },
          name: { bsonType: "string" },
        },
      },
    },
    validationLevel: "strict",
    validationAction: "error",
  });
  await dbS.collection("scrap_grades").createIndexes([{ key: { code: 1 }, name: "ix_code_u", unique: true }]);
  const s1 = await dbS.collection("scrap_grades").insertOne({ _id: "g1", code: "304", slug: "s1", name: "SS 304" }).catch((e) => e);
  const s2 = await dbS.collection("scrap_grades").insertOne({ _id: "g2", code: "316", slug: "s2", name: "SS 316" }).catch((e) => e);
  const s3 = await dbS.collection("scrap_grades").insertOne({ _id: "g3", code: "304", slug: "s3", name: "dup" }).catch((e) => e);
  const sMissing = await dbS.collection("scrap_grades").insertOne({ _id: "g4", slug: "s4", name: "no code" }).catch((e) => e);
  check("Q5 distinct codes accepted", !s1?.code && !s2?.code, `${codeOf(s1)}/${codeOf(s2)}`);
  check("Q5b duplicate code rejected by the plain unique index", isDup(s3), `got ${codeOf(s3)}`);
  check("Q5c a codeless grade is refused by the VALIDATOR, so the index never sees a NULL",
    sMissing?.code === 121 || sMissing?.codeName === "DocumentValidationFailure", `got ${codeOf(sMissing)}`);
} finally {
  await client.close();
  await server.stop();
}

for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? `  [${detail}]` : ""}`);
console.log(`\nTOTAL ${passed + failed} | passed ${passed} | failed ${failed}`);
process.exit(failed === 0 ? 0 : 1);
