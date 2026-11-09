#!/usr/bin/env node
/**
 * PRIMEMET — one-time bootstrap of the platform organisation and the first SUPER_ADMIN.
 *
 * WHY THIS EXISTS. Admin authorization cannot work without the platform organisation: `loadAdminActor`
 * resolves the staff member's organisation, and `resolve.ts` refuses every permission when it is absent
 * (NO_ORGANISATION). So the first deployment has a circular dependency — the operator identity is needed
 * before the operator can grant anything, and no route may create it without authentication.
 *
 * This CLI is the deliberate exception. It is a one-time, owner-run, out-of-band procedure: not a route,
 * not a seed, not a default account. Nothing under `src/` imports it, so it cannot be reached over HTTP.
 *
 * WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE
 *
 *   organisations        insert-or-verify. A differing legalName/countryCode aborts with both values
 *                        printed; more than one live PRIMEMET row aborts. Never overwritten.
 *   users                one ADMIN, ACTIVE, with a scrypt hash produced by the application's own
 *                        `hashPassword` — the same function the login route verifies against.
 *   admin_profiles       one SUPER_ADMIN, isActive: true.
 *   audit_logs           one CRITICAL row per object, sharing a requestId, so the run is one event.
 *   _platform_identity   seeded through `ensurePlatformIdentityCollection`, which is idempotent and
 *                        refuses to move an existing anchor. Without this the created admin resolves to
 *                        NO_ORGANISATION and every permission is refused.
 *   _permission_guards   NEVER touched. The first super admin holds ACCESS_GRANT_PERMISSION from the
 *                        tier default, which is evaluated, not stored.
 *
 * DEVIATION FROM docs/PRIMEMET_ORGANISATION_BOOTSTRAP.md §2.2 step 3, BY OWNER DECISION. The design
 * created the user as INVITED with no passwordHash, so the bootstrap could never mint a usable
 * credential. The approved decision is the opposite: the operator supplies a password (hidden prompt) or
 * has one generated, and the account is created ACTIVE so the first login is possible. The design's
 * concern — "a bootstrap-chosen password is a shared secret" — is answered by never defaulting: there is
 * no fallback value, the password is never written to the audit log, and a generated one is shown once.
 *
 *   node db/bootstrap-organisation.mjs --legal-name "..." --country-code IN \
 *        --admin-email <address> --admin-name "..." --staff-code PM-0001 --confirm "..."
 *        (dry run: prints the plan, writes nothing)
 *
 *   ... --apply            write it (needs owner credentials and PRIMEMET_ENV)
 *   ... --apply --generate generate a strong password instead of prompting
 *
 * EXIT CODES. 0 applied or verified · 1 refused, nothing changed · 2 usage error · 3 PARTIAL COMPLETION
 * — the business documents committed but the protected pointer did not, so the account exists and cannot
 * sign in yet. Re-run the same command to repair it; nothing is duplicated.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { MongoClient } from "mongodb";

import { checkTarget } from "../scripts/db-guard.mjs";
import { hashPassword, passwordProblem } from "../src/lib/auth/password.ts";
import {
  ensurePlatformIdentityCollection,
  GUARD_PLATFORM_IDENTITY,
  PLATFORM_IDENTITY_COLLECTION,
} from "./guards.mjs";

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
/** The business documents committed but the protected pointer did not. Re-running repairs it. */
const EXIT_PARTIAL = 3;

/**
 * The process exit code for a failure.
 *
 * A partial completion must never share a code with a refusal. "Nothing was changed" tells an operator to
 * fix a precondition; "the account exists but cannot sign in" tells them to re-run. Collapsing the two
 * into one code is how a scripted deployment deletes a working account and starts again.
 */
export function exitCodeFor(error) {
  return error instanceof BootstrapError && error.partial === true ? EXIT_PARTIAL : EXIT_REFUSED;
}

/** The roles that may run a bootstrap. `primemet_app` is never one of them. */
const OWNER_ROLES = ["primemet_owner", "root", "atlasAdmin"];

/** The role the runtime identity holds. Its presence is a finding, not a shortcut. */
const RUNTIME_ROLE = "primemet_app";

/**
 * A refusal with a stable code, so a test can assert the reason rather than the prose.
 *
 * Every message names the fix, because the operator reading it is mid-deployment and has one attempt
 * before they start guessing.
 */
