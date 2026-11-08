/**
 * PRIMEMET — structural verification.
 *
 * "Initialized" is a claim about the live database, so it is checked against the database, not against
 * the code that was supposed to create it. Every check reads `listCollections` / `listIndexes` and
 * compares with the version-controlled definition, in both directions:
 *
 *   - a declared collection that is absent          → failure
 *   - a declared index that is absent or wrong      → failure
 *   - a collection with no validator                → failure
 *   - an extra collection in the database           → reported, never removed
 *
 * Data-level business rules (6061 vs 6063, alias approval, immutable history) are exercised by
 * scripts/check-mongodb.mjs against disposable records.
 *
 * `reconcileVerifiedAliases` (defect A) is the detection half of D-1: a MongoDB validator cannot read
 * another collection, so the only check that can compare a stored VERIFIED alias with the decision
 * that is supposed to authorise it is one that runs here, after the fact, on every verify.
 */

import { COLLECTIONS, INFRASTRUCTURE_COLLECTIONS } from "./collections/index.mjs";
import { plansFor } from "./define.mjs";
import {
  GUARDS,
  GUARD_LAST_SUPER_ADMIN,
  GUARD_PLATFORM_IDENTITY,
  PLATFORM_IDENTITY_COLLECTION,
  PLATFORM_IDENTITY_VALIDATOR,
  PLATFORM_ORGANISATION_ENV,
} from "./guards.mjs";
import { LEDGER, LEDGER_INDEXES, definitionsDrift } from "./ledger.mjs";

function sameKey(a = {}, b = {}) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => String(a[k]) === String(b[k]) && kb.includes(k));
}

