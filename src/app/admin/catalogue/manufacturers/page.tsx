import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import { listManufacturers } from "@/lib/data/admin-console";

export const metadata: Metadata = { title: "Manufacturers" };
export const dynamic = "force-dynamic";

/**
 * Manufacturers, as named on live products.
 *
 * A product stores its manufacturer by name, so this screen derives the list from the catalogue rather
 * than keeping a second table that can disagree with it. Renaming here updates every live product that
 * carries the name and writes one audit row; product slugs are untouched, so existing URLs survive.
 */
export default async function AdminManufacturersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdminPage("/admin/catalogue/manufacturers");
  const params = await searchParams;
  const manufacturers = await listManufacturers();
  const totalProducts = manufacturers.reduce((sum, row) => sum + row.products, 0);
  const unnamed = manufacturers.length === 0;

  return (
    <PortalPage
      eyebrow="Catalogue"
      title="Manufacturers"
      description="Every manufacturer named on a live product, with the number of products that carry it."
      actions={
        <Link className="text-sm font-medium text-green-700 underline" href="/admin/products">
          Products
        </Link>
      }
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
        <Stat label="Manufacturers" value={String(manufacturers.length)} hint="Derived from live products." />
        <Stat label="Products carrying one" value={String(totalProducts)} hint="Across every publication state." />
        <Stat
          label="Published products"
          value={String(manufacturers.reduce((sum, row) => sum + row.published, 0))}
          hint="Visible in the public catalogue."
        />
        <Stat label="Rename scope" value="Catalogue-wide" hint="Every live product with that name." />
      </div>

      <Panel
        title="Manufacturer list"
        description="A rename is one bounded update over the matching products and is recorded in the audit log."
      >
        <Table caption="Manufacturers">
          <THead>
            <TR>
              <TH>Manufacturer</TH>
              <TH>Products</TH>
              <TH>Published</TH>
              <TH>Rename</TH>
            </TR>
          </THead>
          <TBody>
            {unnamed ? (
              <EmptyRow colSpan={4}>
                No product names a manufacturer yet. Add one on a product in{" "}
                <Link className="underline" href="/admin/products">
                  product management
                </Link>
                .
              </EmptyRow>
            ) : (
              manufacturers.map((row) => (
                <TR key={row.name}>
                  <TD className="font-medium text-navy-900">{row.name}</TD>
                  <TD>{row.products}</TD>
                  <TD>{row.published}</TD>
                  <TD>
                    <form method="post" action="/api/admin/manufacturers" className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="from" value={row.name} />
                      <input
                        name="to"
                        required
                        minLength={2}
                        maxLength={160}
                        defaultValue={row.name}
                        aria-label={`New name for ${row.name}`}
                        className="w-48 rounded-md border border-steel-300 px-2 py-1 text-xs"
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Rename
                      </Button>
                    </form>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </Panel>

      <Panel title="Why names, not ids" description="How the catalogue references a manufacturer.">
        <p className="text-sm leading-6 text-steel-600">
          Products store the manufacturer as a name because that is what a buyer reads and what supplier
          listings declare. Keeping a second manufacturer table would let the two disagree silently, so
          this screen derives its list from the live catalogue. Renaming rewrites the name on every matching
          product in one update; the product slug — and therefore the public URL — is never rewritten.
        </p>
      </Panel>
    </PortalPage>
  );
}
