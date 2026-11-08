/**
 * PRIMEMET — audit trail and authentication events.
 *
 * WHAT IS WRITTEN. Two different records, on purpose:
 *
 *   - `auth_events` — every login attempt, logout, registration and refusal, successful or not. It is
 *     the trail an incident review reads to answer "was this account taken over?".
 *   - `audit_logs` — privileged business actions: seller approval, product publication, category
 *     creation, enquiry status change, internal note edit. It answers "who changed the catalogue?".
 *
 * WHAT IS NOT TRUSTED. An audit write can fail (disk, connection, a validator). Failing the user's
 * action because the audit row failed would turn an observability problem into an outage; dropping it
 * silently would leave no trace at all. So a failed write is recorded in `audit_log_failures` and the
 * request continues. That collection is append-only and is exactly what `db/collections/core.mjs`
 * declares it to be: an audit write that failed is itself an event.
 *
 * Audit functions never throw. Their callers are request paths that have already committed the change.
 */

import { randomUUID } from "node:crypto";

import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { keyedHash } from "./hashing";
import type { Role } from "./session";

type Severity = "INFO" | "NOTICE" | "WARNING" | "CRITICAL";

function auditKey(): string | null {
  return env.AUTH_SECRET ?? null;
}

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: Role | null;
  ip?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  severity?: Severity;
}

/** Record a privileged action. Silently degrades to `audit_log_failures` rather than throwing. */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const now = new Date();
  const key = auditKey();
  const document = {
    _id: randomUUID(),
    occurredAt: now,
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole ?? null,
    actorIpHash: entry.ip && key ? keyedHash(entry.ip, key) : null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    beforeState: entry.before ?? null,
    afterState: entry.after ?? null,
    requestId: null,
    severity: entry.severity ?? "INFO",
    createdAt: now,
  };

  try {
    const db = await getDb();
    await db.collection("audit_logs").insertOne(document);
  } catch (error) {
    try {
      const db = await getDb();
      await db.collection("audit_log_failures").insertOne({
        _id: randomUUID(),
        attemptedAt: now,
        payload: document,
        error: error instanceof Error ? error.message.slice(0, 2000) : "unknown audit failure",
        resolved: false,
        createdAt: now,
      });
    } catch {
      // Last resort: the database itself is unreachable. Never throw into the request that succeeded.
    }
  }
}

export interface AuthEventEntry {
  userId?: string | null;
  emailAttempted?: string | null;
  eventType: string;
  success: boolean;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown> | null;
}

/** Record an authentication event (login, logout, registration, lockout). Never throws. */
export async function writeAuthEvent(entry: AuthEventEntry): Promise<void> {
  const now = new Date();
  const key = auditKey();
  try {
    const db = await getDb();
    await db.collection("auth_events").insertOne({
      _id: randomUUID(),
      userId: entry.userId ?? null,
      emailAttempted: entry.emailAttempted ? entry.emailAttempted.slice(0, 320) : null,
      eventType: entry.eventType.slice(0, 60),
      success: entry.success,
      ipHash: entry.ip && key ? keyedHash(entry.ip, key) : null,
      userAgentHash: entry.userAgent && key ? keyedHash(entry.userAgent, key).slice(0, 32) : null,
      detail: entry.detail ?? null,
      occurredAt: now,
      createdAt: now,
    });
  } catch {
    // Authentication must not fail because its log did.
  }
}