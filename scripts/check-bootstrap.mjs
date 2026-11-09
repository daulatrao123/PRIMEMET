#!/usr/bin/env node
/**
 * PRIMEMET — bootstrap readiness check.
 *
 * The organisation bootstrap is designed in `docs/PRIMEMET_ORGANISATION_BOOTSTRAP.md` and, since D-BOOT-1,
 * implemented as exactly one owner-run CLI: `db/bootstrap-organisation.mjs`. That makes it easy for the
 * design's guarantees to rot: someone adds a second admin creation route, a seed script, or a default
 * credential, and nothing notices. This check is what notices.
 *
 * This check asserts the properties the design depends on, so a regression fails here instead of being
 * discovered during the first production bootstrap:
 *
 *   1. no path in the application can create an admin
 *   2. no credential, email or seed script exists anywhere, except the one allowlisted CLI
 *   3. the platform organisation is storable (`orgKind`) and unique
 *   4. `orgType` cannot express PRIMEMET, so the two columns cannot be conflated again
 *   5. the audit trail the bootstrap writes to is append-only and carries the fields it needs
 *   6. the runtime identity holds no structural privilege, so it cannot bootstrap anything
 *   7. the design document states the controls it claims
 *
 *   npm run check:bootstrap
 *
 * Offline. No database is contacted and nothing is written.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { auditLog, organisation } from "../db/collections/core.mjs";
import {
  STRUCTURAL_ACTIONS,
  auditRoleDefinitions,
  buildRoleDefinitions,
  effectivePrivilegesFor,
} from "../db/roles.mjs";
import { GUARDS } from "../db/guards.mjs";

let passed = 0;
const failures = [];

function ok(name, detail = "") {
  passed += 1;
  process.stdout.write(`  \u2714 ${name}${detail ? ` — ${detail}` : ""}\n`);
}
function fail(name, detail = "") {
  failures.push(name);
  process.stdout.write(`  \u2716 ${name}${detail ? ` — ${detail}` : ""}\n`);
}
function check(name, condition, detail = "") {
  if (condition) ok(name, detail);
  else fail(name, detail);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const sources = walk("src").filter((path) => /\.(ts|tsx)$/.test(path));
const doc = readFileSync("docs/PRIMEMET_ORGANISATION_BOOTSTRAP.md", "utf8");

// ---------------------------------------------------------------------------
process.stdout.write("\n1. No path in the application creates an admin\n");
// ---------------------------------------------------------------------------
{
  const handlers = sources.filter((path) =>
    /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(readFileSync(path, "utf8")),
  );

  // The Stage-1 assertions here were "no route handler exists at all" and "no admin API route exists".
  // Both were proxies: the property they protected is "nothing in the application can create an admin",
  // and in Stage 1 the easiest way to hold it was to have no routes. The portal now ships 16 handlers,
  // 8 of them admin routes, every one of them role-gated — so the proxies are false while the property
  // still holds. Asserting the proxies fails for the wrong reason; deleting them loses the property.
  // These assertions state the property itself, at the three places it could actually break.

  // A guard that passes because it found nothing to inspect is worse than no guard. If the route
  // surface ever disappears, this check must be reviewed rather than quietly satisfied.
  check(
    "the application still exposes a mutating surface for this check to inspect",
    handlers.length > 0,
    `${handlers.length} mutating handlers`,
  );

  const userInserts = [];
  for (const path of sources) {
    const text = readFileSync(path, "utf8");
    if (
      /collection(?:<[^>]*>)?\(\s*["']users["']\s*\)\s*\.\s*(?:insertOne|insertMany|bulkWrite)\s*\(/.test(
        text,
      )
    ) {
      userInserts.push(path.replace(/\\/g, "/"));
    }
  }
  check(
    "registerAccount() is the only code that creates a user document",
    userInserts.length === 1 && userInserts[0] === "src/lib/data/accounts.ts",
    userInserts.join(", ") || "no writer found — the check is stale",
  );

  const accountsSource = readFileSync("src/lib/data/accounts.ts", "utf8");
  const registerBody = accountsSource.slice(accountsSource.indexOf("export async function registerAccount"));
  const guardAt = registerBody.indexOf("requireRegistrableRole(input.role)");
  // Anchored on the call, not the bare name: the function's own comment explains that the guard sits
  // ahead of `getDb()`, so searching for the name alone would match the prose.
  const handleAt = registerBody.indexOf("await getDb()");
  check(
    "registration enforces a runtime BUYER/SELLER allowlist before it opens a database handle",
    guardAt !== -1 && handleAt !== -1 && guardAt < handleAt,
    guardAt === -1
      ? "the runtime role guard is gone — the type union is not a runtime check"
      : handleAt === -1
        ? "registerAccount no longer opens a handle — the check is stale"
        : "allowlist precedes getDb()",
  );

  const actions = sources.filter((path) => readFileSync(path, "utf8").includes('"use server"'));
  check("no server action exists to create an admin", actions.length === 0, actions.join(", ") || "0 actions");

  const adminRoutes = sources
    .filter((path) => /app[\\/]api[\\/]admin[\\/].*route\.ts$/.test(path))
    .map((path) => path.replace(/\\/g, "/"));
  const ungated = adminRoutes.filter(
    (path) => !/requireApi\(\s*\[\s*["']ADMIN["']/.test(readFileSync(path, "utf8")),
  );
  check(
    "every admin API route refuses a caller without the ADMIN role",
    adminRoutes.length > 0 && ungated.length === 0,
    ungated.length
      ? ungated.join(", ")
      : `${adminRoutes.length} admin routes, all gated by requireApi(["ADMIN"])`,
  );

  // A new admin route is not automatically wrong, but it has to be added here deliberately rather than
  // appearing in the shipped surface unexamined.
  const EXPECTED_ADMIN_ROUTES = 8;
  check(
    "the admin API surface is the one that was reviewed",
    adminRoutes.length === EXPECTED_ADMIN_ROUTES,
    `${adminRoutes.length} admin route(s), expected ${EXPECTED_ADMIN_ROUTES}`,
  );
}

// ---------------------------------------------------------------------------
process.stdout.write("\n2. No credential is seeded anywhere\n");
// ---------------------------------------------------------------------------
{
  // This file declares the patterns it searches for, so it must not search itself.
  const candidates = [...sources, ...walk("scripts").filter((p) => p.endsWith(".mjs")), ...walk("db").filter((p) => p.endsWith(".mjs"))].filter(
    (path) => !path.endsWith("check-bootstrap.mjs"),
  );
  // D-BOOT-1: exactly one file may carry a bootstrap-shaped name, and it is named here by its full
  // path. An allowlist rather than a pattern, because a pattern that admits "bootstrap" admits every
  // future file that calls itself one. The assertions below are what keep the exemption narrow.
  const BOOTSTRAP_CLI_ALLOWLIST = new Set(["db/bootstrap-organisation.mjs"]);
  const seedLike = candidates.filter(
    (path) =>
      /seed|bootstrap|fixture|demo-data/i.test(path) &&
      !/check-|verify-|report-/.test(path) &&
      !BOOTSTRAP_CLI_ALLOWLIST.has(path.replace(/\\/g, "/")),
  );
  check("no seeding script exists that could create an account", seedLike.length === 0, seedLike.join(", ") || "none");

  const bootstrapModules = sources.filter((path) => /bootstrap/i.test(path));
  check("no bootstrap route or module exists under src/", bootstrapModules.length === 0, bootstrapModules.join(", ") || "none");

  // A credential in this repository can take three shapes, and each is checked for what it actually is:
  //
  //   1. a default password constant, a bootstrap password or an admin address — nothing legitimate
  //      needs one, so any occurrence is a finding;
  //   2. a syntactically valid hash. A hash is not a login unless the password is known, but a real hash
  //      of a real password is still a leak. Exactly one file may hold one: the login route's
  //      timing-equalisation decoy, which belongs to no account. That file is allowlisted BY PATH, and
  //      separately asserted to be unable to create a user, so the exemption cannot travel with a copy.
  const defaultCredentialPatterns = [
    [/DEFAULT_ADMIN_PASSWORD/i, "default admin password constant"],
    [/admin@primemet\./, "hardcoded admin address"],
    [/INITIAL_ADMIN|BOOTSTRAP_PASSWORD|SEED_ADMIN/i, "bootstrap credential constant"],
  ];
  const credentialHits = [];
  for (const path of candidates) {
    const text = readFileSync(path, "utf8");
    for (const [pattern, label] of defaultCredentialPatterns) {
      if (pattern.test(text)) credentialHits.push(`${path} (${label})`);
    }
  }
  check(
    "no default password, bootstrap credential or admin address exists",
    credentialHits.length === 0,
    credentialHits.join(", ") || "0 matches",
  );

  // A full scrypt string: six `$`-separated segments with a base64url salt and digest. Prose that
  // elides the middle (`scrypt$32768$8$1$…`) does not match, so this catches hashes, not discussion of
  // them. The previous pattern here was /passwordHash:\s*["']/, which missed a hash held in a `const`
  // and fired on any quoted string after the key.
  const hashPattern = /scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{32,}/;
  const HASH_ALLOWLIST = new Map([
    [
      "src/app/api/auth/login/route.ts",
      "DUMMY_HASH — a hash of a password no account holds, stored only to equalise login timing",
    ],
  ]);
  const hashHits = candidates
    .filter((path) => hashPattern.test(readFileSync(path, "utf8")))
    .map((path) => path.replace(/\\/g, "/"));
  const unreviewed = hashHits.filter((path) => !HASH_ALLOWLIST.has(path));
  check(
    "every credential-shaped hash in the tree is the one reviewed decoy",
    unreviewed.length === 0,
    unreviewed.length ? unreviewed.join(", ") : `${hashHits.length} occurrence(s), all allowlisted by path`,
  );

  const loginSource = readFileSync("src/app/api/auth/login/route.ts", "utf8");
  check(
    "the decoy hash cannot authenticate an account: it is only a fallback operand, in a route that creates no user",
    /verifyPassword\([^;]*DUMMY_HASH/.test(loginSource) &&
      !/collection(?:<[^>]*>)?\(\s*["']users["']\s*\)\s*\.\s*(?:insertOne|insertMany)/.test(loginSource),
    "the route no longer falls back to the decoy, or it now writes users",
  );

  check(
    "the design records the approved D-BOOT-1 decision and the CLI that implements it",
    /D-BOOT-1/.test(doc) && /bootstrap-organisation\.mjs/.test(doc),
  );

  // -------------------------------------------------------------------------
  // D-BOOT-1: the one bootstrap CLI, and the properties that make it safe.
  // -------------------------------------------------------------------------
  // The allowlist above admits exactly one path. These assertions are what make that exemption narrow:
  // the file must be a CLI that refuses the runtime identity, requires an explicit address, defaults to
  // a dry run, never touches the guard collection, and is unreachable from the application.
  const cliPath = "db/bootstrap-organisation.mjs";
  check("the bootstrap CLI exists at the allowlisted path", existsSync(cliPath), cliPath);
  const cli = existsSync(cliPath) ? readFileSync(cliPath, "utf8") : "";
  check(
    "the bootstrap CLI refuses the runtime identity",
    /RUNTIME_ROLE\s*=\s*"primemet_app"/.test(cli) && /BOOTSTRAP_APP_IDENTITY/.test(cli),
  );
  check(
    "the bootstrap CLI requires an explicit admin address and has no default",
    /--admin-email/.test(cli) && /BOOTSTRAP_MISSING_ARGUMENT/.test(cli) && !/adminEmail\s*=\s*"[^"]*@/.test(cli),
  );
  check(
    "the bootstrap CLI is a dry run unless --apply is passed",
    /apply:\s*\{\s*type:\s*"boolean",\s*default:\s*false\s*\}/.test(cli) && /if\s*\(!args\.apply\)/.test(cli),
  );
  check(
    "the bootstrap CLI never writes the guard collection",
    !/collection\(\s*GUARDS\s*\)/.test(cli) && !/ensurePermissionGuards/.test(cli),
  );
  check(
    "the bootstrap CLI seeds the pointer through the existing guard function",
    /ensurePlatformIdentityCollection/.test(cli),
  );
  check(
    "the bootstrap CLI hashes with the application's own implementation",
    /from\s+"\.\.\/src\/lib\/auth\/password\.ts"/.test(cli) && /hashPassword\(/.test(cli),
  );
  check(
    "no application source imports the bootstrap CLI",
    !sources.some((path) => readFileSync(path, "utf8").includes("bootstrap-organisation")),
  );
}

// ---------------------------------------------------------------------------
process.stdout.write("\n3-4. The platform organisation is storable, unique and unambiguous\n");
// ---------------------------------------------------------------------------
{
  const orgKind = organisation.fields.orgKind;
  check(
    "organisations can store orgKind = PRIMEMET",
    orgKind?.bsonType === "string" && (orgKind.enum ?? []).includes("PRIMEMET"),
    JSON.stringify(orgKind ?? null),
  );
  check(
    "exactly one live PRIMEMET organisation is enforced by a partial unique index",
    organisation.indexes.some(
      (ix) =>
        ix.unique === true &&
        ix.partialFilterExpression?.orgKind === "PRIMEMET" &&
        ix.partialFilterExpression?.deletedAt === null,
    ),
  );
  check(
    "orgType cannot express PRIMEMET (the two columns stay distinct)",
    !(organisation.fields.orgType.enum ?? []).includes("PRIMEMET"),
    JSON.stringify(organisation.fields.orgType.enum ?? null),
  );
}

// ---------------------------------------------------------------------------
process.stdout.write("\n5. The audit trail is append-only and complete\n");
// ---------------------------------------------------------------------------
{
  check("audit_logs is immutable", auditLog.immutable === true);
  const fields = Object.keys(auditLog.fields);
  const needed = ["actorUserId", "actorRole", "action", "entityType", "entityId", "requestId", "severity", "occurredAt"];
  check(
    "an audit record carries the actor, the action, the entity and the request",
    needed.every((name) => fields.includes(name)),
    fields.length + " fields",
  );
}

// ---------------------------------------------------------------------------
process.stdout.write("\n6. The runtime identity cannot bootstrap anything\n");
// ---------------------------------------------------------------------------
{
  const roles = buildRoleDefinitions();
  const app = roles.find((r) => r.role === "primemet_app");
  check("primemet_app is defined", app !== undefined);

  if (app) {
    // Every scope the bootstrap or a migration would need, plus the database-wide grant that MongoDB
    // treats as covering all of them.
    const scopes = ["", "organisations", "users", "admin_profiles", "audit_logs", "sessions", GUARDS];
    const forbidden = [];
    for (const action of STRUCTURAL_ACTIONS) {
      const holders = scopes.filter((scope) => effectivePrivilegesFor(app, scope).includes(action));
      if (holders.length > 0) forbidden.push(`${action} on ${holders.map((s) => s || "(database-wide)").join("/")}`);
    }
    check(
      "primemet_app holds no structural action in any scope it can reach",
      forbidden.length === 0,
      forbidden.join(", ") || "none",
    );
  }

  const problems = auditRoleDefinitions();
  check("the role definitions audit clean", problems.length === 0, problems.join("; "));
}

// ---------------------------------------------------------------------------
process.stdout.write("\n7. The design states the controls it claims\n");
// ---------------------------------------------------------------------------
{
  const requirements = [
    [/no default public admin account/i, "no default public admin account"],
    [/no hardcoded credentials/i, "no hardcoded credentials"],
    [/no unauthenticated admin-creation endpoint/i, "no unauthenticated admin-creation endpoint"],
    [/idempotent/i, "idempotency"],
    [/does not overwrite an existing organisation/i, "does not overwrite an existing organisation"],
    [/every action auditable/i, "every action auditable"],
    [/runtime identities lack owner privileges/i, "runtime identities lack owner privileges"],
  ];
  for (const [pattern, label] of requirements) check(`the design addresses: ${label}`, pattern.test(doc));
  // D-BOOT-1 replaced "design only" with an implemented CLI, so the assertion now checks that the
  // document says which of the two it is, rather than pinning it to the pre-implementation wording.
  check(
    "the design states its own implementation status",
    /D-BOOT-1 is decided and implemented/i.test(doc) && /bootstrap-organisation\.mjs/.test(doc),
  );
}

process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const f of failures) process.stdout.write(`  \u2716 ${f}\n`);
  process.exit(1);
}
process.exit(0);