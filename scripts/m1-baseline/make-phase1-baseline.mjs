#!/usr/bin/env node
/**
 * Reconstructs the Phase 1 datamodel (the state after the five Phase 1 migrations and before the
 * D-1/D-2 corrective) from the current schema, by reversing exactly the blocks D-1 added.
 *
 * The output becomes scripts/m1-baseline/schema-phase1.prisma — a frozen boundary that lets the
 * schema check prove two independent things:
 *   diff(M1 → Phase 1)   == the committed Phase 1 catalogue migration
 *   diff(Phase 1 → now)  == the committed D-1 governance migration
 * Without that intermediate snapshot the delta would have to be compared as a set, which cannot work
 * because a later migration legitimately changes a table an earlier one created.
 *
 * Refuses to run if any anchor is missing, so a partial reversal cannot produce a wrong baseline.
 */
import { readFileSync, writeFileSync } from "node:fs";

const CURRENT = "prisma/schema.prisma";
const OUT = "scripts/m1-baseline/schema-phase1.prisma";

let schema = readFileSync(CURRENT, "utf8");
const original = schema;

function cut(from, to, label) {
  const start = schema.indexOf(from);
  if (start === -1) throw new Error(`anchor not found (start): ${label}`);
  const end = schema.indexOf(to, start);
  if (end === -1) throw new Error(`anchor not found (end): ${label}`);
  schema = schema.slice(0, start) + schema.slice(end);
}

function remove(text, label) {
  const count = schema.split(text).length - 1;
  if (count !== 1) throw new Error(`expected exactly 1 occurrence of ${label}, found ${count}`);
  schema = schema.replace(text, "");
}

cut(
  "/// How a phrase relates to the canonical grade it points at (Phase 1 corrective, D-1).",
  "enum SearchIntentType {",
  "EquivalenceBasis + EquivalenceDecisionStatus enums",
);

cut(
  "/// D-1 — the equivalence review of an alias phrase, recorded as its own auditable decision.",
  "/// A named set of attributes that applies to one product form",
  "MaterialAliasEquivalenceDecision model",
);

remove(
  `  /// D-1: how the phrase relates to the canonical material. NULL until classified — and a release
  /// CHECK (migration 20261031140000) refuses VERIFIED while this is NULL, so an unclassified
  /// phrase can never be published by accident.
  equivalenceBasis EquivalenceBasis?  @map("equivalence_basis")
  /// D-1: the APPROVED technical review that authorises VERIFIED. A CHECK constraint pins it to
  /// an APPROVED decision belonging to this same alias, so "a verifier name and a timestamp" are
  /// not sufficient to verify a phrase.
  equivalenceDecisionId String?      @map("equivalence_decision_id") @db.Uuid
`,
  "MaterialAlias equivalence columns",
);

remove(
  `  /// The review that currently authorises this phrase. SetNull, because a cascade from an alias
  /// to the evidence of why it was trusted is the wrong direction.
  equivalenceDecision MaterialAliasEquivalenceDecision? @relation("AliasEquivalence", fields: [equivalenceDecisionId], references: [id], onDelete: SetNull)
  /// Every review ever raised for this phrase, in order. The full history, not only the current one.
  equivalenceDecisions MaterialAliasEquivalenceDecision[] @relation("AliasEquivalenceHistory")
`,
  "MaterialAlias equivalence relations",
);

remove(
  `  aliasEquivalenceReviews MaterialAliasEquivalenceDecision[] @relation("AliasEquivalenceReviewer")\n`,
  "User back-relation",
);
remove(
  `  aliasEquivalenceEvidence  MaterialAliasEquivalenceDecision[] @relation("AliasEquivalenceEvidence")\n`,
  "Document back-relation",
);

if (schema === original) throw new Error("reversal changed nothing");
if (/EquivalenceBasis|EquivalenceDecisionStatus|MaterialAliasEquivalenceDecision|equivalence_/.test(schema)) {
  throw new Error("reversal left D-1 artifacts behind");
}

writeFileSync(OUT, schema, "utf8");
console.log(`wrote ${OUT} (${schema.length} bytes, ${schema.split("\n").length} lines)`);