/**
 * PRIMEMET — platform identity and the legacy organisation backfill (W2 and W4-a remediation).
 *
 * ## The problem (W2)
 *
 * `orgKind: "PRIMEMET"` is a field on an ordinary, mutable business document. The Phase 1 review showed
 * what that costs: a partial unique index blocks a relabel only while another live PRIMEMET row exists,
 * so before bootstrap — and after any deletion of that row — a BUYER organisation can be relabelled
 * PRIMEMET and, because administrator resolution keyed on that marker, silently become the organisation
 * that governs every admin's access.
 *
 * A document validator cannot fix it: it sees one document and cannot compare it to its previous version,
 * so "this field may never change" is not expressible (limitation L1). The identity therefore moves OUT of
 * the mutable document into a pointer held as an infrastructure guard document:
 *
 *     _permission_guards / { _id: "platform-identity", kind: "PLATFORM_IDENTITY", organisationId: <id> }
 *
 * Administrator resolution reads the POINTER. Relabelling an organisation then changes a label, not
 * authority; deleting the pointed-at organisation fails closed (NO_ORGANISATION) instead of promoting
 * whoever holds the marker next. That is the security property, and it is the one the review asked for:
 * "Administrator resolution must use the protected identity."
 *
 * WHAT THIS DOES NOT DO, stated plainly: it does not prevent a write to `organisations.orgKind`. It
 * removes the marker's power. Provenance of the pointer itself is an application/privilege question,
 * reported by `platformIdentityProblems()` rather than assumed.
 *
 * ## The legacy backfill (W4-a)
 *
 * v004 makes `orgKind` required, so an organisation stored before v004 cannot satisfy it, and the
 * migration refused with no report and no ledger record. This module classifies rows deterministically,
 * never invents platform identity, and supports a dry run.
 */

import { GUARDS, GUARD_PLATFORM_IDENTITY } from "./guards.mjs";

/** The pointer's document id. Exported so the resolver and the tests agree on one literal. */
export const PLATFORM_IDENTITY_ID = GUARD_PLATFORM_IDENTITY;
export const PLATFORM_IDENTITY_KIND = "PLATFORM_IDENTITY";

/** The counterparty kinds that map onto an operator marker without a judgement call. */
const UNAMBIGUOUS = new Map([
  ["BUYER", "BUYER"],
  ["SELLER", "SELLER"],
]);

/**
 * The marker a legacy organisation gets.
 *
 * `BOTH` is deliberately NOT mapped: a counterparty that both buys and sells is neither marker, and
 * choosing one would be a guess that outlives the migration. It is reported as ambiguous and the operator
 * decides once, with an explicit flag.
 *
 * `PRIMEMET` is never produced here, by construction. A legacy row carries no evidence of being the
 * operator, and the one thing this function must never do is mint a second platform identity.
 */
export function classifyLegacyRow(row) {
  if (typeof row.orgKind === "string" && row.orgKind.length > 0) {
    return { kind: "ALREADY_CLASSIFIED", proposed: row.orgKind, basis: `orgKind already ${row.orgKind}` };
  }
  const mapped = UNAMBIGUOUS.get(row.orgType);
  if (mapped) return { kind: "DERIVABLE", proposed: mapped, basis: `orgType = ${row.orgType}` };
  if (row.orgType === "BOTH") {
    return {
      kind: "AMBIGUOUS",
      proposed: null,
      basis: "orgType = BOTH is both counterparty kinds; the marker is a business decision",
    };
  }
  return {
    kind: "AMBIGUOUS",
    proposed: null,
    basis: `orgType = ${String(row.orgType)} has no marker mapping`,
  };
}

/** Read the pointer. `null` before v005 has seeded it. */
export async function readPlatformIdentity(db) {
  try {
    const row = await db.collection(GUARDS).findOne({ _id: PLATFORM_IDENTITY_ID });
    return row ?? null;
  } catch {
    return null;
  }
}

