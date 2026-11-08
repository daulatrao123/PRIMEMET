#!/usr/bin/env node
/**
 * PRIMEMET — HISTORICAL M1 baseline verification.
 *
 * This pass is deliberately separate from `check-schema.mjs`.
 *
 *   check-schema-m1.mjs  proves the M1 milestone is still exactly what it shipped as:
 *                        three migrations, pinned checksums, 34 tables, no later table.
 *                        It never reads the current schema, so Phase 1 additions CANNOT
 *                        change its expected results. If a Phase 1 model leaked into an
 *                        M1 migration, this pass fails.
 *
 *   check-schema.mjs     proves the COMPLETE schema: M1 migrations plus the Phase 1
 *                        migration, every model, constraint and index that exists now.
 *
 * The frozen M1 datamodel lives at scripts/m1-baseline/schema.prisma and is the reference
 * against which migration 1 is regenerated. It is a committed copy, not /tmp, so the
 * historical baseline survives a reboot.
 *
 * Exit code 0 = every historical assertion held.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const M1_SCHEMA = "scripts/m1-baseline/schema.prisma";

/**
 * The three M1 migrations, with the SHA-256 each one had when the milestone closed.
 *
 * Pinned rather than computed: that is the entire point of a historical baseline. A Phase 1
 * change that edits, regenerates or reorders an M1 migration changes this digest and fails
 * here, even though the complete-schema pass would still succeed.
 */
const M1_MIGRATIONS = [
  {
    path: "prisma/migrations/20261031000000_m1_initial_schema/migration.sql",
    sha256: "14b112ac1c37",
  },
  {
    path: "prisma/migrations/20261031000100_m1_constraints/migration.sql",
    sha256: "666529830086",
  },
  {
    path: "prisma/migrations/20261031000200_m1_reference_seeds/migration.sql",
    sha256: "535763a2867c",
  },
];

const PLACEHOLDER_URL = "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";

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

const PRISMA_CLI = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));

