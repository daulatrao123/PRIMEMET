import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel, PortalPage } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { requirePage } from "@/lib/auth/guards";
import { REVIEW_LABELS, getMyListing } from "@/lib/data/listings";

export const metadata: Metadata = { title: "Edit submission" };
export const dynamic = "force-dynamic";

/**
 * Edit and resubmit one submission.
 *
 * The listing is loaded with `getMyListing(user, id)`, which resolves the supplier from the session: a
 * seller who changes the id in the URL to another seller's listing is answered with a 404, not that
 * listing. An approved listing is shown read-only — its availability is what the desk accepted.
 */
export default async function SellerListingEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requirePage(["SELLER"], "/seller/products");
  const { id } = await params;
  const query = await searchParams;
  const listing = await getMyListing(user, id);
  if (!listing) notFound();

  const editable = listing.reviewStatus !== "APPROVED";

  return (
    <PortalPage
      eyebrow="Listings"
      title={listing.title}
      description="Correct what the desk asked for, then resubmit. A resubmission goes back into the review queue."
      actions={
        <Badge tone={listing.reviewStatus === "APPROVED" ? "green" : listing.reviewStatus === "REJECTED" ? "red" : "amber"}>
          {REVIEW_LABELS[listing.reviewStatus]}
        </Badge>
      }
    >
      {query.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{query.ok}</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error}
        </p>
      ) : null}

      {listing.rejectionReason ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          <span className="font-medium">The desk rejected this submission: </span>
          {listing.rejectionReason}
        </p>
      ) : null}

      <p className="text-sm text-steel-600">
        <Link href="/seller/products" className="font-medium text-green-700 underline underline-offset-2">
          Back to listings
        </Link>
      </p>

      {editable ? (
        <Panel title="Submission" description="Saving returns this listing to PENDING and clears the previous decision.">
          <form method="post" action="/api/seller/listings/update" className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="listingId" value={listing.id} />
            <Field label="Product name" htmlFor="edit-title">
              <Input id="edit-title" name="title" defaultValue={listing.title} required minLength={3} maxLength={200} />
            </Field>
            <Field label="Category" htmlFor="edit-category">
              <Input id="edit-category" name="categoryLabel" defaultValue={listing.categoryLabel ?? ""} required minLength={2} maxLength={160} />
            </Field>
            <Field label="Manufacturer" htmlFor="edit-manufacturer" hint="Optional.">
              <Input id="edit-manufacturer" name="manufacturer" defaultValue={listing.manufacturer ?? ""} maxLength={160} />
            </Field>
            <Field label="Available quantity (kg)" htmlFor="edit-quantity" hint="Optional.">
              <Input id="edit-quantity" name="quantityKg" defaultValue={listing.quantityKg ?? ""} inputMode="decimal" maxLength={20} />
            </Field>
            <Field label="Description" htmlFor="edit-description" className="sm:col-span-2" hint="At least 20 characters.">
              <Textarea id="edit-description" name="description" defaultValue={listing.description ?? ""} rows={4} required minLength={20} maxLength={4000} />
            </Field>
            <Field label="Technical specification" htmlFor="edit-specification" className="sm:col-span-2">
              <Textarea id="edit-specification" name="specification" defaultValue={listing.specification ?? ""} rows={4} maxLength={4000} />
            </Field>
            <Field label="Image links" htmlFor="edit-images" className="sm:col-span-2" hint="https:// links only, one per line or comma separated, up to eight.">
              <Textarea id="edit-images" name="images" defaultValue={listing.images.join("\n")} rows={2} maxLength={4000} />
            </Field>
            <Field label="Supporting information" htmlFor="edit-supporting" className="sm:col-span-2">
              <Textarea id="edit-supporting" name="supportingInfo" defaultValue={listing.supportingInfo ?? ""} rows={3} maxLength={2000} />
            </Field>
            <Field label="Notes for the desk" htmlFor="edit-notes" className="sm:col-span-2" hint="Internal to PRIMEMET; never shown to a buyer.">
              <Textarea id="edit-notes" name="notes" defaultValue={listing.notes ?? ""} rows={2} maxLength={2000} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Resubmit for review</Button>
            </div>
          </form>
        </Panel>
      ) : (
        <Panel title="Approved submission" description="An approved listing is what the desk accepted and is not editable.">
          <p className="text-sm leading-6 text-steel-600">
            To change availability, submit a new listing. Editing an accepted one would change a reviewed
            fact without review.
          </p>
        </Panel>
      )}
    </PortalPage>
  );
}
