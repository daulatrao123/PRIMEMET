#!/usr/bin/env node
/**
 * PRIMEMET — D-1 and D-2 corrective acceptance (equivalence governance and history immutability).
 *
 * Two databases are built, because the two questions are different:
 *
 *   FRESH    — all seven migrations, in order, on an empty database. Proves the migrations apply
 *              cleanly and that every new rule holds from the first row.
 *   UPGRADE  — the five Phase 1 migrations, then REAL pre-existing data (a verified alias and its
 *              history), then the two corrective migrations. Proves the change is additive, that
 *              existing records and their verification history survive untouched, and that nothing
 *              was silently approved or migrated.
 *
 * Nothing is mocked: a real PostgreSQL engine (PGlite) executes the committed migration files.
 *
 * Usage:
 *   npm run check:equivalence
 */

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const PHASE1 = [
  "prisma/migrations/20261031000000_m1_initial_schema/migration.sql",
  "prisma/migrations/20261031000100_m1_constraints/migration.sql",
  "prisma/migrations/20261031000200_m1_reference_seeds/migration.sql",
  "prisma/migrations/20261031130000_m1_phase1_canonical_catalogue/migration.sql",
  "prisma/migrations/20261031130100_m1_phase1_constraints/migration.sql",
];
const CORRECTIVE = [
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



async function newDb(paths) {
  const db = await PGlite.create({ extensions: { btree_gist } });
  for (const path of paths) {
    try {
      await db.exec(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`migration ${path} failed: ${error?.message ?? error}`);
    }
  }
  return db;
}

function helpers(db) {
  return {
    one: async (sql, params) => (await db.query(sql, params)).rows[0],
    scalar: async (sql, params) => {
      const row = (await db.query(sql, params)).rows[0];
      return row ? Object.values(row)[0] : undefined;
    },
    async accept(name, sql, params) {
      try {
        await db.query(sql, params);
        ok(name);
        return true;
      } catch (error) {
        fail(name, `statement was REJECTED: ${error?.message ?? error}`);
        return false;
      }
    },
    async reject(name, sql, params, pattern) {
      try {
        await db.query(sql, params);
        fail(name, "statement was ACCEPTED but the rule requires rejection");
        return false;
      } catch (error) {
        const message = String(error?.message ?? error);
        if (pattern.test(message)) {
          ok(name, message.split("\n")[0].slice(0, 96));
          return true;
        }
        fail(name, `rejected for the wrong reason: ${message}`);
        return false;
      }
    },
  };
}

const USER = "a0000000-0000-0000-0000-000000000001";
const USER2 = "a0000000-0000-0000-0000-000000000002";
const AL_6061 = "f3000000-0000-0000-0000-000000000002";
const AL_6063 = "f3000000-0000-0000-0000-000000000003";

/** Catalogue fixtures shared by both databases. */
async function seedCatalogue(db) {
  await db.exec(`
    INSERT INTO users (id, email, full_name, role, status) VALUES
      ('${USER}', 'reviewer@example.test', 'Technical Reviewer', 'ADMIN', 'ACTIVE'),
      ('${USER2}', 'reviewer2@example.test', 'Second Reviewer', 'ADMIN', 'ACTIVE');

    INSERT INTO material_families (id, category_id, slug, code, name, publication_state) VALUES
      ('f1000000-0000-0000-0000-000000000002', NULL, 'aluminium', 'AL', 'Aluminium', 'DRAFT');

    INSERT INTO material_grades (id, family_id, slug, code, name, designation, verification) VALUES
      ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002',
       'aluminium-6061', '6061', 'Aluminium 6061', 'AA6061', 'PENDING'),
      ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002',
       'aluminium-6063', '6063', 'Aluminium 6063', 'AA6063', 'PENDING');

    INSERT INTO materials (id, grade_id, slug, name) VALUES
      ('${AL_6061}', 'f2000000-0000-0000-0000-000000000002', 'aluminium-6061', 'Aluminium 6061'),
      ('${AL_6063}', 'f2000000-0000-0000-0000-000000000003', 'aluminium-6063', 'Aluminium 6063');
  `);
}

console.log("PRIMEMET — D-1 equivalence governance and D-2 immutable history\n");

// ===========================================================================
// A. FRESH DATABASE — all seven migrations
// ===========================================================================
console.log("A. Fresh database — all seven migrations in order");
const fresh = await newDb([...PHASE1, ...CORRECTIVE]);
const { one: fOne, scalar: fScalar, accept: fAccept, reject: fReject } = helpers(fresh);
await seedCatalogue(fresh);
ok("seven migrations applied and catalogue fixtures written");

// A1 — 6061 and 6063 remain separate canonical grades.
console.log("\nA1. 6061 and 6063 stay separate");
{
  await fAccept(
    "an alias for 6063 is recorded",
    `insert into material_aliases (id, material_id, alias, normalised_alias, language, verification)
     values ('b2000000-0000-0000-0000-000000000001', '${AL_6063}', 'AL 6063', 'al 6063', 'en', 'PENDING')`,
  );
  await fAccept(
    "an alias for 6061 is recorded",
    `insert into material_aliases (id, material_id, alias, normalised_alias, language, verification)
     values ('b2000000-0000-0000-0000-000000000002', '${AL_6061}', 'AL 6061', 'al 6061', 'en', 'PENDING')`,
  );

  const grades = await fScalar(
    `select count(*)::int from materials where slug in ('aluminium-6061','aluminium-6063')`,
  );
  if (grades === 2) ok("two canonical grades still exist", "no equivalence merged them");
  else fail("canonical grade count", `expected 2, found ${grades}`);

  // The 6063 alias cannot be re-pointed at 6061: the phrase resolves to one material.
  await fReject(
    "the 6063 phrase cannot be re-pointed at 6061",
    `insert into material_aliases (material_id, alias, normalised_alias, language)
     values ('${AL_6061}', 'AL 6063', 'al 6063', 'en')`,
    undefined,
    /uq_material_aliases_normalised|duplicate/i,
  );
}

// A2 — verified requires an approved decision, not merely a name and a timestamp.
console.log("\nA2. Verification requires an APPROVED equivalence review");
{
  await fReject(
    "a verifier and timestamp alone cannot verify a phrase",
    `update material_aliases set verification = 'VERIFIED',
            verified_by_id = '${USER}', verified_at = now()
      where id = 'b2000000-0000-0000-0000-000000000002'`,
    undefined,
    /material_aliases_verified_needs_equivalence/,
  );

  await fAccept(
    "a review missing technical evidence can still be PENDING",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, notes)
     values ('e2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002',
             'EXACT_DESIGNATION', 'PENDING', 'awaiting mill certificate')`,
  );

  await fReject(
    "a PENDING review cannot be used to verify the phrase",
    `update material_aliases set verification = 'VERIFIED', verified_by_id = '${USER}',
            verified_at = now(), equivalence_basis = 'EXACT_DESIGNATION',
            equivalence_decision_id = 'e2000000-0000-0000-0000-000000000001'
      where id = 'b2000000-0000-0000-0000-000000000002'`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );

  await fReject(
    "an APPROVED review without a reference or evidence is REJECTED",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, reviewed_by_id, reviewed_at, notes)
     values ('e2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002',
             'EXACT_DESIGNATION', 'APPROVED', '${USER}', now(), 'trust me')`,
    undefined,
    /equivalence_decisions_approved_needs_evidence/,
  );

  await fReject(
    "a decided review with no reviewer is REJECTED",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, technical_reference, reviewed_at, notes)
     values ('e2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000002',
             'EXACT_DESIGNATION', 'APPROVED', 'ASTM B221', now(), 'cross-checked')`,
    undefined,
    /equivalence_decisions_decided_is_attributable/,
  );

  await fReject(
    "a decided review with no timestamp is REJECTED",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, technical_reference, reviewed_by_id, notes)
     values ('e2000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000002',
             'EXACT_DESIGNATION', 'APPROVED', 'ASTM B221', '${USER}', 'cross-checked')`,
    undefined,
    /equivalence_decisions_decided_is_attributable/,
  );

  await fReject(
    "a decided review with empty notes is REJECTED",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, technical_reference, reviewed_by_id, reviewed_at, notes)
     values ('e2000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000002',
             'EXACT_DESIGNATION', 'APPROVED', 'ASTM B221', '${USER}', now(), '   ')`,
    undefined,
    /equivalence_decisions_notes_not_blank/,
  );

  await fReject(
    "a blank technical reference is REJECTED",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, technical_reference, evidence_document_id, reviewed_by_id, reviewed_at, notes)
     values ('e2000000-0000-0000-0000-000000000006', 'b2000000-0000-0000-0000-000000000001',
             'EXACT_DESIGNATION', 'APPROVED', '  ', NULL, '${USER}', now(), 'cross-checked')`,
    undefined,
    /equivalence_decisions_reference_not_blank/,
  );

  await fAccept(
    "an APPROVED review with a reference and a reviewer is accepted",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, technical_reference, reviewed_by_id, reviewed_at, notes)
     values ('e2000000-0000-0000-0000-000000000007', 'b2000000-0000-0000-0000-000000000002',
             'EXACT_DESIGNATION', 'APPROVED', 'ASTM B221 / AA6061-T6', '${USER}', now(),
             'designation confirmed against the standard')`,
  );

  await fAccept(
    "the phrase can now be VERIFIED under that review",
    `update material_aliases set verification = 'VERIFIED', verified_by_id = '${USER}',
            verified_at = now(), equivalence_basis = 'EXACT_DESIGNATION',
            equivalence_decision_id = 'e2000000-0000-0000-0000-000000000007'
      where id = 'b2000000-0000-0000-0000-000000000002'`,
  );
}

// A3 — the declared basis must agree with the approving decision.
console.log("\nA3. Basis must match the approving decision");
{
  await fAccept(
    "an ISRI_EQUIVALENT review is approved for the 6063 alias",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, technical_reference, reviewed_by_id, reviewed_at, notes)
     values ('e2000000-0000-0000-0000-000000000010', 'b2000000-0000-0000-0000-000000000001',
             'ISRI_EQUIVALENT', 'APPROVED', 'ISRI 6063 / Twitch', '${USER}', now(),
             'scrapyard equivalence, specification cited')`,
  );

  await fReject(
    "relabelling an ISRI equivalent as EXACT_DESIGNATION is REJECTED",
    `update material_aliases set verification = 'VERIFIED', verified_by_id = '${USER}',
            verified_at = now(), equivalence_basis = 'EXACT_DESIGNATION',
            equivalence_decision_id = 'e2000000-0000-0000-0000-000000000010'
      where id = 'b2000000-0000-0000-0000-000000000001'`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );

  await fAccept(
    "the same phrase verifies under its own declared basis",
    `update material_aliases set verification = 'VERIFIED', verified_by_id = '${USER}',
            verified_at = now(), equivalence_basis = 'ISRI_EQUIVALENT',
            equivalence_decision_id = 'e2000000-0000-0000-0000-000000000010'
      where id = 'b2000000-0000-0000-0000-000000000001'`,
  );
}

