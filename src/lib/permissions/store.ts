/**
 * PRIMEMET — the database side of the permission model: read the log, append to it, never rewrite it.
 *
 * WHY THIS IS SEPARATE FROM THE RULES. `resolve.ts` and `delegation.ts` are pure: they decide given
 * facts. This module is the only place facts are fetched, and that separation is a security boundary, not
 * tidiness. The actor's permissions used by `mayGrant` are **resolved here, from the event log**, and
 * never taken from a request body — so a forged `{ permissions: [...] }` payload has nothing to attach
 * to. `scripts/check-permissions.mjs` proves that against a real MongoDB.
 *
 * THE LOG IS APPEND-ONLY. There is no update and no delete in this module, and the database refuses both:
 * the collection is `immutable: true` and `primemet_app` holds no update/delete privilege on it.
 *
 * Mongo types are imported as `import type` on purpose — this module takes a `Db` handle and does not
 * import `@/lib/db`, so a Node script can exercise the real code against an in-memory replica set
 * without a Next.js runtime or a connection string.
 */

import { randomUUID } from "node:crypto";

import { Long, type ClientSession, type Collection, type Db } from "mongodb";

import { mayGrant, wouldLockOutSuperAdmins, type DelegationRefusal } from "./delegation.ts";
import { resolveAdminPermissions } from "./resolve.ts";
import { ADMIN_PERMISSIONS, type AdminActor, type AdminPermission, type PermissionEventRow } from "./types.ts";
import { assertSignable, integrityTag } from "./integrity.ts";

export const GRANTS_COLLECTION = "admin_permission_grants";
export const PROFILES_COLLECTION = "admin_profiles";
export const USERS_COLLECTION = "users";

/**
 * The continuity guard collection (C3). The name is duplicated from `db/guards.mjs` on purpose: this
 * module is loaded by Node scripts *and* by the Next.js bundle, and importing `db/` from `src/` would
 * pull the migration machinery into the request path. `scripts/check-adversarial.mjs` asserts the two
 * literals are equal, so the duplication cannot drift silently.
 */
export const GUARDS_COLLECTION = "_permission_guards";
export const GUARD_LAST_SUPER_ADMIN = "last-super-admin";

/** W2: the guard document that names the platform organisation. Literal asserted equal to db/guards.mjs. */
export const GUARD_PLATFORM_IDENTITY = "platform-identity";

/**
 * The key that authenticates permission events (W3).
 *
 * Read from the environment at call time, not captured at module load, so a rotated key takes effect on
 * the next append without a redeploy of a cached value. Below 16 characters is treated as "not
 * configured" rather than as a weak key: a short secret would produce tags that look sound.
 */
export function permissionLogKey() {
  const key = process.env.PERMISSION_LOG_KEY;
  return typeof key === "string" && key.length >= 16 ? key : null;
}

/**
 * The collection the protected platform identity pointer lives in (W2.2/W2.6).
 *
 * The literal is duplicated from `db/guards.mjs` for the same reason `GUARDS_COLLECTION` is: this module
 * is loaded by Node scripts and by the Next.js bundle, and importing `db/` here would pull the migration
 * machinery into the request path. `scripts/check-adversarial.mjs` asserts the two literals are equal.
 */
export const PLATFORM_IDENTITY_COLLECTION = "_platform_identity";

/**
 * The governing organisation named by the protected pointer, or null when nothing usable answers.
 *
 * W2.2/W2.6 REMEDIATION. v005 moved administrator resolution off the mutable `orgKind` marker and onto a
 * pointer document. That closed the relabel attack, but the pointer sat in `_permission_guards`, where
 * this process holds `update` in order to increment the continuity fence — and MongoDB has no
 * per-document privilege, so the same grant could also re-point the pointer. The authenticated audit
 * measured it: re-pointing was accepted, and two concurrent writes left an order-dependent survivor.
 * v010 moved the pointer to `_platform_identity`, where this identity holds only `find`, so re-pointing
 * is refused by the server.
 *
 * F1: THERE IS NO FALLBACK. The previous version distinguished "collection absent" (a pre-v010 database,
 * where the legacy `_permission_guards` pointer was legitimate) from "pointer unset" by asking
 * `listCollections` — and this identity holds no `listCollections` action, so that question always threw
 * and the legacy branch was unreachable. Measured: with the protected collection removed and a legacy
 * pointer present, an administrator resolved to nothing. A documented fallback that cannot execute is
 * worse than none, because it is relied on. It is gone: one pointer, or fail closed with NO_ORGANISATION.
 * The consequence is deliberate — v010 is a deployment prerequisite, and `db/README.md` says so.
 */
