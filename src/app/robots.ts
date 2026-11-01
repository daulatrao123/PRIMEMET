import type { MetadataRoute } from "next";
import { NON_PUBLIC_PREFIXES, SITE_URL } from "@/lib/seo";

/**
 * Crawl policy.
 *
 * Portal, auth and API areas are disallowed because they are previews of screens that need a
 * session: indexing them would publish empty administrative pages, and a crawler cannot use them.
 * They are *also* marked `noindex` by their own layouts — `Disallow` stops crawling, not indexing,
 * so a disallowed URL can still be indexed if something links to it. The two together are the
 * documented way to keep a route out of search results without it ever being crawled.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...NON_PUBLIC_PREFIXES],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}