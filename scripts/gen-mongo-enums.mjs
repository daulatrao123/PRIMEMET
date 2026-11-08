#!/usr/bin/env node
/**
 * Regenerate db/enums.mjs from prisma/schema.prisma, plus the local additions.
 *
 * The Prisma schema stays the single source of truth for enum membership (architecture §5.1 — an enum
 * value is append-only). MongoDB validators need the value lists, so they are generated rather than
 * copied by hand: a hand-maintained copy would drift silently, and a drifted enum is a validator that
 * either refuses a valid value or accepts an invented one.
 *
 * Enums Prisma does not declare — `GrantEffect`, added by D-ARCH-12 — are declared in
 * `db/enums-local.mjs` and merged here. Assembly and rendering live in `scripts/lib/mongo-enums.mjs`
 * so this script and `scripts/check-enums.mjs` cannot disagree about what the correct file is.
 *
 *   npm run db:enums
 *   node scripts/check-enums.mjs     # proves the generated file still matches its sources
 */

import { readFileSync, writeFileSync } from "node:fs";

import { buildEnums, renderEnums } from "./lib/mongo-enums.mjs";
import { parsePrismaEnums } from "./lib/prisma-enums.mjs";

const schema = readFileSync("prisma/schema.prisma", "utf8");

let enums;
try {
  enums = buildEnums(parsePrismaEnums(schema));
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exit(1);
}

writeFileSync("db/enums.mjs", renderEnums(enums));
console.log(`✔ db/enums.mjs written — ${Object.keys(enums).length} enums`);
