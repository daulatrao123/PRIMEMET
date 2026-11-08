import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductForm } from "@/components/admin/product-form";
import { Panel, PortalPage } from "@/components/portal/blocks";
import { formatImageLines, formatSpecLines } from "@/lib/catalogue-form";
import { requireAdminPage } from "@/lib/auth/guards";
import { getProductById, listCatalogueTree, listProductSpecifications } from "@/lib/data/catalogue";

export const metadata: Metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

/**
 * Edit a product.
 *
 * The gallery and the specification table are rendered back into the textareas they came from, so saving
 * without touching them is a no-op rather than a silent deletion — the failure mode of every editor that
 * shows a list it cannot round-trip.
 */
export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requireAdminPage("/admin/products");
  const { id } = await params;
  const query = await searchParams;

  const [product, tree, specifications] = await Promise.all([
    getProductById(id),
    listCatalogueTree(),
    listProductSpecifications(id),
  ]);
  if (!product) notFound();

  return (
    <PortalPage
      eyebrow="Catalogue"
      title={product.title}
      description={`/${product.slug} · ${product.publicationState.toLowerCase()}`}
    >
      {query.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{query.ok}</p>
      ) : null}

      <Panel title="Product details">
        <ProductForm
          mode="edit"
          product={product}
          tree={tree}
          imagesText={formatImageLines(product.images)}
          specsText={formatSpecLines(specifications)}
          error={query.error}
        />
      </Panel>

      <Panel title="Public page" description="What a buyer sees once this product is published.">
        <a className="text-sm font-medium text-green-700 underline" href={`/products/${product.slug}`}>
          Open /products/{product.slug}
        </a>
      </Panel>
    </PortalPage>
  );
}
