import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { resolveSiteUrl } from "./src/lib/site-url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Baseline response headers for every route.
   *
   * The portal now handles credentials, so the cheap, universally safe headers are set here rather than
   * left to the hosting platform: no MIME sniffing, no framing of the admin area by another origin, no
   * referrer leaking a portal URL to a third party, and no silent access to device sensors.
   *
   * A Content-Security-Policy is deliberately NOT set here: the site uses inline style attributes for
   * layout, and a policy loose enough to allow them without nonces would be theatre. It belongs with the
   * deployment that can mint nonces per response.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

/**
 * Decision 1: a production build or server must never run with a missing, invalid or loopback
 * NEXT_PUBLIC_APP_URL. Validating here fails `next build` before any page (and therefore any
 * canonical URL, sitemap.xml or robots.txt) is generated.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_PRODUCTION_SERVER) {
    resolveSiteUrl(process.env.NEXT_PUBLIC_APP_URL, "production");
  }
  return nextConfig;
}