// A4 — a decision about one alias cannot authorise another.
console.log("\nA4. A decision authorises only its own alias");
{
  // The composite foreign key is what makes this impossible rather than merely discouraged: the
  // 6063 alias cannot borrow the decision that was raised about the 6061 alias.
  await fReject(
    "a review raised for one alias cannot verify a different alias",
    `update material_aliases set verification = 'VERIFIED', verified_by_id = '${USER}',
            verified_at = now(), equivalence_basis = 'EXACT_DESIGNATION',
            equivalence_decision_id = 'e2000000-0000-0000-0000-000000000007'
      where id = 'b2000000-0000-0000-0000-000000000001'`,
    undefined,
    /material_aliases_equivalence_decision_same_alias_fkey/,
  );

  await fAccept(
    "an unclassified phrase cannot be verified",
    `insert into material_aliases (id, material_id, alias, normalised_alias, language, verification)
     values ('b2000000-0000-0000-0000-000000000003', '${AL_6063}', 'ALUM 6063', 'alum 6063', 'en', 'PENDING')`,
  );
  await fReject(
    "a decision with a mismatched basis cannot verify it",
    `update material_aliases set verification = 'VERIFIED', verified_by_id = '${USER}',
            verified_at = now(), equivalence_basis = 'PROCESS_SYNONYM',
            equivalence_decision_id = 'e2000000-0000-0000-0000-000000000010'
      where id = 'b2000000-0000-0000-0000-000000000003'`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );
}