export class BootstrapError extends Error {
  constructor(code, message, { partial = false, requestId = null } = {}) {
    super(message);
    this.name = "BootstrapError";
    this.code = code;
    // A partial completion is not a refusal: the business documents are already committed. The flag is
    // what lets the CLI report that honestly and exit with a code a script can tell apart from "nothing
    // was changed".
    this.partial = partial;
    this.requestId = requestId;
  }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/**
 * Parse the command line. Pure: no I/O, no environment, so a test can drive every branch.
 *
 * `--admin-email` has no default and no fallback anywhere in the repository — that is the whole point
 * of the design. `--confirm` must equal `--legal-name`, so a mis-pasted command fails before it writes.
 */
export function parseBootstrapArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      apply: { type: "boolean", default: false },
      generate: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      "legal-name": { type: "string" },
      "country-code": { type: "string" },
      "admin-email": { type: "string" },
      "admin-name": { type: "string" },
      "staff-code": { type: "string" },
      confirm: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    apply: values.apply === true,
    generate: values.generate === true,
    help: values.help === true,
    legalName: values["legal-name"],
    countryCode: values["country-code"],
    adminEmail: values["admin-email"],
    adminName: values["admin-name"],
    staffCode: values["staff-code"],
    confirm: values.confirm,
  };
}

/**
 * Refuse an incomplete or contradictory command line.
 *
 * Every field here is an identity the operator must state. None is derived, defaulted or guessed: a
 * bootstrap that invents the operator's legal name is how an invoice ends up under the wrong entity.
 */
export function validateBootstrapArgs(args) {
  const missing = [];
  if (!args.legalName) missing.push("--legal-name");
  if (!args.countryCode) missing.push("--country-code");
  if (!args.adminEmail) missing.push("--admin-email");
  if (!args.adminName) missing.push("--admin-name");
  if (!args.staffCode) missing.push("--staff-code");
  if (!args.confirm) missing.push("--confirm");
  if (missing.length > 0) {
    throw new BootstrapError(
      "BOOTSTRAP_MISSING_ARGUMENT",
      "missing required argument(s): " + missing.join(", ") + ". Nothing was changed.",
    );
  }

  if (args.confirm !== args.legalName) {
    throw new BootstrapError(
      "BOOTSTRAP_CONFIRM_MISMATCH",
      '--confirm must equal --legal-name exactly. Got --confirm "' + args.confirm +
        '" against --legal-name "' + args.legalName + '". Nothing was changed.',
    );
  }

  if (!/^[A-Za-z]{2}$/.test(args.countryCode)) {
    throw new BootstrapError(
      "BOOTSTRAP_INVALID_COUNTRY",
      "--country-code must be a two-letter ISO-3166 alpha-2 code, got \"" + args.countryCode + "\".",
    );
  }

  // The users validator refuses a non-lower-case address, so normalise here rather than letting the
  // database reject it after the organisation has already been written.
  const email = args.adminEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new BootstrapError(
      "BOOTSTRAP_INVALID_EMAIL",
      "--admin-email is not a usable address. Nothing was changed.",
    );
  }

  if (args.staffCode.length > 40) {
    throw new BootstrapError("BOOTSTRAP_INVALID_STAFF_CODE", "--staff-code must be at most 40 characters.");
  }

  return { ...args, adminEmail: email, countryCode: args.countryCode.toUpperCase() };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Refuse to run under anything but an owner identity.
 *
 * A bootstrap run with application credentials is a finding, not a shortcut: the whole point of the
 * owner/app split is that the runtime identity cannot create the organisation, the first user or the
 * first admin profile. `primemet_app` is checked first and named explicitly, because "you are not an
 * owner" is a much less useful message than "you are the runtime identity".
 */
