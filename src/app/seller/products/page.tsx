import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PortalPage } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/guards";
import { REVIEW_LABELS, listMyListings } from "@/lib/data/listings";
import { getSellerApplication } from "@/lib/data/seller-portal";

export const metadata: Metadata = { title: "Product listings" };
export const dynamic = "force-dynamic";

/**
 * Seller listing submission and history.
 *
 * The form carries no status, no product id and no supplier id: the supplier comes from the session and
 * the write is always PENDING. A seller cannot make a listing public, and cannot see another seller's
 * submission — the list is `listMyListings(user)`.
 */
export default async function SellerProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requirePage(["SELLER"], "/seller/products");
  const query = await searchParams;
  const [application, listings] = await Promise.all([getSellerApplication(user), listMyListings(user)]);
  const canSubmit = application.canSubmitListings;

  return (
    <PortalPage
      eyebrow="Listings"
      title="Product listings"
      description="Submit products for PRIMEMET review. A submission is never published directly: the desk decides, and the central catalogue is published by PRIMEMET."
    >
      {query.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{query.ok}</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error}
        </p>
      ) : null}

      {!canSubmit ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This account cannot submit listings while its application is not active. Contact the PRIMEMET
          desk if you believe this is wrong.
        </p>
      ) : null}

      <Panel title="Submit a listing" description="Every field you enter is reviewed by the desk. Quantity is an indication, not a commitment.">
        <form method="post" action="/api/seller/listings" className="grid gap-4 sm:grid-cols-2">
          <Field label="Product name" htmlFor="listing-title">
            <Input id="listing-title" name="title" placeholder="e.g. Aluminium 6061 turning scrap" required minLength={3} maxLength={200} />
          </Field>
          <Field label="Category" htmlFor="listing-category" hint="Material grade or part category.">
            <Input id="listing-category" name="categoryLabel" placeholder="e.g. Aluminium / Spare parts" required minLength={2} maxLength={160} />
          </Field>
          <Field label="Manufacturer" htmlFor="listing-manufacturer" hint="Optional — brand or works.">
            <Input id="listing-manufacturer" name="manufacturer" maxLength={160} />
          </Field>
          <Field label="Available quantity (kg)" htmlFor="listing-quantity" hint="Optional. Leave blank if not applicable.">
            <Input id="listing-quantity" name="quantityKg" inputMode="decimal" maxLength={20} />
          </Field>
          <Field label="Description" htmlFor="listing-description" className="sm:col-span-2" hint="At least 20 characters.">
            <Textarea id="listing-description" name="description" rows={4} required minLength={20} maxLength={4000} />
          </Field>
          <Field label="Technical specification" htmlFor="listing-specification" className="sm:col-span-2">
            <Textarea id="listing-specification" name="specification" rows={4} maxLength={4000} placeholder="Grade, composition, dimensions, tolerances, packaging." />
          </Field>
          <Field label="Image links" htmlFor="listing-images" className="sm:col-span-2" hint="https:// links only, one per line or comma separated, up to eight. File upload is not available in this build.">
            <Textarea id="listing-images" name="images" rows={2} maxLength={4000} />
          </Field>
          <Field label="Supporting information" htmlFor="listing-supporting" className="sm:col-span-2" hint="Certificates, test reports or inspection references the desk should know about.">
            <Textarea id="listing-supporting" name="supportingInfo" rows={3} maxLength={2000} />
          </Field>
          <Field label="Notes for the desk" htmlFor="listing-notes" className="sm:col-span-2" hint="Internal to PRIMEMET; never shown to a buyer.">
            <Textarea id="listing-notes" name="notes" rows={2} maxLength={2000} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!canSubmit}>
              Submit for review
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Submission history" description="Your listings, with the desk's decision and any rejection reason.">
        <Table caption="Submission history">
          <THead>
            <TR>
              <TH>Product</TH>
              <TH>Category</TH>
              <TH>Manufacturer</TH>
              <TH>Quantity</TH>
              <TH>Submitted</TH>
              <TH>Review</TH>
            </TR>
          </THead>
          <TBody>
            {listings.length === 0 ? (
              <EmptyRow colSpan={6}>No listings submitted yet.</EmptyRow>
            ) : (
              listings.map((listing) => (
                <TR key={listing.id}>
                  <TD>
                    <span className="font-medium text-navy-900">{listing.title}</span>
                    {listing.reviewStatus === "REJECTED" && listing.rejectionReason ? (
                      <span className="mt-1 block text-xs leading-5 text-red-700">Reason: {listing.rejectionReason}</span>
                    ) : null}
                    <Link
                      href={"/seller/products/" + listing.id}
                      className="mt-1 block text-xs font-medium text-green-700 underline underline-offset-2"
                    >
                      {listing.reviewStatus === "APPROVED" ? "View submission" : "Edit & resubmit"}
                    </Link>
                  </TD>
                  <TD>{listing.categoryLabel ?? "—"}</TD>
                  <TD>{listing.manufacturer ?? "—"}</TD>
                  <TD>{listing.quantityKg ? `${listing.quantityKg} kg` : "—"}</TD>
                  <TD>{listing.submittedAt.toISOString().slice(0, 10)}</TD>
                  <TD>
                    <Badge tone={listing.reviewStatus === "APPROVED" ? "green" : listing.reviewStatus === "REJECTED" ? "red" : "amber"}>
                      {REVIEW_LABELS[listing.reviewStatus]}
                    </Badge>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}
