import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { catalogueFacets, listPublishedProducts, PRODUCT_CONDITIONS } from "@/lib/data/catalogue";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Product catalogue",
  description:
    "Browse PRIMEMET's catalogue of verified scrap grades, reclaimed metals and industrial spare parts, with manufacturer and technical specifications.",
  path: "/products",
});

/**
 * The public catalogue.
 *
 * Rendered per request, never prerendered: a statically cached catalogue would keep showing a product
 * that an administrator unpublished this morning. Every filter is a query parameter, so a filtered view
 * is a URL a buyer can send to a colleague, and the page works with JavaScript disabled.
 *
 * Only PUBLISHED products are reachable from here — that filter is in the data layer's query, not in
 * this template, so no arrangement of parameters can surface a draft.
 */
export const dynamic = "force-dynamic";

const CONDITION_LABELS: Record<string, string> = {
  NEW: "New",
  REFURBISHED: "Refurbished",
  USED: "Used",
  UNKNOWN: "Unspecified",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; family?: string; condition?: string; sort?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const category = params.category?.trim() ?? "";
  const family = params.family?.trim() ?? "";
  const condition = (PRODUCT_CONDITIONS as readonly string[]).includes(params.condition ?? "")
    ? (params.condition as string)
    : "";
  const sort = params.sort === "title" ? "title" : "newest";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const [listing, facets] = await Promise.all([
    listPublishedProducts({ q, category, family, condition, sort, page, pageSize: 12 }),
    catalogueFacets(),
  ]);

  const pages = Math.max(1, Math.ceil(listing.total / listing.pageSize));
  const families = category ? facets.families.filter((item) => item.categorySlug === category) : facets.families;

  const query = (overrides: Record<string, string | number> = {}) => {
    const next = new URLSearchParams();
    const values: Record<string, string | number> = { q, category, family, condition, sort, page, ...overrides };
    for (const [key, value] of Object.entries(values)) {
      if (value !== "" && value !== undefined && !(key === "sort" && value === "newest") && !(key === "page" && Number(value) === 1)) {
        next.set(key, String(value));
      }
    }
    const text = next.toString();
    return text ? `/products?${text}` : "/products";
  };

  return (
    <>
      <PageHero
        eyebrow="Catalogue"
        title="Products and grades"
        description="Every listing is a catalogued item with its manufacturer, condition and technical specification — not a marketplace post."
        crumbs={[{ label: "Home", href: "/" }, { label: "Products" }]}
      />

      <Section>
        <form method="get" action="/products" className="grid gap-3 rounded-xl border border-steel-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600 lg:col-span-2">
            Search
            <Input name="q" defaultValue={q} placeholder="Bearing, 6061, SKF…" />
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            Category
            <Select name="category" defaultValue={category}>
              <option value="">All categories</option>
              {facets.categories.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name} ({item.count})
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            Subcategory
            <Select name="family" defaultValue={family}>
              <option value="">All subcategories</option>
              {families.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name} ({item.count})
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            Condition
            <Select name="condition" defaultValue={condition}>
              <option value="">Any condition</option>
              {facets.conditions.map((item) => (
                <option key={item.value} value={item.value}>
                  {CONDITION_LABELS[item.value] ?? item.value} ({item.count})
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            Sort
            <Select name="sort" defaultValue={sort}>
              <option value="newest">Newest first</option>
              <option value="title">Title A–Z</option>
            </Select>
          </label>
          <div className="sm:col-span-2 lg:col-span-6">
            <button type="submit" className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white">
              Apply filters
            </button>
            {q || category || family || condition ? (
              <Link className="ml-3 text-sm underline" href="/products">
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        <p className="mt-6 text-sm text-steel-600">
          {listing.total === 0
            ? "No product matches these filters."
            : `${listing.total} product${listing.total === 1 ? "" : "s"} · page ${listing.page} of ${pages}`}
        </p>

        {listing.items.length > 0 ? (
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {listing.items.map((product) => (
              <li key={product.id}>
                <Card className="h-full">
                  <CardBody className="flex h-full flex-col gap-3">
                    {product.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={product.imageUrl}
                        alt={product.images[0]?.alt ?? product.title}
                        className="h-40 w-full rounded-lg object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-40 items-center justify-center rounded-lg bg-steel-100 text-xs uppercase tracking-[0.14em] text-steel-500">
                        No image
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {product.categoryName ? <Badge tone="outline">{product.categoryName}</Badge> : null}
                      <Badge tone="steel">{CONDITION_LABELS[product.condition] ?? product.condition}</Badge>
                    </div>
                    <h2 className="text-base font-semibold text-navy-950">
                      <Link href={`/products/${product.slug}`} className="underline-offset-2 hover:underline">
                        {product.title}
                      </Link>
                    </h2>
                    {product.shortDescription ? (
                      <p className="text-sm leading-6 text-steel-600">{product.shortDescription}</p>
                    ) : null}
                    <dl className="mt-auto grid grid-cols-2 gap-2 text-xs text-steel-500">
                      <div>
                        <dt className="uppercase tracking-[0.1em]">Part no.</dt>
                        <dd className="text-steel-700">{product.partNumber ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-[0.1em]">Manufacturer</dt>
                        <dd className="text-steel-700">{product.manufacturer ?? "—"}</dd>
                      </div>
                    </dl>
                    <ButtonLink href={`/products/${product.slug}`} variant="secondary" size="sm">
                      View and enquire
                    </ButtonLink>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        ) : null}

        {pages > 1 ? (
          <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Catalogue pages">
            {listing.page > 1 ? (
              <Link className="underline" href={query({ page: listing.page - 1 })}>
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-steel-500">
              Page {listing.page} of {pages}
            </span>
            {listing.page < pages ? (
              <Link className="underline" href={query({ page: listing.page + 1 })}>
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </Section>
    </>
  );
}
