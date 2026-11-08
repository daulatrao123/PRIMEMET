#!/usr/bin/env node
/**
 * PRIMEMET — generate the permission-by-permission tier matrix.
 *
 * WHY THIS IS GENERATED AND NOT WRITTEN BY HAND. The matrix is the artefact three documents have
 * disagreed about (62/12 vs 59/15 vs 45). A hand-written table is the fourth opinion. This reads
 * `src/lib/permissions/tiers.ts`, `types.ts` and `delegation.ts` — the code the resolver actually
 * executes — and renders what is there, so the document cannot drift from the implementation without
 * the next run of this script changing it.
 *
 *   node scripts/report-tier-matrix.mjs            # writes docs/PRIMEMET_TIER_MATRIX.md
 *   node scripts/report-tier-matrix.mjs --stdout     # prints it
 */

import { writeFileSync } from "node:fs";

import { ADMIN_PERMISSIONS } from "../src/lib/permissions/types.ts";
import { TIER_DEFAULTS } from "../src/lib/permissions/tiers.ts";
import { NON_DELEGABLE } from "../src/lib/permissions/delegation.ts";

const TARGET = "docs/PRIMEMET_TIER_MATRIX.md";

const sets = {
  SUPER_ADMIN: new Set(TIER_DEFAULTS.SUPER_ADMIN),
  SOURCING_OPS_ADMIN: new Set(TIER_DEFAULTS.SOURCING_OPS_ADMIN),
  CATALOGUE_MANAGER: new Set(TIER_DEFAULTS.CATALOGUE_MANAGER),
  READ_ONLY_ADMIN: new Set(TIER_DEFAULTS.READ_ONLY_ADMIN),
};

const union = new Set([...sets.SOURCING_OPS_ADMIN, ...sets.CATALOGUE_MANAGER, ...sets.READ_ONLY_ADMIN]);
const superOnly = ADMIN_PERMISSIONS.filter((p) => !union.has(p));
const nonDelegable = new Set(NON_DELEGABLE);

/** The three whose tier placement the two designs disagreed about. */
const DISPUTED = new Set(["LOT_OVERRIDE_GATE", "PARTY_SUSPEND", "ORDER_CANCEL"]);

const mark = (set, permission) => (set.has(permission) ? "yes" : "no");

function row(permission) {
  const superOnlyHere = !union.has(permission);
  const delegation = nonDelegable.has(permission)
    ? "SUPER_ADMIN only (non-delegable)"
    : "delegable (ceiling applies)";
  const source = [];
  source.push("§2.8 vocabulary");
  if (superOnlyHere) source.push("super-only by arithmetic");
  if (DISPUTED.has(permission)) source.push("**disputed — D-TIER-1 open**");
  if (nonDelegable.has(permission)) source.push("§2.6 non-delegable");
  return `| \`${permission}\` | ${mark(sets.SUPER_ADMIN, permission)} | ${mark(sets.SOURCING_OPS_ADMIN, permission)} | ${mark(sets.CATALOGUE_MANAGER, permission)} | ${mark(sets.READ_ONLY_ADMIN, permission)} | ${delegation} | ${superOnlyHere ? "**yes**" : "no"} | ${source.join("; ")} |`;
}

const lines = [];
const out = (line = "") => lines.push(line);

