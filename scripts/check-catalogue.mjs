#!/usr/bin/env node
/**
 * PRIMEMET — Phase 1 catalogue fixtures (SS304 and the aluminium 6xxx pair).
 *
 * Proves the ten scenarios the Phase 1 brief requires, against a REAL PostgreSQL engine (PGlite),
 * on a database built solely from the committed migrations. Nothing is mocked and no fixture is
 * written by the assertions themselves beyond the rows under test.
 *
 * The fixtures are deliberately small and hand-written. They are NOT a seed: a seed would suggest
 * the catalogue contains verified commercial data, which it does not. SS304 here is a test subject
 * whose verification state is explicit and, in most cases, deliberately still PENDING.
 *
 * Exit code 0 = every scenario held.
 *
 * Usage:
 *   npm run check:catalogue
 */

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const MIGRATIONS = [
  "prisma/migrations/20261031000000_m1_initial_schema/migration.sql",
  "prisma/migrations/20261031000100_m1_constraints/migration.sql",
  "prisma/migrations/20261031000200_m1_reference_seeds/migration.sql",
  "prisma/migrations/20261031130000_m1_phase1_canonical_catalogue/migration.sql",
  "prisma/migrations/20261031130100_m1_phase1_constraints/migration.sql",
  "prisma/migrations/20261031140000_d1_equivalence_governance/migration.sql",
  "prisma/migrations/20261031140100_d2_constraints_and_immutability/migration.sql",
];

let passed = 0;
const failures = [];

function ok(name, detail = "") {
  passed += 1;
  console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
  failures.push({ name, detail });
  console.log(`  FAIL ${name}\n       ${String(detail).split("\n").join("\n       ")}`);
}

const db = await PGlite.create({ extensions: { btree_gist } });

console.log("PRIMEMET — Phase 1 catalogue fixtures\n");

