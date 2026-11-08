import { createHash, createHmac } from "node:crypto";

/**
 * Hashing helpers shared by sessions, audit rows and auth events.
 *
 * IP addresses and user agents are stored as keyed hashes, never as clear values: an audit trail needs
 * to correlate "these five logins came from one address" without turning the database into a location
 * history of every visitor. The key is `AUTH_SECRET`, so the mapping cannot be reversed by hashing a
 * guessed address without the server secret.
 */

/** Stable hex digest, used for the session token lookup key. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** A short, keyed, non-reversible identifier for an IP or user agent. */
export function keyedHash(value: string, key: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex").slice(0, 32);
}

/** Truncate an IP's last octet before hashing (IPv4) so the audit cannot pinpoint a single host. */
export function coarseIp(ip: string): string {
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.0`;
  return ip;
}