async function readPlatformPointer(db: Db): Promise<{ organisationId: string | null }> {
  try {
    const document = await db
      .collection<{ _id: string; organisationId?: unknown }>(PLATFORM_IDENTITY_COLLECTION)
      .findOne({ _id: GUARD_PLATFORM_IDENTITY }, { projection: { organisationId: 1 } });
    const value = document?.organisationId;
    return { organisationId: typeof value === "string" && value.length > 0 ? value : null };
  } catch {
    // The database could not answer. Fail closed; never fall back to a weaker source on an error.
    return { organisationId: null };
  }
}

/** Row shapes, declared with `_id: string` because these collections use UUID primary keys, not ObjectId. */
interface UserDoc {
  _id: string;
  role?: string;
  status?: string;
  deletedAt?: Date | null;
  organisationId?: string | null;
}

interface ProfileDoc {
  _id: string;
  userId: string;
  isActive?: boolean;
  tier?: string;
}

interface OrgDoc {
  _id: string;
  deletedAt?: Date | null;
  /**
   * `orgKind` is the operator marker (PRIMEMET | BUYER | SELLER | PARTNER | OTHER). It is NOT `orgType`:
   * that column is the counterparty kind (BUYER | SELLER | BOTH) and has no PRIMEMET value. The first
   * MongoDB port dropped `orgKind` and filtered the single-PRIMEMET index on `orgType`, which made the
   * platform organisation unstorable and left every admin resolving to NO_ORGANISATION — the permission
   * model was inert against a valid database. Corrected by migration v004 (defect S-1).
   */
  orgKind?: string;
  accountStatus?: string;
}

interface GrantDoc {
  _id: string;
  adminId: string;
  permission: string;
  effect: string;
  seq: number | Long;
  eventId: string;
  grantedById: string;
  reason: string;
  expiresAt: Date | null;
  createdAt: Date;
}

/** A continuity guard document (`db/guards.mjs`). Infrastructure, not business data. */
interface GuardDoc {
  _id: string;
  kind: string;
  fence?: number | Long;
  value?: number | Long;
  updatedAt: Date;
}

/** A resolved read: the facts an authorisation decision needs, and nothing else. */
export async function loadAdminActor(db: Db, userId: string): Promise<AdminActor | null> {
  const user = await db
    .collection<UserDoc>(USERS_COLLECTION)
    .findOne({ _id: userId }, { projection: { _id: 1, role: 1, status: 1, deletedAt: 1, organisationId: 1 } });
  if (!user) return null;

  const profile = await db
    .collection<ProfileDoc>(PROFILES_COLLECTION)
    .findOne({ userId }, { projection: { _id: 1, isActive: 1, tier: 1 } });

  // WHICH ORGANISATION IS A STAFF MEMBER IN? `users` has no `organisationId` — that column belongs to
  // `portal_invitations`. An admin profile is, by definition, staff of the operator, so the organisation
  // that governs their access is the platform organisation (`orgKind: "PRIMEMET"`). The `users` field is
  // honoured when a deployment adds one, so a future staff member attached to a specific entity resolves
  // against it instead. If neither exists the gate reports NO_ORGANISATION and refuses — fail-closed.
  // W2 REMEDIATION. The platform organisation is whatever the PROTECTED POINTER names, not whatever
  // document happens to carry `orgKind: "PRIMEMET"` at this instant. Before this change a BUYER
  // organisation could be relabelled PRIMEMET — an ordinary update to a business document — and silently
  // become the organisation governing every administrator's access. Now relabelling changes a label,
  // deleting the pointed-at organisation fails closed, and a second PRIMEMET marker is inert.
  //
  // The marker fallback and the legacy pointer fallback are both GONE (F1). A database that has not run
  // v010 resolves no administrator at all, which `db/verify` reports as an outstanding migration rather
  // than papering over; the marker is app-writable and cannot be authority.
  // A SOFT-DELETED governing organisation is no more authoritative than a deleted row: the pointer still
  // names it, so the lookup finds a document that is no longer live, and the gate must report
  // NO_ORGANISATION rather than keep granting. An ABSENT `deletedAt` is treated as live, matching the
  // validator (`dateOpt`) and the legacy rows v004 backfills.
  // F2: `users.organisationId` may CORROBORATE the pointer; it may never override it. Three outcomes:
  //   - the field is absent            → the pointer governs;
  //   - it equals the pointer          → the pointer governs (agreement is a no-op by construction);
  //   - it differs, or no pointer      → NO organisation, and the gate reports NO_ORGANISATION.
  // The third case must fail closed rather than silently preferring either value: two sources that
  // disagree are a statement that this administrator's anchoring is not known, and the only safe reading
  // of that is none. Before this rule the field simply overrode the pointer, so a single write to a
  // validator-relaxed `users` row redirected an administrator away from the governing organisation.
  const pointer = await readPlatformPointer(db);
  const rawClaim = user.organisationId;
  const claimed = typeof rawClaim === "string" && rawClaim.length > 0 ? rawClaim : null;
  // Present but unusable is NOT the same as absent: `null`/`undefined` mean the column is not in use, while
  // a number, an object or an empty string can only exist on a row written with validation bypassed. That
  // is a tampering signal, so it fails closed rather than being read as "no opinion".
  const malformed = rawClaim !== undefined && rawClaim !== null && claimed === null;
  const sourcesAgree =
    !malformed && (claimed === null || (pointer.organisationId !== null && claimed === pointer.organisationId));
  const governingOrgId = sourcesAgree ? pointer.organisationId : null;

  let governing = null;
  if (governingOrgId) {
    governing = await db
      .collection<OrgDoc>("organisations")
      .findOne({ _id: governingOrgId }, { projection: { _id: 1, orgKind: 1, accountStatus: 1, deletedAt: 1 } });
  }
  const org = governing && (governing.deletedAt === null || governing.deletedAt === undefined) ? governing : null;

  return {
    user: {
      id: user._id,
      role: user.role ?? "",
      status: user.status ?? "",
      deletedAt: user.deletedAt ?? null,
    },
    profile: profile
      ? { id: profile._id, isActive: profile.isActive === true, tier: profile.tier ?? "" }
      : null,
    org: org ? { id: org._id, orgKind: org.orgKind ?? "", accountStatus: org.accountStatus ?? "" } : null,
  };
}

