import type { Metadata } from "next";
import { MATERIALS } from "@/lib/content/materials";
import { PARTS } from "@/lib/content/parts";
import { env } from "@/lib/env";
import { resolveSiteUrl } from "@/lib/site-url";

/**
 * Technical SEO contract for the public site.
 *
 * Three rules keep this honest:
 *
 * 1. **The registry below is the only list of public URLs.** `sitemap.ts`, the robots policy and
 *    `scripts/check-seo.mjs` all read it, so a page cannot be added without appearing in the sitemap
 *    and a sitemap entry cannot survive the deletion of its page.
 *
 * 2. **Nothing here invents a fact.** No price, stock level, rating, address, telephone number or
 *    certification exists in this file, so none can leak into structured data. Communication
 *    channels are published as {{PLACEHOLDER}} tokens precisely so a placeholder can never be
 *    mistaken for a real value by a reader *or* by a crawler.
 *
 * 3. **Markup is earned, not assumed.** `productSchema()` refuses to emit `Product` unless a
 *    genuine price and availability are supplied; today nothing supplies them, so no page carries
 *    Product markup. That is the intended state, not an oversight.
 */

/* -------------------------------------------------------------------------------------------- */
/* Site identity                                                                                 */
/* -------------------------------------------------------------------------------------------- */

export const SITE_NAME = "PRIMEMET";

export const SITE_DESCRIPTION =
  "PRIMEMET runs managed scrap-metal sourcing and spare-parts procurement programmes for industrial buyers and sellers: specification, inspection, logistics and documentation handled end to end.";

/**
 * Origin without a trailing slash, from the single validator. In production it throws rather than
 * fall back to localhost; next.config.ts has already run the same check before rendering starts.
 */
export const SITE_URL = resolveSiteUrl(env.NEXT_PUBLIC_APP_URL, env.NODE_ENV);

/**
 * Stable `@id` anchors. Declaring them once lets `WebSite`, `Organization` and breadcrumbs refer to
 * the same entities instead of repeating (and eventually contradicting) them.
 */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** Absolute URL for a site-relative path. The home page keeps a bare origin, with no trailing slash. */
export function absoluteUrl(path = "/"): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/* -------------------------------------------------------------------------------------------- */
/* Public route registry                                                                          */
/* -------------------------------------------------------------------------------------------- */

export type ChangeFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type PublicRoute = {
  /** Site-relative path, always beginning with "/". */
  path: string;
  changeFrequency: ChangeFrequency;
  /** Relative to other public pages only — not a claim about importance to a reader. */
  priority: number;
};

/**
 * Static public pages. Order is deliberate: it is the order the sitemap emits.
 *
 * `/login`, `/register/*`, `/admin/*`, `/buyer/*` and `/seller/*` are absent on purpose — they are
 * either incomplete previews or non-public, and they are disallowed in `robots.ts` and marked
 * noindex by their own layouts.
 */
