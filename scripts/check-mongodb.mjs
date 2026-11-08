#!/usr/bin/env node
/**
 * PRIMEMET — MongoDB verification suite.
 *
 * Runs against a REAL `mongod` (mongodb-memory-server, replica set so transactions behave as they do on
 * Atlas), not a mock. Every business rule the PostgreSQL schema enforced is exercised here by trying
 * to break it and asserting the specific refusal.
 *
 *   node scripts/check-mongodb.mjs
 *
 * Destructive-behaviour tests use disposable records created inside a scratch database, so nothing
 * here can touch a real cluster.
 */

import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";

import { COLLECTIONS, COLLECTIONS_BY_NAME, IMMUTABLE_COLLECTIONS } from "../db/collections/index.mjs";
import { applyMigrations, ledgerReport, reconcileMigrations, readLedger, LEDGER } from "../db/ledger.mjs";
import { MIGRATIONS } from "../db/migrations/index.mjs";
import { reconcileVerifiedAliases, verifyDatabase } from "../db/verify.mjs";
import { APPEND_ONLY, assertAppendOnly, assertReferences, insertGuarded, verifyAlias } from "../db/refs.mjs";
import { assertNoActiveTaxRuleOverlap } from "../db/tax.mjs";
import { auditRoleDefinitions, buildRoleDefinitions, effectivePrivilegesFor, MUTABLE_COLLECTIONS } from "../db/roles.mjs";
import { checkRuntimeIdentity, provisionPlan } from "../db/provision-roles.mjs";

let passed = 0;
const failures = [];
const skip = [];

