import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import {
  PUBLICATION_LABELS,
  adminListProducts,
  listCatalogueTree,
  type PublicationState,
} from "@/lib/data/catalogue";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

const STATES: Array<PublicationState | "ALL"> = ["ALL", "DRAFT", "PUBLISHED", "ARCHIVED"];

/**
 * Product management.
 *
 * Reading requires an administrator twice over: middleware refuses an anonymous or non-admin request
 * before this renders, and `requireAdminPage` re-reads the session and the account status from the
 * database. The list is server-rendered from MongoDB, so what an admin sees is the catalogue as stored,
 * not a fixture compiled into the page.
 */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; page?: string; ok?: string; error?: string }>;
}) {
  await requireAdminPage("/admin/products");
  const params = await searchParams;

  const q = params.q?.trim() ?? "";
  const state = (STATES as readonly string[]).includes(params.state ?? "")
    ? (params.state as PublicationState | "ALL")
    : "ALL";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const [listing, tree] = await Promise.all([adminListProducts({ q, state, page, pageSize: 20 }), listCatalogueTree()]);

  const pages = Math.max(1, Math.ceil(listing.total / listing.pageSize));
  const counts = {
    published: listing.items.filter((item) => item.publicationState === "PUBLISHED").length,
    draft: listing.items.filter((item) => item.publicationState === "DRAFT").length,
  };

  return (
    <PortalPage
      eyebrow="Catalogue"
      title="Products"
      description="Every catalogue product, in every state. Publishing and archiving are recorded in the audit log."
      actions={<ButtonLink href="/admin/products/new">New product</ButtonLink>}
    >
      {params.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{params.ok}</p>
      ) : null}
      {params.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {params.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Products matching" value={String(listing.total)} hint="Across all states." />
        <Stat label="Published on this page" value={String(counts.published)} hint="Visible to buyers." />
        <Stat label="Drafts on this page" value={String(counts.draft)} hint="Not publicly readable." />
        <Stat label="Subcategories" value={String(tree.reduce((sum, category) => sum + category.families.length, 0))} />
      </div>

      <Panel title="Find a product" description="Search by title, part number, brand, manufacturer or slug.">
        <form method="get" action="/admin/products" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            Search
            <Input name="q" defaultValue={q} placeholder="Bearing, 6205, SKF…" />
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            State
            <Select name="state" defaultValue={state}>
              {STATES.map((option) => (
                <option key={option} value={option}>
                  {option === "ALL" ? "All states" : PUBLICATION_LABELS[option]}
                </option>
              ))}
            </Select>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white"
          >
            Filter
          </button>
        </form>
      </Panel>

      <Panel title="Catalogue" description={`Page ${listing.page} of ${pages}.`}>
        <Table caption="Catalogue products">
          <THead>
            <TR>
              <TH>Product</TH>
              <TH>Subcategory</TH>
              <TH>Part number</TH>
              <TH>Manufacturer</TH>
              <TH>State</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {listing.items.length === 0 ? (
              <EmptyRow colSpan={6}>
                No product matches. <Link href="/admin/products/new" className="underline">Create one</Link>.
              </EmptyRow>
            ) : (
              listing.items.map((product) => (
                <TR key={product.id}>
                  <TD>
                    <Link href={`/admin/products/${product.id}`} className="font-medium text-navy-900 underline">
                      {product.title}
                    </Link>
                    <span className="block text-xs text-steel-500">/{product.slug}</span>
                  </TD>
                  <TD>{product.familyName ?? "—"}</TD>
                  <TD>{product.partNumber ?? "—"}</TD>
                  <TD>{product.manufacturer ?? "—"}</TD>
                  <TD>
                    <Badge tone={product.publicationState === "PUBLISHED" ? "green" : product.publicationState === "DRAFT" ? "amber" : "steel"}>
                      {PUBLICATION_LABELS[product.publicationState]}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-2">
                      <form method="post" action="/api/admin/catalogue/products">
                        <input type="hidden" name="action" value={product.publicationState === "PUBLISHED" ? "unpublish" : "publish"} />
                        <input type="hidden" name="id" value={product.id} />
                        <input type="hidden" name="returnTo" value="/admin/products" />
                        <button type="submit" className="text-xs font-medium text-green-700 underline">
                          {product.publicationState === "PUBLISHED" ? "Unpublish" : "Publish"}
                        </button>
                      </form>
                      {product.publicationState !== "ARCHIVED" ? (
                        <form method="post" action="/api/admin/catalogue/products">
                          <input type="hidden" name="action" value="archive" />
                          <input type="hidden" name="id" value={product.id} />
                          <input type="hidden" name="returnTo" value="/admin/products" />
                          <button type="submit" className="text-xs font-medium text-red-700 underline">
                            Archive
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        <div className="mt-4 flex items-center justify-between text-sm">
          {listing.page > 1 ? (
            <Link className="underline" href={`/admin/products?q=${encodeURIComponent(q)}&state=${state}&page=${listing.page - 1}`}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {listing.page < pages ? (
            <Link className="underline" href={`/admin/products?q=${encodeURIComponent(q)}&state=${state}&page=${listing.page + 1}`}>
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      </Panel>
    </PortalPage>
  );
}
