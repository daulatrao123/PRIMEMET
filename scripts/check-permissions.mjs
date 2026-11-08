#!/usr/bin/env node
/**
 * PRIMEMET — D-ARCH-12 permission resolver and safeguard suite.
 *
 * WHAT THIS PROVES, and why it is one file rather than three:
 *
 *   1. the vocabulary in `src/lib/permissions` matches the value sets the DATABASE enforces
 *   2. the tier defaults are the four sets the contracts specify, with their exact counts
 *   3. the resolver implements the approved latest-event-wins semantics, including expiry, REVOKE,
 *      the tiebreaker, and the "unknown effect is ignored, never a GRANT" rule
 *   4. delegation cannot be used to escalate: ceiling, self-target, non-delegable set, inactive target,
 *      super-admin protection, and the lockout guard
 *   5. against a REAL mongod: the validator accepts GRANT, DENY **and REVOKE** — the D-ARCH-12 defect —
 *      refuses everything else, the log stays append-only, a retried event is a no-op, and concurrent
 *      appends produce a deterministic order
 *   6. a forged request body cannot grant anything, because permissions are resolved server-side
 *
 * The pure suite runs with no database. The integration suite starts an in-memory replica set (the same
 * one `check:mongodb` uses) and is skipped only if that binary is unavailable.
 *
 *   npm run check:permissions
 *   node scripts/check-permissions.mjs            # both sections
 *   node scripts/check-permissions.mjs --unit     # no database at all
 */

import { randomUUID } from "node:crypto";

import { Long } from "mongodb";

import { adminPermissionGrant } from "../db/collections/core.mjs";
import { plansFor } from "../db/define.mjs";
import { ENUMS } from "../db/enums.mjs";
import { LOCAL_ENUMS } from "../db/enums-local.mjs";
import { GUARD_LAST_SUPER_ADMIN, GUARDS, ensurePermissionGuards, ensurePlatformIdentityCollection } from "../db/guards.mjs";
import { buildRoleDefinitions } from "../db/roles.mjs";
import {
  ADMIN_PERMISSIONS,
  ADMIN_TIERS,
  GRANT_EFFECTS,
  isAdminPermission,
} from "../src/lib/permissions/types.ts";
import { TIER_DEFAULTS, tierDefault } from "../src/lib/permissions/tiers.ts";
import { actorDenial, resolveAdminPermissions, resolvePermission } from "../src/lib/permissions/resolve.ts";
import {
  NON_DELEGABLE,
  mayGrant,
  wouldLockOutSuperAdmins,
} from "../src/lib/permissions/delegation.ts";

let passed = 0;
const failures = [];