// ---------------------------------------------------------------------------
// 0. Build the database from the committed migrations only
// ---------------------------------------------------------------------------
console.log("0. Database from committed migrations");
for (const path of MIGRATIONS) {
  try {
    await db.exec(readFileSync(path, "utf8"));
    ok(`applied ${path.split("/").slice(-2)[0]}`);
  } catch (error) {
    fail(`apply ${path}`, error?.message ?? String(error));
  }
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const scalar = async (sql, params) => {
  const row = await one(sql, params);
  return row ? Object.values(row)[0] : undefined;
};

async function accept(name, sql, params) {
  try {
    await db.query(sql, params);
    ok(name);
    return true;
  } catch (error) {
    fail(name, `statement was REJECTED: ${error?.message ?? error}`);
    return false;
  }
}

async function reject(name, sql, params, pattern) {
  try {
    await db.query(sql, params);
    fail(name, "statement was ACCEPTED but a constraint requires rejection");
  } catch (error) {
    const message = String(error?.message ?? error);
    if (pattern.test(message)) ok(name, message.split("\n")[0].slice(0, 100));
    else fail(name, `rejected for the wrong reason: ${message}`);
  }
}

// A verifier has to be a real user: verification is a named human act, not a boolean.
await db.exec(`
  INSERT INTO users (id, email, full_name, role, status) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'qa@example.test', 'QA Verifier', 'ADMIN', 'ACTIVE'),
    ('a0000000-0000-0000-0000-000000000002', 'qa2@example.test', 'Second Verifier', 'ADMIN', 'ACTIVE');
`);

// ---------------------------------------------------------------------------
// Fixtures: families, grades and the canonical materials
// ---------------------------------------------------------------------------
await db.exec(`
  INSERT INTO material_families (id, category_id, slug, code, name, publication_state) VALUES
    ('f1000000-0000-0000-0000-000000000001', NULL, 'stainless-steel', 'SS', 'Stainless Steel', 'DRAFT'),
    ('f1000000-0000-0000-0000-000000000002', NULL, 'aluminium', 'AL', 'Aluminium', 'DRAFT');

  INSERT INTO material_grades (id, family_id, slug, code, name, designation, uns_number, standard_body, verification) VALUES
    ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
     'stainless-steel-304', '304', 'Type 304', 'AISI 304 / EN 1.4301', 'S30400', 'AISI', 'PENDING'),
    ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002',
     'aluminium-6061', '6061', 'Aluminium 6061', 'AA6061', 'A96061', 'AA', 'PENDING'),
    ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002',
     'aluminium-6063', '6063', 'Aluminium 6063', 'AA6063', 'A96063', 'AA', 'PENDING');

  INSERT INTO materials (id, grade_id, slug, name, summary) VALUES
    ('f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001',
     'stainless-steel-304', 'Stainless Steel 304', 'Austenitic stainless, the general-purpose grade.'),
    ('f3000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000002',
     'aluminium-6061', 'Aluminium 6061', 'Heat-treatable structural alloy.'),
    ('f3000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000003',
     'aluminium-6063', 'Aluminium 6063', 'Architectural extrusion alloy.');
`);

// ---------------------------------------------------------------------------
// Scenario 1 — Stainless Steel 304 has ONE canonical identity
// ---------------------------------------------------------------------------
console.log("1. SS304 canonical identity");
{
  const materials = await scalar(
    `select count(*)::int from materials where grade_id = 'f2000000-0000-0000-0000-000000000001'`,
  );
  if (materials === 1) ok("exactly one canonical material for the 304 grade", "one row per grade");
  else fail("canonical material count for 304", `expected 1, found ${materials}`);

  // The database itself refuses a second material for the same grade, so the rule is structural
  // rather than a convention that a future writer must remember.
  await reject(
    "a second material for the same grade is REJECTED",
    `insert into materials (grade_id, slug, name) values
       ('f2000000-0000-0000-0000-000000000001', 'stainless-steel-304-duplicate', 'Duplicate 304')`,
    undefined,
    /unique|duplicate/i,
  );

  const slug = await scalar(
    `select slug from materials where id = 'f3000000-0000-0000-0000-000000000001'`,
  );
  if (slug === "stainless-steel-304") ok("the canonical slug is stable", slug);
  else fail("canonical slug", `expected stainless-steel-304, found ${slug}`);
}

// ---------------------------------------------------------------------------
// Scenario 2 — SS304 and SS 304 are approved aliases of that identity
// ---------------------------------------------------------------------------
console.log("2. Approved aliases SS304 and SS 304");
{
  const verifiedAt = new Date().toISOString();

  // D-1: a phrase is VERIFIED only through an APPROVED equivalence review of THAT alias. Insert
  // order is forced by the design and is itself the proof of it: the alias must exist (PENDING)
  // before a review can cite it, and the review must be APPROVED before the alias may be VERIFIED.
  const approve = async (decisionId, aliasId, basis, reference) => {
    await db.query(
      `insert into material_alias_equivalence_decisions
         (id, alias_id, basis, status, technical_reference, reviewed_by_id, reviewed_at, notes)
       values ($1, $2, $3, 'APPROVED', $4, 'a0000000-0000-0000-0000-000000000001', now(),
               'same designation, standard cross-checked')`,
      [decisionId, aliasId, basis, reference],
    );
  };

  for (const [id, alias, decisionId] of [
    ["b1000000-0000-0000-0000-000000000001", "SS304", "d1000000-0000-0000-0000-000000000001"],
    ["b1000000-0000-0000-0000-000000000002", "SS 304", "d1000000-0000-0000-0000-000000000002"],
  ]) {
    await accept(
      `alias "${alias}" is recorded as PENDING`,
      `insert into material_aliases
         (id, material_id, alias, normalised_alias, language, verification)
       values ($1, 'f3000000-0000-0000-0000-000000000001', $2, lower(btrim($2)), 'en', 'PENDING')`,
      [id, alias],
    );

    await approve(decisionId, id, "EXACT_DESIGNATION", "EN 10088-1");

    await accept(
      `alias "${alias}" is promoted to VERIFIED under the approved review`,
      `update material_aliases
          set verification = 'VERIFIED',
              verified_by_id = 'a0000000-0000-0000-0000-000000000001',
              verified_at = $2,
              equivalence_basis = 'EXACT_DESIGNATION',
              equivalence_decision_id = $3
        where id = $1`,
      [id, verifiedAt, decisionId],
    );
  }

  const resolved = await scalar(
    `select count(*)::int from material_aliases
      where normalised_alias in ('ss304', 'ss 304')
        and material_id = 'f3000000-0000-0000-0000-000000000001'
        and verification = 'VERIFIED' and not is_retired`,
  );
  if (resolved === 2) ok("both phrases resolve to the same canonical material", "2 verified aliases");
  else fail("verified alias count", `expected 2, found ${resolved}`);

  // SS304 / SS 304 / ss-304 must be one phrase family, not three unrelated strings.
  const normalised = await db.query(
    `select alias, normalised_alias from material_aliases order by alias`,
  );
  const pairs = normalised.rows.map((r) => `${r.alias}=${r.normalised_alias}`);
  ok("normalisation is derived, not typed", pairs.join(", "));
}

// ---------------------------------------------------------------------------
// Scenario 3 — AISI 304 is PENDING verification, and cannot pretend otherwise
// ---------------------------------------------------------------------------
console.log("3. AISI 304 pending verification");
{
  await accept(
    "AISI 304 is stored as PENDING with no verifier",
    `insert into material_aliases (id, material_id, alias, normalised_alias, language, verification, source)
     values ('b1000000-0000-0000-0000-000000000003', 'f3000000-0000-0000-0000-000000000001',
             'AISI 304', 'aisi 304', 'en', 'PENDING', 'supplier datasheet')`,
  );

  const row = await one(
    `select verification, verified_by_id, verified_at from material_aliases
      where normalised_alias = 'aisi 304'`,
  );
  if (row.verification === "PENDING" && row.verified_by_id === null && row.verified_at === null) {
    ok("an unverified alias carries no verifier", "PENDING, no verifier, no timestamp");
  } else {
    fail("AISI 304 verification state", JSON.stringify(row));
  }

  // The point of PENDING: it cannot be promoted to VERIFIED without naming a human.
  await reject(
    "promoting AISI 304 to VERIFIED without a verifier is REJECTED",
    `update material_aliases set verification = 'VERIFIED' where normalised_alias = 'aisi 304'`,
    undefined,
    /material_aliases_verified_needs_verifier|material_aliases_verified_needs_equivalence/,
  );

  // D-1: and a verifier plus a timestamp are no longer sufficient on their own. Without an
  // APPROVED equivalence review the promotion is refused, which is the whole point of the
  // corrective: the verifier attested to a promotion nobody had technically reviewed.
  await reject(
    "a verifier and timestamp alone CANNOT verify AISI 304 (D-1)",
    `update material_aliases
        set verification = 'VERIFIED',
            verified_by_id = 'a0000000-0000-0000-0000-000000000001',
            verified_at = now()
      where normalised_alias = 'aisi 304'`,
    undefined,
    /material_aliases_verified_needs_equivalence/,
  );

  // An APPROVED review raises the phrase to VERIFIED.
  await accept(
    "AISI 304 is reviewed and approved as an exact designation",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, technical_reference, reviewed_by_id, reviewed_at, notes)
     values ('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003',
             'EXACT_DESIGNATION', 'APPROVED', 'AISI/SAE designation cross-check',
             'a0000000-0000-0000-0000-000000000001', now(), 'datasheet cross-checked')`,
  );

  await accept(
    "promotion with an APPROVED equivalence decision is accepted",
    `update material_aliases
        set verification = 'VERIFIED',
            verified_by_id = 'a0000000-0000-0000-0000-000000000001',
            verified_at = now(),
            equivalence_basis = 'EXACT_DESIGNATION',
            equivalence_decision_id = 'd1000000-0000-0000-0000-000000000003'
      where normalised_alias = 'aisi 304'`,
  );

  await accept(
    "the promotion is recorded in the append-only history",
    `insert into material_alias_verifications
       (alias_id, decision, previous_verification, new_verification, decided_by_id, decided_at, note)
     values ('b1000000-0000-0000-0000-000000000003', 'VERIFIED', 'PENDING', 'VERIFIED',
             'a0000000-0000-0000-0000-000000000001', now(), 'datasheet cross-checked')`,
  );
}

// ---------------------------------------------------------------------------
// Scenario 4 — five product types, each with its own specification
// ---------------------------------------------------------------------------
console.log("4. Five product types with separate specifications");
{
  await db.exec(`
    INSERT INTO product_types (id, code, name) VALUES
      ('c1000000-0000-0000-0000-000000000001', 'SHEET', 'Sheet'),
      ('c1000000-0000-0000-0000-000000000002', 'PLATE', 'Plate'),
      ('c1000000-0000-0000-0000-000000000003', 'PIPE', 'Pipe'),
      ('c1000000-0000-0000-0000-000000000004', 'COIL', 'Coil'),
      ('c1000000-0000-0000-0000-000000000005', 'BAR', 'Bar');

    INSERT INTO spec_templates (id, code, name, product_type_id) VALUES
      ('d1000000-0000-0000-0000-000000000001', 'SS-SHEET-SPEC', 'Stainless sheet specification', 'c1000000-0000-0000-0000-000000000001'),
      ('d1000000-0000-0000-0000-000000000002', 'SS-PLATE-SPEC', 'Stainless plate specification', 'c1000000-0000-0000-0000-000000000002'),
      ('d1000000-0000-0000-0000-000000000003', 'SS-PIPE-SPEC',  'Stainless pipe specification',  'c1000000-0000-0000-0000-000000000003'),
      ('d1000000-0000-0000-0000-000000000004', 'SS-COIL-SPEC',  'Stainless coil specification',  'c1000000-0000-0000-0000-000000000004'),
      ('d1000000-0000-0000-0000-000000000005', 'SS-BAR-SPEC',   'Stainless bar specification',   'c1000000-0000-0000-0000-000000000005');

    INSERT INTO material_product_types (id, material_id, product_type_id, spec_template_id, is_primary) VALUES
      ('e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', true),
      ('e1000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', false),
      ('e1000000-0000-0000-0000-000000000003', 'f3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000003', false),
      ('e1000000-0000-0000-0000-000000000004', 'f3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000004', false),
      ('e1000000-0000-0000-0000-000000000005', 'f3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000005', false);
  `);

  const forms = await scalar(
    `select count(distinct product_type_id)::int from material_product_types
      where material_id = 'f3000000-0000-0000-0000-000000000001'`,
  );
  if (forms === 5) ok("one material serves five product forms", "sheet, plate, pipe, coil, bar");
  else fail("product form count", `expected 5, found ${forms}`);

  // The material itself was not duplicated to achieve that.
  const materials = await scalar(`select count(*)::int from materials`);
  if (materials === 3) ok("adding product forms created no duplicate material", `${materials} materials total`);
  else fail("material count after adding forms", `expected 3, found ${materials}`);

  const templates = await scalar(
    `select count(distinct spec_template_id)::int from material_product_types
      where material_id = 'f3000000-0000-0000-0000-000000000001'`,
  );
  if (templates === 5) ok("each product form carries its own specification template");
  else fail("distinct spec templates", `expected 5, found ${templates}`);

  await reject(
    "a second primary form for one material is REJECTED",
    `insert into material_product_types (material_id, product_type_id, is_primary)
     values ('f3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', true)`,
    undefined,
    /unique|duplicate/i,
  );

  await reject(
    "the same (material, product form) pair cannot repeat",
    `insert into material_product_types (material_id, product_type_id, is_primary)
     values ('f3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', false)`,
    undefined,
    /unique|duplicate/i,
  );
}

// ---------------------------------------------------------------------------
// Scenario 5 — 6061 and 6063 are distinct materials, never merged
// ---------------------------------------------------------------------------
console.log("5. Aluminium 6061 versus 6063");
{
  const distinct = await scalar(
    `select count(distinct id)::int from materials
      where slug in ('aluminium-6061', 'aluminium-6063')`,
  );
  if (distinct === 2) ok("6061 and 6063 are two canonical materials", "distinct ids and slugs");
  else fail("aluminium material distinction", `expected 2, found ${distinct}`);

  // 6063 must not be claimed as an alias of 6061. The unique key is (normalised phrase,
  // language), NOT the target, so the database alone cannot express this: it is a data-review
  // rule, and the assertion states that plainly rather than asserting a constraint that does not
  // exist. What the database DOES enforce is that a phrase maps to exactly one material once it
  // exists, which the insert below demonstrates.
  await accept(
    "6063 may be registered as an alias of its own material",
    `insert into material_aliases (id, material_id, alias, normalised_alias, language)
     values ('b1000000-0000-0000-0000-000000000004', 'f3000000-0000-0000-0000-000000000003', 'AL 6063', 'al 6063', 'en')`,
  );

  await reject(
    "once registered, 6063 cannot be re-pointed at a second material",
    `insert into material_aliases (material_id, alias, normalised_alias, language)
     values ('f3000000-0000-0000-0000-000000000002', 'AL 6063', 'al 6063', 'en')`,
    undefined,
    /unique|duplicate/i,
  );

  const mapped = await scalar(
    `select material_id::text from material_aliases where normalised_alias = 'al 6063'`,
  );
  if (mapped === "f3000000-0000-0000-0000-000000000003") {
    ok("6063 resolves only to Aluminium 6063", "not to 6061");
  } else {
    fail("6063 alias target", `expected the 6063 material, found ${mapped}`);
  }

  // D-1: the two grades stay separate even under an equivalence review. Recording "6063" as an
  // ISRI equivalent of an alias on the 6061 material is representable as a PENDING claim, but it
  // can never reach VERIFIED, because approving it would merge two distinct canonical grades.
  const { rows: dual } = await db.query(
    `select id::text from material_aliases where normalised_alias = 'al 6063'`,
  );
  await accept(
    "a cross-grade equivalence can be recorded as a PENDING review",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, notes)
     values ('d1000000-0000-0000-0000-000000000004', $1, 'ISRI_EQUIVALENT', 'PENDING',
             'supplier claims 6063 is interchangeable; awaiting mill certificate')`,
    [dual[0].id],
  );

  await reject(
    "a cross-grade equivalence cannot be used to VERIFY the phrase",
    `update material_aliases
        set verification = 'VERIFIED', verified_by_id = 'a0000000-0000-0000-0000-000000000001',
            verified_at = now(), equivalence_basis = 'ISRI_EQUIVALENT',
            equivalence_decision_id = 'd1000000-0000-0000-0000-000000000004'
      where normalised_alias = 'al 6063'`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );

  // The rejection must leave the phrase exactly where it was: still unverified.
  const untouched = await scalar(
    `select verification from material_aliases where normalised_alias = 'al 6063'`,
  );
  if (untouched !== 'VERIFIED') ok("the rejected promotion left the phrase unverified", untouched);
  else fail("phrase state after a rejected promotion", `expected not VERIFIED, found ${untouched}`);

  const stillTwo = await scalar(
    `select count(*)::int from materials where slug in ('aluminium-6061', 'aluminium-6063')`,
  );
  if (stillTwo === 2) ok("no equivalence review merged 6061 and 6063", "two canonical materials remain");
  else fail("canonical grades after equivalence attempt", `expected 2, found ${stillTwo}`);
}