export async function assertOwnerIdentity(db) {
  const status = await db.command({ connectionStatus: 1 });
  const roles = (status?.authInfo?.authenticatedUserRoles ?? []).map((role) => role.role);

  if (roles.includes(RUNTIME_ROLE)) {
    throw new BootstrapError(
      "BOOTSTRAP_APP_IDENTITY",
      "the connected identity holds " + RUNTIME_ROLE + ", which is the application runtime role. " +
        "The bootstrap must run with owner credentials. Nothing was changed.",
    );
  }

  const owner = roles.filter((role) => OWNER_ROLES.includes(role));
  if (owner.length === 0) {
    throw new BootstrapError(
      "BOOTSTRAP_NOT_OWNER",
      "the connected identity holds no owner role (" + OWNER_ROLES.join(", ") + "). " +
        "Observed roles: " + (roles.join(", ") || "none") + ". Nothing was changed.",
    );
  }

  return { roles, owner };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Read the current state and decide what would be written. Writes nothing.
 *
 * This is the whole safety story: every refusal below happens before a single document is touched, and
 * the dry run prints exactly this plan. A second run with identical arguments produces a plan of
 * `verify` actions and therefore zero inserts.
 */
export async function planBootstrap(db, args) {
  const now = new Date();

  // --- the platform organisation -------------------------------------------------
  const live = await db
    .collection("organisations")
    .find({ orgKind: "PRIMEMET", deletedAt: null }, { projection: { _id: 1, legalName: 1, countryCode: 1 } })
    .limit(2)
    .toArray();

  if (live.length > 1) {
    throw new BootstrapError(
      "BOOTSTRAP_AMBIGUOUS_ORGANISATION",
      live.length + " live organisations carry orgKind \"PRIMEMET\" (" +
        live.map((row) => row._id).join(", ") + "). The partial unique index should have prevented " +
        "this, so the database needs a human before anything else is written. Nothing was changed.",
    );
  }

  let organisation;
  if (live.length === 0) {
    organisation = { action: "insert", id: randomUUID() };
  } else {
    const existing = live[0];
    if (existing.legalName !== args.legalName || existing.countryCode !== args.countryCode) {
      throw new BootstrapError(
        "BOOTSTRAP_ORGANISATION_MISMATCH",
        "a platform organisation already exists and does not match the supplied identity.\n" +
          "          existing  legalName=\"" + existing.legalName + "\"  countryCode=\"" + existing.countryCode + "\"\n" +
          "          supplied  legalName=\"" + args.legalName + "\"  countryCode=\"" + args.countryCode + "\"\n" +
          "          Silently rewriting the operator's legal identity is how an invoice ends up under the\n" +
          "          wrong entity. Nothing was changed.",
      );
    }
    organisation = { action: "verify", id: existing._id };
  }

  // --- the first admin user ------------------------------------------------------
  const existingUser = await db
    .collection("users")
    .findOne({ email: args.adminEmail }, { projection: { _id: 1, role: 1, status: 1 } });

  let user;
  if (!existingUser) {
    user = { action: "insert", id: randomUUID() };
  } else {
    if (existingUser.role !== "ADMIN") {
      throw new BootstrapError(
        "BOOTSTRAP_USER_ROLE_CONFLICT",
        "users/" + existingUser._id + " already exists for " + args.adminEmail + ' with role "' +
          existingUser.role + '". An email is one identity; use a different address for the operator. ' +
          "Nothing was changed.",
      );
    }
    if (existingUser.status !== "ACTIVE") {
      throw new BootstrapError(
        "BOOTSTRAP_USER_STATUS_CONFLICT",
        "users/" + existingUser._id + " exists for " + args.adminEmail + ' with status "' +
          existingUser.status + '". Activate or remove it deliberately before bootstrapping. ' +
          "Nothing was changed.",
      );
    }
    user = { action: "verify", id: existingUser._id };
  }

  // --- the admin profile ---------------------------------------------------------
  const existingProfile = await db
    .collection("admin_profiles")
    .findOne({ userId: user.id }, { projection: { _id: 1, tier: 1, isActive: 1 } });

  let profile;
  if (!existingProfile) {
    profile = { action: "insert", id: randomUUID() };
  } else {
    if (existingProfile.tier !== "SUPER_ADMIN") {
      throw new BootstrapError(
        "BOOTSTRAP_PROFILE_TIER_CONFLICT",
        "admin_profiles/" + existingProfile._id + ' already exists for this user with tier "' +
          existingProfile.tier + '". The operator has to look at why an admin profile already exists. ' +
          "Nothing was changed.",
      );
    }
    profile = { action: "verify", id: existingProfile._id };
  }

  // --- provenance: an existing account is only ours if a bootstrap created it --------------------
  // The audit row is written in the SAME transaction as the object it describes, so its presence is a
  // durable record of origin. Without this check a partial state could silently promote an ADMIN user
  // that some other procedure created — the one thing a bootstrap must never do. The checks run after
  // the role, status and tier refusals so those keep their more specific messages.
  if (user.action === "verify") {
    const origin = await db
      .collection("audit_logs")
      .findOne({ action: "BOOTSTRAP_ADMIN_USER", entityId: user.id }, { projection: { _id: 1 } });
    if (!origin) {
      throw new BootstrapError(
        "BOOTSTRAP_USER_NOT_BOOTSTRAP_ORIGIN",
        "users/" + user.id + " already exists for " + args.adminEmail + " as an ADMIN, but no bootstrap " +
          "recorded creating it. Adopting an account this command did not create is not a recovery, it is " +
          "a silent grant of SUPER_ADMIN.\n" +
          "          Use a different --admin-email for the operator, or investigate how that account was made.\n" +
          "          Nothing was changed.",
      );
    }
  }

  if (profile.action === "verify") {
    const origin = await db
      .collection("audit_logs")
      .findOne({ action: "BOOTSTRAP_ADMIN_PROFILE", entityId: profile.id }, { projection: { _id: 1 } });
    if (!origin) {
      throw new BootstrapError(
        "BOOTSTRAP_PROFILE_NOT_BOOTSTRAP_ORIGIN",
        "admin_profiles/" + profile.id + " already exists for this user as SUPER_ADMIN, but no bootstrap " +
          "recorded creating it. Nothing was changed.",
      );
    }
  }

  // --- the protected pointer -----------------------------------------------------
  // Read only. The write happens after the transaction, through ensurePlatformIdentityCollection, which
  // refuses to move an existing anchor. Checking here means a conflict is reported before any write.
  let pointer = null;
  try {
    pointer = await db
      .collection(PLATFORM_IDENTITY_COLLECTION)
      .findOne({ _id: GUARD_PLATFORM_IDENTITY }, { projection: { organisationId: 1 } });
  } catch {
    // Collection absent: v010 has not run. The seed below will create it.
  }

  if (pointer && pointer.organisationId !== organisation.id) {
    throw new BootstrapError(
      "BOOTSTRAP_POINTER_CONFLICT",
      PLATFORM_IDENTITY_COLLECTION + "/" + GUARD_PLATFORM_IDENTITY + " already names " +
        pointer.organisationId + ", but this run would govern " + organisation.id + ".\n" +
        "          Re-anchoring the platform identity is an owner decision, not a side effect of a\n" +
        "          bootstrap. Nothing was changed.",
    );
  }

  const pointerAction = pointer ? "verify" : "seed";

  return { now, organisation, user, profile, pointerAction, alreadyBootstrapped: organisation.action === "verify" && user.action === "verify" && profile.action === "verify" };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Convert a post-transaction failure into a refusal that says what already exists.
 *
 * The distinction is operational, not cosmetic: "nothing was changed" tells the operator to fix a
 * precondition, while "the account exists but cannot sign in" tells them to re-run. Reporting the first
 * when the second is true is how an operator deletes a working account and starts again.
 */
function partialCompletion(cause, { requestId, written, plan }) {
  const detail = String(cause?.message ?? cause).trim();
  return new BootstrapError(
    "BOOTSTRAP_POINTER_FAILED",
    "PARTIAL COMPLETION — the business documents were committed, but the protected platform identity " +
      "pointer was not established.\n" +
      "          committed    organisation " + written.organisation + ", user " + written.user +
      ", profile " + written.profile + ", audit " + written.audit + "\n" +
      "          requestId    " + requestId + "\n" +
      "          organisation " + plan.organisation.id + "\n" +
      "          cause        " + detail + "\n" +
      "          The SUPER_ADMIN account exists but resolves to NO_ORGANISATION, so every permission is\n" +
      "          refused until the pointer names its organisation. Nothing is lost and nothing is\n" +
      "          duplicated: re-run this command with the same arguments. Every step is idempotent, so the\n" +
      "          re-run performs no inserts and only seeds the pointer.",
    { partial: true, requestId },
  );
}

/**
 * Write the plan. Transactional, idempotent, and auditable.
 *
 * The three business documents and their audit rows go in ONE transaction, so an interrupted run leaves
 * either all of them or none. The pointer is seeded afterwards, outside the transaction, because
 * `ensurePlatformIdentityCollection` issues DDL (`createCollection` / `collMod`) and MongoDB refuses DDL
 * inside a transaction. That ordering is safe: the organisation is committed before the pointer is
 * validated against it, and the seed is idempotent, so a failure between the two is repaired by simply
 * re-running the command.
 */
export async function applyBootstrap(
  client,
  db,
  plan,
  args,
  { passwordHash, now = new Date(), log = () => {}, ensurePointer = ensurePlatformIdentityCollection } = {},
) {
  const requestId = randomUUID();
  const audit = [];
  const written = { organisation: 0, user: 0, profile: 0, audit: 0 };

  const auditRow = (action, entityType, entityId, afterState) => ({
    _id: randomUUID(),
    occurredAt: now,
    actorUserId: null,
    actorRole: null,
    actorIpHash: null,
    action,
    entityType,
    entityId,
    beforeState: null,
    afterState,
    requestId,
    severity: "CRITICAL",
    createdAt: now,
  });

  if (plan.organisation.action === "insert") {
    audit.push(
      auditRow("BOOTSTRAP_ORGANISATION", "organisations", plan.organisation.id, {
        legalName: args.legalName,
        countryCode: args.countryCode,
        orgKind: "PRIMEMET",
        orgType: "BOTH",
        accountStatus: "ACTIVE",
      }),
    );
  }
  if (plan.user.action === "insert") {
    // The hash is deliberately absent from the audit row: an audit trail records that a credential was
    // set, never the credential.
    audit.push(
      auditRow("BOOTSTRAP_ADMIN_USER", "users", plan.user.id, {
        email: args.adminEmail,
        role: "ADMIN",
        status: "ACTIVE",
        passwordSet: true,
      }),
    );
  }
  if (plan.profile.action === "insert") {
    audit.push(
      auditRow("BOOTSTRAP_ADMIN_PROFILE", "admin_profiles", plan.profile.id, {
        tier: "SUPER_ADMIN",
        isActive: true,
        staffCode: args.staffCode,
      }),
    );
  }
  if (audit.length === 0) {
    audit.push(auditRow("BOOTSTRAP_VERIFIED", "organisations", plan.organisation.id, { verified: true }));
  }

  const session = client.startSession();
  try {
    await session.withTransaction(
      async () => {
        if (plan.organisation.action === "insert") {
          await db.collection("organisations").insertOne(
            {
              _id: plan.organisation.id,
              legalName: args.legalName,
              tradeName: null,
              registrationNumber: null,
              gstin: null,
              pan: null,
              iec: null,
              countryCode: args.countryCode,
              stateCode: null,
              city: null,
              website: null,
              accountStatus: "ACTIVE",
              isListable: false,
              internalNotes: null,
              orgType: "BOTH",
              orgKind: "PRIMEMET",
              verificationStatus: "VERIFIED",
              businessType: null,
              description: null,
              reviewFeedback: null,
              reviewedAt: null,
              reviewedByUserId: null,
              suspendedAt: null,
              suspensionReason: null,
              deletedAt: null,
              createdAt: now,
              updatedAt: now,
            },
            { session },
          );
          written.organisation = 1;
        }

        if (plan.user.action === "insert") {
          await db.collection("users").insertOne(
            {
              _id: plan.user.id,
              email: args.adminEmail,
              emailVerifiedAt: now,
              passwordHash,
              passwordChangedAt: now,
              fullName: args.adminName,
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
              createdAt: now,
              updatedAt: now,
            },
            { session },
          );
          written.user = 1;
        }

        if (plan.profile.action === "insert") {
          await db.collection("admin_profiles").insertOne(
            {
              _id: plan.profile.id,
              userId: plan.user.id,
              staffCode: args.staffCode,
              jobTitle: null,
              desk: null,
              tier: "SUPER_ADMIN",
              mfaRequired: true,
              approvalLimit: null,
              isActive: true,
              createdAt: now,
              updatedAt: now,
            },
            { session },
          );
          written.profile = 1;
        }

        await db.collection("audit_logs").insertMany(audit, { session });
        written.audit = audit.length;
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" },
    );
  } finally {
    await session.endSession();
  }

  log("  ✔ business documents committed (organisation " + written.organisation + ", user " +
    written.user + ", profile " + written.profile + ", audit " + written.audit + ")");

  // Outside the transaction: DDL is not permitted inside one. Idempotent, and it refuses to move an
  // existing anchor, so a re-run after a partial failure converges instead of re-pointing.
  //
  // THIS IS THE ONE PARTIAL-COMPLETION WINDOW. The business documents are already committed by the time
  // this runs, so a failure here leaves a real SUPER_ADMIN who cannot resolve permissions. Every failure
  // is therefore converted into a BootstrapError flagged `partial`, which the CLI reports as PARTIAL
  // COMPLETION with exit code 3 — never as a plain refusal, and never as success.
  let created;
  let pointer;
  try {
    created = await ensurePointer(db, {
      now,
      organisationId: plan.organisation.id,
      log: (message) => log("  " + message.trim()),
    });

    pointer = await db
      .collection(PLATFORM_IDENTITY_COLLECTION)
      .findOne({ _id: GUARD_PLATFORM_IDENTITY }, { projection: { organisationId: 1 } });
  } catch (error) {
    throw partialCompletion(error, { requestId, written, plan });
  }

  if (!pointer || pointer.organisationId !== plan.organisation.id) {
    throw partialCompletion(
      new Error(
        PLATFORM_IDENTITY_COLLECTION + " does not name " + plan.organisation.id + " after seeding",
      ),
      { requestId, written, plan },
    );
  }

  return { requestId, written, created, organisationId: plan.organisation.id, userId: plan.user.id, profileId: plan.profile.id };
}

// ---------------------------------------------------------------------------
// Password acquisition — never a default, never a literal
// ---------------------------------------------------------------------------

/** A password character set that satisfies `passwordProblem` by construction: letters and digits only. */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/**
 * A generated password, accepted only if the application's own policy accepts it.
 *
 * The loop is not defensive padding: `passwordProblem` is the single policy, and a generator that emits
 * something the policy rejects would produce an account nobody can set a password for.
 */
export function generatePassword(length = 28) {
  for (;;) {
    let out = "";
    const bytes = randomBytes(length);
    for (let i = 0; i < length; i += 1) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
    if (passwordProblem(out) === null) return out;
  }
}

/**
 * Read a password without echoing it.
 *
 * Refuses when stdin is not a TTY: a piped stdin would either hang forever or feed a placeholder, and a
 * bootstrap that silently accepts an empty password is worse than one that stops.
 */
export async function promptHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    throw new BootstrapError(
      "BOOTSTRAP_NO_TTY",
      "stdin is not a terminal, so a hidden password cannot be read. Re-run from an interactive shell, " +
        "or pass --generate to have one created.",
    );
  }

  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return await new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          process.stderr.write("\n");
          reject(new BootstrapError("BOOTSTRAP_CANCELLED", "cancelled — nothing was changed."));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    stdin.on("data", onData);
  });
}