function ok(name) {
  passed += 1;
  process.stdout.write(`  \u2714 ${name}\n`);
}
function fail(name, detail) {
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  process.stdout.write(`  \u2716 ${name}${detail ? ` — ${detail}` : ""}\n`);
}
function check(name, condition, detail) {
  if (condition) ok(name);
  else fail(name, detail);
}
async function expectReject(name, fn, matcher) {
  try {
    await fn();
    fail(name, "was ACCEPTED but should have been rejected");
  } catch (error) {
    const text = `${error?.message ?? error}${error?.code ? ` [code ${error.code}]` : ""}`;
    if (!matcher || matcher.test(text)) ok(name);
    else fail(name, `rejected for the wrong reason: ${text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const UNIT_ONLY = process.argv.includes("--unit");
const NOW = new Date("2026-11-01T12:00:00.000Z");
const PROFILE = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE = "22222222-2222-4222-8222-222222222222";
const day = (n) => new Date(NOW.getTime() + n * 86_400_000);

function actor(overrides = {}) {
  return {
    user: {
      id: "user-1",
      role: "ADMIN",
      status: "ACTIVE",
      deletedAt: null,
      ...(overrides.user ?? {}),
    },
    profile: {
      id: PROFILE,
      isActive: true,
      tier: "SOURCING_OPS_ADMIN",
      ...(overrides.profile ?? {}),
    },
    org: { id: "org-1", orgKind: "PRIMEMET", accountStatus: "ACTIVE", ...(overrides.org ?? {}) },
  };
}

let seqCounter = 0;
function event({
  permission,
  effect,
  createdAt,
  expiresAt = null,
  adminId = PROFILE,
  seq = undefined,
  eventId = undefined,
  reason = "test fixture",
}) {
  seqCounter += 1;
  return {
    _id: randomUUID(),
    adminId,
    permission,
    effect,
    seq: seq ?? seqCounter,
    eventId: eventId ?? `evt-${seqCounter}`,
    grantedById: "user-super",
    reason,
    expiresAt,
    createdAt,
  };
}

const allowed = (resolution, permission) => resolution.allowed.has(permission);
const decision = (resolution, permission) => resolution.decisions.get(permission);

async function main() {
  process.stdout.write("PRIMEMET — permission resolver and safeguards (D-ARCH-12)\n\n");

  // =========================================================================
  // 1. Vocabulary parity with the database
  // =========================================================================
  process.stdout.write("1. Vocabulary matches the database\n");

  check(
    `the resolver declares the same ${ENUMS.AdminPermission.length} permissions the database enforces`,
    JSON.stringify(ADMIN_PERMISSIONS) === JSON.stringify(ENUMS.AdminPermission),
    `resolver=${ADMIN_PERMISSIONS.length} database=${ENUMS.AdminPermission.length}`,
  );
  check(
    "the permission list has no duplicate value",
    new Set(ADMIN_PERMISSIONS).size === ADMIN_PERMISSIONS.length,
    `${ADMIN_PERMISSIONS.length - new Set(ADMIN_PERMISSIONS).size} duplicate(s)`,
  );
  check(
    "the tier list matches AdminTier",
    JSON.stringify(ADMIN_TIERS) === JSON.stringify(ENUMS.AdminTier),
    JSON.stringify(ADMIN_TIERS),
  );
  check(
    "the effect list matches the locally declared GrantEffect (including REVOKE)",
    JSON.stringify(GRANT_EFFECTS) === JSON.stringify(LOCAL_ENUMS.GrantEffect),
    `resolver=${JSON.stringify(GRANT_EFFECTS)} database=${JSON.stringify(LOCAL_ENUMS.GrantEffect)}`,
  );
  check(
    "REVOKE is a value the resolver, the enum file and the local declaration all agree on",
    GRANT_EFFECTS.includes("REVOKE") &&
      ENUMS.GrantEffect.includes("REVOKE") &&
      LOCAL_ENUMS.GrantEffect.includes("REVOKE"),
    "a disagreement here is exactly the D-ARCH-12 defect",
  );
  check(
    "the privacy of the vocabulary is fail-closed: an invented permission is not a permission",
    !isAdminPermission("TOTAL_CONTROL"),
    "isAdminPermission accepted an invented value",
  );

  // =========================================================================
  // 2. Tier defaults
  // =========================================================================
  process.stdout.write("\n2. Tier defaults\n");

  const WANT_COUNTS = {
    SUPER_ADMIN: 74,
    SOURCING_OPS_ADMIN: 45,
    CATALOGUE_MANAGER: 14,
    READ_ONLY_ADMIN: 20,
  };
  for (const [tier, count] of Object.entries(WANT_COUNTS)) {
    check(
      `${tier} defaults to exactly ${count} permissions`,
      TIER_DEFAULTS[tier].length === count,
      `${TIER_DEFAULTS[tier].length}`,
    );
  }
  check(
    "no tier default names a permission the database does not enforce",
    Object.values(TIER_DEFAULTS)
      .flat()
      .every((p) => ENUMS.AdminPermission.includes(p)),
    "a tier grants something that does not exist",
  );
  check(
    "SUPER_ADMIN reaches every permission",
    ADMIN_PERMISSIONS.every((p) => tierDefault("SUPER_ADMIN", p)),
    "a permission is unreachable by the only tier that should reach it",
  );
  check(
    "READ_ONLY_ADMIN is read-only by construction",
    TIER_DEFAULTS.READ_ONLY_ADMIN.every((p) => p.includes("VIEW")) &&
      !TIER_DEFAULTS.READ_ONLY_ADMIN.includes("CONTENT_REVIEW"),
    "a mutating permission leaked into the read-only tier",
  );
  for (const denied of [
    "PRICING_EDIT",
    "PRICING_APPROVE",
    "TAX_EDIT",
    "TAX_APPROVE",
    "INVOICE_ISSUE",
    "USER_INVITE",
    "USER_SUSPEND",
    "ACCESS_ASSIGN_ROLE",
    "ACCESS_GRANT_PERMISSION",
    "DATABASE_APPLY_MIGRATION",
    "AUDIT_EXPORT",
  ]) {
    check(
      `SOURCING_OPS_ADMIN cannot reach ${denied}`,
      !tierDefault("SOURCING_OPS_ADMIN", denied),
      "the commercial desk holds a control it must not",
    );
  }
  check(
    "CATALOGUE_MANAGER cannot reach any commercial permission",
    ["QUOTE_APPROVE", "PRICING_EDIT", "INVOICE_ISSUE", "ORDER_EDIT", "ACCESS_GRANT_PERMISSION"].every(
      (p) => !tierDefault("CATALOGUE_MANAGER", p),
    ),
    "the catalogue tier reaches a commercial control",
  );
  check(
    "an unknown tier grants nothing (fail-closed)",
    tierDefault("SHADOW_ADMIN", "ENQUIRY_VIEW") === false && tierDefault("", "ENQUIRY_VIEW") === false,
    "an unknown tier was granted a default",
  );

  // =========================================================================
  // 3. Gates
  // =========================================================================
  process.stdout.write("\n3. Fail-closed gates\n");

  const gateCases = [
    ["no actor at all", null, "NO_ACTOR"],
    ["no user record", { ...actor(), user: null }, "NO_ACTOR"],
    ["a BUYER or SELLER session", actor({ user: { role: "BUYER" } }), "NOT_ADMIN_ROLE"],
    ["a suspended user", actor({ user: { status: "SUSPENDED" } }), "USER_NOT_ACTIVE"],
    ["a deleted user", actor({ user: { deletedAt: new Date() } }), "USER_DELETED"],
    ["role=ADMIN with no admin profile", { ...actor(), profile: null }, "NO_ADMIN_PROFILE"],
    ["an inactive admin profile", actor({ profile: { isActive: false } }), "PROFILE_INACTIVE"],
    ["no organisation", { ...actor(), org: null }, "NO_ORGANISATION"],
    [
      "a suspended non-PRIMEMET organisation",
      actor({ org: { orgKind: "BUYER_ORG", accountStatus: "SUSPENDED" } }),
      "ORGANISATION_NOT_ACTIVE",
    ],
  ];
  for (const [label, input, want] of gateCases) {
    const reason = actorDenial(input);
    check(`${label} is refused as ${want}`, reason === want, String(reason));
    const resolution = resolveAdminPermissions(input, [], NOW);
    check(
      `${label} yields no permission at all`,
      resolution.allowed.size === 0 && resolution.deniedAt === want,
      `${resolution.allowed.size} allowed, deniedAt=${resolution.deniedAt}`,
    );
  }
  check(
    "the PRIMEMET organisation is not barred by its own account status",
    actorDenial(actor({ org: { orgKind: "PRIMEMET", accountStatus: "SUSPENDED" } })) === null,
    "staff were locked out of the platform organisation",
  );
  check(
    "a fully valid admin passes every gate",
    actorDenial(actor()) === null,
    String(actorDenial(actor())),
  );
  check(
    "an unrecognised tier resolves to nothing and says so",
    resolveAdminPermissions(actor({ profile: { tier: "SHADOW_ADMIN" } }), [], NOW).deniedAt ===
      "UNKNOWN_TIER",
    "an unknown tier was not reported",
  );

  // =========================================================================
  // 4. The approved semantics — mandatory cases
  // =========================================================================
  process.stdout.write("\n4. Latest-event-wins semantics\n");

  // P-R1: GRANT overrides a default denial
  {
    const events = [
      event({ permission: "CATALOGUE_EDIT", effect: "GRANT", createdAt: day(-1) }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "GRANT overrides a default denial",
      allowed(resolution, "CATALOGUE_EDIT") && decision(resolution, "CATALOGUE_EDIT").decidedBy === "EVENT",
      JSON.stringify(decision(resolution, "CATALOGUE_EDIT")),
    );
  }

  // P-R2: DENY overrides a default grant
  {
    const events = [event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(-1) })];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "DENY overrides a default grant",
      !allowed(resolution, "ENQUIRY_VIEW") && decision(resolution, "ENQUIRY_VIEW").effect === "DENY",
      JSON.stringify(decision(resolution, "ENQUIRY_VIEW")),
    );
  }

  // P-R3: REVOKE restores the tier default (which grants here)
  {
    const events = [
      event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(-2) }),
      event({ permission: "ENQUIRY_VIEW", effect: "REVOKE", createdAt: day(-1) }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    const d = decision(resolution, "ENQUIRY_VIEW");
    check(
      "REVOKE restores the tier default",
      allowed(resolution, "ENQUIRY_VIEW") && d.decidedBy === "TIER_DEFAULT" && d.effect === "REVOKE",
      JSON.stringify(d),
    );
  }

  // P-R4: REVOKE of a permission the tier does NOT grant restores a denial
  {
    const events = [
      event({ permission: "DATABASE_APPLY_MIGRATION", effect: "GRANT", createdAt: day(-2) }),
      event({ permission: "DATABASE_APPLY_MIGRATION", effect: "REVOKE", createdAt: day(-1) }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "REVOKE where the tier grants nothing restores the denial",
      !allowed(resolution, "DATABASE_APPLY_MIGRATION") &&
        decision(resolution, "DATABASE_APPLY_MIGRATION").effect === "REVOKE",
      JSON.stringify(decision(resolution, "DATABASE_APPLY_MIGRATION")),
    );
  }

  // P-R5: DENY followed by REVOKE restores the default
  {
    const events = [
      event({ permission: "QUOTE_VIEW", effect: "DENY", createdAt: day(-3) }),
      event({ permission: "QUOTE_VIEW", effect: "REVOKE", createdAt: day(-2) }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "DENY followed by REVOKE restores the tier default",
      allowed(resolution, "QUOTE_VIEW") && decision(resolution, "QUOTE_VIEW").decidedBy === "TIER_DEFAULT",
      JSON.stringify(decision(resolution, "QUOTE_VIEW")),
    );
  }

  // P-R6: GRANT followed by DENY denies
  {
    const events = [
      event({ permission: "CATALOGUE_EDIT", effect: "GRANT", createdAt: day(-3) }),
      event({ permission: "CATALOGUE_EDIT", effect: "DENY", createdAt: day(-2) }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "GRANT followed by DENY denies",
      !allowed(resolution, "CATALOGUE_EDIT"),
      JSON.stringify(decision(resolution, "CATALOGUE_EDIT")),
    );
  }

  // P-R7: an expired GRANT is ignored — it does not authorise
  {
    const events = [
      event({ permission: "CATALOGUE_EDIT", effect: "GRANT", createdAt: day(-2), expiresAt: day(-1) }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "an expired GRANT is ignored",
      !allowed(resolution, "CATALOGUE_EDIT") && decision(resolution, "CATALOGUE_EDIT").decidedBy === "TIER_DEFAULT",
      JSON.stringify(decision(resolution, "CATALOGUE_EDIT")),
    );
  }

  // P-R8: an expired DENY is ignored — the suspension lifted
  {
    const events = [
      event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(-2), expiresAt: day(-1) }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "an expired DENY is ignored",
      allowed(resolution, "ENQUIRY_VIEW") && decision(resolution, "ENQUIRY_VIEW").decidedBy === "TIER_DEFAULT",
      JSON.stringify(decision(resolution, "ENQUIRY_VIEW")),
    );
  }

  // P-R9: an expired newest event falls through to the preceding applicable one — the deciding row
  {
    const events = [
      event({ permission: "ENQUIRY_VIEW", effect: "GRANT", createdAt: day(-30) }),
      event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(-20) }),
      event({ permission: "ENQUIRY_VIEW", effect: "GRANT", createdAt: day(-10), expiresAt: day(-5) }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    const d = decision(resolution, "ENQUIRY_VIEW");
    check(
      "an expired newest event falls through to the preceding applicable event",
      !allowed(resolution, "ENQUIRY_VIEW") && d.effect === "DENY",
      JSON.stringify(d),
    );
  }

  // P-R10: the mirror case — an expired temporary grant must not become a permanent denial
  {
    const events = [
      event({ permission: "ENQUIRY_VIEW", effect: "GRANT", createdAt: day(-30) }),
      event({ permission: "ENQUIRY_VIEW", effect: "GRANT", createdAt: day(-10), expiresAt: day(-5) }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "a lapsed temporary GRANT restores the earlier GRANT rather than denying",
      allowed(resolution, "ENQUIRY_VIEW") && decision(resolution, "ENQUIRY_VIEW").effect === "GRANT",
      JSON.stringify(decision(resolution, "ENQUIRY_VIEW")),
    );
  }

  // P-R11: an event dated in the future is not yet applicable
  {
    const events = [event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(1) })];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "an event created in the future does not apply yet",
      allowed(resolution, "ENQUIRY_VIEW"),
      JSON.stringify(decision(resolution, "ENQUIRY_VIEW")),
    );
  }

  // P-R12: an expiry exactly at `now` has lapsed (strict >, per §2.3)
  {
    const events = [
      event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(-1), expiresAt: NOW }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "an event expiring exactly at the evaluation instant is inert",
      allowed(resolution, "ENQUIRY_VIEW"),
      JSON.stringify(decision(resolution, "ENQUIRY_VIEW")),
    );
  }

  // P-R13 (W1 remediation): an unrecognised effect DENIES the permission. It used to be skipped, which
  // made a corrupt row weaker than no row at all — the GRANT beneath it, or the tier default, decided.
  {
    const alone = resolveAdminPermissions(
      actor(),
      [event({ permission: "DATABASE_APPLY_MIGRATION", effect: "SUPER", createdAt: day(-1) })],
      NOW,
    );
    check(
      "an unrecognised effect denies the permission",
      !allowed(alone, "DATABASE_APPLY_MIGRATION"),
      JSON.stringify(decision(alone, "DATABASE_APPLY_MIGRATION")),
    );
    check(
      "the refusal is attributed to the corrupt event, not to the tier",
      decision(alone, "DATABASE_APPLY_MIGRATION").decidedBy === "INVALID_EVENT",
      JSON.stringify(decision(alone, "DATABASE_APPLY_MIGRATION")),
    );
    check(
      "the corrupt effect is not silently reinterpreted as REVOKE",
      decision(alone, "DATABASE_APPLY_MIGRATION").effect === "INVALID",
      JSON.stringify(decision(alone, "DATABASE_APPLY_MIGRATION")),
    );
    check(
      "the ignored event is reported, not silently dropped",
      decision(alone, "DATABASE_APPLY_MIGRATION").ignoredEvents.length === 1,
      JSON.stringify(decision(alone, "DATABASE_APPLY_MIGRATION").ignoredEvents),
    );

    const aboveGrant = resolveAdminPermissions(
      actor(),
      [
        event({ permission: "CATALOGUE_EDIT", effect: "GRANT", createdAt: day(-2) }),
        event({ permission: "CATALOGUE_EDIT", effect: "superuser", createdAt: day(-1) }),
      ],
      NOW,
    );
    check(
      "an unrecognised effect above a GRANT denies it",
      !allowed(aboveGrant, "CATALOGUE_EDIT"),
      JSON.stringify(decision(aboveGrant, "CATALOGUE_EDIT")),
    );

    // Above a DENY the outcome is the same, so the assertion exists to pin that a corrupt row never
    // *upgrades* a DENY either — the permission must not become allowed because the DENY was damaged.
    const aboveDeny = resolveAdminPermissions(
      actor(),
      [
        event({ permission: "CATALOGUE_EDIT", effect: "DENY", createdAt: day(-2) }),
        event({ permission: "CATALOGUE_EDIT", effect: "maybe", createdAt: day(-1) }),
      ],
      NOW,
    );
    check(
      "an unrecognised effect above a DENY still denies",
      !allowed(aboveDeny, "CATALOGUE_EDIT"),
      JSON.stringify(decision(aboveDeny, "CATALOGUE_EDIT")),
    );

    // Above a REVOKE is the distinguishing case: a REVOKE would restore the tier default, and
    // ENQUIRY_VIEW's default for READ_ONLY_ADMIN is TRUE. If a corrupt row were treated as a REVOKE the
    // permission would be granted; it must instead be refused.
    const aboveRevoke = resolveAdminPermissions(
      actor(),
      [
        event({ permission: "ENQUIRY_VIEW", effect: "REVOKE", createdAt: day(-2) }),
        event({ permission: "ENQUIRY_VIEW", effect: "REVOKED", createdAt: day(-1) }),
      ],
      NOW,
    );
    check(
      "an unrecognised effect above a REVOKE denies rather than restoring the tier default",
      !allowed(aboveRevoke, "ENQUIRY_VIEW"),
      JSON.stringify(decision(aboveRevoke, "ENQUIRY_VIEW")),
    );
    check(
      "the tier default is genuinely a grant here, so the case is distinguishing",
      resolveAdminPermissions(actor(), [event({ permission: "ENQUIRY_VIEW", effect: "REVOKE", createdAt: day(-1) })], NOW)
        .decisions.get("ENQUIRY_VIEW").allowed === true,
      "REVOKE alone must restore the tier default",
    );

    // Malformed: the field is absent, null, or empty. All three are uninterpretable and must refuse.
    for (const [label, value] of [["absent", undefined], ["null", null], ["empty", ""]]) {
      const r = resolveAdminPermissions(actor(), [event({ permission: "ENQUIRY_VIEW", effect: value, createdAt: day(-1) })], NOW);
      check(
        "a malformed record (effect " + label + ") denies",
        !allowed(r, "ENQUIRY_VIEW"),
        JSON.stringify(decision(r, "ENQUIRY_VIEW")),
      );
    }

    // A record that cannot be ordered (no usable createdAt) must NOT be treated as newest: it cannot be
    // placed, so it neither decides nor denies, and the valid row beneath it stands.
    const unordered = resolveAdminPermissions(
      actor(),
      [
        event({ permission: "ENQUIRY_VIEW", effect: "GRANT", createdAt: day(-2) }),
        { adminId: "p1", permission: "ENQUIRY_VIEW", effect: "superuser", seq: 9, eventId: "no-time", expiresAt: null },
      ],
      NOW,
    );
    check(
      "an unordered malformed record does not decide and does not deny",
      allowed(unordered, "ENQUIRY_VIEW"),
      JSON.stringify(decision(unordered, "ENQUIRY_VIEW")),
    );

    // Expiry still wins over interpretation (D-ARCH-12): an expired event is inert, so an expired corrupt
    // row must not deny a permission that a live GRANT holds.
    const expiredCorrupt = resolveAdminPermissions(
      actor(),
      [
        event({ permission: "ENQUIRY_VIEW", effect: "GRANT", createdAt: day(-3) }),
        event({ permission: "ENQUIRY_VIEW", effect: "superuser", createdAt: day(-2), expiresAt: day(-1) }),
      ],
      NOW,
    );
    check(
      "an expired corrupt record is inert, not decisive",
      allowed(expiredCorrupt, "ENQUIRY_VIEW"),
      JSON.stringify(decision(expiredCorrupt, "ENQUIRY_VIEW")),
    );

    // Mixed history: valid rows above and below the corrupt one. Only the newest applicable row decides.
    const mixed = resolveAdminPermissions(
      actor(),
      [
        event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(-4) }),
        event({ permission: "ENQUIRY_VIEW", effect: "GRANT", createdAt: day(-3) }),
        event({ permission: "ENQUIRY_VIEW", effect: "corrupt", createdAt: day(-2) }),
        event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(-1) }),
      ],
      NOW,
    );
    check(
      "in a mixed history the newest VALID row decides",
      !allowed(mixed, "ENQUIRY_VIEW") && decision(mixed, "ENQUIRY_VIEW").decidedBy === "EVENT",
      JSON.stringify(decision(mixed, "ENQUIRY_VIEW")),
    );
    check(
      "the corrupt row is still reported in a mixed history",
      mixed.integrityDiagnostics.length === 1 && mixed.integrityDiagnostics[0].decisive === false,
      JSON.stringify(mixed.integrityDiagnostics),
    );
  }

  // P-R14: the sequence tiebreaker decides within one millisecond
  {
    const sameInstant = day(-1);
    const denyWins = resolveAdminPermissions(
      actor(),
      [
        event({ permission: "CATALOGUE_EDIT", effect: "GRANT", createdAt: sameInstant, seq: 1 }),
        event({ permission: "CATALOGUE_EDIT", effect: "DENY", createdAt: sameInstant, seq: 2 }),
      ],
      NOW,
    );
    check(
      "same instant, higher seq wins (DENY at seq 2)",
      !allowed(denyWins, "CATALOGUE_EDIT"),
      JSON.stringify(decision(denyWins, "CATALOGUE_EDIT")),
    );

    const grantWins = resolveAdminPermissions(
      actor(),
      [
        event({ permission: "CATALOGUE_EDIT", effect: "GRANT", createdAt: sameInstant, seq: 2 }),
        event({ permission: "CATALOGUE_EDIT", effect: "DENY", createdAt: sameInstant, seq: 1 }),
      ],
      NOW,
    );
    check(
      "same instant, higher seq wins (GRANT at seq 2)",
      allowed(grantWins, "CATALOGUE_EDIT"),
      JSON.stringify(decision(grantWins, "CATALOGUE_EDIT")),
    );
  }

  // P-R15: input order must not matter
  {
    const rows = [
      event({ permission: "ENQUIRY_VIEW", effect: "GRANT", createdAt: day(-30) }),
      event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(-20) }),
      event({ permission: "ENQUIRY_VIEW", effect: "REVOKE", createdAt: day(-10) }),
    ];
    const forwards = resolveAdminPermissions(actor(), rows, NOW);
    const backwards = resolveAdminPermissions(actor(), [...rows].reverse(), NOW);
    check(
      "resolution is independent of the order rows are handed over",
      forwards.allowed.has("ENQUIRY_VIEW") === backwards.allowed.has("ENQUIRY_VIEW") &&
        forwards.allowed.size === backwards.allowed.size,
      `${forwards.allowed.size} vs ${backwards.allowed.size}`,
    );
  }

  // P-R16: another admin's rows are not this admin's events
  {
    const events = [
      event({ permission: "DATABASE_APPLY_MIGRATION", effect: "GRANT", createdAt: day(-1), adminId: OTHER_PROFILE }),
    ];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "another admin's grant does not apply",
      !allowed(resolution, "DATABASE_APPLY_MIGRATION"),
      "a row from a different admin was applied",
    );
  }

  // P-R17: a malformed row without createdAt cannot decide anything
  {
    const events = [{ adminId: PROFILE, permission: "ENQUIRY_VIEW", effect: "DENY", seq: 1, eventId: "x", createdAt: null }];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "a row with no usable createdAt is not applicable",
      allowed(resolution, "ENQUIRY_VIEW"),
      "an unorderable row decided a permission",
    );
  }

  // P-R18: resolvePermission agrees with resolveAdminPermissions
  {
    const events = [event({ permission: "ENQUIRY_VIEW", effect: "DENY", createdAt: day(-1) })];
    check(
      "resolvePermission agrees with the full resolution",
      resolvePermission(actor(), events, "ENQUIRY_VIEW", NOW).allowed === false &&
        resolvePermission(actor(), events, "QUOTE_VIEW", NOW).allowed === true,
      "the single-permission helper disagrees",
    );
  }

  // P-R19: a REVOKE is not a DENY — the superseded semantics
  {
    const events = [event({ permission: "ENQUIRY_VIEW", effect: "REVOKE", createdAt: day(-1) })];
    const resolution = resolveAdminPermissions(actor(), events, NOW);
    check(
      "a lone REVOKE restores the tier default rather than denying (deny-wins would deny here)",
      allowed(resolution, "ENQUIRY_VIEW"),
      JSON.stringify(decision(resolution, "ENQUIRY_VIEW")),
    );
  }

  // =========================================================================
  // 5. Delegation safeguards
  // =========================================================================
  process.stdout.write("\n5. Delegation safeguards\n");

  const superActor = {
    actorPermissions: new Set(ADMIN_PERMISSIONS),
    actorProfileId: PROFILE,
    actorTier: "SUPER_ADMIN",
  };
  const opsActor = {
    actorPermissions: new Set(TIER_DEFAULTS.SOURCING_OPS_ADMIN),
    actorProfileId: PROFILE,
    actorTier: "SOURCING_OPS_ADMIN",
  };
  const goodTarget = { profileId: OTHER_PROFILE, isActive: true, userIsActive: true, tier: "CATALOGUE_MANAGER" };

  check(
    "the four non-delegable permissions are the ones the contract names",
    JSON.stringify([...NON_DELEGABLE].sort()) ===
      JSON.stringify(
        ["ACCESS_GRANT_PERMISSION", "ACCESS_ASSIGN_ROLE", "DATABASE_APPLY_MIGRATION", "AUDIT_EXPORT"].sort(),
      ),
    JSON.stringify(NON_DELEGABLE),
  );
  check(
    "every non-delegable permission exists in the enum",
    NON_DELEGABLE.every((p) => ADMIN_PERMISSIONS.includes(p)),
    "a non-delegable name does not exist",
  );

  const grantCase = (input) =>
    mayGrant({ ...superActor, target: goodTarget, request: { permission: "CATALOGUE_EDIT", effect: "GRANT", reason: "catalogue cover", eventId: "e1" }, now: NOW, ...input });

  check("a super admin may grant a held permission to another admin", grantCase({}).allowed === true, JSON.stringify(grantCase({})));
  check(
    "an actor without ACCESS_GRANT_PERMISSION may grant nothing",
    grantCase({ actorPermissions: new Set(["ENQUIRY_VIEW"]), actorTier: "SOURCING_OPS_ADMIN" }).refusal ===
      "ACTOR_NOT_PERMITTED",
    JSON.stringify(grantCase({ actorPermissions: new Set(["ENQUIRY_VIEW"]), actorTier: "SOURCING_OPS_ADMIN" })),
  );
  check(
    "self-grant is refused even for a permission the actor holds",
    grantCase({ target: { ...goodTarget, profileId: PROFILE } }).refusal === "SELF_TARGET",
    "a self-grant was permitted",
  );
  check(
    "the transitive ceiling refuses a permission the actor does not hold",
    grantCase({
      actorPermissions: new Set(["ENQUIRY_VIEW", "ACCESS_GRANT_PERMISSION"]),
      actorTier: "SOURCING_OPS_ADMIN",
      request: { permission: "DATABASE_APPLY_MIGRATION", effect: "GRANT", reason: "x", eventId: "e" },
    }).refusal === "NON_DELEGABLE",
    "a non-delegable grant was attempted by a non-super tier",
  );
  check(
    "the ceiling refuses a permission the actor does not hold",
    grantCase({
      actorPermissions: new Set(["ENQUIRY_VIEW", "ACCESS_GRANT_PERMISSION"]),
      actorTier: "SOURCING_OPS_ADMIN",
      request: { permission: "CATALOGUE_EDIT", effect: "GRANT", reason: "x", eventId: "e" },
    }).refusal === "CEILING_EXCEEDED",
    "escalation beyond the ceiling was permitted",
  );
  check(
    "a non-super tier holding a non-delegable permission still cannot grant it",
    grantCase({
      actorPermissions: new Set([...ADMIN_PERMISSIONS]),
      actorTier: "SOURCING_OPS_ADMIN",
      request: { permission: "DATABASE_APPLY_MIGRATION", effect: "GRANT", reason: "x", eventId: "e" },
    }).refusal === "NON_DELEGABLE",
    "a non-super tier granted a non-delegable permission",
  );
  check(
    "a target that is not active is refused",
    grantCase({ target: { ...goodTarget, isActive: false } }).refusal === "TARGET_NOT_ACTIVE",
    "an inactive profile was allowed to receive a grant",
  );
  check(
    "a non-super actor cannot alter a super admin's access",
    grantCase({ actorTier: "CATALOGUE_MANAGER", target: { ...goodTarget, tier: "SUPER_ADMIN" } }).refusal ===
      "TARGET_IS_SUPER_ADMIN",
    "super-admin protection was bypassed",
  );
  check(
    "a super admin may alter another super admin's access",
    grantCase({ target: { ...goodTarget, tier: "SUPER_ADMIN" } }).allowed === true,
    "super admin could not grant to a peer",
  );
  check(
    "an anonymous grant (no reason, no expiry) is refused",
    grantCase({ request: { permission: "CATALOGUE_EDIT", effect: "GRANT", eventId: "e" } }).refusal ===
      "NO_REASON_OR_EXPIRY",
    "an unattributed grant was permitted",
  );
  check(
    "a blank reason is not a reason",
    grantCase({ request: { permission: "CATALOGUE_EDIT", effect: "GRANT", reason: "   ", eventId: "e" } }).refusal ===
      "NO_REASON_OR_EXPIRY",
    "whitespace passed as a reason",
  );
  check(
    "an expiry in the past is refused as inert on arrival",
    grantCase({
      request: { permission: "CATALOGUE_EDIT", effect: "GRANT", expiresAt: day(-1), eventId: "e" },
    }).refusal === "EXPIRY_NOT_IN_FUTURE",
    "an already-expired grant was accepted",
  );
  check(
    "a request without an eventId is refused (retry safety)",
    grantCase({ request: { permission: "CATALOGUE_EDIT", effect: "GRANT", reason: "x" } }).refusal ===
      "EVENT_ID_REQUIRED",
    "an unidentifiable event was accepted",
  );
  check(
    "an invented permission is refused before any rule runs",
    grantCase({ request: { permission: "TOTAL_CONTROL", effect: "GRANT", reason: "x", eventId: "e" } }).refusal ===
      "UNKNOWN_PERMISSION",
    "an invented permission reached the rules",
  );
  check(
    "an invented effect is refused",
    grantCase({ request: { permission: "CATALOGUE_EDIT", effect: "OWN", reason: "x", eventId: "e" } }).refusal ===
      "UNKNOWN_EFFECT",
    "an invented effect reached the rules",
  );
  check(
    "the commercial desk's tier default confers no delegation right at all",
    mayGrant({
      ...opsActor,
      target: goodTarget,
      request: { permission: "ENQUIRY_VIEW", effect: "GRANT", reason: "cover", eventId: "e" },
      now: NOW,
    }).refusal === "ACTOR_NOT_PERMITTED",
    "a tier without ACCESS_GRANT_PERMISSION delegated successfully",
  );
  check(
    "an admin granted ACCESS_GRANT_PERMISSION can delegate within their ceiling",
    mayGrant({
      actorPermissions: new Set(["ACCESS_GRANT_PERMISSION", "ENQUIRY_VIEW"]),
      actorProfileId: PROFILE,
      actorTier: "SOURCING_OPS_ADMIN",
      target: goodTarget,
      request: { permission: "ENQUIRY_VIEW", effect: "GRANT", reason: "cover", eventId: "e" },
      now: NOW,
    }).allowed === true,
    "an in-ceiling delegation was refused",
  );

  process.stdout.write("\n6. Lockout guard\n");
  check(
    "denying the last super admin's ACCESS_GRANT_PERMISSION is refused by the guard",
    wouldLockOutSuperAdmins({
      target: { ...goodTarget, tier: "SUPER_ADMIN" },
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "DENY",
      remainingHolders: 0,
    }) === true,
    "the guard did not fire",
  );
  check(
    "the guard does not fire while another super admin still holds it",
    wouldLockOutSuperAdmins({
      target: { ...goodTarget, tier: "SUPER_ADMIN" },
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "DENY",
      remainingHolders: 1,
    }) === false,
    "the guard fired with a holder remaining",
  );
  check(
    "the guard ignores a REVOKE (it returns such an admin to the tier default, which grants it)",
    wouldLockOutSuperAdmins({
      target: { ...goodTarget, tier: "SUPER_ADMIN" },
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "REVOKE",
      remainingHolders: 0,
    }) === false,
    "a REVOKE was treated as a lockout",
  );
  check(
    "the guard ignores permissions other than ACCESS_GRANT_PERMISSION",
    wouldLockOutSuperAdmins({
      target: { ...goodTarget, tier: "SUPER_ADMIN" },
      permission: "AUDIT_EXPORT",
      effect: "DENY",
      remainingHolders: 0,
    }) === false,
    "an unrelated permission triggered the lockout guard",
  );

  // =========================================================================
  // 7. Append-only privilege model
  // =========================================================================
  process.stdout.write("\n7. The log cannot be rewritten\n");
  {
    const roles = buildRoleDefinitions();
    const collectionName = adminPermissionGrant.name;
    const mutating = [];
    for (const role of roles) {
      for (const privilege of role.privileges ?? []) {
        const actions = (privilege.actions ?? []).map((a) => String(a).toLowerCase());
        const resource = privilege.resource?.collection ?? privilege.resource ?? "";
        const touches =
          resource === collectionName || resource === "" || resource === undefined || resource === "*";
        if (touches && actions.some((a) => a === "update" || a === "delete" || a === "drop" || a === "*")) {
          mutating.push(`${role.role}: ${actions.join(",")}`);
        }
      }
    }
    check(
      `no role holds update, delete or drop on ${collectionName}`,
      mutating.length === 0,
      mutating.join("; "),
    );
    check(
      `${collectionName} is declared append-only in its definition`,
      adminPermissionGrant.immutable === true,
      "the collection is not marked immutable",
    );
  }

  // =========================================================================
  // 8. Real mongod: the validator, the constraints and the store
  // =========================================================================
  process.stdout.write("\n8. Real MongoDB — validator, constraints, store\n");

  if (UNIT_ONLY) {
    process.stdout.write("  (unit-only run: the integration section was not executed)\n");
    return summary();
  }

  let MongoMemoryReplSet;
  let MongoClient;
  let store;
  try {
    ({ MongoMemoryReplSet } = await import("mongodb-memory-server"));
    ({ MongoClient } = await import("mongodb"));
    store = await import("../src/lib/permissions/store.ts");
  } catch (error) {
    if (UNIT_ONLY) {
      process.stdout.write("  (unit-only run: integration section skipped)\n");
      return summary();
    }
    fail("the integration dependencies load", String(error?.message ?? error));
    return summary();
  }

  let server;
  try {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
      binary: { version: "7.0.14" },
    });
  } catch (error) {
    process.stdout.write(`  ! could not start mongod: ${String(error?.message ?? error).slice(0, 160)}\n`);
    fail("a real mongod is available for the integration section");
    return summary();
  }

  const client = new MongoClient(server.getUri());
  await client.connect();
  const db = client.db("primemet_permissions");

  try {
    const plan = plansFor(adminPermissionGrant);
    await db.createCollection(plan.name, {
      validator: plan.validator,
      validationLevel: "strict",
      validationAction: "error",
    });
    await db.collection(plan.name).createIndexes(plan.indexes);
    ok(`the ${plan.name} validator and ${plan.indexes.length} indexes were created from the definition`);

    // C3: the continuity guard is infrastructure, seeded by migration v003. Created here from the same
    // definition the migration uses, so the suite exercises the real validator rather than a stub.
    await ensurePermissionGuards(db, { now: NOW });
    const seededGuard = await db.collection(GUARDS).findOne({ _id: GUARD_LAST_SUPER_ADMIN });
    ok(`the ${GUARDS} guard document is seeded with fence=${seededGuard?.fence}`);

    // `seq` is BSON long by contract, so every fixture states it as a Long: a plain JS number is encoded
    // as int32 by the driver and the validator correctly refuses it.
    const base = (over = {}) => {
      const doc = {
        _id: randomUUID(),
        adminId: PROFILE,
        permission: "ENQUIRY_VIEW",
        effect: "GRANT",
        seq: 1,
        eventId: `e-${randomUUID()}`,
        // grantedById is a reference to users._id, so it must be a UUID like every other reference.
        grantedById: "99999999-9999-4999-8999-999999999999",
        reason: "fixture",
        expiresAt: null,
        createdAt: day(-1),
        ...over,
      };
      doc.seq = Long.fromNumber(Number(doc.seq));
      return doc;
    };
    const insert = (doc) => db.collection(plan.name).insertOne(doc);

    for (const effect of ["GRANT", "DENY", "REVOKE"]) {
      try {
        await insert(base({ effect, seq: { GRANT: 101, DENY: 102, REVOKE: 103 }[effect] }));
        ok(`the validator accepts effect=${effect}`);
      } catch (error) {
        fail(`the validator accepts effect=${effect}`, String(error?.message ?? error).slice(0, 200));
      }
    }

    await expectReject(
      "an unsupported effect is refused by the database",
      () => insert(base({ effect: "OWN", seq: 201 })),
      /validation|121/i,
    );
    await expectReject(
      "a blank reason is refused by the database",
      () => insert(base({ reason: "   ", seq: 202 })),
      /validation|121/i,
    );
    await expectReject(
      "a negative sequence number is refused by the database",
      () => insert(base({ seq: -1 })),
      /validation|121/i,
    );
    await expectReject(
      "an expiry before the event instant is refused by the database",
      () => insert(base({ seq: 203, expiresAt: day(-5) })),
      /validation|121/i,
    );
    await expectReject(
      "a permission outside the enum is refused by the database",
      () => insert(base({ permission: "TOTAL_CONTROL", seq: 204 })),
      /validation|121/i,
    );
    await expectReject(
      "an extra field is refused (the shape is closed)",
      () => insert({ ...base({ seq: 205 }), sneaky: true }),
      /validation|121/i,
    );
    await expectReject(
      "a repeated eventId for the same admin is refused (idempotency key)",
      () => insert({ ...base({ seq: 206 }), eventId: "fixed-event" }).then((r) => insert(base({ seq: 207, eventId: "fixed-event" })).then(() => r)),
      /duplicate|11000/i,
    );
    await expectReject(
      "a repeated sequence number for the same admin is refused (total order)",
      () => insert(base({ seq: 300 })).then(() => insert(base({ seq: 300 }))),
      /duplicate|11000/i,
    );

    // ---- the store, against the real validator -------------------------
    const superUser = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const superProfile = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const opsUser = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const opsProfile = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const orgId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

    await db.collection("organisations").insertMany([
      { _id: orgId, orgKind: "PRIMEMET", orgType: "BOTH", accountStatus: "ACTIVE", createdAt: NOW, updatedAt: NOW },
    ]);
    // F1: there is no marker fallback any more, so the world must carry the protected pointer that names
    // the operator organisation. Seeded through the migration helper, which also asserts the organisation
    // is a live PRIMEMET one. The admins below claim `organisationId: orgId`, which F2 requires to AGREE.
    await ensurePlatformIdentityCollection(db, { now: NOW, organisationId: orgId });
    await db.collection("users").insertMany([
      { _id: superUser, email: "super@example.test", role: "ADMIN", status: "ACTIVE", fullName: "Super", locale: "en-IN", mfaEnabled: false, failedLoginCount: 0, deletedAt: null, organisationId: orgId, createdAt: NOW, updatedAt: NOW },
      { _id: opsUser, email: "ops@example.test", role: "ADMIN", status: "ACTIVE", fullName: "Ops", locale: "en-IN", mfaEnabled: false, failedLoginCount: 0, deletedAt: null, organisationId: orgId, createdAt: NOW, updatedAt: NOW },
    ]);
    await db.collection("admin_profiles").insertMany([
      { _id: superProfile, userId: superUser, staffCode: "S-1", tier: "SUPER_ADMIN", mfaRequired: true, isActive: true, createdAt: NOW, updatedAt: NOW },
      { _id: opsProfile, userId: opsUser, staffCode: "O-1", tier: "SOURCING_OPS_ADMIN", mfaRequired: true, isActive: true, createdAt: NOW, updatedAt: NOW },
    ]);

    const superResolved = await store.resolveActorPermissions(db, superUser, NOW);
    check(
      "a super admin resolves to all 74 permissions from the tier default alone",
      superResolved.permissions.size === 74,
      `${superResolved.permissions.size}`,
    );
    const opsResolved = await store.resolveActorPermissions(db, opsUser, NOW);
    check(
      "a sourcing ops admin resolves to the 45 tier defaults",
      opsResolved.permissions.size === 45,
      `${opsResolved.permissions.size}`,
    );

    // The users collection has no organisationId column: the platform organisation is what governs staff.
    await db.collection("users").updateOne({ _id: opsUser }, { $unset: { organisationId: "" } });
    const withoutOrgColumn = await store.resolveActorPermissions(db, opsUser, NOW);
    check(
      "a staff member resolves through the platform organisation when users has no organisationId",
      withoutOrgColumn.permissions.size === 45 && withoutOrgColumn.deniedAt === null,
      `${withoutOrgColumn.permissions.size} permissions, deniedAt=${withoutOrgColumn.deniedAt}`,
    );

    const target = { profileId: opsProfile, isActive: true, userIsActive: true, tier: "SOURCING_OPS_ADMIN" };

    const firstAppend = await store.appendPermissionEvent(db, {
      actorUserId: superUser,
      target,
      permission: "CATALOGUE_EDIT",
      effect: "GRANT",
      reason: "catalogue cover for Diwali",
      eventId: "evt-grant-1",
      now: day(-1),
    });
    check(
      "a super admin can append a GRANT through the store",
      firstAppend.ok === true && firstAppend.seq === 1,
      JSON.stringify(firstAppend),
    );

    const retry = await store.appendPermissionEvent(db, {
      actorUserId: superUser,
      target,
      permission: "CATALOGUE_EDIT",
      effect: "GRANT",
      reason: "catalogue cover for Diwali",
      eventId: "evt-grant-1",
      now: day(-1),
    });
    check(
      "a retried request is a no-op, not a second row",
      retry.ok === true && retry.seq_idempotent === true,
      JSON.stringify(retry),
    );
    const rowCount = await db.collection(plan.name).countDocuments({ adminId: opsProfile, eventId: "evt-grant-1" });
    check("the retry left exactly one row", rowCount === 1, `${rowCount}`);

    const afterGrant = await store.resolveActorPermissions(db, opsUser, NOW);
    check(
      "the appended GRANT takes effect on the next resolution",
      afterGrant.permissions.has("CATALOGUE_EDIT"),
      "the grant did not apply",
    );

    const forged = await store.appendPermissionEvent(db, {
      actorUserId: opsUser,
      target,
      permission: "DATABASE_APPLY_MIGRATION",
      effect: "GRANT",
      reason: "forged payload",
      eventId: "evt-forged-1",
      now: NOW,
    });
    check(
      "a low-privilege actor cannot grant a permission they do not hold (forged body ignored)",
      forged.ok === false && ["ACTOR_NOT_PERMITTED", "CEILING_EXCEEDED", "NON_DELEGABLE"].includes(forged.refusal),
      JSON.stringify(forged),
    );

    // ---- concurrency ---------------------------------------------------
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.appendPermissionEvent(db, {
          actorUserId: superUser,
          target,
          permission: "REPORT_VIEW",
          effect: i % 2 === 0 ? "GRANT" : "DENY",
          reason: `concurrent ${i}`,
          eventId: `evt-concurrent-${i}`,
          now: day(-1),
        }),
      ),
    );
    const written = concurrent.filter((r) => r.ok).length;
    check("10 concurrent appends all succeed", written === 10, `${written}/10`);
    const seqs = (
      await db.collection(plan.name).find({ adminId: opsProfile, eventId: /^evt-concurrent-/ }).toArray()
    ).map((r) => Number(r.seq));
    check(
      "concurrent appends produced distinct sequence numbers",
      new Set(seqs).size === seqs.length,
      JSON.stringify(seqs),
    );
    const deterministic = resolveAdminPermissions(
      actor({ profile: { id: opsProfile, tier: "SOURCING_OPS_ADMIN" } }),
      await store.readPermissionEvents(db, opsProfile, NOW),
      NOW,
    );
    const reversed = resolveAdminPermissions(
      actor({ profile: { id: opsProfile, tier: "SOURCING_OPS_ADMIN" } }),
      (await store.readPermissionEvents(db, opsProfile, NOW)).reverse(),
      NOW,
    );
    check(
      "the same log resolves identically whatever order the rows arrive in",
      deterministic.allowed.size === reversed.allowed.size &&
        [...deterministic.allowed].every((p) => reversed.allowed.has(p)),
      `${deterministic.allowed.size} vs ${reversed.allowed.size}`,
    );

    // ---- REVOKE through the real validator restores the tier default ----
    const revoke = await store.appendPermissionEvent(db, {
      actorUserId: superUser,
      target,
      permission: "CATALOGUE_EDIT",
      effect: "REVOKE",
      reason: "catalogue cover ended",
      eventId: "evt-revoke-1",
      now: NOW,
    });
    check("a REVOKE can be appended (the D-ARCH-12 fix, end to end)", revoke.ok === true, JSON.stringify(revoke));
    const afterRevoke = await store.resolveActorPermissions(db, opsUser, NOW);
    const revokeDecision = afterRevoke.decisions.get("CATALOGUE_EDIT");
    check(
      "the REVOKE removed the explicit grant and restored the tier default",
      !afterRevoke.permissions.has("CATALOGUE_EDIT") &&
        revokeDecision.effect === "REVOKE" &&
        revokeDecision.decidedBy === "TIER_DEFAULT",
      JSON.stringify(revokeDecision),
    );

    // ---- the guard against locking out the last super admin -------------
    const lockout = await store.appendPermissionEvent(db, {
      actorUserId: superUser,
      target: { profileId: superProfile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" },
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "DENY",
      reason: "attempted self-lockout",
      eventId: "evt-lockout-1",
      now: NOW,
    });
    check(
      "a super admin cannot deny their own kind the way back in",
      lockout.ok === false && ["SELF_TARGET", "NON_DELEGABLE"].includes(lockout.refusal),
      JSON.stringify(lockout),
    );

    // ---- C2: an idempotency key may not carry a different request ----
    const conflictingRetry = await store.appendPermissionEvent(db, {
      actorUserId: superUser,
      target,
      permission: "CATALOGUE_EDIT",
      effect: "DENY",
      reason: "a different request reusing the key",
      eventId: "evt-grant-1",
      now: day(-1),
    });
    check(
      "a repeated eventId with a different payload is refused, not reported as applied",
      conflictingRetry.ok === false && conflictingRetry.refusal === "EVENT_ID_CONFLICT",
      JSON.stringify(conflictingRetry),
    );
    const stillOne = await db.collection(plan.name).countDocuments({ adminId: opsProfile, eventId: "evt-grant-1" });
    check("the conflicting request wrote nothing", stillOne === 1, `${stillOne} rows`);
    const storedGrant = await db.collection(plan.name).findOne({ adminId: opsProfile, eventId: "evt-grant-1" });
    check(
      "the conflicting request did not rewrite the stored effect",
      storedGrant?.effect === "GRANT",
      JSON.stringify(storedGrant?.effect),
    );

    // ---- C3: the continuity guard actually guards ----
    const secondSuperUser = "12121212-1212-4212-8212-121212121212";
    const secondSuperProfile = "34343434-3434-4434-8434-343434343434";
    const secondTarget = {
      profileId: secondSuperProfile,
      isActive: true,
      userIsActive: true,
      tier: "SUPER_ADMIN",
    };
    await db.collection("users").insertOne({
      _id: secondSuperUser,
      email: "super2@example.test",
      role: "ADMIN",
      status: "ACTIVE",
      fullName: "Super Two",
      locale: "en-IN",
      mfaEnabled: false,
      failedLoginCount: 0,
      deletedAt: null,
      organisationId: orgId,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.collection("admin_profiles").insertOne({
      _id: secondSuperProfile,
      userId: secondSuperUser,
      staffCode: "S-2",
      tier: "SUPER_ADMIN",
      mfaRequired: true,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });

    // A guard that is missing must refuse, never permit. Deleting the seed document is exactly the
    // state a deployment that skipped migration v003 is in.
    await db.collection(GUARDS).deleteOne({ _id: GUARD_LAST_SUPER_ADMIN });
    const unguarded = await store.appendPermissionEvent(db, {
      actorUserId: superUser,
      target: secondTarget,
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "DENY",
      reason: "attempt while the guard document is absent",
      eventId: "evt-no-guard-1",
      now: day(-1),
    });
    check(
      "a missing guard document refuses the change instead of proceeding unguarded",
      unguarded.ok === false && unguarded.refusal === "GUARD_UNAVAILABLE",
      JSON.stringify(unguarded),
    );
    check(
      "the refused change wrote no event",
      (await db.collection(plan.name).countDocuments({ eventId: "evt-no-guard-1" })) === 0,
      "an event was appended without the guard",
    );
    await ensurePermissionGuards(db, { now: NOW });

    const cross = await store.appendPermissionEvent(db, {
      actorUserId: superUser,
      target: secondTarget,
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "DENY",
      reason: "cross denial while one other holder remains",
      eventId: "evt-cross-1",
      now: day(-1),
    });
    check(
      "a super admin may deny another super admin while another holder remains",
      cross.ok === true,
      JSON.stringify(cross),
    );

    const afterCross = await store.appendPermissionEvent(db, {
      actorUserId: secondSuperUser,
      target: { profileId: superProfile, isActive: true, userIsActive: true, tier: "SUPER_ADMIN" },
      permission: "ACCESS_GRANT_PERMISSION",
      effect: "DENY",
      reason: "the denied super admin tries to deny the last holder",
      eventId: "evt-cross-2",
      now: NOW,
    });
    check(
      "a super admin who has been denied can no longer write an access event",
      afterCross.ok === false && afterCross.refusal === "ACTOR_NOT_PERMITTED",
      JSON.stringify(afterCross),
    );

    // ---- C3: the same invariant on the profile path (deactivation and demotion) ----
    const selfDeactivate = await store.setAdminProfileAccess(db, {
      actorUserId: superUser,
      profileId: superProfile,
      isActive: false,
      now: NOW,
    });
    check(
      "deactivating the last super admin is refused by the continuity guard",
      selfDeactivate.ok === false && selfDeactivate.refusal === "LAST_SUPER_ADMIN",
      JSON.stringify(selfDeactivate),
    );
    const selfDemote = await store.setAdminProfileAccess(db, {
      actorUserId: superUser,
      profileId: superProfile,
      tier: "SOURCING_OPS_ADMIN",
      now: NOW,
    });
    check(
      "demoting the last super admin is refused by the same guard",
      selfDemote.ok === false && selfDemote.refusal === "LAST_SUPER_ADMIN",
      JSON.stringify(selfDemote),
    );
    const lastHolderStillActive = await db
      .collection("admin_profiles")
      .findOne({ _id: superProfile }, { projection: { isActive: 1, tier: 1 } });
    check(
      "the refused changes left the last super admin untouched",
      lastHolderStillActive?.isActive === true && lastHolderStillActive?.tier === "SUPER_ADMIN",
      JSON.stringify(lastHolderStillActive),
    );

    const reactivate = await store.setAdminProfileAccess(db, {
      actorUserId: superUser,
      profileId: secondSuperProfile,
      isActive: true,
      now: NOW,
    });
    check("reactivating an admin is not a removal and is not blocked", reactivate.ok === true, JSON.stringify(reactivate));
    const deactivateOne = await store.setAdminProfileAccess(db, {
      actorUserId: superUser,
      profileId: secondSuperProfile,
      isActive: false,
      now: NOW,
    });
    check(
      "deactivating a super admin is allowed while another holder remains",
      deactivateOne.ok === true,
      JSON.stringify(deactivateOne),
    );
  } finally {
    await client.close();
    await server.stop();
  }

  return summary();
}

function summary() {
  process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const f of failures) process.stdout.write(`  \u2716 ${f}\n`);
    process.exit(1);
  }
  process.exit(0);
}

await main();