const STATIC_PUBLIC_ROUTES: PublicRoute[] = [
  { path: "/", changeFrequency: "monthly", priority: 1 },
  { path: "/scrap-metals", changeFrequency: "monthly", priority: 0.9 },
  { path: "/spare-parts", changeFrequency: "monthly", priority: 0.9 },
  { path: "/request-a-quote", changeFrequency: "monthly", priority: 0.9 },
  { path: "/sell-scrap", changeFrequency: "monthly", priority: 0.8 },
  { path: "/source-scrap", changeFrequency: "monthly", priority: 0.8 },
  { path: "/how-it-works", changeFrequency: "monthly", priority: 0.7 },
  { path: "/trading-models", changeFrequency: "monthly", priority: 0.7 },
  { path: "/quality-assurance", changeFrequency: "monthly", priority: 0.7 },
  { path: "/industries", changeFrequency: "monthly", priority: 0.6 },
  { path: "/about", changeFrequency: "yearly", priority: 0.6 },
  { path: "/become-a-supplier", changeFrequency: "monthly", priority: 0.6 },
  { path: "/faqs", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

/**
 * Detail pages are derived from the content modules, never hand-listed. Adding a grade to
 * `MATERIALS` therefore adds a sitemap entry, and removing one removes it — the two cannot drift.
 */
const MATERIAL_ROUTES: PublicRoute[] = MATERIALS.map((material) => ({
  path: `/scrap-metals/${material.slug}`,
  changeFrequency: "monthly",
  priority: 0.8,
}));

const PART_ROUTES: PublicRoute[] = PARTS.map((part) => ({
  path: `/spare-parts/${part.slug}`,
  changeFrequency: "monthly",
  priority: 0.8,
}));

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  ...STATIC_PUBLIC_ROUTES,
  ...MATERIAL_ROUTES,
  ...PART_ROUTES,
];

/**
 * Prefixes that must never be indexed. `robots.ts` disallows them and
 * `scripts/check-seo.mjs` asserts that no sitemap URL falls under one.
 */
export const NON_PUBLIC_PREFIXES = [
  "/admin",
  "/buyer",
  "/seller",
  "/api",
  "/login",
  "/register",
] as const;

/** True when `path` sits under a prefix that must stay out of search. */
export function isNonPublicPath(path: string): boolean {
  return NON_PUBLIC_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Per-page metadata                                                                             */
/* -------------------------------------------------------------------------------------------- */

/**
 * Build the metadata object for a public page: canonical URL, Open Graph and Twitter card.
 *
 * The canonical is site-relative and resolved against `metadataBase` in the root layout, so it
 * stays correct if the origin changes. No `og:image` is emitted because no 1200×630 asset exists;
 * pointing at `icon.svg` would be a broken preview rather than a rich one.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
  noindex = false,
}: {
  title: string;
  description: string;
  /** Site-relative canonical path. */
  path: string;
  type?: "website" | "article";
  noindex?: boolean;
}): Metadata {
  const url = absoluteUrl(path);

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type,
      title,
      description,
      url,
      siteName: SITE_NAME,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Structured data                                                                               */
/* -------------------------------------------------------------------------------------------- */

type JsonLdObject = Record<string, unknown>;

/**
 * `Organization` for the site itself.
 *
 * Deliberately carries no `address`, `telephone`, `email`, `sameAs` or identifier: the repository
 * holds placeholder contact details, and publishing a placeholder as structured data would put an
 * unverified fact into search results. Add each field only when the real value is confirmed.
 */
export function organizationSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/icon.svg"),
    },
  };
}

/**
 * `WebSite` for the home page.
 *
 * No `SearchAction`: the site has no on-site search, and declaring one would promise a URL pattern
 * that does not exist.
 */
export function websiteSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: { "@id": ORGANIZATION_ID },
    inLanguage: "en",
  };
}

export type CrumbInput = { label: string; href?: string };

/**
 * `BreadcrumbList` mirroring the visible trail.
 *
 * The same `crumbs` array renders the on-page navigation and this markup, so the two cannot
 * disagree — a mismatch between visible and structured breadcrumbs is a manual-action risk.
 *
 * An entry without an `href` omits `item`: that is the current page, and Google treats the final
 * breadcrumb's URL as optional. Synthesising one would be inventing a href the page never renders.
 */
export function breadcrumbSchema(crumbs: readonly CrumbInput[]): JsonLdObject {
  const trail: CrumbInput[] = [{ label: "Home", href: "/" }, ...crumbs];

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      ...(crumb.href ? { item: absoluteUrl(crumb.href) } : {}),
    })),
  };
}

/**
 * Facts a genuine `Product` declaration would need. Both fields are required.
 *
 * Nothing in the current content supplies them: the catalogue publishes no price and no stock.
 */
export type ProductOfferFacts = {
  price: string;
  priceCurrency: string;
  availability?: string;
};

/**
 * `Product` markup, emitted **only** when a real price and currency are supplied.
 *
 * Returns `null` otherwise. Google requires `offers`, `review` or `aggregateRating` for a Product
 * rich result, so a price-less Product is ineligible anyway — and inventing a price to qualify is
 * exactly what the project forbids. Keep the gate: when pricing becomes real data in a later stage,
 * pass it in; until then this returns `null` for every call site.
 */
export function productSchema(input: {
  name: string;
  description: string;
  path: string;
  offer: ProductOfferFacts | null;
  /** Omitted unless a verified brand name exists. */
  brand?: string;
}): JsonLdObject | null {
  if (!input.offer || !input.offer.price || !input.offer.priceCurrency) return null;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path),
    ...(input.brand ? { brand: { "@type": "Brand", name: input.brand } } : {}),
    offers: {
      "@type": "Offer",
      price: input.offer.price,
      priceCurrency: input.offer.priceCurrency,
      url: absoluteUrl(input.path),
      ...(input.offer.availability ? { availability: input.offer.availability } : {}),
    },
  };
}