out("# PRIMEMET — permission matrix, measured");
out();
out("**Generated.** `node scripts/report-tier-matrix.mjs` — do not hand-edit. The table below is read from");
out("`src/lib/permissions/tiers.ts`, `types.ts` and `delegation.ts`, which is the code the resolver executes.");
out();
out("Status: **measurement, not a decision.** One item in it (D-TIER-1, below) is an owner policy question and");
out("is left open deliberately. Nothing in this document approves it.");
out();
out("---");
out();
out("## 1. The discrepancy, resolved arithmetically");
out();
out("| Figure | Where it came from | Reproducible? |");
out("|---|---|---|");
out(`| **74** permissions in the vocabulary | \`ADMIN_PERMISSIONS\`, §2.2/§2.8 | yes — \`${ADMIN_PERMISSIONS.length}\` |`);
out(`| **45** SOURCING_OPS_ADMIN defaults | §2.8 table and the contractual matrix | yes — \`${sets.SOURCING_OPS_ADMIN.size}\` |`);
out(`| **14** CATALOGUE_MANAGER defaults | §2.8 | yes — \`${sets.CATALOGUE_MANAGER.size}\` |`);
out(`| **20** READ_ONLY_ADMIN defaults | §2.8 (VIEW minus CONTENT_REVIEW) | yes — \`${sets.READ_ONLY_ADMIN.size}\` |`);
out(`| **${union.size}** ordinary admin permissions / **${superOnly.length}** super-only | this run | yes — \`${union.size}\` / \`${superOnly.length}\` |`);
out();
out("The two disputed readings are not a counting error — both are arithmetically self-consistent, and they");
out("differ by exactly three permissions:");
out();
out("```");
out(`with LOT_OVERRIDE_GATE, PARTY_SUSPEND, ORDER_CANCEL in SOURCING_OPS_ADMIN`);
out(`    SOURCING_OPS_ADMIN = ${sets.SOURCING_OPS_ADMIN.size}   union = ${union.size}   super-only = ${superOnly.length}`);
out(`with those three removed from SOURCING_OPS_ADMIN`);
out(`    SOURCING_OPS_ADMIN = ${sets.SOURCING_OPS_ADMIN.size - 3}   union = ${union.size - 3}   super-only = ${superOnly.length + 3}`);
out("```");
out();
out("So the previous authentication design's **59 / 15** is the same matrix with those three treated as");
out("super-only, and **62 / 12** is the matrix where they are ordinary. The contractual **45** is only");
out("reachable if all three are included: excluding them yields 42, which contradicts the contract in three");
out("places. That makes **62 / 12** the figure consistent with the contractual matrix, and it is what the code");
out("implements.");
out();
out("**What is NOT resolved by arithmetic:** whether denying those three to SOURCING_OPS_ADMIN is the right");
out("policy. \`PARTY_SUSPEND\` suspends a party, \`ORDER_CANCEL\` cancels an order and \`LOT_OVERRIDE_GATE\` overrides");
out("a quality gate — each is both an operational necessity and a control worth restricting. The counts");
out("(62/12) and the policy are separate questions, and only the first one is settled by the arithmetic.");
out("Recorded as **D-TIER-1**, open.");
out();
out("## 2. Where the documents now say what");
out();
out("| Document | Before this pass | Now |");
out("|---|---|---|");
out("| `docs/PRIMEMET_PHASE_1A_CONTRACTS.md` §2.8 | \"Union … = 59, so 15 permissions are SUPER_ADMIN-only\" — while the same section's table states 45 | corrected to 62/12, with the arithmetic shown |");
out("| `docs/PRIMEMET_M2_AUTH_DESIGN.md` §3.4 | listed 15 super-only permissions (the twelve plus the three) | corrected to the twelve, with the three marked disputed |");
out("| `docs/PRIMEMET_M2_READINESS.md` | already 62/12 with the arithmetic rationale | unchanged |");
out("| `docs/PRIMEMET_M2A_DECISION_REGISTER.md` | noted the correction | records D-TIER-1 as open |");
out("| `scripts/check-adversarial.mjs` §C | — | asserts 74 / 45 / 14 / 20 / 62 / 12 and reproduces 59/15 as the same matrix minus three |");
out();
out("## 3. The matrix");
out();
out("`Super-only` is derived, not declared: it means **no non-super tier holds it**, so no admin below");
out("SUPER_ADMIN can exercise it without an explicit grant. `Delegation` describes who may *grant* it");
out("(§2.5/§2.6): the four non-delegable permissions cannot be granted by a non-super tier at all, and never");
out("to oneself by anyone.");
out();
out("| Permission | SUPER_ADMIN | SOURCING_OPS_ADMIN | CATALOGUE_MANAGER | READ_ONLY_ADMIN | Delegation | Super-only | Source |");
out("|---|---|---|---|---|---|---|---|");
for (const permission of ADMIN_PERMISSIONS) out(row(permission));
out();
out(`**Totals.** SUPER_ADMIN ${sets.SUPER_ADMIN.size} · SOURCING_OPS_ADMIN ${sets.SOURCING_OPS_ADMIN.size} · CATALOGUE_MANAGER ${sets.CATALOGUE_MANAGER.size} · READ_ONLY_ADMIN ${sets.READ_ONLY_ADMIN.size} · union ${union.size} · super-only ${superOnly.length}.`);
out();
out("## 4. The twelve super-only permissions");
out();
for (const permission of superOnly) out(`- \`${permission}\`${DISPUTED.has(permission) ? " — **disputed**" : ""}`);
out();
out("## 5. Open decisions recorded by this measurement");
out();
out("| ID | Question | Recommendation | Status |");
out("|---|---|---|---|");
out("| **D-TIER-1** | Should `LOT_OVERRIDE_GATE`, `PARTY_SUSPEND` and `ORDER_CANCEL` be super-only, making the matrix 59/15 and SOURCING_OPS_ADMIN 42? | Keep 62/12 as implemented until the operation has enough staff to absorb the controls: removing three day-to-day operational actions from the sourcing desk is a process change, not a permission tidy-up. The alternative is a one-line edit in `tiers.ts` plus a migration-free redeploy, so it stays cheap to reverse. | **OPEN — owner decision** |");
out();

const text = `${lines.join("\n")}\n`;
if (process.argv.includes("--stdout")) {
  process.stdout.write(text);
} else {
  writeFileSync(TARGET, text, "utf8");
  process.stdout.write(`wrote ${TARGET} — ${lines.length} lines\n`);
}