/**
 * The events that could decide anything for this admin at `now`.
 *
 * The query is deliberately *not* narrowed by permission: a resolution answers all 74 questions, and the
 * filter cannot exclude an event that an expiry could promote into the newest applicable position. The
 * index `{adminId, permission, createdAt:-1, seq:-1}` serves the sort.
 */
export async function readPermissionEvents(
  db: Db,
  adminId: string,
  now: Date = new Date(),
  session: ClientSession | null = null,
): Promise<PermissionEventRow[]> {
  const rows = await db
    .collection<GrantDoc>(GRANTS_COLLECTION)
    .find({ adminId, createdAt: { $lte: now } }, session ? { session } : {})
    .sort({ createdAt: -1, seq: -1 })
    .toArray();
  return rows as unknown as PermissionEventRow[];
}

export interface ActorResolution {
  actor: AdminActor | null;
  permissions: ReadonlySet<AdminPermission>;
  decisions: ReturnType<typeof resolveAdminPermissions>["decisions"];
  deniedAt: ReturnType<typeof resolveAdminPermissions>["deniedAt"];
}

/** Load the actor, load their events, resolve. The only supported way to obtain actor permissions. */
export async function resolveActorPermissions(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<ActorResolution> {
  const actor = await loadAdminActor(db, userId);
  const profileId = actor?.profile?.id;
  const events = profileId ? await readPermissionEvents(db, profileId, now) : [];
  const resolution = resolveAdminPermissions(actor, events, now, { integrityKey: permissionLogKey() });
  return {
    actor,
    permissions: resolution.allowed,
    decisions: resolution.decisions,
    deniedAt: resolution.deniedAt,
  };
}

export interface AppendInput {
  /** The acting user — a `users._id`. Their permissions are resolved here, never supplied. */
  actorUserId: string;
  target: {
    /** `admin_profiles._id`. */
    profileId: string;
    isActive: boolean;
    userIsActive: boolean;
    tier: string;
  };
  permission: string;
  effect: string;
  reason?: string | null;
  expiresAt?: Date | null;
  eventId?: string | null;
  now?: Date;
}

export type AppendResult =
  | { ok: true; seq: number; seq_idempotent: false; eventId: string }
  | { ok: true; seq_idempotent: true; eventId: string }
  | { ok: false; refusal: DelegationRefusal | "ACTOR_UNRESOLVED" | "SEQ_CONTENTION" | "EVENT_ID_CONFLICT" | ContinuityRefusal };

/**
 * The three ways the C3 guard can stop an event, kept separate from the delegation refusals because
 * they describe the *database's* state rather than the actor's authority.
 */
export type ContinuityRefusal = "LAST_SUPER_ADMIN" | "GUARD_UNAVAILABLE" | "CONTINUITY_CONTENTION";

/**
 * How hard a sequence collision is retried before the caller is told to try again.
 *
 * The counter below is the primary allocator, so this loop is the *repair* path: it runs when the counter
 * disagrees with the log — a restored backup, a counter document deleted by hand, a deployment that
 * skipped the migration. It is bounded by both a count and a deadline because the two fail differently.
 */
const SEQ_RETRIES = 200;
const SEQ_DEADLINE_MS = 4_000;

/**
 * The pause between attempts: small and FLAT.
 *
 * The first version grew the window with each attempt, which is the textbook choice for a lock and the
 * wrong one here: it spent the whole deadline asleep. Measured on a 1000-way burst, growing backoff
 * produced 162 applied in 20 attempts and 15 in the same budget once the deadline became binding. A
 * flat jitter of a few milliseconds keeps attempts inside the window, and the unique index — not the
 * delay — is what prevents a duplicate.
 */
const BACKOFF_MS = 12;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const backoff = (): Promise<void> => sleep(2 + Math.floor(Math.random() * BACKOFF_MS));

function isDuplicateKey(error: unknown): { duplicate: boolean; keyPattern: Record<string, unknown> } {
  const e = error as { code?: number; keyPattern?: Record<string, unknown> };
  return { duplicate: e?.code === 11000, keyPattern: e?.keyPattern ?? {} };
}

/** The `_permission_guards` id of one admin's sequence counter. */
const sequenceGuardId = (adminId: string): string => `seq-${adminId}`;

/** The highest position any row claims for this admin, or 0. The log is the authority if the counter lies. */
async function maxSequenceInLog(collection: Collection<GrantDoc>, adminId: string): Promise<number> {
  const newest = await collection
    .find({ adminId }, { projection: { seq: 1 } })
    .sort({ seq: -1 })
    .limit(1)
    .toArray();
  return newest.length > 0 ? Number(newest[0].seq ?? 0) : 0;
}

/**
 * The next position in this admin's log, allocated atomically.
 *
 * WHY A COUNTER AND NOT `max(seq) + 1`. Reading the maximum and then inserting it is a check-then-act:
 * N concurrent appends all read the same maximum, one insert wins and N−1 collide. Measured on a
 * 1000-way burst against one admin, that scheme applied **18** of 1000 within a four-second budget (with
 * 20 attempts: 162). Every loser was told to retry rather than losing a write, so it was never wrong —
 * but an access change that fails 98% of the time under load is a defect, not a characteristic.
 * `$inc` on a single document is atomic in MongoDB, so each caller gets a distinct position and no
 * caller has to lose before it can win.
 *
 * The counter lives beside the continuity guard because it is the same kind of object: infrastructure
 * that exists so a cross-instance invariant — here, "the order is total" — holds without a shared
 * process. It is deliberately NOT in `admin_permission_grants`: the log is append-only and its rows are
 * the audit record, so a mutable counter inside it would be the one document that is not history.
 *
 * FALLS BACK TO THE LOG. If the collection or the document cannot be reached, the previous scheme still
 * works correctly — just more slowly — so a deployment that has not applied v003 loses throughput and
 * nothing else. The unique index on `{adminId, seq}` remains the guarantee in both paths.
 */
async function allocateSequence(db: Db, adminId: string, collection: Collection<GrantDoc>): Promise<number> {
  const guards = db.collection<GuardDoc>(GUARDS_COLLECTION);

  try {
    const allocated = await guards.findOneAndUpdate(
      { _id: sequenceGuardId(adminId) },
      {
        $inc: { value: 1 },
        $setOnInsert: { kind: "PERMISSION_SEQUENCE" },
        $set: { updatedAt: new Date() },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (allocated?.value !== undefined && allocated?.value !== null) return Number(allocated.value);
  } catch (error) {
    // The only expected failure is two first-time upserts racing for the same _id: one inserts, the
    // other is told the key exists. The document is there now, so a plain `$inc` completes the work.
    if (isDuplicateKey(error).duplicate) {
      const retried = await guards
        .findOneAndUpdate(
          { _id: sequenceGuardId(adminId) },
          { $inc: { value: 1 }, $set: { updatedAt: new Date() } },
          { returnDocument: "after" },
        )
        .catch(() => null);
      if (retried?.value !== undefined && retried?.value !== null) return Number(retried.value);
    }
  }

  return (await maxSequenceInLog(collection, adminId)) + 1;
}

/**
 * Bring a lagging counter up to a position the log proves is already taken.
 *
 * Needed after a restore that lost the guard collection but kept the log: without it, the counter would
 * keep handing out positions that are occupied and every append would collide forever.
 */
async function advanceSequenceGuard(db: Db, adminId: string, occupied: number): Promise<void> {
  await db
    .collection<GuardDoc>(GUARDS_COLLECTION)
    .updateOne({ _id: sequenceGuardId(adminId) }, { $max: { value: Long.fromNumber(occupied) } })
    .catch(() => {
      /* best effort: the retry loop repairs the log either way */
    });
}

/**
 * Is this failure one the driver can make go away by trying again?
 *
 * A WriteConflict is what two guarded transactions produce when they meet on the fence document, so it
 * is the *expected* outcome of a genuine race, not an error. The check is explicit rather than a bare
 * `catch` because a duplicate-key error must not be retried as if it were contention — inside the loop
 * below it means something specific about the request.
 */
function isTransient(error: unknown): boolean {
  const e = error as {
    code?: number;
    codeName?: string;
    errorLabels?: string[];
    hasErrorLabel?: (label: string) => boolean;
  };
  if (e?.code === 112 || e?.codeName === "WriteConflict") return true;
  const labels = ["TransientTransactionError", "UnknownTransactionCommitResult"];
  if (Array.isArray(e?.errorLabels) && labels.some((l) => e.errorLabels?.includes(l))) return true;
  if (typeof e?.hasErrorLabel === "function" && labels.some((l) => e.hasErrorLabel?.(l) === true)) return true;
  return false;
}

/**
 * Count the super admins who would still be able to write an access event if these profiles lost theirs.
 *
 * This resolves each active super admin rather than reading a cache, because the only correct answer is
 * "what does the log say right now". The set is small by construction — it is the number of people who
 * can change access — and this runs only for a change that could remove the ability to write one.
 *
 * `session` is not optional in practice: called outside the caller's transaction the count is a guess.
 * It is passed through to every read so the count and the write it justifies observe one snapshot.
 */
async function countRemainingGrantHolders(
  db: Db,
  excludeProfileIds: readonly string[],
  now: Date,
  session: ClientSession | null = null,
): Promise<number> {
  const excluded = [...new Set(excludeProfileIds)];
  const profiles = await db
    .collection<ProfileDoc>(PROFILES_COLLECTION)
    .find(
      { tier: "SUPER_ADMIN", isActive: true, _id: { $nin: excluded } },
      { projection: { _id: 1, userId: 1 }, ...(session ? { session } : {}) },
    )
    .toArray();

  // A HOLDER IS A USABLE IDENTITY, NOT AN ACTIVE PROFILE (defect A-1, found by independent acceptance).
  // The first version counted every active SUPER_ADMIN profile and probed the log with a synthetic user
  // that was always ACTIVE. That made a departing employee — user suspended or soft-deleted while the
  // profile was left active — count as a way back in, so the last usable super admin could deactivate
  // itself and leave the platform with nobody able to write an access event. The count now requires the
  // user row to satisfy the very gates the resolver applies, because that is what "usable" means here.
  const userIds = profiles.map((p) => p.userId).filter((id): id is string => typeof id === "string");
  const usableUsers = userIds.length
    ? await db
        .collection<UserDoc>(USERS_COLLECTION)
        .find(
          { _id: { $in: userIds }, role: "ADMIN", status: "ACTIVE", deletedAt: null },
          { projection: { _id: 1 }, ...(session ? { session } : {}) },
        )
        .toArray()
    : [];
  const usableUserIds = new Set(usableUsers.map((u) => u._id));

  let holders = 0;
  for (const profile of profiles) {
    // A profile whose user cannot sign in is not a way back in, however active the profile looks.
    if (!profile.userId || !usableUserIds.has(profile.userId)) continue;
    const events = await readPermissionEvents(db, profile._id, now, session);
    const actor: AdminActor = {
      user: { id: profile.userId, role: "ADMIN", status: "ACTIVE", deletedAt: null },
      profile: { id: profile._id, isActive: true, tier: "SUPER_ADMIN" },
      org: { id: "probe", orgKind: "PRIMEMET", accountStatus: "ACTIVE" },
    };
    // F-1. The key must be passed here for the same reason `resolveActorPermissions` passes it: without
    // it every stored row reports `UNKEYED`, and P2 made `UNKEYED` a failure in the production posture.
    // A holder with NO recorded event still counted, from the tier default, which is why this stayed
    // invisible; a holder WITH an event did not, because an unverifiable newest row resolves to
    // INVALID_EVENT rather than falling back to the tier. So the counter under-reported in production
    // whenever a super admin had ever had an access event, and the consequence was a false refusal:
    // removing the last such holder was rejected as LAST_SUPER_ADMIN. Fail-closed, but wrong.
    if (
      resolveAdminPermissions(actor, events, now, { integrityKey: permissionLogKey() }).allowed.has(
        "ACCESS_GRANT_PERMISSION",
      )
    ) {
      holders += 1;
    }
  }
  return holders;
}

/** Outer attempts around `withTransaction`; the driver retries transient errors itself inside each one. */
const GUARD_ATTEMPTS = 4;

/**
 * Run `action` only if the platform still keeps a way back in, and serialise the decision across every
 * application instance.
 *
 * THE DEFECT THIS CLOSES (C3). Counting holders and then inserting is a check-then-act over two
 * documents. Under snapshot isolation two transactions that write *different* documents both commit,
 * so instance A denying super admin X and instance B denying super admin Y can each observe the other
 * as still holding the permission and both succeed. The count is not wrong when it is read; it is
 * wrong by the time it is acted on, and no amount of retrying the read fixes that.
 *
 * THE MECHANISM. Every guarded transaction writes the same fence document. WiredTiger admits one
 * writer per document, so the later transaction gets a WriteConflict, the driver replays it, and the
 * replay reads a snapshot that contains the first transaction's committed change. The invariant is
 * then evaluated against the truth rather than against a stale count. This needs no shared memory, no
 * leader and no advisory-lock service: it is one document that every instance must touch, which is
 * what makes it correct across processes as well as across connections.
 *
 * FAIL-CLOSED. A missing guard document refuses the change (GUARD_UNAVAILABLE) instead of proceeding
 * unguarded. The document is seeded by migration v003, so its absence means the deployment skipped a
 * migration — exactly the condition under which the protection must not be silently dropped.
 */
async function withContinuityGuard<T>(
  db: Db,
  args: {
    now: Date;
    /** Profiles whose access this change removes; excluded from the count, as they are losing it. */
    excludeProfileIds: readonly string[];
    /** Given the number of holders left, is this change safe? One rule, evaluated once, under the fence. */
    isSafe: (remainingHolders: number) => boolean;
  },
  action: (session: ClientSession) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; refusal: ContinuityRefusal }> {
  const guards = db.collection<GuardDoc>(GUARDS_COLLECTION);

  for (let attempt = 0; attempt < GUARD_ATTEMPTS; attempt += 1) {
    const session = db.client.startSession();
    // A container, not two `let`s: TypeScript narrows a closure-assigned variable to its initial
    // value across the callback boundary, which would make the refusal below unreachable to it.
    const state: { refusal: ContinuityRefusal | null; value?: T } = { refusal: null };

    try {
      await session.withTransaction(
        async () => {
          state.refusal = null;
          state.value = undefined;

          const guard = await guards.findOne(
            { _id: GUARD_LAST_SUPER_ADMIN },
            { projection: { _id: 1 }, session },
          );
          if (!guard) {
            state.refusal = "GUARD_UNAVAILABLE";
            return;
          }

          const remaining = await countRemainingGrantHolders(db, args.excludeProfileIds, args.now, session);
          if (!args.isSafe(remaining)) {
            state.refusal = "LAST_SUPER_ADMIN";
            return;
          }

          // The rendezvous point. Written even when the change turns out to be a no-op, because the
          // conflict it creates is the entire mechanism; its value is never read to decide anything.
          await guards.updateOne(
            { _id: GUARD_LAST_SUPER_ADMIN },
            { $inc: { fence: 1 }, $set: { updatedAt: args.now } },
            { session },
          );

          state.value = await action(session);
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" },
      );

      if (state.refusal) return { ok: false, refusal: state.refusal };
      return { ok: true, value: state.value as T };
    } catch (error) {
      if (!isTransient(error)) throw error;
      // Two instances met on the fence. Back off and replay: the next snapshot contains the winner.
      await backoff();
    } finally {
      await session.endSession();
    }
  }

  // Never "probably fine": a guard that could not be evaluated refuses the change.
  return { ok: false, refusal: "CONTINUITY_CONTENTION" };
}

/**
 * Append one permission event, or explain why not.
 *
 * ORDER OF OPERATIONS, which is the whole defence: resolve the actor from the log → apply the pure rules
 * → check the idempotency key and compare its payload → (for an event that can remove the last way in)
 * open a transaction that touches the continuity fence → allocate a sequence number → insert. The unique
 * index on `{adminId, eventId}` turns a retried request into a no-op; the unique index on `{adminId, seq}`
 * turns a concurrent append into a retry rather than two rows claiming the same position in the order.
 */
export async function appendPermissionEvent(db: Db, input: AppendInput): Promise<AppendResult> {
  const now = input.now ?? new Date();

  const actorState = await resolveActorPermissions(db, input.actorUserId, now);
  if (!actorState.actor?.profile) return { ok: false, refusal: "ACTOR_UNRESOLVED" };

  const decision = mayGrant({
    actorPermissions: actorState.permissions,
    actorProfileId: actorState.actor.profile.id,
    actorTier: actorState.actor.profile.tier,
    target: input.target,
    request: {
      permission: input.permission,
      effect: input.effect,
      reason: input.reason ?? null,
      expiresAt: input.expiresAt ?? null,
      eventId: input.eventId ?? null,
    },
    now,
  });
  if (!decision.allowed) return { ok: false, refusal: decision.refusal ?? "ACTOR_NOT_PERMITTED" };

  const profileId = input.target.profileId;
  const reason = typeof input.reason === "string" ? input.reason : "";
  const expiresAt = input.expiresAt ?? null;
  const eventId = String(input.eventId ?? "").trim();
  const collection = db.collection<GrantDoc>(GRANTS_COLLECTION);

  /**
   * C3: only an event that can REMOVE a super admin's ability to write another access event needs the
   * guard. GRANT adds a way in, and no other permission decides who may write events at all.
   */
  const guarded =
    input.permission === "ACCESS_GRANT_PERMISSION" && (input.effect === "DENY" || input.effect === "REVOKE");

  /**
   * The same request arriving twice is a no-op. A request arriving twice with a DIFFERENT payload is not
   * a retry — it is a second, contradictory change wearing the first one's idempotency key, and
   * accepting it is how a DENY gets recorded as a GRANT in the audit trail (C2 defect: the previous
   * version returned "already applied" for any row found under the key, whatever it said). The stored
   * row is therefore compared field by field before the retry is believed.
   */
  const idempotentOutcome = (existing: GrantDoc): AppendResult => {
    const storedExpiry = existing.expiresAt ? new Date(existing.expiresAt).getTime() : null;
    const requestedExpiry = expiresAt ? expiresAt.getTime() : null;
    const samePayload =
      existing.adminId === profileId &&
      existing.permission === input.permission &&
      existing.effect === input.effect &&
      existing.grantedById === input.actorUserId &&
      (existing.reason ?? "") === reason &&
      storedExpiry === requestedExpiry;
    return samePayload
      ? { ok: true, seq_idempotent: true, eventId }
      : { ok: false, refusal: "EVENT_ID_CONFLICT" };
  };

  // Checked before anything is written, so the ordinary retry costs one read and opens no transaction.
  const earlier = await collection.findOne({ adminId: profileId, eventId });
  if (earlier) return idempotentOutcome(earlier);

  const startedAt = Date.now();

  type AttemptOutcome =
    | { kind: "inserted" }
    | { kind: "duplicate"; keyPattern: Record<string, unknown> }
    | { kind: "refused"; refusal: ContinuityRefusal };

  const attemptInsert = async (doc: GrantDoc): Promise<AttemptOutcome> => {
    if (!guarded) {
      try {
        await collection.insertOne(doc);
        return { kind: "inserted" };
      } catch (error) {
        const { duplicate, keyPattern } = isDuplicateKey(error);
        if (!duplicate) throw error;
        return { kind: "duplicate", keyPattern };
      }
    }

    try {
      const outcome = await withContinuityGuard<void>(
        db,
        {
          now,
          excludeProfileIds: [profileId],
          isSafe: (remainingHolders) =>
            !wouldLockOutSuperAdmins({
              target: input.target,
              permission: input.permission,
              effect: input.effect,
              remainingHolders,
            }),
        },
        async (session) => {
          await collection.insertOne(doc, { session });
        },
      );
      return outcome.ok ? { kind: "inserted" } : { kind: "refused", refusal: outcome.refusal };
    } catch (error) {
      const { duplicate, keyPattern } = isDuplicateKey(error);
      if (!duplicate) throw error;
      return { kind: "duplicate", keyPattern };
    }
  };

  for (let attempt = 0; attempt < SEQ_RETRIES; attempt += 1) {
    if (attempt > 0 && Date.now() - startedAt > SEQ_DEADLINE_MS) break;
    const seq = await allocateSequence(db, profileId, collection);

    // W3: the row is signed over the fields that decide access, before it is written. The verifier
    // recomputes the same canonical string from the stored document, so an edit to any of those fields
    // afterwards — by anyone — makes the row unverifiable, and an unverifiable row does not decide.
    const signingInput = {
      adminId: profileId,
      permission: input.permission,
      effect: input.effect,
      seq,
      eventId,
      grantedById: input.actorUserId,
      reason,
      expiresAt,
      createdAt: now,
    };
    assertSignable(signingInput);
    const key = permissionLogKey();
    const doc: GrantDoc & { integrity?: string } = {
      _id: randomUUID(),
      adminId: profileId,
      permission: input.permission,
      effect: input.effect,
      seq: Long.fromNumber(seq),
      eventId,
      grantedById: input.actorUserId,
      reason,
      expiresAt,
      createdAt: now,
      ...(key ? { integrity: integrityTag(signingInput, key) } : {}),
    };

    const outcome = await attemptInsert(doc);

    if (outcome.kind === "inserted") return { ok: true, seq, seq_idempotent: false, eventId };

    if (outcome.kind === "refused") {
      // Contention is a retry; a refused invariant is final.
      if (outcome.refusal !== "CONTINUITY_CONTENTION") return { ok: false, refusal: outcome.refusal };
      await backoff();
      continue;
    }

    // The same request again: believed only if the stored row says the same thing.
    if ("eventId" in outcome.keyPattern) {
      const same = await collection.findOne({ adminId: profileId, eventId });
      if (same) return idempotentOutcome(same);
    }
    // A duplicated POSITION means the counter is behind the log (a restore, or a hand-deleted counter).
    // Repair it to the position the log proves is taken, then try again from there.
    if ("seq" in outcome.keyPattern) await advanceSequenceGuard(db, profileId, seq);
    // Two appends raced for the same sequence number: back off, recompute, try again.
    await backoff();
  }

  return { ok: false, refusal: "SEQ_CONTENTION" };
}

/**
 * Change an admin's standing — deactivate, reactivate, or move tier — without removing the last way in.
 *
 * WHY THIS EXISTS. The guard in `appendPermissionEvent` protects the event log, but a super admin's
 * ability to write an event also ends when their profile is deactivated or their tier is lowered, and
 * neither path appends an event. Leaving those unguarded would mean the safeguard protects the one
 * route nobody uses while the obvious one stays open, so both routes share one decision.
 *
 * SEQUENTIAL AND CONCURRENT BEHAVIOUR ARE THE SAME ARGUMENT: the count and the write are one transaction
 * behind the fence document, so two instances deactivating two different super admins cannot both see
 * the other as still present.
 *
 * RESIDUAL RISK, stated rather than hidden: this function is a choke point only for code that calls it.
 * MongoDB cannot refuse a direct `updateOne` on `admin_profiles`, and `primemet_app` legitimately holds
 * `update` there. M2's admin routes must therefore route profile changes through this function, and
 * `docs/PRIMEMET_C3_SUPER_ADMIN_CONTINUITY.md` records that as an implementation requirement rather
 * than a nice-to-have.
 */
export interface ProfileAccessChange {
  /** The acting user — a `users._id`. Their permission is resolved here, never supplied. */
  actorUserId: string;
  /** The `admin_profiles._id` being changed. */
  profileId: string;
  isActive?: boolean;
  tier?: string;
  now?: Date;
}

export type ProfileAccessResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      refusal:
        | ContinuityRefusal
        | "ACTOR_UNRESOLVED"
        | "ACTOR_NOT_PERMITTED"
        | "PROFILE_NOT_FOUND"
        | "NO_CHANGE_SPECIFIED";
    };

export async function setAdminProfileAccess(
  db: Db,
  input: ProfileAccessChange,
): Promise<ProfileAccessResult> {
  const now = input.now ?? new Date();

  const actorState = await resolveActorPermissions(db, input.actorUserId, now);
  if (!actorState.actor?.profile) return { ok: false, refusal: "ACTOR_UNRESOLVED" };
  // The permission that governs standing, not merely access. `ACCESS_ASSIGN_ROLE` is already
  // non-delegable below SUPER_ADMIN, so this cannot be obtained by redistributing what one holds.
  if (!actorState.permissions.has("ACCESS_ASSIGN_ROLE")) return { ok: false, refusal: "ACTOR_NOT_PERMITTED" };

  const profile = await db
    .collection<ProfileDoc>(PROFILES_COLLECTION)
    .findOne({ _id: input.profileId }, { projection: { _id: 1, tier: 1, isActive: 1 } });
  if (!profile) return { ok: false, refusal: "PROFILE_NOT_FOUND" };

  const set: Record<string, unknown> = { updatedAt: now };
  if (typeof input.isActive === "boolean") set.isActive = input.isActive;
  if (typeof input.tier === "string") set.tier = input.tier;
  if (Object.keys(set).length === 1) return { ok: false, refusal: "NO_CHANGE_SPECIFIED" };

  // Only a change that takes the ability AWAY needs the guard: deactivating, or leaving SUPER_ADMIN.
  const wasSuper = profile.tier === "SUPER_ADMIN";
  const staysSuper = input.tier === undefined ? wasSuper : input.tier === "SUPER_ADMIN";
  const removesCapability = wasSuper && ((input.isActive === false) || !staysSuper);

  const profiles = db.collection<ProfileDoc>(PROFILES_COLLECTION);

  if (!removesCapability) {
    const result = await profiles.updateOne({ _id: input.profileId }, { $set: set });
    return { ok: true, changed: result.modifiedCount > 0 };
  }

  const outcome = await withContinuityGuard<{ changed: boolean }>(
    db,
    { now, excludeProfileIds: [input.profileId], isSafe: (remainingHolders) => remainingHolders > 0 },
    async (session) => {
      const result = await profiles.updateOne({ _id: input.profileId }, { $set: set }, { session });
      return { changed: result.modifiedCount > 0 };
    },
  );

  return outcome.ok
    ? { ok: true, changed: outcome.value.changed }
    : { ok: false, refusal: outcome.refusal };
}

/** Every permission name, so callers do not import the tuple separately. */
export { ADMIN_PERMISSIONS };