// A5 — D-2: the history is append-only.
console.log("\nA5. History immutability (D-2)");
{
  await fAccept(
    "INSERT into the verification history succeeds",
    `insert into material_alias_verifications
       (id, alias_id, decision, previous_verification, new_verification, decided_by_id, decided_at, note)
     values ('c2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002',
             'VERIFIED', 'PENDING', 'VERIFIED', '${USER}', now(), 'verified under an approved review')`,
  );

  await fReject(
    "UPDATE on the verification history is REJECTED",
    `update material_alias_verifications set note = 'rewritten'
      where id = 'c2000000-0000-0000-0000-000000000001'`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );

  await fReject(
    "DELETE on the verification history is REJECTED",
    `delete from material_alias_verifications where id = 'c2000000-0000-0000-0000-000000000001'`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );

  await fReject(
    "UPDATE on the equivalence decisions is REJECTED",
    `update material_alias_equivalence_decisions set notes = 'quietly changed'
      where id = 'e2000000-0000-0000-0000-000000000007'`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );

  await fReject(
    "DELETE on the equivalence decisions is REJECTED",
    `delete from material_alias_equivalence_decisions
      where id = 'e2000000-0000-0000-0000-000000000007'`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );

  const original = await fOne(
    `select note from material_alias_verifications where id = 'c2000000-0000-0000-0000-000000000001'`,
  );
  if (original?.note === "verified under an approved review") {
    ok("the rejected mutations left the original history intact", "note unchanged");
  } else {
    fail("history after rejected mutations", JSON.stringify(original));
  }

  // A correction is a new row, and the trail then contains both.
  await fAccept(
    "a correction is recorded as a NEW row",
    `insert into material_alias_verifications
       (alias_id, decision, previous_verification, new_verification, decided_by_id, decided_at, note)
     values ('b2000000-0000-0000-0000-000000000002', 'VERIFIED', 'PENDING', 'VERIFIED',
             '${USER2}', now(), 're-reviewed, second reviewer')`,
  );

  const count = await fScalar(
    `select count(*)::int from material_alias_verifications
      where alias_id = 'b2000000-0000-0000-0000-000000000002'`,
  );
  if (count === 2) ok("both the original and the correction are readable", `${count} rows`);
  else fail("history row count", `expected 2, found ${count}`);
}

