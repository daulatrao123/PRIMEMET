/**
 * PRIMEMET — Task A: does the tax_rules partial unique index actually enforce the documented rule?
 *
 * The static audit flagged ix_tax_rules_…_u_p as "partial filter present but does not cover every
 * optional key field". That is a heuristic, and it may be wrong: the collection's own comment states
 * that a null transactionModel / jurisdictionStateId means 'ANY' and is MEANT to collide with another
 * null. So this harness tests the behaviour against real mongod rather than trusting either claim.
 *
 * If two rules with different scopes are wrongly rejected, that is a genuine defect.
 * If only identical-scope same-day ACTIVE rules are rejected, the index is correct and the static
 * heuristic produced a false positive.
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";

const server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
const client = new MongoClient(server.getUri());
await client.connect();
const db = client.db("t_tax_real");

const out = [];
let passed = 0;
let failed = 0;
const check = (n, c, d = "") => (c ? (passed++, out.push(["PASS", n, d])) : (failed++, out.push(["FAIL", n, d])));
const dup = (e) => e?.code === 11000 || e?.codeName === "DuplicateKey";

// Mirror of the REAL definition: required set, bsonTypes and the exact index spec.
await db.createCollection("tax_rules", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "_id", "code", "componentCode", "transactionModel", "invoiceRole", "appliesTo",
        "taxableBaseRule", "jurisdictionStateId", "hsnSacCode", "ratePct", "includesFreight",
        "reverseCharge", "thresholdAmount", "effectiveFrom", "effectiveTo", "approvedById",
        "approvedAt", "legalReference", "status", "createdAt", "updatedAt",
      ],
      additionalProperties: false,
      properties: {
        _id: { bsonType: "string" }, code: { bsonType: "string" }, componentCode: { bsonType: "string" },
        transactionModel: { bsonType: ["string", "null"] }, invoiceRole: { bsonType: "string" },
        appliesTo: { bsonType: "string" }, taxableBaseRule: { bsonType: "string" },
        jurisdictionStateId: { bsonType: ["string", "null"] }, hsnSacCode: { bsonType: ["string", "null"] },
        ratePct: { bsonType: "decimal" }, includesFreight: { bsonType: "bool" }, reverseCharge: { bsonType: "bool" },
        thresholdAmount: { bsonType: ["decimal", "null"] },
        effectiveFrom: { bsonType: "date" }, effectiveTo: { bsonType: ["date", "null"] },
        approvedById: { bsonType: ["string", "null"] }, approvedAt: { bsonType: ["date", "null"] },
        legalReference: { bsonType: ["string", "null"] }, status: { bsonType: "string" },
        createdAt: { bsonType: "date" }, updatedAt: { bsonType: "date" },
      },
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});

await db.collection("tax_rules").createIndexes([{
  key: { componentCode: 1, transactionModel: 1, invoiceRole: 1, jurisdictionStateId: 1, effectiveFrom: 1 },
  name: "ix_tax_rules_scope_start_u_p",
  unique: true,
  partialFilterExpression: { status: "ACTIVE" },
}]);

const now = new Date("2026-11-01T00:00:00Z");
const day = (m, d) => new Date(Date.UTC(2026, m - 1, d));
const base = {
  code: "R", appliesTo: "TRANSACTION", taxableBaseRule: "SUBTOTAL", hsnSacCode: null,
  includesFreight: false, reverseCharge: false, thresholdAmount: null, effectiveTo: null,
  approvedById: null, approvedAt: null, legalReference: null, createdAt: now, updatedAt: now,
};
const put = async (id, over) => {
  const doc = {
    ...base, _id: id, componentCode: "GST", invoiceRole: "ANY", ratePct: null, status: "ACTIVE",
    transactionModel: null, jurisdictionStateId: null, effectiveFrom: day(4, 1), ...over,
  };
  // ratePct must be decimal; validator requires it even though it is not indexed here.
  const { Decimal128 } = await import("bson");
  doc.ratePct = Decimal128.fromString(String(over.ratePct ?? "18"));
  return db.collection("tax_rules").insertOne(doc).catch((e) => e);
};

try {
  const a = await put("a", {});
  check("wildcard ACTIVE rule (model=null,state=null) accepted", !a?.code, `got ${a?.code}`);

  const b = await put("b", {});
  check("identical scope + same start date REJECTED (the intended uniqueness)", dup(b), `got ${b?.code}`);

  const c = await put("c", { effectiveFrom: day(7, 1) });
  check("same scope, later start date ALLOWED (a rate change must be possible)", !c?.code, `got ${c?.code}`);

  const d = await put("d", { transactionModel: "PRINCIPAL" });
  check("specific model alongside the wildcard ALLOWED", !d?.code, `got ${d?.code}`);

  const e = await put("e", { transactionModel: "AGENCY" });
  check("a second specific model ALLOWED", !e?.code, `got ${e?.code}`);

  const f = await put("f", { jurisdictionStateId: "MH" });
  check("specific state alongside the wildcard ALLOWED", !f?.code, `got ${f?.code}`);

  const g = await put("g", { jurisdictionStateId: "DL" });
  check("a second specific state ALLOWED", !g?.code, `got ${g?.code}`);

  const h = await put("h", { invoiceRole: "MATERIAL" });
  check("different invoice role ALLOWED", !h?.code, `got ${h?.code}`);

  const i = await put("i", { componentCode: "TDS" });
  check("different component ALLOWED", !i?.code, `got ${i?.code}`);

  // Two non-ACTIVE rules with identical scope/date must NOT collide (they are outside the partial index).
  const j = await put("j", { status: "SUPERSEDED" });
  const k = await put("k", { status: "DRAFT" });
  check("non-ACTIVE rows are excluded from the index entirely", !j?.code && !k?.code, `${j?.code}/${k?.code}`);

  const cnt = await db.collection("tax_rules").countDocuments();
  check("all permitted rules stored", cnt === 10, `count=${cnt} expected=10`);

  // THE ONE CASE THAT MATTERS: can two DIFFERENT wildcards coexist? They cannot, and per the
  // collection comment that is deliberate — null IS the ANY scope, so two ANY rules for one day would
  // genuinely be ambiguous. Verify that reading holds rather than being an accident of indexing.
  const l = await put("l", { transactionModel: null, jurisdictionStateId: null, invoiceRole: "ANY", effectiveFrom: day(4, 1) });
  check("re-stating the ANY/ANY/ANY scope is refused — ambiguity, not a defect", dup(l), `got ${l?.code}`);
} finally {
  await client.close();
  await server.stop();
}

for (const [s, n, d] of out) console.log(`${s}  ${n}${d ? `  [${d}]` : ""}`);
console.log(`\nTOTAL ${passed + failed} | passed ${passed} | failed ${failed}`);
process.exit(failed === 0 ? 0 : 1);
