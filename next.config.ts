import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { resolveSiteUrl } from "./src/lib/site-url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