/** The organisation id that governs administrator access, from the protected pointer. */
export async function platformOrganisationId(db) {
  const identity = await readPlatformIdentity(db);
  const id = identity?.organisationId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Seed the pointer from the database's own state — but only when the state makes it unambiguous.
 *
 * The single legitimate derivation is "exactly one live organisation carries orgKind PRIMEMET": that is
 * the row the schema has been treating as the operator, so recording it is a restatement, not a guess.
 * Zero candidates leaves the pointer unset and administrator resolution falls back to the marker with a
 * reported warning. More than one refuses: choosing between them would be the guess this exists to avoid.
 */
export async function seedPlatformIdentity(db, { now = new Date(), log = () => {} } = {}) {
  const existing = await readPlatformIdentity(db);
  if (existing) {
    log(`  = ${GUARDS}/${PLATFORM_IDENTITY_ID} already names ${existing.organisationId}`);
    return { seeded: false, reason: "ALREADY_SEEDED", organisationId: existing.organisationId };
  }

  const candidates = await db
    .collection("organisations")
    .find({ orgKind: "PRIMEMET", deletedAt: null }, { projection: { _id: 1, legalName: 1 } })
    .toArray();

  if (candidates.length > 1) {
    throw new Error(
      `PREFLIGHT_FAILED: ${candidates.length} live organisations carry orgKind PRIMEMET ` +
        `(${candidates.map((c) => String(c._id)).join(", ")}). The platform identity cannot be inferred. ` +
        "Soft-delete the duplicates so exactly one remains, then retry.",
    );
  }
  if (candidates.length === 0) {
    log("  ! no live PRIMEMET organisation exists; the platform identity is left unset");
    return { seeded: false, reason: "NO_CANDIDATE", organisationId: null };
  }

  const organisationId = String(candidates[0]._id);
  await db.collection(GUARDS).updateOne(
    { _id: PLATFORM_IDENTITY_ID },
    {
      $setOnInsert: {
        _id: PLATFORM_IDENTITY_ID,
        kind: PLATFORM_IDENTITY_KIND,
        organisationId,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  log(`  + ${GUARDS}/${PLATFORM_IDENTITY_ID} names organisation ${organisationId}`);
  return { seeded: true, reason: "SEEDED", organisationId };
}

/** Classify every organisation without writing anything. */
export async function classifyLegacyOrganisations(db) {
  const rows = await db
    .collection("organisations")
    .find({}, { projection: { _id: 1, legalName: 1, orgType: 1, orgKind: 1, deletedAt: 1 } })
    .toArray();

  const report = {
    total: rows.length,
    alreadyClassified: [],
    derivable: [],
    ambiguous: [],
    conflicts: [],
  };

  for (const row of rows) {
    const verdict = classifyLegacyRow(row);
    const label = { id: String(row._id), legalName: row.legalName ?? null, orgType: row.orgType ?? null };
    if (verdict.kind === "ALREADY_CLASSIFIED") {
      report.alreadyClassified.push({ ...label, orgKind: verdict.proposed });
    } else if (verdict.kind === "DERIVABLE") {
      report.derivable.push({ ...label, proposed: verdict.proposed, basis: verdict.basis });
    } else {
      report.ambiguous.push({ ...label, basis: verdict.basis });
    }
  }

  // A marker that already says PRIMEMET is a conflict unless the pointer agrees with it, because it
  // claims the identity the pointer owns. Deleting a duplicate is a business decision, so it is reported.
  const pointerId = await platformOrganisationId(db);
  const claimed = report.alreadyClassified.filter((row) => row.orgKind === "PRIMEMET");
  if (pointerId) {
    for (const row of claimed) {
      if (row.id !== pointerId) {
        report.conflicts.push({
          ...row,
          basis: `claims PRIMEMET but the platform identity names ${pointerId}`,
        });
      }
    }
  } else if (claimed.length > 1) {
    report.conflicts.push({
      id: null,
      legalName: null,
      orgType: null,
      orgKind: "PRIMEMET",
      basis: `${claimed.length} organisations claim PRIMEMET and no platform identity is recorded`,
    });
  }

  return report;
}

/** A report a human can act on. Printed by the CLI and by the dry run. */
export function formatBackfillReport(report) {
  const lines = [];
  lines.push(`organisations examined : ${report.total}`);
  lines.push(`already classified     : ${report.alreadyClassified.length}`);
  lines.push(`derivable              : ${report.derivable.length}`);
  for (const row of report.derivable) lines.push(`   ~ ${row.id} -> ${row.proposed}   (${row.basis})`);
  lines.push(`ambiguous              : ${report.ambiguous.length}`);
  for (const row of report.ambiguous) {
    lines.push(`   ? ${row.id} "${row.legalName ?? ""}" ${row.basis}`);
  }
  lines.push(`conflicts              : ${report.conflicts.length}`);
  for (const row of report.conflicts) lines.push(`   ! ${row.id ?? "(none)"} ${row.basis}`);
  return lines.join("\n");
}

/**
 * Classify legacy organisations, in place.
 *
 * @param options.dryRun  report only; writes nothing
 * @param options.bothAs  the marker an operator has decided ambiguous rows get. Required when any exist —
 *                        omitting it is a refusal, not a default, because a default here would be exactly
 *                        the guess this function exists to avoid.
 */
export async function applyLegacyOrganisationBackfill(db, { dryRun = false, bothAs = null, log = () => {} } = {}) {
  const report = await classifyLegacyOrganisations(db);

  if (report.conflicts.length > 0) {
    throw new Error(
      `PREFLIGHT_FAILED: ${report.conflicts.length} organisation(s) conflict with the recorded platform identity.\n` +
        `${formatBackfillReport(report)}\n` +
        "Resolve the conflict (soft-delete the duplicate, or correct the platform identity) before retrying.",
    );
  }

  if (report.ambiguous.length > 0 && !bothAs) {
    throw new Error(
      `PREFLIGHT_FAILED: ${report.ambiguous.length} organisation(s) cannot be classified without a decision.\n` +
        `${formatBackfillReport(report)}\n` +
        "Re-run with an explicit marker for these rows (bothAs: OTHER | PARTNER). Nothing was written.",
    );
  }

  if (dryRun) {
    log(formatBackfillReport(report));
    log("dry run: nothing was written");
    return { report, written: 0, dryRun: true };
  }

  let written = 0;
  for (const row of report.derivable) {
    await db.collection("organisations").updateOne({ _id: row.id }, { $set: { orgKind: row.proposed } });
    written += 1;
  }
  if (bothAs) {
    for (const row of report.ambiguous) {
      await db.collection("organisations").updateOne({ _id: row.id }, { $set: { orgKind: bothAs } });
      written += 1;
    }
  }

  log(formatBackfillReport(report));
  log(`backfill applied to ${written} organisation(s)`);
  return { report, written, dryRun: false };
}

/**
 * Consistency checks for a verification run.
 *
 * Returns problems rather than throwing so a verification reports every one instead of the first.
 */
export async function platformIdentityProblems(db) {
  const problems = [];
  const identity = await readPlatformIdentity(db);
  const byMarker = await db
    .collection("organisations")
    .find({ orgKind: "PRIMEMET", deletedAt: null })
    .toArray();

  if (!identity) {
    if (byMarker.length > 0) {
      problems.push(
        `no platform identity is recorded, but ${byMarker.length} organisation(s) carry orgKind PRIMEMET — ` +
          "administrator resolution is still keyed on a mutable field (run v005)",
      );
    }
    return problems;
  }

  const pointerId = identity.organisationId;
  if (typeof pointerId !== "string" || pointerId.length === 0) {
    problems.push("the platform identity guard exists but names no organisation");
    return problems;
  }

  const target = await db.collection("organisations").findOne({ _id: pointerId });
  if (!target) {
    problems.push(`the platform identity names ${pointerId}, which does not exist in organisations`);
    return problems;
  }
  if (target.orgKind !== "PRIMEMET") {
    problems.push(`the platform identity names ${pointerId}, whose orgKind is ${JSON.stringify(target.orgKind)}`);
  }
  for (const row of byMarker) {
    if (String(row._id) !== pointerId) {
      problems.push(
        `organisation ${String(row._id)} carries orgKind PRIMEMET but the platform identity names ${pointerId} ` +
          "(the marker no longer grants authority, but it is misleading)",
      );
    }
  }
  if (byMarker.length === 0) {
    problems.push(`no live organisation carries orgKind PRIMEMET although the platform identity names ${pointerId}`);
  }
  return problems;
}