/** Prompt twice and require the two entries to agree. */
async function promptForPassword() {
  const first = await promptHidden("First SUPER_ADMIN password (input hidden): ");
  const second = await promptHidden("Repeat password: ");
  if (first !== second) {
    throw new BootstrapError("BOOTSTRAP_ENTRY_MISMATCH", "the two entries did not match. Nothing was changed.");
  }
  return first;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printUsage() {
  process.stdout.write(
    [
      "",
      "PRIMEMET — one-time platform organisation and first SUPER_ADMIN bootstrap",
      "",
      "  node db/bootstrap-organisation.mjs [--apply] [--generate] \\",
      "      --legal-name \"<registered legal name>\" \\",
      "      --country-code <ISO-3166 alpha-2> \\",
      "      --admin-email <address> \\",
      "      --admin-name \"<full name>\" \\",
      "      --staff-code <operator numbering> \\",
      "      --confirm \"<exactly --legal-name>\"",
      "",
      "  Without --apply it is a dry run: the plan is printed and nothing is written.",
      "  --apply needs owner credentials (MONGODB_URI) and an explicit PRIMEMET_ENV.",
      "  --generate creates a strong password instead of prompting for one; it is shown once, on stderr,",
      "  and is never written to the audit log.",
      "",
    ].join("\n"),
  );
}

function printPlan(plan, args) {
  const line = (label, value) => process.stdout.write("  " + label.padEnd(16) + value + "\n");
  process.stdout.write("\nPRIMEMET — bootstrap plan\n\n");
  line("organisation", plan.organisation.action + "  " + plan.organisation.id + '  ("' + args.legalName + '", ' + args.countryCode + ")");
  line("admin user", plan.user.action + "  " + plan.user.id + "  (" + args.adminEmail + ", ADMIN/ACTIVE)");
  line("admin profile", plan.profile.action + "  " + plan.profile.id + "  (" + args.staffCode + ", SUPER_ADMIN)");
  line("pointer", plan.pointerAction + "  " + PLATFORM_IDENTITY_COLLECTION + " → " + plan.organisation.id);
  process.stdout.write("\n");
}

function printResult(result) {
  process.stdout.write("\n✔ bootstrap applied\n\n");
  process.stdout.write("  requestId        " + result.requestId + "\n");
  process.stdout.write("  organisation     " + result.organisationId + "\n");
  process.stdout.write("  admin user       " + result.userId + "\n");
  process.stdout.write("  admin profile    " + result.profileId + "\n");
  process.stdout.write("  writes           organisation " + result.written.organisation +
    ", user " + result.written.user + ", profile " + result.written.profile + ", audit " + result.written.audit + "\n");
  process.stdout.write("\n  Next: sign in at /admin/login with the address you supplied.\n\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  let args;
  try {
    args = parseBootstrapArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write("\n✖ " + String(error?.message ?? error) + "\n");
    process.exitCode = EXIT_USAGE;
    return;
  }

  if (args.help) {
    printUsage();
    process.exitCode = EXIT_OK;
    return;
  }

  try {
    validateBootstrapArgs(args);
  } catch (error) {
    process.stderr.write("\n✖ " + String(error?.message ?? error) + "\n");
    process.exitCode = EXIT_USAGE;
    return;
  }

  // `--apply` writes, so the database-target guard demands an explicit environment. Without that, a
  // mistyped MONGODB_DB plus a local PRIMEMET_ENV could point a bootstrap at production.
  const target = checkTarget(process.env, { requiresEnvironment: args.apply });
  if (!target.ok) {
    process.stderr.write("\n✖ " + target.reason + "\n");
    process.exitCode = EXIT_REFUSED;
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    process.stderr.write("\n✖ MONGODB_URI is not set. Nothing was changed.\n");
    process.exitCode = EXIT_REFUSED;
    return;
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db(target.target.database);

    const identity = await assertOwnerIdentity(db);
    process.stdout.write("✔ owner identity confirmed (" + identity.owner.join(", ") + ")\n");

    const plan = await planBootstrap(db, args);
    printPlan(plan, args);

    if (!args.apply) {
      process.stdout.write("Dry run: nothing was changed. Re-run with --apply to write.\n\n");
      process.exitCode = EXIT_OK;
      return;
    }

    if (plan.alreadyBootstrapped && plan.pointerAction === "verify") {
      // Nothing would be written, so asking for a password would be a lie: it would not be stored.
      process.stdout.write("Already bootstrapped: no writes are needed. Run again without --apply to inspect.\n\n");
      process.exitCode = EXIT_OK;
      return;
    }

    // Only a NEW user needs a credential. When the account already exists the hash is not written, so
    // asking for a password would train the operator to type a secret for nothing — and the audit row
    // would still claim one was set.
    let passwordHash;
    if (plan.user.action === "insert") {
      let password;
      let generated = false;
      if (args.generate) {
        password = generatePassword();
        generated = true;
      } else {
        password = await promptForPassword();
      }

      const problem = passwordProblem(password);
      if (problem) throw new BootstrapError("BOOTSTRAP_WEAK_PASSWORD", problem + " Nothing was changed.");

      passwordHash = await hashPassword(password);

      if (generated) {
        // stderr, not stdout: stdout carries the audit summary an operator may capture into a log.
        process.stderr.write("\n  Generated password (shown once — record it now, it is not stored anywhere):\n");
        process.stderr.write("  " + password + "\n\n");
      }
    }

    const result = await applyBootstrap(client, db, plan, args, {
      passwordHash,
      log: (message) => process.stdout.write(message + "\n"),
    });
    printResult(result);
    process.exitCode = EXIT_OK;
  } catch (error) {
    if (error instanceof BootstrapError && error.partial === true) {
      process.stderr.write("\n⚠ PARTIAL COMPLETION — the account exists but cannot sign in yet.\n");
    }
    process.stderr.write("\n✖ " + String(error?.message ?? error) + "\n");
    process.exitCode = exitCodeFor(error);
  } finally {
    await client.close().catch(() => {});
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) await main();