/**
 * Canonical JSON: object keys sorted, so two structurally equal validators compare equal regardless of
 * the order MongoDB returns their keys in.
 *
 * Defect E depends on this. The previous check only asserted that *a* validator was present at
 * `validationLevel: strict`, so a hand `collMod` that replaced it with a permissive one passed
 * verification — which meant neither the drift nor reconciliation's repair of it could be observed.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof RegExp)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

function sameValidator(a, b) {
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
}

export async function verifyDatabase(db, options = {}) {
  const expectedNames = options.collections ?? COLLECTIONS.map((c) => c.name);
  const failures = [];
  let passed = 0;
  const ok = (label) => {
    passed += 1;
    if (options.verbose) console.log(`  ✔ ${label}`);
  };
  const bad = (label) => failures.push(label);

  const present = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );

  ok(`database reachable (${present.size} collections)`);

  if (!present.has(LEDGER)) bad(`ledger collection "${LEDGER}" is missing`);
  else ok(`ledger "${LEDGER}" exists`);

  const ledgerIndexes = await db.collection(LEDGER).indexes().catch(() => []);
  for (const want of LEDGER_INDEXES) {
    const found = ledgerIndexes.find((ix) => ix.name === want.name);
    if (!found || !sameKey(found.key, want.key)) bad(`ledger index ${want.name} is missing`);
    else ok(`ledger index ${want.name}`);
  }

  // C3: the continuity guard is infrastructure, not business data, so it is checked here rather than in
  // the per-collection loop. A database without it refuses every access change that could remove the
  // last super admin, which is safe but is still a deployment that skipped a migration — say so.
  if (!present.has(GUARDS)) {
    bad(`continuity guard collection "${GUARDS}" is missing (migration v003 has not been applied)`);
  } else {
    const guard = await db.collection(GUARDS).findOne({ _id: GUARD_LAST_SUPER_ADMIN });
    if (!guard) bad(`continuity guard document "${GUARD_LAST_SUPER_ADMIN}" is missing`);
    else ok(`continuity guard "${GUARD_LAST_SUPER_ADMIN}" is seeded (fence ${guard.fence})`);
  }

  // W2.2: the platform identity pointer lives in its own collection so that the runtime identity's
  // guard `update` privilege — needed to increment the fence — cannot reach it. Verified here for the
  // same reason the continuity guard is: it is infrastructure, its absence is a deployment that skipped
  // a migration, and a hand edit must be reported rather than obeyed.
  if (!present.has(PLATFORM_IDENTITY_COLLECTION)) {
    bad(
      `protected platform identity collection "${PLATFORM_IDENTITY_COLLECTION}" is missing ` +
        "(migration v010 has not been applied)",
    );
  } else {
    const identityInfo = (await db.listCollections({ name: PLATFORM_IDENTITY_COLLECTION }).toArray())[0] ?? {};
    const identityValidator = identityInfo.options?.validator;
    if (!identityValidator) {
      bad(`collection ${PLATFORM_IDENTITY_COLLECTION} has no validator`);
    } else if (identityInfo.options?.validationLevel !== "strict") {
      bad(`collection ${PLATFORM_IDENTITY_COLLECTION} validationLevel is ${identityInfo.options?.validationLevel}, expected strict`);
    } else if (!sameValidator(identityValidator, PLATFORM_IDENTITY_VALIDATOR)) {
      bad(`collection ${PLATFORM_IDENTITY_COLLECTION} validator does not match the definition in db/guards`);
    } else ok(`collection ${PLATFORM_IDENTITY_COLLECTION} has the declared strict validator`);

    const protectedPointer = await db
      .collection(PLATFORM_IDENTITY_COLLECTION)
      .findOne({ _id: GUARD_PLATFORM_IDENTITY });
    const legacyPointer = present.has(GUARDS)
      ? await db.collection(GUARDS).findOne({ _id: GUARD_PLATFORM_IDENTITY })
      : null;

    if (!protectedPointer) {
      if (legacyPointer) {
        bad(
          `the legacy guard pointer names ${legacyPointer.organisationId} but ${PLATFORM_IDENTITY_COLLECTION} ` +
            "holds no pointer — the legacy pointer is application-writable and is no longer adopted; " +
            `re-run the migration as the owner with ${PLATFORM_ORGANISATION_ENV}=<organisation-id>`,
        );
      } else {
        ok(
          "protected platform identity is present and unseeded (no platform organisation yet — " +
            `bootstrap pending: set ${PLATFORM_ORGANISATION_ENV} and re-run the migration)`,
        );
      }
    } else if (typeof protectedPointer.organisationId !== "string" || protectedPointer.organisationId.length === 0) {
      bad("the protected platform identity names no organisation");
    } else {
      ok(`protected platform identity names ${protectedPointer.organisationId}`);
      if (legacyPointer && String(legacyPointer.organisationId) !== String(protectedPointer.organisationId)) {
        bad(
          `the legacy guard pointer names ${legacyPointer.organisationId} while the protected pointer names ` +
            `${protectedPointer.organisationId} — the runtime reads the protected one, so the legacy copy is stale`,
        );
      } else {
        ok("the legacy guard pointer agrees with the protected pointer");
      }
    }
  }

  // F-1: the declared schema must be the one the applied migrations recorded. A mismatch means the
  // definitions moved without a version to carry the change, which every collection check below would
  // otherwise report as an unexplained validator difference.
  const drift = await definitionsDrift(db);
  if (drift) {
    bad(
      `declared schema changed after migration ${drift.version} (${drift.name}) was applied — ` +
        `ledger ${String(drift.ledgerDigest).slice(0, 12)}…, current ${String(drift.currentDigest).slice(0, 12)}…; ` +
        drift.remediedBy,
    );
  } else ok("the declared schema matches the applied migrations");

  for (const def of COLLECTIONS) {
    const plan = plansFor(def);

    if (!present.has(plan.name)) {
      bad(`collection "${plan.name}" is missing`);
      continue;
    }
    ok(`collection ${plan.name} exists`);

    const infos = await db.listCollections({ name: plan.name }).toArray();
    const info = infos[0] ?? {};
    const validator = info.options?.validator;
    if (!validator) bad(`collection ${plan.name} has no validator`);
    else if (info.options?.validationLevel !== "strict") {
      bad(`collection ${plan.name} validationLevel is ${info.options?.validationLevel}, expected strict`);
    } else if (!sameValidator(validator, plan.validator)) {
      // Present but not OURS: a hand `collMod` that relaxed a rule must not pass as healthy.
      bad(`collection ${plan.name} validator does not match the definition in db/collections`);
    } else ok(`collection ${plan.name} has the declared strict validator`);

    const actual = await db.collection(plan.name).indexes();
    for (const index of plan.indexes) {
      const found = actual.find((ix) => ix.name === index.name);
      if (!found) {
        bad(`index ${index.name} on ${plan.name} is missing`);
        continue;
      }
      if (!sameKey(found.key, index.key)) {
        bad(`index ${index.name} on ${plan.name} has key ${JSON.stringify(found.key)}, expected ${JSON.stringify(index.key)}`);
        continue;
      }
      if (Boolean(index.unique) !== Boolean(found.unique)) {
        bad(`index ${index.name} on ${plan.name} unique=${Boolean(found.unique)}, expected ${Boolean(index.unique)}`);
        continue;
      }
      if (index.partialFilterExpression) {
        const want = JSON.stringify(index.partialFilterExpression);
        const got = JSON.stringify(found.partialFilterExpression ?? null);
        if (want !== got) {
          bad(`index ${index.name} on ${plan.name} partialFilterExpression is ${got}, expected ${want}`);
          continue;
        }
      }
      ok(`index ${index.name} on ${plan.name}`);
    }
  }

  const unexpected = [...present].filter(
    (n) => !INFRASTRUCTURE_COLLECTIONS.includes(n) && !expectedNames.includes(n),
  );
  if (unexpected.length > 0) {
    // Not a failure: never remove something that exists.
    if (options.verbose) console.log(`  ! unexpected collections (left untouched): ${unexpected.join(", ")}`);
  }

  // D-1 reconciliation (defect A): every stored VERIFIED alias is compared with its real decision.
  // This is the control that makes a bypassed write visible, so it runs on every verify.
  const aliasAudit = await reconcileVerifiedAliases(db);
  passed += aliasAudit.passed;
  failures.push(...aliasAudit.failures);

  return { passed, failed: failures.length, failures, unexpected };
}

/**
 * Reconcile every VERIFIED alias against the decision that is supposed to authorise it (D-1).
 *
 * A collection validator sees one document and cannot read `material_alias_equivalence_decisions`, so
 * "VERIFIED requires an APPROVED decision for this alias" is not a rule MongoDB can hold. This function
 * is the authoritative check instead: it reads the real decision and refuses to accept the alias's own
 * claim about it. `db:verify` and every initialization run it, so a write that went around
 * `verifyAlias()` is reported rather than trusted.
 *
 * Read-only. Never repairs anything: a forged or stale VERIFIED alias must be investigated, not
 * silently rewritten.
 */