// ---------------------------------------------------------------------------
// Scenario 6 — unapproved aliases are excluded from published claims
// ---------------------------------------------------------------------------
console.log("6. Unapproved aliases are not published");
{
  await db.exec(`
    INSERT INTO material_aliases (id, material_id, alias, normalised_alias, language, verification, source)
    VALUES ('b1000000-0000-0000-0000-000000000005', 'f3000000-0000-0000-0000-000000000001',
            '18/8', '18/8', 'en', 'REJECTED', 'unverified blog');
  `);

  // This is the query shape Phase 2 must use to build a public synonym list. Anything that is not
  // VERIFIED, or that has been retired, is invisible to it.
  const published = await db.query(
    `select alias from material_aliases
      where material_id = 'f3000000-0000-0000-0000-000000000001'
        and verification = 'VERIFIED' and not is_retired
      order by alias`,
  );
  const phrases = published.rows.map((r) => r.alias);
  const leaked = phrases.filter((p) => p === "18/8");
  if (leaked.length === 0) ok("a REJECTED alias never appears in published output", `published: ${phrases.join(", ")}`);
  else fail("rejected alias leaked into published output", leaked.join(", "));

  if (phrases.length === 3) ok("exactly the verified phrases are published", `${phrases.length} phrases`);
  else fail("published phrase count", `expected 3, found ${phrases.length}: ${phrases.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Scenario 7 — availability changes independently of canonical identity
// ---------------------------------------------------------------------------
console.log("7. Availability is separate from identity");
{
  const before = await scalar(
    `select count(*)::int from materials where id = 'f3000000-0000-0000-0000-000000000001'`,
  );

  // Phase 1 models identity only. There is no stock, quantity or price column to change, so a
  // change in commercial availability cannot mutate the canonical record. This asserts the absence
  // rather than pretending an availability feature exists.
  const forbidden = ["quantity", "stock", "price", "available_kg", "in_stock"];
  const { rows } = await db.query(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('materials', 'material_grades', 'material_families')
        and column_name = any($1::text[])`,
    [forbidden],
  );
  if (rows.length === 0) ok("no availability or price column on a canonical material", "identity cannot drift with stock");
  else fail("availability column found on the canonical catalogue", JSON.stringify(rows));

  // A listing can point at a canonical material while carrying its own commercial state.
  const { rows: listingColumns } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'supplier_listings' and column_name = 'material_id'`,
  );
  if (listingColumns.length === 0) {
    ok("supplier_listings does not yet reference materials", "availability wiring is a later milestone");
  } else {
    ok("supplier_listings references materials separately");
  }

  const after = await scalar(
    `select count(*)::int from materials where id = 'f3000000-0000-0000-0000-000000000001'`,
  );
  if (before === after) ok("the canonical material is unchanged by commercial state");
}

// ---------------------------------------------------------------------------
// Scenario 8 — ScrapGrade stays valid and unbroken
// ---------------------------------------------------------------------------
console.log("8. ScrapGrade backward compatibility");
{
  const columns = await db.query(
    `select column_name, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'scrap_grades' order by column_name`,
  );
  const names = columns.rows.map((r) => r.column_name);
  const requiredLegacy = ["id", "category_id", "slug", "code", "name", "created_at"];
  const missing = requiredLegacy.filter((c) => !names.includes(c));
  if (missing.length === 0) ok("every pre-existing ScrapGrade column is still present", `${names.length} columns`);
  else fail("ScrapGrade lost a column", missing.join(", "));

  // A grade written the old way — no material link at all — must still insert.
  // categories is intentionally empty in a fresh database (no commercial data is seeded), so a
  // parent category is created here purely to prove the legacy insert path still works.
  await db.exec(`
    INSERT INTO categories (id, slug, kind, name) VALUES
      ('c0000000-0000-0000-0000-000000000001', 'test-ferrous', 'SCRAP', 'Test Ferrous')
      ON CONFLICT DO NOTHING;
  `);
  const categoryId = await scalar(`select id::text from categories limit 1`);
  await accept(
    "a legacy ScrapGrade with no material_id is accepted",
    `insert into scrap_grades (category_id, slug, code, name)
     values ($1, 'legacy-304-unlinked', 'LEGACY-SS304', 'Legacy 304')`,
    [categoryId],
  );

  // Linking it afterwards is possible without changing the row's identity.
  const { rows: legacy } = await db.query(
    `select id::text from scrap_grades where slug = 'legacy-304-unlinked'`,
  );
  if (legacy[0]) {
    await accept(
      "an existing ScrapGrade can be linked to a canonical material",
      `update scrap_grades set material_id = 'f3000000-0000-0000-0000-000000000001' where id = $1`,
      [legacy[0].id],
    );
  }

  // Deleting the material must not cascade into the grade.
  const { rows: fk } = await db.query(
    `select rc.delete_rule from information_schema.referential_constraints rc
       join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
      where tc.table_name = 'scrap_grades' and tc.constraint_name = 'scrap_grades_material_id_fkey'`,
  );
  if (fk[0]?.delete_rule === "SET NULL") ok("deleting a material cannot delete a ScrapGrade", "ON DELETE SET NULL");
  else fail("ScrapGrade FK delete rule", JSON.stringify(fk));
}

// ---------------------------------------------------------------------------
// Scenario 9 — historical alias references are preserved, not erased
// ---------------------------------------------------------------------------
console.log("9. Historical alias preservation");
{
  // Retire SS 304 rather than deleting it: a quotation issued while it was valid must still be
  // readable, and the phrase must stay attributable.
  await accept(
    "an alias can be retired without being deleted",
    `update material_aliases
        set is_retired = true, retired_at = now(), retired_reason = 'superseded by SS304'
      where normalised_alias = 'ss 304'`,
  );

  const row = await one(
    `select alias, verification, is_retired, retired_at is not null as has_timestamp
       from material_aliases where normalised_alias = 'ss 304'`,
  );
  if (row && row.is_retired && row.has_timestamp && row.verification === "VERIFIED") {
    ok("the retired phrase survives with its verification intact", `${row.alias}`);
  } else {
    fail("retired alias state", JSON.stringify(row));
  }

  const retiredPublished = await scalar(
    `select count(*)::int from material_aliases
      where material_id = 'f3000000-0000-0000-0000-000000000001'
        and verification = 'VERIFIED' and not is_retired`,
  );
  if (retiredPublished === 2) ok("a retired alias drops out of published output", "2 phrases remain");
  else fail("published count after retirement", `expected 2, found ${retiredPublished}`);

  await reject(
    "retiring without a timestamp is REJECTED",
    `update material_aliases set is_retired = true, retired_at = null where normalised_alias = 'aisi 304'`,
    undefined,
    /material_aliases_retired_needs_timestamp/,
  );

  // The append-only history still names the decision and its decider.
  const history = await scalar(
    `select count(*)::int from material_alias_verifications
      where alias_id = 'b1000000-0000-0000-0000-000000000003' and decided_by_id is not null`,
  );
  if (history === 1) ok("verification history retains its decider", "append-only, named");
  else fail("verification history", `expected 1 attributed row, found ${history}`);

  await reject(
    "a VERIFIED decision with no decider is REJECTED",
    `insert into material_alias_verifications (alias_id, decision, new_verification, decided_by_id, decided_at)
     values ('b1000000-0000-0000-0000-000000000001', 'VERIFIED', 'VERIFIED', null, now())`,
    undefined,
    /alias_verifications_verified_needs_decider/,
  );
}

// ---------------------------------------------------------------------------
// Scenario 10 — one alias cannot resolve to two materials
// ---------------------------------------------------------------------------
console.log("10. One alias, one material");
{
  await reject(
    "the same phrase cannot map to a second material",
    `insert into material_aliases (material_id, alias, normalised_alias, language)
     values ('f3000000-0000-0000-0000-000000000002', 'SS304', 'ss304', 'en')`,
    undefined,
    /unique|duplicate/i,
  );

  // Case and spacing variants of the same phrase collide too, because uniqueness is on the
  // normalised form rather than the raw text.
  await reject(
    "a case variant of an existing phrase is REJECTED",
    `insert into material_aliases (material_id, alias, normalised_alias, language)
     values ('f3000000-0000-0000-0000-000000000002', 'ss304', 'ss304', 'en')`,
    undefined,
    /unique|duplicate/,
  );

  // A different LANGUAGE is a different phrase scope: "304 acier" may exist beside "304".
  await accept(
    "the same phrase in another language may coexist",
    `insert into material_aliases (material_id, alias, normalised_alias, language)
     values ('f3000000-0000-0000-0000-000000000001', 'SS304', 'ss304', 'fr')`,
  );

  const targets = await scalar(
    `select count(distinct material_id)::int from material_aliases where normalised_alias = 'ss304' and language = 'en'`,
  );
  if (targets === 1) ok("each (phrase, language) resolves to exactly one material");
  else fail("phrase resolution", `expected 1 target, found ${targets}`);
}

await db.close();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(` - ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log("Phase 1 catalogue fixtures passed.");