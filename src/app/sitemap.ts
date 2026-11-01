import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, absoluteUrl } from "@/lib/seo";

/**
 * Public sitemap.
 *
 * Generated from the same `PUBLIC_ROUTES` registry the SEO test suite asserts against, so this file
 * cannot list a page that does not exist or omit one that does. Portal, auth and API routes are
 * absent by construction: they are never added to the registry.
 *
 * No `lastModified` is emitted. Every page here is static copy with no recorded edit history, and a
 * build-time timestamp would tell Google the page changed on every deploy — the classic false
 * freshness signal. When content gains real versioning, derive `lastModified` from it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}