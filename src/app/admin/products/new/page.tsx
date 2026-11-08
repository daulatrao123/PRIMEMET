import type { Metadata } from "next";
import Link from "next/link";

import { ProductForm } from "@/components/admin/product-form";
import { Panel, PortalPage } from "@/components/portal/blocks";
import { requireAdminPage } from "@/lib/auth/guards";
import { listCatalogueTree } from "@/lib/data/catalogue";

export const metadata: Metadata = { title: "New product" };
export const dynamic = "force-dynamic";

/**
 * Create a product.
 *
 * The subcategory list is read from MongoDB, so a product can only be filed under a subcategory that
 * exists. If the catalogue has no categories yet, the form says so and links to the manager rather than
 * offering an empty select that fails on submit.
 */
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdminPage("/admin/products/new");
  const params = await searchParams;
  const tree = await listCatalogueTree();
  const hasFamilies = tree.some((category) => category.families.length > 0);

  return (
    <PortalPage
      eyebrow="Catalogue"
      title="New product"
      description="A product is filed under a subcategory, which is what the public catalogue filters by."
    >
      {!hasFamilies ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No subcategory exists yet. Create a category and a subcategory in{" "}
          <Link className="underline" href="/admin/catalogue/categories">
            category management
          </Link>{" "}
          first.
        </p>
      ) : null}

      <Panel title="Product details">
        <ProductForm mode="create" tree={tree} error={params.error} />
      </Panel>
    </PortalPage>
  );
}