function prisma(args) {
  return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || PLACEHOLDER_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

console.log("PRIMEMET — M1 historical baseline verification\n");

// ---------------------------------------------------------------------------
// 1. The frozen M1 datamodel is itself valid
// ---------------------------------------------------------------------------
console.log("1. Frozen M1 datamodel");
{
  if (!existsSync(M1_SCHEMA)) {
    fail("frozen M1 snapshot missing", M1_SCHEMA);
  } else {
    const output = prisma(["validate", "--schema", M1_SCHEMA]);
    if (/is valid/.test(output)) ok("frozen M1 snapshot is a valid schema", M1_SCHEMA);
    else fail("frozen M1 snapshot is invalid", output);

    const models = (readFileSync(M1_SCHEMA, "utf8").match(/^model\s+\w+\s*\{/gm) ?? []).length;
    if (models === 34) ok("frozen snapshot holds 34 models", "the M1 model count");
    else fail("frozen snapshot model count", `expected 34, found ${models}`);
  }
}

// ---------------------------------------------------------------------------
// 2. The M1 migrations are byte-identical to the milestone they shipped as
// ---------------------------------------------------------------------------
console.log("2. M1 migration checksums");

for (const migration of M1_MIGRATIONS) {
  if (!existsSync(migration.path)) {
    fail(`M1 migration missing`, migration.path);
    continue;
  }
  const digest = sha256(readFileSync(migration.path));
  if (digest.startsWith(migration.sha256)) {
    ok(`unchanged ${migration.path.split("/").pop()}`, `sha256 ${migration.sha256}…`);
  } else {
    fail(
      `M1 migration was MODIFIED`,
      `${migration.path}\n  expected sha256 ${migration.sha256}…\n  actual   ${digest.slice(0, 12)}…`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Migration 1 still regenerates exactly from the frozen datamodel
// ---------------------------------------------------------------------------
console.log("3. Migration 1 ↔ frozen datamodel parity");
{
  const generated = prisma([
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema-datamodel",
    M1_SCHEMA,
    "--script",
  ]);
  const committed = readFileSync(M1_MIGRATIONS[0].path, "utf8");
  if (generated.trim() === committed.trim()) {
    ok("migration 1 matches the frozen M1 datamodel", `${committed.split("\n").length} lines`);
  } else {
    const a = generated.split("\n");
    const b = committed.split("\n");
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    fail(
      "migration 1 no longer matches the frozen M1 datamodel",
      `first difference at line ${i + 1}\n  generated: ${JSON.stringify(a[i] ?? "<eof>")}\n  committed: ${JSON.stringify(b[i] ?? "<eof>")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. The three M1 migrations apply in order to a real PostgreSQL
// ---------------------------------------------------------------------------
console.log("4. Apply M1 migrations to PostgreSQL");
const db = await PGlite.create({ extensions: { btree_gist } });
{
  for (const migration of M1_MIGRATIONS) {
    try {
      await db.exec(readFileSync(migration.path, "utf8"));
      ok(`applied ${migration.path.split("/").pop()}`);
    } catch (error) {
      fail(`apply ${migration.path}`, error?.message ?? String(error));
    }
  }
}

// ---------------------------------------------------------------------------
// 5. The M1 table set — 34 tables, and nothing from a later milestone
// ---------------------------------------------------------------------------
console.log("5. M1 structure");
{
  const EXPECTED_M1_TABLES = [
    "admin_permission_grants",
    "admin_profiles",
    "audit_log_failures",
    "audit_logs",
    "auth_events",
    "buyer_profiles",
    "categories",
    "composition_attribute_defs",
    "document_access_log",
    "documents",
    "grade_composition_attributes",
    "grade_reference_sources",
    "inspection_methods_ref",
    "location_states",
    "migration_runs",
    "organisation_addresses",
    "organisation_contacts",
    "organisation_verifications",
    "organisations",
    "portal_invitations",
    "pricing_rule_sets",
    "product_compatibilities",
    "product_families",
    "product_specifications",
    "products",
    "reference_sequences",
    "scrap_grades",
    "sessions",
    "supplier_listings",
    "supplier_profiles",
    "tax_components_ref",
    "tax_rules",
    "tax_treatments",
    "users",
  ];

  const { rows } = await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const actual = rows.map((r) => r.table_name);
  const missing = EXPECTED_M1_TABLES.filter((t) => !actual.includes(t));
  const extra = actual.filter((t) => !EXPECTED_M1_TABLES.includes(t));
  if (missing.length === 0 && extra.length === 0) {
    ok(`exactly ${actual.length} M1 tables`, "no later-milestone table in the M1 set");
  } else {
    fail(
      "M1 table set mismatch",
      `missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`,
    );
  }
}

{
  // The Phase 1 tables must NOT exist in the historical baseline. This is the assertion that
  // catches a Phase 1 model accidentally folded into an M1 migration.
  const PHASE1_TABLES = [
    "material_families",
    "material_grades",
    "materials",
    "product_types",
    "material_product_types",
    "material_aliases",
    "material_alias_verifications",
    "spec_templates",
    "spec_attributes",
    "spec_template_attributes",
    "search_intent_mappings",
  ];
  const { rows } = await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [PHASE1_TABLES],
  );
  if (rows.length === 0) {
    ok("no Phase 1 table exists in the M1 baseline", `${PHASE1_TABLES.length} checked`);
  } else {
    fail(
      "a Phase 1 table leaked into the M1 migrations",
      rows.map((r) => r.table_name).join(", "),
    );
  }
}

{
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'scrap_grades' and column_name = 'material_id'`,
  );
  if (rows.length === 0) {
    ok("scrap_grades.material_id is absent in M1", "added by Phase 1, not M1");
  } else {
    fail("scrap_grades.material_id exists in the M1 baseline", "Phase 1 column leaked into M1");
  }
}

// ---------------------------------------------------------------------------
// 6. Reference seeds, unchanged
// ---------------------------------------------------------------------------
console.log("6. M1 reference seeds");
{
  const { rows } = await db.query(`select count(*)::int as n from tax_components_ref`);
  if (rows[0].n === 11) ok("tax_components_ref seeded", "11 component names, no rates");
  else fail("tax_components_ref seed count", `expected 11, found ${rows[0].n}`);
}
{
  const { rows } = await db.query(`select count(*)::int as n from inspection_methods_ref`);
  if (rows[0].n === 10) ok("inspection_methods_ref seeded", "10 methods");
  else fail("inspection_methods_ref seed count", `expected 10, found ${rows[0].n}`);
}
{
  const { rows } = await db.query(`select count(*)::int as n from tax_treatments`);
  if (rows[0].n === 0) ok("no tax treatment seeded", "a treatment is a decision, not a reference row");
  else fail("tax_treatments was seeded", `${rows[0].n} rows`);
}
{
  const { rows } = await db.query(`select count(*)::int as n from location_states`);
  if (rows[0].n === 0) ok("no location seeded", "is_serviced is a commercial claim");
  else fail("location_states was seeded", `${rows[0].n} rows`);
}

// ---------------------------------------------------------------------------
// 7. The D7 EXCLUDE constraint still behaves as the document states
// ---------------------------------------------------------------------------
console.log("7. D7 tax overlap protection (historical behaviour)");
{
  const APPROVED_RULE = (id, overrides = {}) => {
    const component = overrides.component ?? "GST";
    const state = overrides.state ? `'${overrides.state}'` : "NULL";
    const invoiceRole = overrides.invoiceRole ?? "ANY";
    const appliesTo = overrides.appliesTo ?? "BOTH";
    const model = overrides.model ? `'${overrides.model}'` : "NULL";
    const rate = overrides.rate ?? 18;
    const from = overrides.from ?? "2026-04-01";
    const to = overrides.to ? `'${overrides.to}'` : "NULL";
    const status = overrides.status ?? "ACTIVE";
    return `INSERT INTO tax_rules
      (id, code, component_code, transaction_model, invoice_role, jurisdiction_state_id, applies_to,
       rate_pct, taxable_base_rule, effective_from, effective_to, status, approved_by_id, approved_at)
      VALUES ('${id}', 'RULE-${id.slice(-4)}', '${component}', ${model}, '${invoiceRole}', ${state}, '${appliesTo}',
       ${rate}, 'GOODS_VALUE', '${from}', ${to}, '${status}',
       '11111111-1111-1111-1111-111111111111', now());`;
  };

  await db.exec(`
    INSERT INTO users (id, email, full_name, role, status)
    VALUES ('11111111-1111-1111-1111-111111111111', 'm1-baseline@example.test', 'M1 Baseline', 'ADMIN', 'ACTIVE');
  `);

  const accept = async (name, sql) => {
    try {
      await db.exec(sql);
      ok(name);
      return true;
    } catch (error) {
      fail(name, `statement was REJECTED: ${error?.message ?? error}`);
      return false;
    }
  };
  const reject = async (name, sql, pattern) => {
    try {
      await db.exec(sql);
      fail(name, "statement was ACCEPTED but the constraint requires rejection");
    } catch (error) {
      const message = String(error?.message ?? error);
      if (pattern.test(message)) ok(name, message.split("\n")[0].slice(0, 100));
      else fail(name, `rejected for the wrong reason: ${message}`);
    }
  };

  await accept("first ACTIVE rule is accepted", APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000001"));
  await reject(
    "duplicate ACTIVE scope is REJECTED (the EXCLUDE constraint)",
    APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000002"),
    /conflict|exclu/i,
  );
  await accept(
    "a different invoice_role is a different scope",
    APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000003", { invoiceRole: "MATERIAL" }),
  );
  await accept(
    "a different transaction_model is a different scope",
    APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000004", { model: "AGENCY" }),
  );
  await accept(
    "a non-overlapping period is accepted",
    // The first rule is open-ended (effective_to NULL = infinity), so nothing starting later can
    // avoid overlapping it. Closing it first makes the second period genuinely disjoint; this is
    // the documented `'[]'` boundary behaviour, not a relaxation of it.
    APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000008", {
      from: "2026-04-01",
      to: "2027-03-31",
      component: "IGST",
    })
  );
  await accept(
    "an adjacent period after a closed one is accepted",
    APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000009", {
      from: "2027-04-01",
      component: "IGST",
    })
  );
  await reject(
    "a period overlapping a closed one at the START boundary is REJECTED ('[]' is inclusive)",
    APPROVED_RULE("aaaaaaaa-0000-0000-0000-00000000000a", {
      from: "2027-03-31",
      component: "IGST",
    }),
    /conflict|exclu/i,
  );
  await reject(
    "a rate above 100% is REJECTED",
    APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000006", { rate: 101, component: "IGST" }),
    /rate|check/i,
  );
  await reject(
    "an ACTIVE rule with no approver is REJECTED",
    APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000007", { component: "GST", from: "2030-04-01" }).replace(
      "'11111111-1111-1111-1111-111111111111', now()",
      "NULL, NULL",
    ),
    /approv|check|not-null/i,
  );
}

await db.close();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(` - ${failure.name}: ${failure.detail}`);
  process.exit(1);
}
console.log("M1 historical baseline verification passed.");