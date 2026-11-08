/**
 * PRIMEMET — request/response helpers shared by the Phase 1 routes.
 *
 * Two rules live here because they have to be applied identically everywhere:
 *
 * 1. **A form post and a JSON call are the same operation.** The portal forms are plain HTML forms so
 *    they work without JavaScript; the tests and any future API client post JSON. `readInput` normalises
 *    both, and the route decides how to answer from the request's `Accept`/content type. There is one
 *    validation path, not a browser path and a privileged one.
 * 2. **A cross-site POST is refused before anything else runs.** The session cookie is `SameSite=Lax`,
 *    which already keeps it off a cross-site POST; the explicit Origin check is the second lock, and it
 *    is what an auditor can point at. A request with no Origin (curl, server-to-server) is allowed —
 *    it also carries no ambient cookie.
 */

import { NextResponse, type NextRequest } from "next/server";

/** Normalise a form body or a JSON body into string fields. Arrays/objects are ignored, not coerced. */
export async function readInput(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  const result: Record<string, string> = {};

  if (contentType.includes("application/json")) {
    const body: unknown = await request.json().catch(() => null);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (typeof value === "string") result[key] = value;
        else if (typeof value === "number" || typeof value === "boolean") result[key] = String(value);
        // A list of strings is the JSON shape of a repeated form field (image links, tags). Joining with
        // newlines gives the same value a textarea would post, so one validation path serves both.
        else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
          result[key] = value.join("\n");
        }
      }
    }
    return result;
  }

  const form = await request.formData().catch(() => null);
  if (form) {
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  }

  // Some clients omit the content type but still send a urlencoded body.
  const text = await request.text().catch(() => "");
  if (text) {
    for (const [key, value] of new URLSearchParams(text).entries()) result[key] = value;
  }
  return result;
}

/** Answer in JSON when the caller asked for it, otherwise redirect back to a page with an error. */
export function wantsJson(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  const contentType = request.headers.get("content-type") ?? "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

export function jsonError(status: number, message: string, code = "error"): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export function jsonOk(body: Record<string, unknown> = {}, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...body }, { status });
}

/** 303 so the browser issues a GET to the destination, never a replay of the POST. */
export function redirectTo(request: NextRequest, path: string, params: Record<string, string> = {}): NextResponse {
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

/** A same-site path only. Rejects `//evil.test`, absolute URLs and backslash tricks. */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

/**
 * True when the request names an Origin that is not this host.
 *
 * Compares host (not scheme): a reverse proxy terminates TLS, so the request's own scheme is not a
 * reliable claim. An empty Origin is not cross-site — it means a non-browser client.
 */
export function isCrossSite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** The client address, if the platform provides one. Never required, never trusted for authorisation. */
export function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

/** A stable, human-readable error string for a redirect. Capped so a URL cannot carry a payload. */
export function shortMessage(value: string, max = 160): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}