export async function reconcileVerifiedAliases(db) {
  const failures = [];
  let passed = 0;

  const aliases = await db
    .collection("material_aliases")
    .find({ verification: "VERIFIED" })
    .toArray();

  if (aliases.length === 0) {
    passed += 1;
    return { passed, failed: 0, failures, checked: 0 };
  }

  const decisionIds = [...new Set(aliases.map((a) => a.equivalenceDecisionId).filter(Boolean))];
  const decisions = decisionIds.length
    ? await db
        .collection("material_alias_equivalence_decisions")
        .find({ _id: { $in: decisionIds } })
        .toArray()
    : [];
  const byId = new Map(decisions.map((d) => [String(d._id), d]));

  for (const alias of aliases) {
    const label = `VERIFIED alias ${alias._id} (${alias.alias})`;
    const problems = [];

    if (!alias.equivalenceDecisionId) {
      problems.push("records no equivalenceDecisionId");
    } else {
      const decision = byId.get(String(alias.equivalenceDecisionId));
      if (!decision) {
        problems.push(`points at decision ${alias.equivalenceDecisionId}, which does not exist`);
      } else {
        if (String(decision.aliasId) !== String(alias._id)) {
          problems.push(
            `points at decision ${decision._id}, which concerns alias ${decision.aliasId} — an approval cannot be borrowed`,
          );
        }
        if (decision.status !== "APPROVED") {
          problems.push(`points at decision ${decision._id}, whose status is ${decision.status}, not APPROVED`);
        }
        if (decision.basis !== alias.equivalenceBasis) {
          problems.push(
            `basis ${alias.equivalenceBasis} does not match decision ${decision._id}'s basis ${decision.basis}`,
          );
        }
        if (!decision.reviewedById) problems.push(`decision ${decision._id} names no reviewer`);
        if (!decision.technicalReference && !decision.evidenceDocumentId) {
          problems.push(`decision ${decision._id} carries no technical reference and no evidence document`);
        }
      }
    }

    if (!alias.verifiedById) problems.push("names no verifier");
    if (!(alias.verifiedAt instanceof Date)) problems.push("has no verification timestamp");
    if (!alias.equivalenceBasis) problems.push("records no equivalence basis");

    if (problems.length === 0) passed += 1;
    else failures.push(`${label}: ${problems.join("; ")}`);
  }

  return { passed, failed: failures.length, failures, checked: aliases.length };
}