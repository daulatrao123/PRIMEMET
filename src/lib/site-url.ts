/**
 * Canonical site origin — the single validator for `NEXT_PUBLIC_APP_URL` (Decision 1).
 *
 * Production (`NODE_ENV=production`, i.e. `next build` and `next start`):
 *   - the variable is REQUIRED;
 *   - it must be an absolute `https:` URL with no credentials, path, query or fragment;
 *   - loopback and unspecified hosts are rejected (localhost, *.localhost, 127.0.0.0/8, ::1,
 *     0.0.0.0, ::, IPv4-mapped loopback);
 *   - there is NO fallback. An invalid value throws `SiteUrlError`.
 * Development and test may omit it (→ http://localhost:3000) or use a loopback http URL.
 *
 * Called by `next.config.ts` so a bad value stops the build before any page is rendered, and by
 * `lib/seo.ts` / the root layout so canonical URLs, sitemap.xml and robots.txt all use the value
 * this function returned — never a second, independently-defaulted copy.
 *
 * Pure and dependency-free so `scripts/test-site-url.mjs` can import it directly.
 */

export const DEV_SITE_URL = "http://localhost:3000";

export class SiteUrlError extends Error {
  constructor(message: string) {
    super(`NEXT_PUBLIC_APP_URL ${message}`);
    this.name = "SiteUrlError";
  }
}

const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    IPV4_LOOPBACK.test(h) ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "::" ||
    /^::ffff:(127\.|7f[0-9a-f]{2}:)/.test(h) ||
    /^0*:0*:0*:0*:0*:0*:0*:0*1$/.test(h)
  );
}

/**
 * Return the validated origin without a trailing slash, or throw `SiteUrlError`.
 */
export function resolveSiteUrl(value: string | undefined, nodeEnv: string | undefined): string {
  const production = nodeEnv === "production";
  const raw = value?.trim();

  if (!raw) {
    if (production) {
      throw new SiteUrlError(
        "is required for production builds. Set it to the public https origin, e.g. https://www.example.com.",
      );
    }
    return DEV_SITE_URL;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SiteUrlError(`is not a valid absolute URL: "${raw}".`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SiteUrlError(`must use https (got "${url.protocol}").`);
  }
  if (url.username || url.password) {
    throw new SiteUrlError("must not contain credentials.");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new SiteUrlError(`must be an origin only, with no path, query or fragment (got "${raw}").`);
  }

  if (production) {
    if (url.protocol !== "https:") {
      throw new SiteUrlError(`must use https in production (got "${url.origin}").`);
    }
    if (isLoopbackHost(url.hostname)) {
      throw new SiteUrlError(`must not point to a loopback host in production (got "${url.hostname}").`);
    }
  }

  return url.origin;
}
