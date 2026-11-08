import type { Metadata } from "next";
import Link from "next/link";

import { Input, Select } from "@/components/ui/input";
import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import { adminListProducts, listCatalogueTree } from "@/lib/data/catalogue";

export const metadata: Metadata = { title: "Categories and subcategories" };
export const dynamic = "force-dynamic";

/**
 * Category and subcategory management.
 *
 * The hierarchy is two levels by design: a category is the public grouping a buyer browses, and a
 * subcategory (a product family) is what a product is filed under and what the catalogue filters by.
 * Each row shows how many published products hang off it, counted from MongoDB, so a category that is
 * empty in public view is visibly empty here rather than merely suspected to be.
 */
export default async function CategoryManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdminPage("/admin/catalogue/categories");
  const query = await searchParams;

  const [tree, products] = await Promise.all([listCatalogueTree(), adminListProducts({ state: "PUBLISHED", pageSize: 100 })]);
  const publishedByFamily = new Map<string, number>();
  for (const product of products.items) {
    publishedByFamily.set(product.familyId, (publishedByFamily.get(product.familyId) ?? 0) + 1);
  }

  return (
    <PortalPage
      eyebrow="Catalogue"
      title="Categories and subcategories"
      description="The public catalogue browses by category and filters by subcategory. A product is always filed under a subcategory."
    >
      {query.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{query.ok}</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Categories" value={String(tree.length)} />
        <Stat label="Subcategories" value={String(tree.reduce((sum, category) => sum + category.families.length, 0))} />
        <Stat label="Published products" value={String(products.total)} />
      </div>

      <Panel title="New category" description="A group of subcategories, such as Scrap Metals or Spare Parts.">
        <form method="post" action="/api/admin/catalogue/categories" className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="action" value="create" />
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            Name
            <Input name="name" required maxLength={160} placeholder="Aluminium scrap" />
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            Kind
            <Select name="kind" defaultValue="SCRAP">
              <option value="SCRAP">Scrap</option>
              <option value="SPARE_PARTS">Spare parts</option>
            </Select>
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600 sm:col-span-2">
            Short description
            <Input name="shortDescription" maxLength={600} />
          </label>
          <div>
            <button type="submit" className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white">
              Create category
            </button>
          </div>
        </form>
      </Panel>

      {tree.length === 0 ? (
        <Panel title="Catalogue">
          <p className="text-sm text-steel-600">No category exists yet. Create one above to start the catalogue.</p>
        </Panel>
      ) : null}

      {tree.map((category) => (
        <Panel
          key={category.id}
          title={category.name}
          description={`${category.kind === "SCRAP" ? "Scrap" : "Spare parts"} · ${category.families.length} subcategory(ies)${category.shortDescription ? ` · ${category.shortDescription}` : ""}`}
        >
          <Table caption={`Subcategories of ${category.name}`}>
            <THead>
              <TR>
                <TH>Subcategory</TH>
                <TH>Published products</TH>
                <TH>Rename</TH>
                <TH>Delete</TH>
              </TR>
            </THead>
            <TBody>
              {category.families.length === 0 ? (
                <EmptyRow colSpan={4}>No subcategory yet — add one below.</EmptyRow>
              ) : (
                category.families.map((family) => (
                  <TR key={family.id}>
                    <TD>
                      <span className="font-medium text-navy-900">{family.name}</span>
                      <span className="block text-xs text-steel-500">/{family.slug}</span>
                    </TD>
                    <TD>{publishedByFamily.get(family.id) ?? 0}</TD>
                    <TD>
                      <form method="post" action="/api/admin/catalogue/families" className="flex items-center gap-2">
                        <input type="hidden" name="action" value="update" />
                        <input type="hidden" name="id" value={family.id} />
                        <Input name="name" defaultValue={family.name} maxLength={160} className="max-w-[12rem]" />
                        <button type="submit" className="text-xs font-medium text-green-700 underline">
                          Save
                        </button>
                      </form>
                    </TD>
                    <TD>
                      <form method="post" action="/api/admin/catalogue/families">
                        <input type="hidden" name="action" value="delete" />
                        <input type="hidden" name="id" value={family.id} />
                        <button type="submit" className="text-xs font-medium text-red-700 underline">
                          Delete
                        </button>
                      </form>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>

          <form method="post" action="/api/admin/catalogue/families" className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="action" value="create" />
            <input type="hidden" name="categoryId" value={category.id} />
            <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
              New subcategory in {category.name}
              <Input name="name" required maxLength={160} placeholder="Bearings and seals" />
            </label>
            <button type="submit" className="rounded-lg border border-navy-900 px-4 py-2 text-sm font-medium text-navy-900">
              Add subcategory
            </button>
          </form>
        </Panel>
      ))}

      <p className="text-sm text-steel-600">
        A category with subcategories cannot be deleted, and a subcategory with products cannot be deleted:
        both would orphan catalogue entries instead of removing them. Archive the products first.
      </p>

      <p className="text-sm">
        <Link className="underline" href="/admin/products">
          Back to products
        </Link>
      </p>
    </PortalPage>
  );
}
