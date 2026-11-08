/**
 * PRIMEMET — tax rule scope and overlap guard (D7).
 *
 * PostgreSQL enforced this with `EXCLUDE USING gist (... daterange(...) WITH &&)`. MongoDB has no
 * range-overlap index, so the rule is split into the two halves that MongoDB *can* support:
 *
 * 1. **Scope uniqueness** — a partial unique index on
 *    (componentCode, transactionModel, invoiceRole, jurisdictionStateId) where status = "ACTIVE".
 *    A unique index treats a missing field as a value, so two rules that both mean "every model" or
 *    "every state" collide. That is precisely the COALESCE semantics PostgreSQL needed a wrapper
 *    function for, and it is enforced by the server, not by this file.
 *
 * 2. **Date overlap** — checked here, inside the caller's transaction, because no index can express it.
 *
 * Residual risk, stated rather than buried: a writer that bypasses this module (mongosh, Data
 * Explorer, a hand-written $insert) can create two ACTIVE rules whose effective ranges overlap. The
 * tax engine must therefore still raise TAX_RULE_AMBIGUOUS when it resolves a rate and finds more than
 * one candidate (architecture §15.5.4) — this guard reduces the chance, the engine resolution is what
 * makes the outcome safe.
 */

const DAY = 24 * 60 * 60 * 1000;

/** PostgreSQL daterange(..., '[]') is INCLUSIVE of both ends; preserve that exactly. */
export function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  const aStart = aFrom.getTime();
  const aEnd = aTo ? aTo.getTime() : Number.POSITIVE_INFINITY;
  const bStart = bFrom.getTime();
  const bEnd = bTo ? bTo.getTime() : Number.POSITIVE_INFINITY;
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Normalise an effective window the way `daterange(from, COALESCE(to,'infinity'), '[]')` did, so a
 * comparison in MongoDB (which has no date type) is not off by one millisecond on a date column.
 */
export function effectiveWindow(date) {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { from, to: null };
}

/**
 * Throw if adding `candidate` as an ACTIVE rule would overlap an existing ACTIVE rule with the same
 * scope. Call inside the same transaction as the insert.
 *
 * Scope equality mirrors the PostgreSQL EXCLUDE: component, transaction model (null = every model),
 * invoice role (never null; ANY is the wildcard), jurisdiction state (null = every state).
 */
export async function assertNoActiveTaxRuleOverlap(db, candidate, options = {}) {
  const { session, excludeId = null } = options;

  if (candidate.status !== "ACTIVE") return;

  const scope = {
    componentCode: candidate.componentCode,
    transactionModel: candidate.transactionModel ?? null,
    invoiceRole: candidate.invoiceRole,
    jurisdictionStateId: candidate.jurisdictionStateId ?? null,
    status: "ACTIVE",
  };

  const existing = await db.collection("tax_rules").find(scope, { session }).toArray();
  const conflicts = existing.filter((rule) => {
    if (excludeId && rule._id === excludeId) return false;
    return rangesOverlap(
      candidate.effectiveFrom,
      candidate.effectiveTo ?? null,
      rule.effectiveFrom,
      rule.effectiveTo ?? null,
    );
  });

  if (conflicts.length > 0) {
    const ids = conflicts.map((r) => r._id).join(", ");
    throw new Error(
      `TAX_RULE_AMBIGUOUS: an ACTIVE ${candidate.componentCode} rule for ` +
        `model=${candidate.transactionModel ?? "ANY"} role=${candidate.invoiceRole} ` +
        `state=${candidate.jurisdictionStateId ?? "ANY"} already covers this period (${ids}). ` +
        "Two active rules for one scope would make the rate ambiguous; retire or date-scope one of them.",
    );
  }
}

/** True when the two inclusive day windows share at least one day. Exported for tests. */
export function overlapsOnDay(aFrom, aTo, bFrom, bTo) {
  return rangesOverlap(aFrom, aTo, bFrom, bTo) && DAY > 0;
}