// A6 — a superseding review replaces the authorisation without touching history.
console.log("\nA6. Supersession");
{
  const { scalar } = helpers(fresh);
  const before = await scalar(
    `select count(*)::int from material_alias_equivalence_decisions
      where alias_id = 'b2000000-0000-0000-0000-000000000002'`,
  );

  await fAccept(
    "a new review supersedes the earlier one",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, technical_reference, reviewed_by_id, reviewed_at, notes,
        supersedes_decision_id)
     values ('e2000000-0000-0000-0000-000000000012', 'b2000000-0000-0000-0000-000000000002',
             'EXACT_DESIGNATION', 'APPROVED', 'ASTM B221-20', '${USER2}', now(),
             'annual re-review, newer edition', 'e2000000-0000-0000-0000-000000000007')`,
  );

  await fAccept(
    "the alias now points at the newer review",
    `update material_aliases set equivalence_decision_id = 'e2000000-0000-0000-0000-000000000012'
      where id = 'b2000000-0000-0000-0000-000000000002'`,
  );

  const rows = await scalar(
    `select count(*)::int from material_alias_equivalence_decisions
      where alias_id = 'b2000000-0000-0000-0000-000000000002'`,
  );
  if (rows === before + 1) ok("the superseded review is still readable", `${rows} reviews, ${before} retained`);
  else fail("review count after supersession", `expected ${before + 1}, found ${rows}`);
}

// A7 — the guard table is unfillable, so a rejection can never be mistaken for data.
console.log("\nA7. Guard table");
{
  const rows = await fScalar(`select count(*)::int from pm_history_guard`);
  if (rows === 0) ok("the guard table holds no rows", "rejections write nothing");
  else fail("guard table rows", `expected 0, found ${rows}`);

  await fReject(
    "the guard table cannot be written to directly",
    `insert into pm_history_guard ("relation", "operation") values ('manual', 'INSERT')`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );
}

await fresh.close();

// ===========================================================================
// B. UPGRADE — Phase 1 data, then the corrective migrations
// ===========================================================================
console.log("\nB. Upgrade database — Phase 1 data already present");
const up = await newDb(PHASE1);
const { scalar: uScalar, accept: uAccept, reject: uReject } = helpers(up);
await seedCatalogue(up);

// Pre-existing Phase 1 state: one VERIFIED alias with history, one PENDING alias, all written
// under the OLD rules (no equivalence classification existed).
await up.exec(`
  INSERT INTO material_aliases
    (id, material_id, alias, normalised_alias, language, verification, verified_by_id, verified_at)
  VALUES
    ('b3000000-0000-0000-0000-000000000001', '${AL_6061}', 'AL 6061', 'al 6061', 'en',
     'VERIFIED', '${USER}', now()),
    ('b3000000-0000-0000-0000-000000000002', '${AL_6063}', 'AL 6063', 'al 6063', 'en', 'PENDING', NULL, NULL);
`).catch((error) => {
  fail("Phase 1 alias fixtures", `${error?.message ?? error} | code=${error?.code} routine=${error?.routine}`);
});
await up.exec(`
  INSERT INTO material_alias_verifications
    (id, alias_id, decision, previous_verification, new_verification, decided_by_id, decided_at, note)
  VALUES
    ('c3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
     'VERIFIED', 'PENDING', 'VERIFIED', '${USER}', now(), 'pre-upgrade verification');
`).catch((error) => {
  fail("Phase 1 history fixtures", `${error?.message ?? error} | code=${error?.code} routine=${error?.routine}`);
});

const beforeAliases = await uScalar(`select count(*)::int from material_aliases`);
const beforeHistory = await uScalar(`select count(*)::int from material_alias_verifications`);
ok(`Phase 1 data written under the old rules`, `${beforeAliases} aliases, ${beforeHistory} history rows`);
if (beforeAliases !== 2 || beforeHistory !== 1) {
  throw new Error(
    `upgrade fixture is not representative: expected 2 aliases and 1 history row, found ${beforeAliases}/${beforeHistory}`,
  );
}

let upgradeError = null;
try {
  for (const path of CORRECTIVE) await up.exec(readFileSync(path, "utf8"));
  ok("both corrective migrations applied over existing data");
} catch (error) {
  upgradeError = error?.message ?? String(error);
  fail("corrective migrations over existing data", upgradeError);
}

if (!upgradeError) {
  const afterAliases = await uScalar(`select count(*)::int from material_aliases`);
  const afterHistory = await uScalar(`select count(*)::int from material_alias_verifications`);
  if (afterAliases === beforeAliases && afterHistory === beforeHistory) {
    ok("no existing alias or history row was added, removed or rewritten",
      `${afterAliases} aliases, ${afterHistory} history rows`);
  } else {
    fail("existing data changed by the migration",
      `before ${beforeAliases}/${beforeHistory}, after ${afterAliases}/${afterHistory}`);
  }

  const verified = await uScalar(
    `select verification from material_aliases where id = 'b3000000-0000-0000-0000-000000000001'`,
  );
  if (verified === "VERIFIED") {
    ok("the pre-existing verified alias keeps its correct state", verified);
  } else {
    fail("pre-existing verified alias state", `expected VERIFIED, found ${verified}`);
  }

  // Requirement 9: nothing was silently approved or back-filled. The legacy alias has no
  // classification and no decision — deliberately, because no human has reviewed it.
  const legacy = await helpers(up).one(
    `select equivalence_basis, equivalence_decision_id from material_aliases
      where id = 'b3000000-0000-0000-0000-000000000001'`,
  );
  if (legacy.equivalence_basis === null && legacy.equivalence_decision_id === null) {
    ok("no existing alias was silently classified or approved", "basis and decision remain NULL");
  } else {
    fail("legacy alias state after migration", JSON.stringify(legacy));
  }

  const decisions = await uScalar(`select count(*)::int from material_alias_equivalence_decisions`);
  if (decisions === 0) ok("no equivalence decision was invented by the migration", "0 decisions");
  else fail("equivalence decisions after migration", `expected 0, found ${decisions}`);

  const pending = await uScalar(
    `select verification from material_aliases where id = 'b3000000-0000-0000-0000-000000000002'`,
  );
  if (pending === "PENDING") ok("the pre-existing pending alias is still PENDING", pending);
  else fail("pre-existing pending alias state", `expected PENDING, found ${pending}`);

  const historyNote = await uScalar(
    `select note from material_alias_verifications where id = 'c3000000-0000-0000-0000-000000000001'`,
  );
  if (historyNote === "pre-upgrade verification") {
    ok("pre-upgrade verification history is readable and unchanged", historyNote);
  } else {
    fail("pre-upgrade history", JSON.stringify(historyNote));
  }

  // The new rule applies immediately to the upgraded data: the legacy verified alias cannot be
  // re-verified without a review, and history that predates the trigger is now immutable.
  await uReject(
    "a legacy alias cannot be re-verified without an approved review",
    `update material_aliases set verification = 'VERIFIED', verified_by_id = '${USER}', verified_at = now()
      where id = 'b3000000-0000-0000-0000-000000000001'`,
    undefined,
    /material_aliases_verified_needs_equivalence/,
  );

  await uReject(
    "pre-upgrade history is immutable under the new trigger",
    `delete from material_alias_verifications where id = 'c3000000-0000-0000-0000-000000000001'`,
    undefined,
    /pm_append_only_history_rejects_update_and_delete/,
  );

  // CONSEQUENCE of grandfathering, asserted rather than hidden: a pre-existing VERIFIED alias cannot
  // be edited at all until it is classified, because the next write is validated. That is the
  // intended pressure — retire or correct only after a real review — but it IS a workflow an
  // operator will meet, so it is stated in the report and proven here.
  await uReject(
    "a grandfathered alias cannot be edited until it is classified",
    `update material_aliases set is_retired = true, retired_at = now(), retired_reason = 'superseded'
      where id = 'b3000000-0000-0000-0000-000000000001'`,
    undefined,
    /material_aliases_verified_needs_equivalence/,
  );

  await uAccept(
    "the legacy alias is reviewed and approved, as an operator would do",
    `insert into material_alias_equivalence_decisions
       (id, alias_id, basis, status, technical_reference, reviewed_by_id, reviewed_at, notes)
     values ('e3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
             'EXACT_DESIGNATION', 'APPROVED', 'ASTM B221', '${USER}', now(),
             'post-upgrade review of a Phase 1 alias')`,
  );

  await uAccept(
    "once reviewed, the same alias can be retired and its history is preserved",
    `update material_aliases
        set equivalence_basis = 'EXACT_DESIGNATION',
            equivalence_decision_id = 'e3000000-0000-0000-0000-000000000001',
            is_retired = true, retired_at = now(), retired_reason = 'superseded'
      where id = 'b3000000-0000-0000-0000-000000000001'`,
  ).then(async () => {
    const history = await uScalar(
      `select count(*)::int from material_alias_verifications where alias_id = 'b3000000-0000-0000-0000-000000000001'`,
    );
    if (history === 1) ok("retirement preserved the pre-upgrade history", "1 history row intact");
    else fail("history after retirement", `expected 1, found ${history}`);
  });
}
await up.close();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(` - ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log("D-1 and D-2 acceptance passed.");