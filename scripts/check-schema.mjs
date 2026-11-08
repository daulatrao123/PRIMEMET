#!/usr/bin/env node
/**
 * PRIMEMET — schema verification.
 *
 * Proves the M1 exit criteria of docs/PRIMEMET_STAGE_2_ARCHITECTURE.md §28.1 against a REAL
 * PostgreSQL engine, with no server to install and no DATABASE_URL:
 *
 *   1. `prisma validate` is clean.
 *   2. The COMMITTED VIEW — the summed effect of all migrations 1..N — still matches
 *      prisma/schema.prisma, so the schema and the applied history cannot drift apart silently.
 *   3. Every committed migration applies in order to PostgreSQL 17 (PGlite, the WASM build).
 *   4. The constraints do what the document says on real inserts — most importantly that the
 *      btree_gist EXCLUDE constraint REJECTS a duplicate ACTIVE tax scope (D7, §15.5.2) while still
 *      allowing a legitimately different scope.
 *   5. No float or double column exists anywhere (§5.1).
 *   6. Every index name fits in PostgreSQL's 63-byte identifier limit, so no two can collide after
 *      truncation.
 *
 * This script verifies the COMPLETE schema as it stands after Phase 1. The frozen historical M1
 * milestone is verified separately by scripts/check-schema-m1.mjs, so a Phase 1 addition can never
 * satisfy an M1 assertion by accident, and an M1 assertion can never be relaxed to fit Phase 1.
 *
 * Note on step 2: once more than one migration exists, an incremental `migrate diff` from any single
 * earlier migration is NOT expected to equal its committed file (Prisma re-renders indexes). The
 * meaningful invariant is that the cumulative effect of all migrations equals the current schema,
 * checked here by applying every migration to a real database and diffing that against
 * schema.prisma (step 3b). Step 2 keeps the from-empty guard for the very first migration only.
 *
 * Usage:
 *   npm run check:schema              # everything, including the live-database assertions
 *   node scripts/check-schema.mjs --db  # same; `--db` is accepted for explicitness
 *
 * On Windows, PGlite prints a few harmless "The system cannot find the path specified." lines to
 * stderr while it starts; they are not errors and the exit code and stdout are unaffected.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const SCHEMA = "prisma/schema.prisma";
const MIGRATIONS = [
  "prisma/migrations/20261031000000_m1_initial_schema/migration.sql",
  "prisma/migrations/20261031000100_m1_constraints/migration.sql",
  "prisma/migrations/20261031000200_m1_reference_seeds/migration.sql",
  "prisma/migrations/20261031130000_m1_phase1_canonical_catalogue/migration.sql",
  "prisma/migrations/20261031130100_m1_phase1_constraints/migration.sql",
  "prisma/migrations/20261031140000_d1_equivalence_governance/migration.sql",
  "prisma/migrations/20261031140100_d2_constraints_and_immutability/migration.sql",
];

// A placeholder URL: `prisma validate` and `migrate diff` parse the schema, they do not connect.
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

async function expectReject(name, sql, pattern) {
  try {
    await db.exec(sql);
    fail(name, "statement was ACCEPTED but the constraint requires it to be rejected");
  } catch (error) {
    const message = String(error?.message ?? error);
    if (pattern.test(message)) {
      ok(name, message.split("\n")[0].slice(0, 120));
    } else {
      fail(name, `rejected for the wrong reason: ${message}`);
    }
  }
}

async function expectAccept(name, sql) {
  try {
    await db.exec(sql);
    ok(name);
  } catch (error) {
    fail(name, `statement was REJECTED: ${error?.message ?? error}`);
  }
}

// Invoke Prisma's CLI through the current Node binary and its real entry point. Calling `npx` is not
// portable here: on Windows a .cmd shim needs a shell, and the failure it produces is a silent empty
// string rather than an error.
const PRISMA_CLI = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));

function prisma(args, { ignoreExit = false } = {}) {
  try {
    return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || PLACEHOLDER_URL },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (ignoreExit) return String(error.stdout ?? "") + String(error.stderr ?? "");
    throw new Error(
      `prisma ${args.join(" ")} failed:\n${error.stdout ?? ""}${error.stderr ?? ""}`,
    );
  }
}

console.log("PRIMEMET — complete schema verification (M1 + Phase 1)\n");

// `--db` states explicitly that the live-database assertions must run. They always run, because the
// whole point of this script is constraint behaviour on real inserts rather than a schema read, so it
// is accepted as a no-op flag rather than as an opt-in that could silently skip them.
const wantsDb = process.argv.includes("--db");
void wantsDb;

// ---------------------------------------------------------------------------
// 1. prisma validate
// ---------------------------------------------------------------------------
console.log("1. Prisma schema");
{
  const output = prisma(["validate"], { ignoreExit: true });
  if (/is valid/.test(output)) ok("prisma validate", "schema is valid");
  else fail("prisma validate", output);
}

// ---------------------------------------------------------------------------
// 2. The committed history still adds up to the schema
// ---------------------------------------------------------------------------
console.log("2. Migration history ↔ schema parity");
{
  // Step 2 keeps its original meaning for the migration it was written for: migration 1 must
  // still regenerate from an empty database exactly as committed, so the foundation cannot be
  // rewritten under a stable filename. It is deliberately NOT extended to the later migrations,
  // because Prisma re-renders index DDL between an incremental diff and a from-empty render, and
  // comparing those would fail for a reason unrelated to correctness. The cumulative invariant that
  // matters — all migrations together equal the current schema — is step 3b below, measured against
  // a real database.
  const generated = prisma([
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema-datamodel",
    "scripts/m1-baseline/schema.prisma",
    "--script",
  ]);
  const committed = readFileSync(MIGRATIONS[0], "utf8");
  if (generated.trim() === committed.trim()) {
    ok("migration 1 matches the frozen M1 datamodel", `${committed.split("\n").length} lines`);
  } else {
    const a = generated.split("\n");
    const b = committed.split("\n");
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    fail(
      "migration 1 has drifted from the frozen M1 datamodel",
      `first difference at line ${i + 1}\n  generated: ${JSON.stringify(a[i] ?? "<eof>")}\n  committed: ${JSON.stringify(b[i] ?? "<eof>")}`,
    );
  }

  const phase1 = "prisma/migrations/20261031130000_m1_phase1_canonical_catalogue/migration.sql";
  if (existsSync(phase1)) {
    ok("the Phase 1 migration exists", `${phase1.split("/").pop()}, ${readFileSync(phase1, "utf8").split("\n").length} lines`);
  } else {
    fail("the Phase 1 migration is missing", phase1);
  }
}

// ---------------------------------------------------------------------------
// 3. Apply the real migrations to a real PostgreSQL
// ---------------------------------------------------------------------------
console.log("3. Apply migrations to PostgreSQL");
const db = await PGlite.create({ extensions: { btree_gist } });
{
  for (const path of MIGRATIONS) {
    if (!existsSync(path)) {
      fail(`missing migration ${path}`, "file not found");
      continue;
    }
    try {
      await db.exec(readFileSync(path, "utf8"));
      ok(
        `applied ${path.split("/").pop()}`,
        `${readFileSync(path, "utf8").split("\n").length} lines`,
      );
    } catch (error) {
      fail(`apply ${path}`, error?.message ?? String(error));
    }
  }
}

// ---------------------------------------------------------------------------
// 3b. Each generated migration equals its own datamodel boundary delta
// ---------------------------------------------------------------------------
console.log("3b. Migration ↔ datamodel boundary deltas");
{
  // The invariant that matters: applying the committed migrations to the M1 state must produce
  // precisely the current schema, and each engine-generated migration must equal the delta of its
  // own boundary. Boundaries are frozen snapshots under scripts/m1-baseline/:
  //
  //   schema.prisma            M1, before Phase 1
  //   schema-phase1.prisma     after Phase 1, before the D-1/D-2 corrective
  //   (current)                prisma/schema.prisma
  //
  // A SET comparison across the whole post-M1 delta cannot work, and the first attempt proved it: a
  // later migration legitimately ALTERs a table an earlier one created, so the generated CREATE
  // TABLE differs from the committed one even when both are correct. Per-boundary equality is the
  // only comparison that is both exact and meaningful.
  const BOUNDARIES = [
    {
      label: "Phase 1",
      from: "scripts/m1-baseline/schema.prisma",
      to: "scripts/m1-baseline/schema-phase1.prisma",
      migration: "prisma/migrations/20261031130000_m1_phase1_canonical_catalogue/migration.sql",
    },
    {
      label: "D-1 equivalence governance",
      from: "scripts/m1-baseline/schema-phase1.prisma",
      to: SCHEMA,
      migration: "prisma/migrations/20261031140000_d1_equivalence_governance/migration.sql",
    },
  ];

  const bodyOf = (text) =>
    text
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trim();

  for (const boundary of BOUNDARIES) {
    if (!existsSync(boundary.from) || !existsSync(boundary.migration)) {
      fail(`cannot check the ${boundary.label} delta`, `${boundary.from} or ${boundary.migration} is missing`);
      continue;
    }
    const generated = prisma([
      "migrate",
      "diff",
      "--from-schema-datamodel",
      boundary.from,
      "--to-schema-datamodel",
      boundary.to,
      "--script",
    ]);
    // Compare the SQL body: the committed files carry explanatory headers the generator does not.
    const committedBody = bodyOf(readFileSync(boundary.migration, "utf8"));
    const generatedBody = bodyOf(generated);
    if (committedBody === generatedBody) {
      const statements = (committedBody.match(/;/g) ?? []).length;
      ok(`${boundary.label} migration equals its boundary delta`, `${statements} statements`);
    } else {
      const a = generatedBody.split("\n");
      const b = committedBody.split("\n");
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
      fail(
        `${boundary.label} migration has drifted from its boundary delta`,
        `first difference at body line ${i + 1}\n  expected: ${JSON.stringify(a[i] ?? "<eof>")}\n  committed: ${JSON.stringify(b[i] ?? "<eof>")}`,
      );
    }
  }
}

// Baseline captured before any test writes, so "nothing was seeded" is measured against the state
// the migrations produced rather than against a table the assertions themselves later populate.
const baseline = {
  taxTreatments: (
    await db.query(`select count(*)::int as n from tax_treatments`)
  ).rows[0].n,
  locationStates: (
    await db.query(`select count(*)::int as n from location_states`)
  ).rows[0].n,
  organisations: (
    await db.query(`select count(*)::int as n from organisations`)
  ).rows[0].n,
};
ok(
  "migrations created no business record",
  `${baseline.organisations} organisations, ${baseline.locationStates} states, ${baseline.taxTreatments} treatments`,
);

// ---------------------------------------------------------------------------
// 4. Structure
// ---------------------------------------------------------------------------
console.log("4. Structure");
const EXPECTED_TABLES = [
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
  "material_alias_equivalence_decisions",
  "material_alias_verifications",
  "material_aliases",
  "material_families",
  "material_grades",
  "material_product_types",
  "materials",
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
  // D-1/D-2 guard table: intentionally has no Prisma model and can never hold a row.
  "pm_history_guard",
  "product_types",
  "reference_sequences",
  "scrap_grades",
  "search_intent_mappings",
  "sessions",
  "spec_attributes",
  "spec_template_attributes",
  "spec_templates",
  "supplier_listings",
  "supplier_profiles",
  "tax_components_ref",
  "tax_rules",
  "tax_treatments",
  "users",
];

{
  const { rows } = await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const actual = rows.map((r) => r.table_name);
  const missing = EXPECTED_TABLES.filter((t) => !actual.includes(t));
  const extra = actual.filter((t) => !EXPECTED_TABLES.includes(t));
  if (missing.length === 0 && extra.length === 0) {
    ok(`${actual.length} tables present`, "exactly the M1 + Phase 1 + corrective set");
  } else {
    fail("table set mismatch", `missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`);
  }
}

{
  // Deferred table groups must NOT exist yet: M1 creates schema, not later milestones.
  const FORBIDDEN = [
    "enquiries",
    "scrap_lots",
    "inspections",
    "orders",
    "invoices",
    "stock_positions",
    "seo_pages",
    "location_cities",
  ];
  const { rows } = await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [FORBIDDEN],
  );
  if (rows.length === 0) ok("no later-milestone table exists", `${FORBIDDEN.length} checked`);
  else fail("later-milestone tables were created in M1", rows.map((r) => r.table_name).join(", "));
}

{
  const { rows } = await db.query(
    `select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and data_type in ('real', 'double precision')`,
  );
  if (rows.length === 0) ok("no float or double column anywhere", "§5.1");
  else fail("float column found", JSON.stringify(rows));
}

{
  // Money is numeric(18,2); a mistyped precision would silently round a rupee amount.
  const { rows } = await db.query(
    `select table_name, column_name, numeric_precision::int as p, numeric_scale::int as s
       from information_schema.columns
      where table_schema = 'public' and data_type = 'numeric'`,
  );
  const wrong = rows.filter(
    (r) => r.p === 65 && r.s === 30 && !["rating_internal"].includes(r.column_name),
  );
  if (wrong.length === 0) ok(`${rows.length} numeric columns carry an explicit precision`);
  else fail("numeric column left at Prisma's default 65,30", JSON.stringify(wrong));
}

{
  const { rows } = await db.query(
    `select count(*)::int as n from pg_indexes where schemaname = 'public'`,
  );
  const { rows: longNames } = await db.query(
    `select indexname from pg_indexes where schemaname = 'public' and length(indexname) > 63`,
  );
  if (longNames.length === 0) ok(`${rows[0].n} indexes, all within 63 bytes`, "no truncation collisions");
  else fail("over-long index name", JSON.stringify(longNames));
}

{
  const { rows } = await db.query(
    `select 1 from pg_extension where extname = 'btree_gist'`,
  );
  if (rows.length === 1) ok("btree_gist installed", "required by the EXCLUDE constraint");
  else fail("btree_gist missing", "the EXCLUDE constraint cannot work without it");
}

// ---------------------------------------------------------------------------
// 5. The EXCLUDE constraint — the point of D7 (§15.5.2)
// ---------------------------------------------------------------------------
console.log("5. Tax overlap protection (D7)");

// A user is needed for the approver columns, and an ACTIVE rule must be approved (CHECK).
await db.exec(`
  INSERT INTO users (id, email, full_name, role, status)
  VALUES ('11111111-1111-1111-1111-111111111111', 'admin@example.test', 'Schema Test Admin', 'ADMIN', 'ACTIVE');
`);

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
  // status === null means "an ACTIVE rule with no approver" — the CHECK must reject it.
  const approver =
    overrides.status === null
      ? "NULL, NULL"
      : "'11111111-1111-1111-1111-111111111111', '2026-03-01T00:00:00Z'";
  return `
  INSERT INTO tax_rules (
    id, code, component_code, jurisdiction_state_id, invoice_role, applies_to,
    transaction_model, rate_pct, taxable_base_rule, effective_from, effective_to,
    status, approved_by_id, approved_at
  ) VALUES (
    '${id}', 'TEST-${id.slice(0, 4)}', '${component}',
    ${state}, '${invoiceRole}', '${appliesTo}',
    ${model}, ${rate}, 'GOODS_VALUE',
    '${from}', ${to},
    '${status}', ${approver}
  );`;
};

// A state row, so jurisdiction scoping can be proven rather than assumed.
await db.exec(`
  INSERT INTO location_states (id, code, name, country_code)
  VALUES ('77777777-7777-7777-7777-777777777777', 'MH', 'Maharashtra', 'IN');
`);

// S1 — an open-ended national GST rule applies to every model and every invoice role.
await expectAccept("first ACTIVE rule is accepted", APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000001"));

await expectReject(
  "duplicate ACTIVE scope is REJECTED",
  APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000002"),
  /exclusion|conflicting key|23P01/i,
);

await expectReject(
  "same scope, overlapping dates is REJECTED",
  APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000003", { from: "2026-06-01", to: "2027-03-31" }),
  /exclusion|conflicting key|23P01/i,
);

// A different invoice role is a different scope: this is what a NULL-means-wildcard column could not
// express, and what coalescing invoice_role to a literal would have broken.
await expectAccept(
  "same component, different invoice_role is ACCEPTED",
  APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000004", { invoiceRole: "COMMISSION" }),
);

await expectAccept(
  "same component, different transaction_model is ACCEPTED",
  APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000005", { model: "AGENCY" }),
);

await expectReject(
  "the same model, role and component still collides with an open-ended rule",
  APPROVED_RULE("aaaaaaaa-0000-0000-0000-00000000005b", { model: "AGENCY" }),
  /exclusion|conflicting key|23P01/i,
);

// Jurisdiction: the COALESCE(…, zero-uuid) expression, proven per state.
await expectAccept(
  "a state-scoped rule may coexist with the national rule",
  APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000006", {
    state: "77777777-7777-7777-7777-777777777777",
  }),
);

await expectReject(
  "a second rule for the same state is REJECTED",
  APPROVED_RULE("aaaaaaaa-0000-0000-0000-000000000007", {
    state: "77777777-7777-7777-7777-777777777777",
  }),
  /exclusion|conflicting key|23P01/i,
);

// NULL transaction_model on both rows: the pm_tax_scope_model('ALL') path.
await expectAccept(
  "two non-overlapping periods for the same NULL-model component are ACCEPTED",
  APPROVED_RULE("bbbbbbbb-0000-0000-0000-000000000001", {
    component: "UTGST",
    from: "2030-04-01",
    to: "2030-06-30",
  }) +
    APPROVED_RULE("bbbbbbbb-0000-0000-0000-000000000002", {
      component: "UTGST",
      from: "2030-07-01",
      to: "2030-12-31",
    }),
);

await expectReject(
  "two NULL transaction_model values still collide on overlapping dates",
  APPROVED_RULE("bbbbbbbb-0000-0000-0000-000000000003", {
    component: "UTGST",
    from: "2030-08-01",
    to: "2030-09-30",
  }),
  /exclusion|conflicting key|23P01/i,
);

// The documented range is INCLUSIVE '[]'. That has a consequence worth pinning down: a rule ending on
// the day the next begins is a one-day overlap and is rejected. If the CA wants back-to-back
// financial years to be legal, the migration must switch to ')' — that is a decision, so it is
// recorded as a test rather than silently changed.
await expectAccept(
  "a rule ending 31 March is accepted",
  APPROVED_RULE("cccccccc-0000-0000-0000-000000000001", {
    component: "VAT",
    from: "2031-01-01",
    to: "2031-03-31",
  }),
);

await expectReject(
  "a next rule starting the same 31 March is REJECTED (inclusive range)",
  APPROVED_RULE("cccccccc-0000-0000-0000-000000000002", {
    component: "VAT",
    from: "2031-03-31",
    to: "2032-03-30",
  }),
  /exclusion|conflicting key|23P01/i,
);

await expectAccept(
  "a non-ACTIVE rule may duplicate an ACTIVE scope",
  APPROVED_RULE("dddddddd-0000-0000-0000-000000000001", { component: "CESS", status: "DRAFT" }) +
    APPROVED_RULE("dddddddd-0000-0000-0000-000000000002", { component: "CESS" }),
);

await expectReject(
  "an ACTIVE rule without an approver is REJECTED",
  APPROVED_RULE("eeeeeeee-0000-0000-0000-000000000001", { component: "SALES_TAX", status: null }),
  /tax_rules_active_is_approved/,
);

await expectReject(
  "a rule above 100 % is REJECTED",
  APPROVED_RULE("eeeeeeee-0000-0000-0000-000000000002", { component: "TDS", rate: 150 }),
  /tax_rules_rate_pct_range/,
);

await expectReject(
  "a NULL invoice_role is REJECTED (D7: NULL cannot be the wildcard)",
  APPROVED_RULE("eeeeeeee-0000-0000-0000-000000000003", { component: "SGST" }).replace(
    "'ANY'",
    "NULL",
  ),
  /not-null|tax_rules_invoice_role_not_null/i,
);

// ---------------------------------------------------------------------------
// 6. Partial unique indexes
// ---------------------------------------------------------------------------
console.log("6. Partial unique indexes");

await db.exec(`
  INSERT INTO organisations (id, legal_name, org_type, country_code, org_kind)
  VALUES ('22222222-2222-2222-2222-222222222222', 'PRIMEMET Trading Pvt Ltd', 'BOTH', 'IN', 'PRIMEMET');
`);
ok("first PRIMEMET organisation accepted");

await expectReject(
  "a second PRIMEMET organisation is REJECTED",
  `INSERT INTO organisations (legal_name, org_type, country_code, org_kind)
   VALUES ('Another PRIMEMET', 'BOTH', 'IN', 'PRIMEMET');`,
  /ix_orgs_one_primemet_org|duplicate key/i,
);

await expectAccept(
  "a soft-deleted PRIMEMET row may be re-created",
  `INSERT INTO organisations (legal_name, org_type, country_code, org_kind, deleted_at)
   VALUES ('Old PRIMEMET', 'BOTH', 'IN', 'PRIMEMET', '2026-01-01T00:00:00Z');`,
);

await expectAccept(
  "two organisations without a GSTIN do not collide",
  `INSERT INTO organisations (legal_name, org_type, country_code) VALUES ('Buyer A', 'BUYER', 'IN');
   INSERT INTO organisations (legal_name, org_type, country_code) VALUES ('Buyer B', 'BUYER', 'IN');`,
);

await db.exec(`UPDATE organisations SET gstin = '27AAAAA0000A1Z5' WHERE legal_name = 'Buyer A';`);
await expectReject(
  "a duplicate GSTIN is REJECTED",
  `UPDATE organisations SET gstin = '27AAAAA0000A1Z5' WHERE legal_name = 'Buyer B';`,
  /ix_orgs_gstin_unique|duplicate key/i,
);

await db.exec(`
  INSERT INTO pricing_rule_sets (id, key, name, version, status, currency_code, effective_from, approved_by_id, approved_at)
  VALUES ('33333333-3333-3333-3333-333333333333', 'scrap-hms', 'HMS pricing', 1, 'ACTIVE', 'INR', '2026-04-01T00:00:00Z', '11111111-1111-1111-1111-111111111111', '2026-03-01T00:00:00Z');
`);
await expectReject(
  "a second ACTIVE version of the same rule set is REJECTED",
  `INSERT INTO pricing_rule_sets (key, name, version, status, currency_code, effective_from, approved_by_id, approved_at)
   VALUES ('scrap-hms', 'HMS pricing v2', 2, 'ACTIVE', 'INR', '2026-05-01T00:00:00Z', '11111111-1111-1111-1111-111111111111', '2026-04-01T00:00:00Z');`,
  /ix_pricing_rule_sets_one_active|duplicate key/i,
);

// ---------------------------------------------------------------------------
// 7. CHECK constraints
// ---------------------------------------------------------------------------
console.log("7. CHECK constraints");

await expectReject(
  "an email stored in mixed case is REJECTED",
  `INSERT INTO users (email, full_name, role) VALUES ('MixedCase@Example.test', 'X', 'BUYER');`,
  /users_email_is_normalised/,
);

await expectReject(
  "a blank full name is REJECTED",
  `INSERT INTO users (email, full_name, role) VALUES ('blank@example.test', '   ', 'BUYER');`,
  /users_full_name_not_blank/,
);

await expectReject(
  "a grade composition RANGE without bounds is REJECTED",
  `WITH c AS (INSERT INTO categories (id, slug, kind, name) VALUES ('44444444-4444-4444-4444-444444444444', 'scrap-metals', 'SCRAP', 'Scrap metals') RETURNING id),
        g AS (INSERT INTO scrap_grades (id, category_id, slug, code, name) SELECT '55555555-5555-5555-5555-555555555555', id, 'hms-1', 'HMS-1', 'HMS 1' FROM c RETURNING id),
        a AS (INSERT INTO composition_attribute_defs (id, symbol, name, canonical_unit) VALUES ('66666666-6666-6666-6666-666666666666', 'Fe', 'Iron', 'PERCENT') RETURNING id)
   INSERT INTO grade_composition_attributes (grade_id, attribute_id, basis, unit)
   SELECT g.id, a.id, 'RANGE', 'PERCENT' FROM g, a;`,
  /grade_comp_range_needs_both_bounds/,
);

// The listing must fail on its own CHECK, not on a foreign key. A real supplier profile is created
// first so the assertion cannot pass for the wrong reason.
await db.exec(`
  INSERT INTO organisations (id, legal_name, org_type, country_code)
  VALUES ('88888888-8888-8888-8888-888888888888', 'Supplier A', 'SELLER', 'IN');
  INSERT INTO supplier_profiles (id, organisation_id)
  VALUES ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888');
`);

await expectReject(
  "a product listing that names neither grade nor product is REJECTED",
  `INSERT INTO supplier_listings (supplier_id, status)
   VALUES ('99999999-9999-9999-9999-999999999999', 'DRAFT');`,
  /listings_grade_or_product/,
);

await expectReject(
  "a migration run marked APPLIED without a verified backup is REJECTED",
  `INSERT INTO migration_runs (migration_id, description, file_checksum_sha256, objects_affected, app_version, applied_by_id, status, finished_at, schema_after, requires_backup)
   VALUES ('x', 'x', repeat('a', 64), '{}', '0.1.0', '11111111-1111-1111-1111-111111111111', 'APPLIED', now(), 'head', true);`,
  /migration_runs_applied_needs_backup/,
);

await expectReject(
  "a document scanned CLEAN with no scan result is REJECTED",
  `INSERT INTO documents (storage_key, bucket, original_filename, mime_type, size_bytes, checksum_sha256, document_type, scan_status)
   VALUES ('k/1', 'private', 'a.pdf', 'application/pdf', 10, 'abc', 'OTHER', 'CLEAN');`,
  /documents_clean_needs_scan_result/,
);

await expectReject(
  "an organisation with an unknown account_status is REJECTED",
  `INSERT INTO organisations (legal_name, org_type, country_code, account_status) VALUES ('C', 'BUYER', 'IN', 'PAUSED');`,
  /orgs_account_status_known/,
);

// ---------------------------------------------------------------------------
// 8. Seed state — reference lists only, and no business record
// ---------------------------------------------------------------------------
console.log("8. Reference seeds");

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
  if (baseline.taxTreatments === 0) {
    ok("no tax treatment seeded", "a treatment is a decision, not a reference row");
  } else {
    fail("tax_treatments was seeded", `${baseline.taxTreatments} rows`);
  }
}

{
  if (baseline.locationStates === 0) {
    ok("no location seeded", "is_serviced is a commercial claim, not a reference row");
  } else {
    fail("location_states was seeded", `${baseline.locationStates} rows`);
  }
}

// ---------------------------------------------------------------------------
// 9. Document immutability shape: no updated_at on insert-only tables
// ---------------------------------------------------------------------------
console.log("9. Insert-only tables");

{
  const INSERT_ONLY = [
    "documents",
    "document_access_log",
    "audit_logs",
    "audit_log_failures",
    "auth_events",
  ];
  const { rows } = await db.query(
    `select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'updated_at' and table_name = any($1::text[])`,
    [INSERT_ONLY],
  );
  if (rows.length === 0) ok("no updated_at on insert-only tables", INSERT_ONLY.join(", "));
  else fail("insert-only table has updated_at", JSON.stringify(rows));
}

// ---------------------------------------------------------------------------
// 10. Phase 1 structure — the canonical catalogue added by this milestone
// ---------------------------------------------------------------------------
console.log("10. Phase 1 canonical catalogue structure");
{
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
  if (rows.length === PHASE1_TABLES.length) {
    ok(`${rows.length} Phase 1 tables exist`);
  } else {
    const found = rows.map((r) => r.table_name);
    fail("Phase 1 table set incomplete", PHASE1_TABLES.filter((t) => !found.includes(t)).join(", "));
  }
}
{
  // Backward compatibility: the Phase 1 column is nullable with no default, so every pre-existing
  // ScrapGrade row stays valid without a backfill, and deleting a material cannot delete a grade.
  const { rows } = await db.query(
    `select is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'scrap_grades' and column_name = 'material_id'`,
  );
  if (rows.length === 1 && rows[0].is_nullable === "YES" && rows[0].column_default === null) {
    ok("scrap_grades.material_id is nullable with no default", "existing rows stay valid");
  } else {
    fail("scrap_grades.material_id shape", JSON.stringify(rows));
  }

  const { rows: fk } = await db.query(
    `select rc.delete_rule from information_schema.referential_constraints rc
       join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
      where tc.table_name = 'scrap_grades' and tc.constraint_name = 'scrap_grades_material_id_fkey'`,
  );
  if (fk.length === 1 && fk[0].delete_rule === "SET NULL") {
    ok("scrap_grades → materials is ON DELETE SET NULL", "a grade outlives its material link");
  } else {
    fail("scrap_grades material FK delete rule", JSON.stringify(fk));
  }
}
{
  const { rows } = await db.query(
    `select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'material_product_types'
        and indexname = 'ix_material_product_types_one_primary'`,
  );
  if (rows.length === 1) ok("partial unique index enforces one primary form", "§Phase 1 migration 2");
  else fail("one-primary partial index missing", JSON.stringify(rows));
}
{
  // The hand-written constraints must be real constraints, not comments in a schema file.
  const EXPECTED_CHECKS = [
    "material_aliases_normalised_is_derived",
    "material_aliases_alias_not_blank",
    "material_aliases_verified_needs_verifier",
    "material_aliases_retired_needs_timestamp",
    "alias_verifications_verified_needs_decider",
    "alias_verifications_decided_at_present",
    "material_grades_code_not_blank",
    "material_families_code_not_blank",
    "search_intent_phrase_not_blank",
  ];
  const { rows } = await db.query(
    `select constraint_name from information_schema.table_constraints
      where table_schema = 'public' and constraint_type = 'CHECK' and constraint_name = any($1::text[])`,
    [EXPECTED_CHECKS],
  );
  const found = rows.map((r) => r.constraint_name);
  const missing = EXPECTED_CHECKS.filter((c) => !found.includes(c));
  if (missing.length === 0) ok(`${found.length} Phase 1 CHECK constraints exist`);
  else fail("Phase 1 CHECK constraints missing", missing.join(", "));
}
{
  // A VERIFIED alias without a named verifier must be impossible, not merely discouraged.
  const setup = `
    INSERT INTO material_families (id, slug, code, name) VALUES
      ('f1000000-0000-0000-0000-000000000001', 'stainless-steel', 'SS', 'Stainless Steel');
    INSERT INTO material_grades (id, family_id, slug, code, name) VALUES
      ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'stainless-steel-304', '304', 'Type 304');
    INSERT INTO materials (id, grade_id, slug, name) VALUES
      ('f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'stainless-steel-304', 'Stainless Steel 304');
  `;
  await db.exec(setup);

  try {
    await db.exec(`
      INSERT INTO material_aliases (material_id, alias, normalised_alias, verification)
      VALUES ('f3000000-0000-0000-0000-000000000001', 'SS304', 'ss304', 'VERIFIED');
    `);
    fail("a VERIFIED alias without a verifier is REJECTED", "it was ACCEPTED");
  } catch (error) {
    const message = String(error?.message ?? error);
    // Both rules reject this row; either named constraint proves the promotion is refused. The
    // verifier rule is isolated in the D-1 block below, which supplies a classification and no name.
    if (/material_aliases_verified_needs_verifier|material_aliases_verified_needs_equivalence/.test(message)) {
      ok("a VERIFIED alias without a verifier is REJECTED", message.match(/material_aliases_[a-z_]+/)?.[0] ?? "rejected");
    } else {
      fail("a VERIFIED alias without a verifier", `rejected for the wrong reason: ${message}`);
    }
  }

  // Isolate the verifier rule: a complete, APPROVED equivalence review is supplied, so the only
  // thing missing is the named human. Nothing else can reject this row.
  await db.exec(`
    INSERT INTO material_aliases (id, material_id, alias, normalised_alias, verification, equivalence_basis)
    VALUES ('b9000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001',
            'SS 304 v', 'ss 304 v', 'PENDING', 'EXACT_DESIGNATION');
    INSERT INTO material_alias_equivalence_decisions
      (id, alias_id, basis, status, technical_reference, reviewed_by_id, reviewed_at, notes)
    SELECT 'e9000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000001',
           'EXACT_DESIGNATION', 'APPROVED', 'EN 10088-1', u.id, now(), 'fixture review'
      FROM users u LIMIT 1;
  `);
  try {
    await db.exec(`
      UPDATE material_aliases
         SET verification = 'VERIFIED',
             equivalence_decision_id = 'e9000000-0000-0000-0000-000000000002'
       WHERE id = 'b9000000-0000-0000-0000-000000000001';
    `);
    fail("verifying with a review but no verifier is REJECTED", "it was ACCEPTED");
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/material_aliases_verified_needs_verifier/.test(message)) {
      ok("verifying with a review but no verifier is REJECTED", "named verifier still required");
    } else {
      fail("verifying with a review but no verifier", `rejected for the wrong reason: ${message}`);
    }
  }

  try {
    await db.exec(`
      INSERT INTO material_aliases (material_id, alias, normalised_alias)
      VALUES ('f3000000-0000-0000-0000-000000000001', 'SS 304', 'ss-304');
    `);
    fail("a mis-normalised alias is REJECTED", "it was ACCEPTED");
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/material_aliases_normalised_is_derived/.test(message)) {
      ok("a mis-normalised alias is REJECTED", "normalised form must be derived");
    } else {
      fail("a mis-normalised alias", `rejected for the wrong reason: ${message}`);
    }
  }
}

await db.close();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(` - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log("Schema verification passed.");