function ok(name) {
  passed += 1;
  process.stdout.write(`  \u2714 ${name}\n`);
}
function fail(name, detail) {
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  process.stdout.write(`  \u2716 ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function expectReject(name, fn, matcher) {
  try {
    await fn();
    fail(name, "was ACCEPTED but should have been rejected");
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    const code = error && error.code;
    const text = message + (code ? ` [code ${code}]` : "");
    if (!matcher || matcher.test(text)) ok(name);
    else fail(name, `rejected for the wrong reason: ${text.slice(0, 220)}`);
  }
}

async function expectOk(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (error) {
    fail(name, `was REJECTED: ${String(error && error.message ? error.message : error).slice(0, 260)}`);
  }
}

const uuid = () => randomUUID();
const now = () => new Date();

async function main() {
  process.stdout.write("PRIMEMET — MongoDB verification\n\n");
  process.stdout.write("Starting a real mongod (replica set, transactions enabled)…\n");

  const server = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: "7.0.14" },
  });
  const uri = server.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("primemet_verify");
  const info = await db.admin().serverInfo();
  process.stdout.write(`Connected: MongoDB ${info.version} (real server)\n\n`);

  try {
    // -------------------------------------------------------------------
    // 1. Initialization
    // -------------------------------------------------------------------
    process.stdout.write("Initialize\n");
    const first = await applyMigrations(db, {
      migrations: MIGRATIONS,
      appliedBy: "check-mongodb",
      appVersion: "0.1.0",
    });
    if (first.every((r) => r.status === "applied")) ok("all migrations applied on a fresh database");
    else fail("all migrations applied on a fresh database", JSON.stringify(first));

    const second = await applyMigrations(db, {
      migrations: MIGRATIONS,
      appliedBy: "check-mongodb",
      appVersion: "0.1.0",
    });
    if (second.every((r) => r.status === "skipped")) ok("a second run skips every applied version (idempotent)");
    else fail("a second run skips every applied version (idempotent)", JSON.stringify(second));

    const ledgerRows = await db.collection("_schema_migrations").countDocuments({ status: "applied" });
    if (ledgerRows === MIGRATIONS.length) ok(`ledger records ${ledgerRows} applied version(s)`);
    else fail("ledger row count", `${ledgerRows} vs ${MIGRATIONS.length}`);

    // Check drift detection: a changed migration file must be refused.
    await expectReject(
      "an already-applied migration whose file changed is refused as drift",
      () =>
        applyMigrations(db, {
          migrations: MIGRATIONS.map((m) => ({ ...m, source: m.source + "\n// edited" })),
          appliedBy: "check-mongodb",
        }),
      /drift/i,
    );

    // -------------------------------------------------------------------
    // 2. Structure
    // -------------------------------------------------------------------
    process.stdout.write("\nStructure\n");
    const verification = await verifyDatabase(db, { collections: COLLECTIONS.map((c) => c.name) });
    if (verification.failed === 0) ok(`all ${COLLECTIONS.length} collections and their indexes verified (${verification.passed} checks)`);
    else fail("structural verification", verification.failures.slice(0, 5).join(" | "));

    const listed = (await db.listCollections().toArray()).map((c) => c.name);
    const absent = COLLECTIONS.filter((c) => !listed.includes(c.name));
    if (absent.length === 0) ok("every declared collection exists in the database");
    else fail("every declared collection exists in the database", absent.map((c) => c.name).join(", "));

    // -------------------------------------------------------------------
    // 3. Validators
    // -------------------------------------------------------------------
    process.stdout.write("\nCollection validation\n");
    const uid = uuid();
    await expectOk("a well-formed user is accepted", () =>
      db.collection("users").insertOne({
        _id: uid,
        email: "owner@primemet.example",
        emailVerifiedAt: null,
        passwordHash: null,
        passwordChangedAt: null,
        fullName: "Owner",
        phone: null,
        locale: "en-IN",
        role: "ADMIN",
        status: "ACTIVE",
        mfaEnabled: false,
        mfaSecretCiphertext: null,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      }),
    );

    await expectReject(
      "an unknown field is rejected (additionalProperties: false)",
      () => db.collection("users").insertOne({ ...minimalUser(), unexpectedField: true }),
      /validation|additional/i,
    );

    await expectReject(
      "a mistyped field is rejected (failedLoginCount as string)",
      () => db.collection("users").insertOne({ ...minimalUser(), failedLoginCount: "zero" }),
      /validation/i,
    );

    await expectReject(
      "an invalid enum value is rejected (role SUPERUSER)",
      () => db.collection("users").insertOne({ ...minimalUser(), role: "SUPERUSER" }),
      /validation/i,
    );

    await expectReject(
      "a non-normalised email is rejected",
      () => db.collection("users").insertOne({ ...minimalUser(), email: "Owner@Primemet.Example" }),
      /validation/i,
    );

    await expectReject(
      "an UPDATE that breaks the validator is rejected",
      async () => {
        await db.collection("users").updateOne({ _id: uid }, { $set: { role: "GOD" } });
      },
      /validation/i,
    );

    // -------------------------------------------------------------------
    // 4. Money must never be a float
    // -------------------------------------------------------------------
    process.stdout.write("\nMoney and precision\n");
    const { Decimal128 } = await import("mongodb");
    await expectReject(
      "a float (double) is rejected where money is expected",
      () => db.collection("tax_rules").insertOne(minimalTaxRule({ ratePct: 18.5 })),
      /validation/i,
    );
    await expectOk("a Decimal128 is accepted where money is expected", () =>
      db.collection("tax_rules").insertOne(minimalTaxRule({ ratePct: Decimal128.fromString("18.00") })),
    );

    // -------------------------------------------------------------------
    // 5. Canonical catalogue identity
    // -------------------------------------------------------------------
    process.stdout.write("\nCanonical catalogue identity\n");
    const familyId = uuid();
    await db.collection("material_families").insertOne({
      _id: familyId,
      categoryId: null,
      slug: "aluminium",
      code: "AL",
      name: "Aluminium",
      description: null,
      publicationState: "PUBLISHED",
      sortOrder: 0,
      createdAt: now(),
      updatedAt: now(),
    });

    const g6061 = uuid();
    const g6063 = uuid();
    await expectOk("aluminium 6061 and 6063 are created as two distinct grades", async () => {
      for (const [id, code] of [
        [g6061, "6061"],
        [g6063, "6063"],
      ]) {
        await db.collection("material_grades").insertOne({
          _id: id,
          familyId,
          slug: `aluminium-${code}`,
          code,
          name: `Aluminium ${code}`,
          designation: null,
          unsNumber: null,
          standardBody: null,
          description: null,
          verification: "VERIFIED",
          publicationState: "PUBLISHED",
          sortOrder: 0,
          deletedAt: null,
          createdAt: now(),
          updatedAt: now(),
        });
      }
    });

    await expectReject(
      "creating 6061 twice inside one family is rejected (unique family+code)",
      () =>
        db.collection("material_grades").insertOne({
          _id: uuid(),
          familyId,
          slug: "aluminium-6061-dup",
          code: "6061",
          name: "Aluminium 6061",
          designation: null,
          unsNumber: null,
          standardBody: null,
          description: null,
          verification: "NOT_SUBMITTED",
          publicationState: "DRAFT",
          sortOrder: 0,
          deletedAt: null,
          createdAt: now(),
          updatedAt: now(),
        }),
      /E11000|duplicate/i,
    );

    const steelFamily = uuid();
    await expectOk("the same code in a different family is allowed (a separate identity)", async () => {
      await db.collection("material_families").insertOne({
        _id: steelFamily,
        categoryId: null,
        slug: "stainless-steel",
        code: "SS",
        name: "Stainless Steel",
        description: null,
        publicationState: "PUBLISHED",
        sortOrder: 1,
        createdAt: now(),
        updatedAt: now(),
      });
      await db.collection("material_grades").insertOne({
        _id: uuid(),
        familyId: steelFamily,
        slug: "stainless-304",
        code: "304",
        name: "Stainless 304",
        designation: null,
        unsNumber: null,
        standardBody: null,
        description: null,
        verification: "PENDING",
        publicationState: "DRAFT",
        sortOrder: 0,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      });
    });

    const m6061 = uuid();
    await db.collection("materials").insertOne({
      _id: m6061,
      gradeId: g6061,
      slug: "aluminium-6061",
      name: "Aluminium 6061",
      summary: null,
      internalNote: null,
      publicationState: "PUBLISHED",
      sortOrder: 0,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
    });

    await expectReject(
      "a second canonical material for the same grade is rejected",
      () =>
        db.collection("materials").insertOne({
          _id: uuid(),
          gradeId: g6061,
          slug: "aluminium-6061-again",
          name: "Aluminium 6061 again",
          summary: null,
          internalNote: null,
          publicationState: "DRAFT",
          sortOrder: 0,
          deletedAt: null,
          createdAt: now(),
          updatedAt: now(),
        }),
      /E11000|duplicate/i,
    );

    // One primary product form per material (partial unique index).
    const sheetId = uuid();
    const plateId = uuid();
    for (const [id, code] of [
      [sheetId, "SHEET"],
      [plateId, "PLATE"],
    ]) {
      await db.collection("product_types").insertOne({
        _id: id,
        code,
        name: code,
        description: null,
        isActive: true,
        sortOrder: 0,
        createdAt: now(),
        updatedAt: now(),
      });
    }
    await db.collection("material_product_types").insertOne({
      _id: uuid(),
      materialId: m6061,
      productTypeId: sheetId,
      specTemplateId: null,
      isPrimary: true,
      sortOrder: 0,
      createdAt: now(),
      updatedAt: now(),
    });
    await expectReject(
      "a second PRIMARY product form for one material is rejected (partial unique index)",
      () =>
        db.collection("material_product_types").insertOne({
          _id: uuid(),
          materialId: m6061,
          productTypeId: plateId,
          specTemplateId: null,
          isPrimary: true,
          sortOrder: 1,
          createdAt: now(),
          updatedAt: now(),
        }),
      /E11000|duplicate/i,
    );
    await expectOk("a non-primary second form of the same material is allowed", () =>
      db.collection("material_product_types").insertOne({
        _id: uuid(),
        materialId: m6061,
        productTypeId: plateId,
        specTemplateId: null,
        isPrimary: false,
        sortOrder: 1,
        createdAt: now(),
        updatedAt: now(),
      }),
    );

    // -------------------------------------------------------------------
    // 6. Alias rules and D-1 equivalence governance
    // -------------------------------------------------------------------
    process.stdout.write("\nAlias governance (D-1)\n");

    await expectReject(
      "an alias whose normalised form disagrees with the phrase is rejected",
      () =>
        db.collection("material_aliases").insertOne(
          minimalAlias({ materialId: m6061, alias: "Alu 6061", normalisedAlias: "wrong" }),
        ),
      /validation/i,
    );

    await expectReject(
      "a blank alias is rejected",
      () =>
        db.collection("material_aliases").insertOne(
          minimalAlias({ materialId: m6061, alias: "   ", normalisedAlias: "   " }),
        ),
      /validation/i,
    );

    await expectReject(
      "retiring an alias without a timestamp is rejected",
      () =>
        db.collection("material_aliases").insertOne({
          ...minimalAlias({ materialId: m6061, alias: "Retired-ish" }),
          isRetired: true,
          retiredAt: null,
        }),
      /validation/i,
    );

    await expectReject(
      "a VERIFIED alias with no equivalence decision is rejected by the database",
      () =>
        db.collection("material_aliases").insertOne({
          ...minimalAlias({ materialId: m6061, alias: "Verified without decision" }),
          verification: "VERIFIED",
          verifiedById: uuid(),
          verifiedAt: now(),
          equivalenceBasis: "EXACT_DESIGNATION",
          equivalenceDecisionId: null,
        }),
      /validation/i,
    );

    const aliasId = uuid();
    const goodDecision = uuid();
    const borrowedDecision = uuid();
    const pendingDecision = uuid();

    await db.collection("material_aliases").insertOne(
      minimalAlias({ id: aliasId, materialId: m6061, alias: "Alu 6061 extrusion" }),
    );

    // A PENDING review with no evidence, a decision belonging to another alias, and an approved one.
    await db.collection("material_alias_equivalence_decisions").insertOne({
      _id: pendingDecision,
      aliasId,
      basis: "EXACT_DESIGNATION",
      status: "PENDING",
      technicalReference: null,
      evidenceDocumentId: null,
      reviewedById: null,
      reviewedAt: null,
      notes: null,
      supersedesDecisionId: null,
      createdAt: now(),
    });

    await expectReject(
      "a review marked APPROVED without a technical reference or evidence is rejected by the database",
      () =>
        db.collection("material_alias_equivalence_decisions").insertOne({
          _id: uuid(),
          aliasId,
          basis: "EXACT_DESIGNATION",
          status: "APPROVED",
          technicalReference: null,
          evidenceDocumentId: null,
          reviewedById: uuid(),
          reviewedAt: now(),
          notes: "approved",
          supersedesDecisionId: null,
          createdAt: now(),
        }),
      /validation/i,
    );

    await expectReject(
      "an APPROVED decision that names no reviewer is rejected by the database",
      () =>
        db.collection("material_alias_equivalence_decisions").insertOne({
          _id: uuid(),
          aliasId,
          basis: "EXACT_DESIGNATION",
          status: "APPROVED",
          technicalReference: "EN 573-3:2019 §6",
          evidenceDocumentId: null,
          reviewedById: null,
          reviewedAt: now(),
          notes: "approved but anonymous",
          supersedesDecisionId: null,
          createdAt: now(),
        }),
      /validation/i,
    );

    await db.collection("material_alias_equivalence_decisions").insertOne({
      _id: goodDecision,
      aliasId,
      basis: "EXACT_DESIGNATION",
      status: "APPROVED",
      technicalReference: "EN 573-3:2019 §6",
      evidenceDocumentId: null,
      reviewedById: uuid(),
      reviewedAt: now(),
      notes: "Designation confirmed against the standard.",
      supersedesDecisionId: null,
      createdAt: now(),
    });

    const otherAlias = uuid();
    await db.collection("material_aliases").insertOne(
      minimalAlias({ id: otherAlias, materialId: m6061, alias: "Other phrasing" }),
    );
    await db.collection("material_alias_equivalence_decisions").insertOne({
      _id: borrowedDecision,
      aliasId: otherAlias,
      basis: "EXACT_DESIGNATION",
      status: "APPROVED",
      technicalReference: "EN 573-3:2019 §6",
      evidenceDocumentId: null,
      reviewedById: uuid(),
      reviewedAt: now(),
      notes: "Belongs to a different alias.",
      supersedesDecisionId: null,
      createdAt: now(),
    });

    // -------------------------------------------------------------------
    // D-1 (defect A): no forgeable copy, and a bypassed write is DETECTED
    // -------------------------------------------------------------------
    // The previous design stored a denormalised `equivalenceGate` and validated THAT copy. The audit
    // proved a direct write could assert it while the referenced decision was REJECTED and belonged to
    // a different alias. The field is gone, and `additionalProperties: false` means it cannot come
    // back — so there is no longer anything for a writer to assert in place of the decision itself.
    await expectReject(
      "the removed equivalenceGate field cannot be written back (unknown field refused)",
      () =>
        db.collection("material_aliases").insertOne({
          ...minimalAlias({ materialId: m6061, alias: "Gate smuggler" }),
          equivalenceGate: { status: "APPROVED" },
        }),
      /validation/i,
    );

    /**
     * Write a VERIFIED alias the way a bypassing writer would — straight through the collection, with no
     * DAO — then ask reconciliation what it thinks. The forged alias is removed afterwards.
     */
    async function forgeVerifiedAndAudit({ label, decisionId, basis }) {
      const id = uuid();
      await db.collection("material_aliases").insertOne(minimalAlias({ id, materialId: m6061, alias: label }));
      await db.collection("material_aliases").updateOne(
        { _id: id },
        {
          $set: {
            verification: "VERIFIED",
            verifiedById: uuid(),
            verifiedAt: now(),
            equivalenceBasis: basis,
            equivalenceDecisionId: decisionId,
          },
        },
      );
      const audit = await reconcileVerifiedAliases(db);
      await db.collection("material_aliases").deleteOne({ _id: id });
      return audit;
    }

    {
      const audit = await forgeVerifiedAndAudit({
        label: "Borrowed approval",
        decisionId: borrowedDecision,
        basis: "EXACT_DESIGNATION",
      });
      if (audit.failed === 1 && /cannot be borrowed/.test(audit.failures[0])) {
        ok("a direct write borrowing another alias's approval is DETECTED by reconciliation");
      } else {
        fail(
          "a direct write borrowing another alias's approval is DETECTED by reconciliation",
          JSON.stringify(audit.failures),
        );
      }
    }

    {
      const audit = await forgeVerifiedAndAudit({
        label: "Pending approval",
        decisionId: pendingDecision,
        basis: "EXACT_DESIGNATION",
      });
      if (audit.failed === 1 && /not APPROVED/.test(audit.failures[0])) {
        ok("a direct write claiming a PENDING decision is DETECTED by reconciliation");
      } else {
        fail(
          "a direct write claiming a PENDING decision is DETECTED by reconciliation",
          JSON.stringify(audit.failures),
        );
      }
    }

    // A basis relabelled on an otherwise valid approval. The decision belongs to the forged alias, so
    // the partial mismatch is what has to be caught. `pendingDecision` above also belongs to `aliasId`,
    // which is why it is a separate case.
    {
      const id = uuid();
      const ownDecision = uuid();
      await db.collection("material_aliases").insertOne(minimalAlias({ id, materialId: m6061, alias: "Relabelled basis" }));
      await db.collection("material_alias_equivalence_decisions").insertOne({
        _id: ownDecision,
        aliasId: id,
        basis: "EXACT_DESIGNATION",
        status: "APPROVED",
        technicalReference: "EN 573-3:2019 §6",
        evidenceDocumentId: null,
        reviewedById: uuid(),
        reviewedAt: now(),
        notes: "Approved for this alias only.",
        supersedesDecisionId: null,
        createdAt: now(),
      });
      await db.collection("material_aliases").updateOne(
        { _id: id },
        {
          $set: {
            verification: "VERIFIED",
            verifiedById: uuid(),
            verifiedAt: now(),
            equivalenceBasis: "ISRI_EQUIVALENT",
            equivalenceDecisionId: ownDecision,
          },
        },
      );
      const audit = await reconcileVerifiedAliases(db);
      await db.collection("material_aliases").deleteOne({ _id: id });
      if (audit.failed === 1 && /basis ISRI_EQUIVALENT does not match decision/.test(audit.failures[0])) {
        ok("a direct write that relabels the basis is DETECTED by reconciliation");
      } else {
        fail("a direct write that relabels the basis is DETECTED by reconciliation", JSON.stringify(audit.failures));
      }
    }

    // Missing reviewer and missing evidence. The validator refuses to CREATE such a decision, so the
    // only way one can exist is a writer who bypassed validation. Reconciliation must still catch it.
    {
      const id = uuid();
      const unsigned = uuid();
      await db.collection("material_aliases").insertOne(minimalAlias({ id, materialId: m6061, alias: "Unsigned approval" }));
      await db.collection("material_alias_equivalence_decisions").insertOne(
        {
          _id: unsigned,
          aliasId: id,
          basis: "EXACT_DESIGNATION",
          status: "APPROVED",
          technicalReference: null,
          evidenceDocumentId: null,
          reviewedById: null,
          reviewedAt: null,
          notes: null,
          supersedesDecisionId: null,
          createdAt: now(),
        },
        { bypassDocumentValidation: true },
      );
      await db.collection("material_aliases").updateOne(
        { _id: id },
        {
          $set: {
            verification: "VERIFIED",
            verifiedById: uuid(),
            verifiedAt: now(),
            equivalenceBasis: "EXACT_DESIGNATION",
            equivalenceDecisionId: unsigned,
          },
        },
      );
      const audit = await reconcileVerifiedAliases(db);
      await db.collection("material_aliases").deleteOne({ _id: id });
      const detail = audit.failures[0] ?? "";
      if (audit.failed === 1 && /names no reviewer/.test(detail) && /no technical reference/.test(detail)) {
        ok("an approval with no reviewer and no evidence is DETECTED by reconciliation");
      } else {
        fail("an approval with no reviewer and no evidence is DETECTED by reconciliation", JSON.stringify(audit.failures));
      }
    }

    // Application path: refuses a PENDING decision.
    await expectReject(
      "verifyAlias refuses a PENDING decision",
      () =>
        verifyAlias(db, {
          aliasId,
          decisionId: pendingDecision,
          basis: "EXACT_DESIGNATION",
          verifiedById: uuid(),
        }),
      /ALIAS_VERIFICATION_REFUSED.*PENDING/i,
    );

    // Application path: refuses a borrowed approval.
    await expectReject(
      "verifyAlias refuses an approval that belongs to another alias",
      () =>
        verifyAlias(db, {
          aliasId,
          decisionId: borrowedDecision,
          basis: "EXACT_DESIGNATION",
          verifiedById: uuid(),
        }),
      /ALIAS_VERIFICATION_REFUSED.*cannot be borrowed/i,
    );

    // The supported path succeeds, and writes history.
    await expectOk("verifyAlias succeeds with an APPROVED decision for the same alias", () =>
      verifyAlias(db, {
        aliasId,
        decisionId: goodDecision,
        basis: "EXACT_DESIGNATION",
        verifiedById: uuid(),
        note: "Confirmed against the standard.",
      }),
    );

    const verifiedAlias = await db.collection("material_aliases").findOne({ _id: aliasId });
    if (verifiedAlias?.verification === "VERIFIED") ok("the alias is VERIFIED after the supported path");
    else fail("the alias is VERIFIED after the supported path", String(verifiedAlias?.verification));

    const history = await db
      .collection("material_alias_verifications")
      .find({ aliasId })
      .toArray();
    if (history.length === 1 && history[0].newVerification === "VERIFIED") ok("a verification history row was written");
    else fail("a verification history row was written", `rows=${history.length}`);

    const acceptedAudit = await reconcileVerifiedAliases(db);
    if (acceptedAudit.failed === 0 && acceptedAudit.checked >= 1) {
      ok("a valid, DAO-verified alias passes reconciliation");
    } else {
      fail("a valid, DAO-verified alias passes reconciliation", JSON.stringify(acceptedAudit.failures));
    }

    // -------------------------------------------------------------------
    // 7. Append-only history (D-2)
    // -------------------------------------------------------------------
    process.stdout.write("\nAppend-only history (D-2)\n");
    // Derived from the canonical definitions, never a hand-written list: a collection that declares
    // `immutable: true` is covered here the moment it exists, so "two of seven were tested" cannot
    // recur. requirement: every append-only collection rejects update and delete through the DAO.
    for (const name of IMMUTABLE_COLLECTIONS) {
      await expectReject(`the DAO refuses update on ${name}`, async () => assertAppendOnly(name, "update"), /append-only/i);
      await expectReject(`the DAO refuses delete on ${name}`, async () => assertAppendOnly(name, "delete"), /append-only/i);
    }
    ok(`the DAO guard refuses update and delete on all ${IMMUTABLE_COLLECTIONS.length} append-only collections`);

    // A guard that also blocks legitimate use is a different bug: find and insert must still pass.
    const blockedLegitimate = [];
    for (const name of IMMUTABLE_COLLECTIONS) {
      for (const verb of ["find", "insert"]) {
        try {
          assertAppendOnly(name, verb);
        } catch {
          blockedLegitimate.push(`${name}:${verb}`);
        }
      }
    }
    if (blockedLegitimate.length === 0) ok("append-only collections still permit find and insert");
    else fail("append-only collections still permit find and insert", blockedLegitimate.join(", "));

    // The mirror image: the guard must not be so broad that ordinary collections are refused.
    const blockedMutable = [];
    for (const name of MUTABLE_COLLECTIONS) {
      for (const verb of ["update", "delete"]) {
        try {
          assertAppendOnly(name, verb);
        } catch {
          blockedMutable.push(`${name}:${verb}`);
        }
      }
    }
    if (blockedMutable.length === 0) ok(`the guard does not refuse the ${MUTABLE_COLLECTIONS.length} mutable collections`);
    else fail("the guard does not refuse mutable collections", blockedMutable.join(", "));

    // Coverage, not a count: the list the DAO consults must be the canonical one, in both directions.
    const daemonly = IMMUTABLE_COLLECTIONS.filter((n) => !APPEND_ONLY.includes(n));
    const onlyDao = APPEND_ONLY.filter((n) => !IMMUTABLE_COLLECTIONS.includes(n));
    if (daemonly.length === 0 && onlyDao.length === 0) {
      ok("the DAO append-only list is derived from the canonical definitions (no drift)");
    } else {
      fail(
        "the DAO append-only list is derived from the canonical definitions (no drift)",
        `missing=${daemonly.join(",") || "-"} extra=${onlyDao.join(",") || "-"}`,
      );
    }
    if (IMMUTABLE_COLLECTIONS.every((n) => COLLECTIONS_BY_NAME[n]?.immutable === true)) {
      ok("every collection in the append-only set declares immutable: true");
    } else {
      fail("every collection in the append-only set declares immutable: true", IMMUTABLE_COLLECTIONS.join(", "));
    }

    const roles = buildRoleDefinitions();
    const appRole = roles.find((r) => r.role === "primemet_app");
    const historyPrivs = (appRole?.privileges ?? []).filter((p) =>
      IMMUTABLE_COLLECTIONS.some((n) => p.resource?.collection === n),
    );
    const canChangeHistory = historyPrivs.some((p) => (p.actions ?? []).some((a) => a !== "find" && a !== "insert"));
    if (!canChangeHistory && historyPrivs.length > 0) {
      ok(`the application role definition grants only find/insert on ${historyPrivs.length} append-only collection(s)`);
    } else {
      fail("the application role definition grants only find/insert on append-only collections", JSON.stringify(historyPrivs).slice(0, 200));
    }

    // -------------------------------------------------------------------
    // 8. Referential guard
    // -------------------------------------------------------------------
    process.stdout.write("\nReferential integrity\n");
    await expectReject(
      "a reference to a non-existent parent is refused before it reaches the database",
      () =>
        assertReferences(db, "material_aliases", {
          ...minimalAlias({ materialId: uuid(), alias: "Orphan phrase" }),
        }),
      /does not exist in "materials"/,
    );

    await expectOk("insertGuarded accepts a document whose references all resolve", () =>
      insertGuarded(db, "material_aliases", minimalAlias({ materialId: m6061, alias: "Wholesale cut 6061" })),
    );

    // -------------------------------------------------------------------
    // 9. ScrapGrade backward compatibility
    // -------------------------------------------------------------------
    process.stdout.write("\nScrapGrade compatibility\n");
    const categoryId = uuid();
    await db.collection("categories").insertOne({
      _id: categoryId,
      slug: "non-ferrous",
      name: "Non-ferrous",
      kind: "SCRAP",
      shortDescription: null,
      longDescription: null,
      heroDocumentId: null,
      publishedAt: null,
      sortOrder: 0,
      createdAt: now(),
      updatedAt: now(),
    });

    const legacyGrade = {
      _id: uuid(),
      categoryId,
      slug: "aluminium-extrusion-6063",
      code: "EXT-6063",
      name: "Aluminium extrusion 6063",
      shortDescription: null,
      tradeDescription: null,
      typicalOrigin: null,
      hazardClass: null,
      defaultPriceMode: "REQUEST",
      publicationState: "PUBLISHED",
      publishedAt: now(),
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };

    await expectOk("a legacy scrap grade with no materialId is accepted", () =>
      db.collection("scrap_grades").insertOne(legacyGrade),
    );
    const storedLegacy = await db.collection("scrap_grades").findOne({ _id: legacyGrade._id });
    if (storedLegacy && storedLegacy.materialId === undefined) ok("the legacy row keeps materialId absent (never backfilled)");
    else fail("the legacy row keeps materialId absent (never backfilled)", JSON.stringify(storedLegacy?.materialId));

    await expectOk("a scrap grade may be linked to a material explicitly", () =>
      db.collection("scrap_grades").updateOne({ _id: legacyGrade._id }, { $set: { materialId: m6061 } }),
    );

    // -------------------------------------------------------------------
    // 10. Tax rule scope and overlap
    // -------------------------------------------------------------------
    process.stdout.write("\nTax rules\n");
    await db.collection("tax_components_ref").insertOne({
      _id: "GST",
      name: "Goods and Services Tax",
      isStatutory: true,
      appliesAt: "BOTH",
      sortOrder: 0,
      active: true,
      createdAt: now(),
      updatedAt: now(),
    });

    const baseTax = {
      componentCode: "GST",
      transactionModel: "AGENCY",
      invoiceRole: "MATERIAL",
      appliesTo: "SALE",
      taxableBaseRule: "GOODS_VALUE",
      jurisdictionStateId: null,
      hsnSacCode: null,
      includesFreight: false,
      reverseCharge: false,
      thresholdAmount: null,
      effectiveTo: null,
      approvedById: uuid(),
      approvedAt: now(),
      legalReference: null,
      status: "ACTIVE",
      createdAt: now(),
      updatedAt: now(),
    };

    const t1 = uuid();
    await expectOk("the first ACTIVE tax rule is accepted", () =>
      db.collection("tax_rules").insertOne({
        ...minimalTaxRuleRow(baseTax),
        _id: t1,
        ratePct: Decimal128.fromString("18.00"),
        effectiveFrom: new Date("2026-04-01"),
        effectiveTo: new Date("2026-08-31"),
      }),
    );

    await expectReject(
      "a second ACTIVE rule with the same scope starting the same day is rejected by the unique index",
      () =>
        db.collection("tax_rules").insertOne({
          ...minimalTaxRuleRow(baseTax),
          _id: uuid(),
          ratePct: Decimal128.fromString("18.00"),
          effectiveFrom: new Date("2026-04-01"),
          effectiveTo: new Date("2026-08-31"),
        }),
      /E11000|duplicate/i,
    );

    await expectReject(
      "an overlapping ACTIVE rule with a different start date is refused by the overlap guard",
      () =>
        assertNoActiveTaxRuleOverlap(db, {
          ...baseTax,
          effectiveFrom: new Date("2026-06-01"),
        }),
      /TAX_RULE_AMBIGUOUS/,
    );

    await expectOk("a non-overlapping later period is allowed", () =>
      assertNoActiveTaxRuleOverlap(db, {
        ...baseTax,
        effectiveFrom: new Date("2026-10-01"),
      }),
    );

    await expectOk("a different invoice role is a different scope", () =>
      assertNoActiveTaxRuleOverlap(db, { ...baseTax, invoiceRole: "COMMISSION", effectiveFrom: new Date("2026-09-01") }),
    );

    // -------------------------------------------------------------------
    // 11. Non-destructive re-run
    // -------------------------------------------------------------------
    process.stdout.write("\nNon-destructive operation\n");
    const sentinel = "zz_primemet_do_not_drop";
    await db.collection(sentinel).insertOne({ _id: "keep-me", note: "must survive re-initialization" });
    await applyMigrations(db, { migrations: MIGRATIONS, appliedBy: "check-mongodb" });
    const stillThere = await db.collection(sentinel).findOne({ _id: "keep-me" });
    if (stillThere) ok("an existing collection and its document survive a re-run");
    else fail("an existing collection and its document survive a re-run", "sentinel was lost");
    const aliasStillThere = await db.collection("material_aliases").findOne({ _id: aliasId });
    if (aliasStillThere?.verification === "VERIFIED") ok("existing catalogue data survives a re-run unchanged");
    else fail("existing catalogue data survives a re-run unchanged", "alias state changed");

    // -------------------------------------------------------------------
    // 12. Seed policy
    // -------------------------------------------------------------------
    process.stdout.write("\nSeed policy\n");
    const componentCount = await db.collection("tax_components_ref").countDocuments();
    const treatmentCount = await db.collection("tax_treatments").countDocuments();
    if (treatmentCount === 0) ok("no tax treatment is seeded (no invented rate or legal conclusion)");
    else fail("no tax treatment is seeded", `found ${treatmentCount}`);
    if (componentCount <= 1) ok(`no tax component is seeded beyond the fixture used by this suite (${componentCount})`);
    else fail("no tax component is seeded", `found ${componentCount}`);

    // -------------------------------------------------------------------
    // 13. Migration retry safety (defect B)
    // -------------------------------------------------------------------
    process.stdout.write("\nRetry safety (defect B)\n");
    {
      const retryDb = client.db("primemet_retry");
      const source = "PRIMEMET synthetic migration 900";
      const version = 900;
      const failing = {
        version,
        name: "v900_synthetic",
        description: "synthetic migration whose first attempt fails",
        source,
        up: async () => {
          throw new Error("simulated transient connection loss");
        },
      };
      const succeeding = { ...failing, up: async () => [] };

      let firstThrew = false;
      try {
        await applyMigrations(retryDb, { migrations: [failing], appliedBy: "check-mongodb" });
      } catch (error) {
        firstThrew = /simulated transient/.test(String(error?.message ?? error));
      }
      if (firstThrew) ok("1. the first attempt fails and surfaces the error");
      else fail("1. the first attempt fails and surfaces the error", "no error surfaced");

      const afterFailure = await retryDb.collection(LEDGER).find({}).toArray();
      if (afterFailure.length === 1 && afterFailure[0].status === "failed" && afterFailure[0].attempts === 1) {
        ok("1. the failure is recorded as ONE row, not applied, attempt 1");
      } else {
        fail(
          "1. the failure is recorded as ONE row, not applied, attempt 1",
          JSON.stringify(afterFailure.map((r) => ({ status: r.status, attempts: r.attempts }))),
        );
      }

      const retried = await applyMigrations(retryDb, { migrations: [succeeding], appliedBy: "check-mongodb" });
      if (retried[0]?.status === "applied") {
        ok("2. a retry of the same version succeeds — a failed attempt does not reserve it");
      } else {
        fail("2. a retry of the same version succeeds", JSON.stringify(retried));
      }

      const afterRetry = await retryDb.collection(LEDGER).find({}).toArray();
      if (afterRetry.length === 1 && afterRetry[0].status === "applied" && afterRetry[0].attempts === 2) {
        ok("2. the same row transitions failed → applied on attempt 2 (no duplicate key)");
      } else {
        fail(
          "2. the same row transitions failed → applied on attempt 2 (no duplicate key)",
          JSON.stringify(afterRetry.map((r) => ({ status: r.status, attempts: r.attempts }))),
        );
      }
      if (afterRetry[0]?.error === undefined) ok("2. the applied row no longer carries the failure message");
      else fail("2. the applied row no longer carries the failure message", String(afterRetry[0]?.error));

      const third = await applyMigrations(retryDb, { migrations: [succeeding], appliedBy: "check-mongodb" });
      if (third[0]?.status === "skipped") ok("3. a third run skips the already-applied version");
      else fail("3. a third run skips the already-applied version", JSON.stringify(third));

      await expectReject(
        "4. a changed checksum on the applied version is still refused as drift",
        () =>
          applyMigrations(retryDb, {
            migrations: [{ ...succeeding, source: `${source} // edited` }],
            appliedBy: "check-mongodb",
          }),
        /drift/i,
      );

      if (afterRetry.length === 1 && afterRetry[0].status === "applied") {
        ok("5. the failed attempt did not brick later initialization");
      } else {
        fail("5. the failed attempt did not brick later initialization", JSON.stringify(afterRetry));
      }
    }

    // -------------------------------------------------------------------
    // 14. Read-only commands (defect D)
    // -------------------------------------------------------------------
    process.stdout.write("\nRead-only commands (defect D)\n");
    {
      const virgin = client.db("primemet_virgin");

      /** Everything a write could plausibly add: collections, documents and indexes. */
      const snapshot = async (database) => {
        const names = (await database.listCollections({}, { nameOnly: true }).toArray())
          .map((c) => c.name)
          .sort();
        const out = {};
        for (const name of names) {
          out[name] = {
            documents: await database.collection(name).countDocuments(),
            indexes: (await database.collection(name).indexes()).map((i) => i.name).sort(),
          };
        }
        return out;
      };

      const before = await snapshot(virgin);
      if (Object.keys(before).length === 0) ok("the scratch database starts completely empty");
      else fail("the scratch database starts completely empty", Object.keys(before).join(", "));

      await applyMigrations(virgin, { migrations: MIGRATIONS, dryRun: true, appliedBy: "check-mongodb" });
      const afterDryRun = await snapshot(virgin);
      if (JSON.stringify(afterDryRun) === JSON.stringify(before)) {
        ok("--dry-run creates no collection, no index and no ledger row");
      } else {
        fail("--dry-run creates no collection, no index and no ledger row", JSON.stringify(afterDryRun));
      }

      await ledgerReport(virgin, COLLECTIONS.map((c) => c.name));
      if ((await readLedger(virgin)) === null) ok("--status (ledgerReport) leaves a virgin database without a ledger");
      else fail("--status (ledgerReport) leaves a virgin database without a ledger", "ledger was created");

      await verifyDatabase(virgin);
      const afterVerify = await snapshot(virgin);
      if (JSON.stringify(afterVerify) === JSON.stringify(before)) {
        ok("--verify-only creates nothing on a virgin database");
      } else {
        fail("--verify-only creates nothing on a virgin database", JSON.stringify(afterVerify));
      }

      if (JSON.stringify(afterVerify) === JSON.stringify(before)) {
        ok("a virgin database is byte-for-byte unchanged after every read-only command");
      } else {
        fail("a virgin database is byte-for-byte unchanged after every read-only command", "changed");
      }
    }

    // -------------------------------------------------------------------
    // 15. Reconcile (defect E)
    // -------------------------------------------------------------------
    process.stdout.write("\nReconcile (defect E)\n");
    {
      const rdb = client.db("primemet_reconcile");
      await applyMigrations(rdb, { migrations: MIGRATIONS, appliedBy: "check-mongodb" });
      const ledgerBefore = await rdb.collection(LEDGER).find({}).toArray();

      // Drift the database the way a hand `collMod` would: a validator is present, strict, and wrong.
      await rdb.command({
        collMod: "categories",
        validator: { $jsonSchema: { bsonType: "object" } },
        validationLevel: "strict",
      });

      const drifted = await verifyDatabase(rdb);
      if (drifted.failed > 0) ok(`a hand collMod is DETECTED by verification (${drifted.failed} failure(s))`);
      else fail("a hand collMod is DETECTED by verification", "no failure reported");

      const { reconciled, absent } = await reconcileMigrations(rdb, { migrations: MIGRATIONS });
      if (reconciled.length === MIGRATIONS.length && absent.length === 0) {
        ok("reconcile re-asserts every applied migration");
      } else {
        fail(
          "reconcile re-asserts every applied migration",
          JSON.stringify({ reconciled: reconciled.length, absent: absent.length }),
        );
      }

      const healed = await verifyDatabase(rdb);
      if (healed.failed === 0) ok("the database verifies clean after reconcile — the drift is repaired");
      else fail("the database verifies clean after reconcile", healed.failures.slice(0, 3).join(" | "));

      const ledgerAfter = await rdb.collection(LEDGER).find({}).toArray();
      const unchanged =
        ledgerBefore.length === ledgerAfter.length &&
        ledgerBefore.every((row, i) => row.checksum === ledgerAfter[i].checksum && row.version === ledgerAfter[i].version);
      if (unchanged) ok("reconcile changes no checksum and writes no ledger row");
      else fail("reconcile changes no checksum and writes no ledger row", JSON.stringify(ledgerAfter.map((r) => r.checksum.slice(0, 8))));

      await expectReject(
        "reconcile refuses a changed migration file instead of accepting it",
        () => reconcileMigrations(rdb, { migrations: MIGRATIONS.map((m) => ({ ...m, source: `${m.source} // edited` })) }),
        /drift/i,
      );
    }

    // -------------------------------------------------------------------
    // 16. Role provisioning
    // -------------------------------------------------------------------
    process.stdout.write("\nRole provisioning\n");
    {
      const roles = buildRoleDefinitions();
      const app = roles.find((r) => r.role === "primemet_app");
      const owner = roles.find((r) => r.role === "primemet_owner");

      if (app && owner) ok("both primemet_owner and primemet_app are defined");
      else fail("both primemet_owner and primemet_app are defined", roles.map((r) => r.role).join(", "));

      const problems = auditRoleDefinitions();
      if (problems.length === 0) ok("the role audit finds no privilege that could rewrite history or structure");
      else fail("the role audit finds no privilege that could rewrite history or structure", problems.join(" | "));

      // Task A: the previous audit reported `[]` while all seven append-only collections were
      // writable by the owner, because a database-wide grant was skipped before the history rule ran.
      // An audit nobody has seen fail is an audit nobody can trust, so inject the defect back.
      const withWildcardUpdate = JSON.parse(JSON.stringify(roles));
      withWildcardUpdate
        .find((r) => r.role === "primemet_owner")
        .privileges[0].actions.push("update");
      const injected = auditRoleDefinitions(withWildcardUpdate);
      if (
        injected.length >= IMMUTABLE_COLLECTIONS.length &&
        IMMUTABLE_COLLECTIONS.every((n) => injected.some((m) => m.includes(n)))
      ) {
        ok(`the audit rejects a database-wide update on all ${IMMUTABLE_COLLECTIONS.length} append-only collections`);
      } else {
        fail("the audit rejects a database-wide update on append-only collections", JSON.stringify(injected));
      }

      for (const forbidden of ["delete", "dropCollection", "dropIndex", "dropDatabase"]) {
        const rogue = JSON.parse(JSON.stringify(roles));
        rogue.find((r) => r.role === "primemet_owner").privileges[1].actions.push(forbidden);
        if (auditRoleDefinitions(rogue).length > 0) ok(`the audit rejects ${forbidden} for primemet_owner`);
        else fail(`the audit rejects ${forbidden} for primemet_owner`, "no problem reported");
      }

      const rogueUnknown = JSON.parse(JSON.stringify(roles));
      rogueUnknown.find((r) => r.role === "primemet_owner").privileges[1].actions.push("bypassDocumentValidation");
      if (auditRoleDefinitions(rogueUnknown).some((m) => /unclassified/.test(m))) {
        ok("the audit fails closed on an unclassified action");
      } else {
        fail("the audit fails closed on an unclassified action", JSON.stringify(auditRoleDefinitions(rogueUnknown)));
      }

      // Task A requirement 4/6: scoping must not have removed a capability the deployment needs.
      const effOwner = (c) => effectivePrivilegesFor(owner, c);
      if (MUTABLE_COLLECTIONS.every((c) => effOwner(c).includes("update"))) {
        ok(`primemet_owner can still amend all ${MUTABLE_COLLECTIONS.length} mutable collections`);
      } else {
        fail("primemet_owner can still amend mutable collections");
      }
      if (IMMUTABLE_COLLECTIONS.every((c) => effOwner(c).includes("find") && effOwner(c).includes("insert"))) {
        ok("primemet_owner can still read and append every append-only collection");
      } else {
        fail("primemet_owner can still read and append append-only collections");
      }
      if (["createCollection", "collMod", "createIndex"].every((a) => effOwner("a_collection_that_does_not_exist_yet").includes(a))) {
        ok("primemet_owner keeps the structural actions a migration needs, including on future collections");
      } else {
        fail("primemet_owner keeps its structural actions");
      }

      const appActions = new Set((app?.privileges ?? []).flatMap((p) => p.actions));
      const structural = ["createCollection", "collMod", "createIndex", "dropCollection", "dropIndex"];
      const leaked = structural.filter((a) => appActions.has(a));
      if (leaked.length === 0) ok("the application role cannot change structure (owner credentials are not deployable)");
      else fail("the application role cannot change structure", leaked.join(", "));

      const historyPrivs = (app?.privileges ?? []).filter((p) => IMMUTABLE_COLLECTIONS.includes(p.resource?.collection));
      const writable = historyPrivs.filter((p) => (p.actions ?? []).some((a) => a !== "find" && a !== "insert"));
      if (historyPrivs.length === IMMUTABLE_COLLECTIONS.length && writable.length === 0) {
        ok(`all ${IMMUTABLE_COLLECTIONS.length} append-only collections are find/insert only for the app role`);
      } else {
        fail(
          `all ${IMMUTABLE_COLLECTIONS.length} append-only collections are find/insert only for the app role`,
          `granted=${historyPrivs.length} writable=${writable.length}`,
        );
      }

      const plan = provisionPlan("primemet");
      const names = plan.roles.map((r) => r.name);
      if (names.includes("primemet_owner") && names.includes("primemet_app")) {
        ok("the provisioning plan covers primemet_owner and primemet_app");
      } else {
        fail("the provisioning plan covers primemet_owner and primemet_app", names.join(", "));
      }
      if (plan.assignments.length === 2) ok("the plan states which identity each role binds to");
      else fail("the plan states which identity each role binds to", String(plan.assignments.length));

      // The identity check is the control that stops owner credentials being deployed. Against this
      // throwaway server it must pass (no roles are bound to the test user).
      await expectOk("the connected identity is not an owner role", () => checkRuntimeIdentity(db));
    }

  } finally {
    await client.close();
    await server.stop();
  }

  process.stdout.write("\n");
  for (const s of skip) process.stdout.write(`  \u25cb SKIPPED ${s}\n`);
  process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const f of failures) process.stdout.write(`  \u2716 ${f}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// --- fixtures -------------------------------------------------------------

function minimalUser() {
  return {
    _id: uuid(),
    email: "someone@primemet.example",
    emailVerifiedAt: null,
    passwordHash: null,
    passwordChangedAt: null,
    fullName: "Someone",
    phone: null,
    locale: "en-IN",
    role: "BUYER",
    status: "ACTIVE",
    mfaEnabled: false,
    mfaSecretCiphertext: null,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

function minimalAlias({ id = uuid(), materialId, alias, normalisedAlias }) {
  return {
    _id: id,
    materialId,
    alias,
    normalisedAlias: normalisedAlias ?? alias.toLowerCase().trim(),
    language: "en",
    source: null,
    verification: "PENDING",
    verifiedById: null,
    verifiedAt: null,
    equivalenceBasis: null,
    equivalenceDecisionId: null,
    isRetired: false,
    retiredAt: null,
    retiredReason: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

function minimalTaxRule({ ratePct }) {
  return {
    _id: uuid(),
    code: "GST-MAT-18",
    componentCode: "GST",
    transactionModel: "PRINCIPAL",
    invoiceRole: "MATERIAL",
    appliesTo: "SALE",
    taxableBaseRule: "GOODS_VALUE",
    jurisdictionStateId: null,
    hsnSacCode: null,
    ratePct,
    includesFreight: false,
    reverseCharge: false,
    thresholdAmount: null,
    effectiveFrom: new Date("2026-04-01"),
    effectiveTo: null,
    approvedById: uuid(),
    approvedAt: now(),
    legalReference: null,
    status: "ACTIVE",
    createdAt: now(),
    updatedAt: now(),
  };
}

function minimalTaxRuleRow(base) {
  return {
    code: "GST-MAT-18",
    ...base,
    thresholdAmount: null,
  };
}

await main();