import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { getSessionUser } from "@/lib/auth/session";
import { approvedAvailabilityByProduct, getPublishedProductBySlug } from "@/lib/data/catalogue";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

const CONDITION_LABELS: Record<string, string> = {
  NEW: "New",
  REFURBISHED: "Refurbished",
  USED: "Used",
  UNKNOWN: "Unspecified",
};

/** A product that is not published is not found: the status codes do not distinguish "draft" from
 *  "never existed", so a slug cannot be probed for unpublished catalogue entries. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublishedProductBySlug(slug);
  if (!product) {
    return pageMetadata({ title: "Product not found", description: "This product is not in the catalogue.", path: `/products/${slug}`, noindex: true });
  }
  return pageMetadata({
    title: product.title,
    description:
      product.shortDescription ??
      `${product.title}${product.manufacturer ? ` by ${product.manufacturer}` : ""} — catalogue item at PRIMEMET.`,
    path: `/products/${product.slug}`,
  });
}

/**
 * Product detail and the enquiry entry point.
 *
 * The enquiry form posts to `/api/enquiries`, which resolves the organisation from the session: a buyer
 * cannot raise a request in another company's name, and an anonymous visitor is not shown a form that
 * would only be refused. A signed-out visitor gets a sign-in link that returns them here.
 */
export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const product = await getPublishedProductBySlug(slug);
  if (!product) notFound();

  const [availability, user] = await Promise.all([
    approvedAvailabilityByProduct([product.id]),
    getSessionUser(),
  ]);
  const supply = availability.get(product.id) ?? null;
  const canEnquire = user?.role === "BUYER";
  const gallery = product.images.length > 0 ? product.images : product.imageUrl ? [{ url: product.imageUrl, alt: product.title, sortOrder: 0 }] : [];

  return (
    <>
      <PageHero
        eyebrow={product.categoryName ?? "Catalogue"}
        title={product.title}
        description={product.shortDescription ?? undefined}
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Products", href: "/products" },
          ...(product.categorySlug ? [{ label: product.categoryName ?? "Category", href: `/products?category=${product.categorySlug}` }] : []),
          { label: product.title },
        ]}
        meta={
          <div className="flex flex-wrap gap-2">
            <Badge tone="green">{CONDITION_LABELS[product.condition] ?? product.condition}</Badge>
            {product.familyName ? <Badge tone="outline">{product.familyName}</Badge> : null}
          </div>
        }
      />

      <Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-8">
            {gallery.length > 0 ? (
              <div className="space-y-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={gallery[0].url}
                  alt={gallery[0].alt ?? product.title}
                  className="w-full rounded-xl border border-steel-200 object-cover"
                />
                {gallery.length > 1 ? (
                  <ul className="grid grid-cols-4 gap-3">
                    {gallery.slice(1).map((image) => (
                      <li key={image.url}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url}
                          alt={image.alt ?? product.title}
                          className="h-20 w-full rounded-lg border border-steel-200 object-cover"
                          loading="lazy"
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <Card>
              <CardBody className="space-y-3">
                <h2 className="text-lg font-semibold text-navy-950">Specification</h2>
                {product.technicalSpecification ? (
                  <p className="whitespace-pre-line text-sm leading-7 text-steel-700">{product.technicalSpecification}</p>
                ) : null}
                {product.specifications.length === 0 ? (
                  <p className="text-sm text-steel-600">
                    No structured specification has been published for this item yet. The desk can confirm
                    details against the manufacturer data sheet on request.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <caption className="sr-only">Technical specifications</caption>
                    <tbody>
                      {product.specifications.map((row) => (
                        <tr key={`${row.attribute}-${row.sortOrder}`} className="border-b border-steel-100">
                          <th scope="row" className="w-1/2 py-2 text-left font-medium text-steel-600">
                            {row.attribute}
                          </th>
                          <td className="py-2 text-steel-800">
                            {row.value}
                            {row.unit ? ` ${row.unit}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card>
              <CardBody className="space-y-3">
                <h2 className="text-base font-semibold text-navy-950">Item facts</h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-steel-500">Part number</dt>
                    <dd className="text-right text-steel-800">{product.partNumber ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-steel-500">Manufacturer</dt>
                    <dd className="text-right text-steel-800">{product.manufacturer ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-steel-500">Brand</dt>
                    <dd className="text-right text-steel-800">{product.brand ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-steel-500">Subcategory</dt>
                    <dd className="text-right text-steel-800">{product.familyName ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-steel-500">Pricing</dt>
                    <dd className="text-right text-steel-800">Quote on request</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-steel-500">Approved supply</dt>
                    <dd className="text-right text-steel-800">
                      {supply ? `${supply.listings} supplier(s) · ${supply.quantityKg.toLocaleString("en-IN")} kg` : "Sourcing on request"}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-4">
                <h2 className="text-base font-semibold text-navy-950">Enquire now</h2>

                {query.error ? (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {query.error}
                  </p>
                ) : null}

                {canEnquire && user ? (
                  <form method="post" action="/api/enquiries" className="space-y-3">
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="returnTo" value={`/products/${product.slug}`} />

                    <Field label="Quantity" htmlFor="enquiry-quantity">
                      <Input id="enquiry-quantity" name="quantity" required inputMode="decimal" placeholder="500" />
                    </Field>
                    <Field label="Unit" htmlFor="enquiry-unit">
                      <Select id="enquiry-unit" name="unit" defaultValue="KG">
                        <option value="KG">Kilograms</option>
                        <option value="MT">Metric tonnes</option>
                        <option value="PIECES">Pieces</option>
                      </Select>
                    </Field>
                    <Field label="Requirement" htmlFor="enquiry-requirements" hint="Grade, delivery window, packing — at least 20 characters.">
                      <Textarea id="enquiry-requirements" name="requirements" rows={4} required minLength={20} maxLength={4000} />
                    </Field>
                    <Field label="Delivery location" htmlFor="enquiry-location">
                      <Input id="enquiry-location" name="deliveryLocation" maxLength={200} placeholder="Pune, Maharashtra" />
                    </Field>
                    <Field label="Your name" htmlFor="enquiry-name">
                      <Input id="enquiry-name" name="contactName" required defaultValue={user.fullName} maxLength={120} />
                    </Field>
                    <Field label="Email" htmlFor="enquiry-email">
                      <Input id="enquiry-email" name="contactEmail" type="email" required defaultValue={user.email} />
                    </Field>
                    <Field label="Phone" htmlFor="enquiry-phone" hint="Optional, but it is the fastest way for the desk to reply.">
                      <Input id="enquiry-phone" name="contactPhone" inputMode="tel" />
                    </Field>

                    <Button type="submit" className="w-full">
                      Send enquiry
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-3 text-sm text-steel-600">
                    <p>
                      Enquiries are raised from a buyer account so that quotes, revisions and delivery terms
                      stay attached to your organisation.
                    </p>
                    <Link
                      className="inline-flex rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white"
                      href={`/login?next=${encodeURIComponent(`/products/${product.slug}`)}`}
                    >
                      Sign in to enquire
                    </Link>
                    <p>
                      No account?{" "}
                      <Link className="underline" href="/register/buyer">
                        Register as a buyer
                      </Link>
                      .
                    </p>
                  </div>
                )}
              </CardBody>
            </Card>
          </aside>
        </div>
      </Section>
    </>
  );
}
