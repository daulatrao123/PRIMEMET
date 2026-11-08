import type { Metadata } from "next";

import { Panel, PortalPage } from "@/components/portal/blocks";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { requirePage } from "@/lib/auth/guards";
import { listPublishedProducts } from "@/lib/data/catalogue";

export const metadata: Metadata = { title: "New enquiry" };
export const dynamic = "force-dynamic";

/**
 * Raise an enquiry from the portal.
 *
 * The product list is the published catalogue, read from MongoDB — a buyer cannot type a product id, and
 * the server re-resolves it against published products anyway. If a buyer arrived from a product page the
 * id is preselected, so the two entry points into the same workflow behave the same way.
 */
export default async function BuyerNewEnquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; error?: string }>;
}) {
  const user = await requirePage(["BUYER"], "/buyer/enquiries/new");
  const query = await searchParams;
  const listing = await listPublishedProducts({ pageSize: 48, sort: "title" });

  return (
    <PortalPage
      eyebrow="Buyer portal"
      title="New enquiry"
      description="Tell the desk what you need. The request is attached to your organisation, and quotes come back against the same reference."
    >
      {query.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error}
        </p>
      ) : null}

      <Panel title="Requirement">
        {listing.items.length === 0 ? (
          <p className="text-sm text-steel-600">
            The catalogue has no published product yet, so there is nothing to enquire about. The desk can
            still source an item — contact them directly and it will be catalogued.
          </p>
        ) : (
          <form method="post" action="/api/enquiries" className="grid gap-4 sm:grid-cols-2">
            <Field label="Product" htmlFor="enquiry-product" className="sm:col-span-2">
              <Select id="enquiry-product" name="productId" required defaultValue={query.product ?? ""}>
                <option value="">Choose a product</option>
                {listing.items.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.title}
                    {product.partNumber ? ` — ${product.partNumber}` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Quantity" htmlFor="enquiry-quantity">
              <Input id="enquiry-quantity" name="quantity" required inputMode="decimal" placeholder="2500" />
            </Field>
            <Field label="Unit" htmlFor="enquiry-unit">
              <Select id="enquiry-unit" name="unit" defaultValue="KG">
                <option value="KG">Kilograms</option>
                <option value="MT">Metric tonnes</option>
                <option value="PIECES">Pieces</option>
              </Select>
            </Field>

            <Field label="Requirement" htmlFor="enquiry-requirements" className="sm:col-span-2" hint="Grade, tolerance, packing, delivery window — at least 20 characters.">
              <Textarea id="enquiry-requirements" name="requirements" rows={5} required minLength={20} maxLength={4000} />
            </Field>

            <Field label="Delivery location" htmlFor="enquiry-location">
              <Input id="enquiry-location" name="deliveryLocation" maxLength={200} placeholder="Pune, Maharashtra" />
            </Field>
            <Field label="Contact name" htmlFor="enquiry-contact">
              <Input id="enquiry-contact" name="contactName" required defaultValue={user.fullName} maxLength={120} />
            </Field>
            <Field label="Contact email" htmlFor="enquiry-email">
              <Input id="enquiry-email" name="contactEmail" type="email" required defaultValue={user.email} />
            </Field>
            <Field label="Contact phone" htmlFor="enquiry-phone">
              <Input id="enquiry-phone" name="contactPhone" inputMode="tel" />
            </Field>

            <div className="sm:col-span-2">
              <Button type="submit">Send enquiry</Button>
            </div>
          </form>
        )}
      </Panel>
    </PortalPage>
  );
}
