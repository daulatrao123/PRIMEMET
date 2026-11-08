import type { Metadata } from "next";

import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/input";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import { REVIEW_LABELS, countPendingListings, listListingsForAdmin } from "@/lib/data/listings";

export const metadata: Metadata = { title: "Listing submissions" };
export const dynamic = "force-dynamic";

const FILTERS = ["PENDING", "APPROVED", "REJECTED"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * The seller listing review queue.
 *
 * A submission cannot be approved by its own author: this page is ADMIN-guarded, and `decideListing`
 * refuses a non-admin actor and a listing that is not PENDING. Approval also requires the listing to be
 * DRAFT, so approval is the only way a submission becomes ACTIVE.
 */
export default async function AdminListingSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ok?: string; error?: string }>;
}) {
  await requireAdminPage("/admin/listing-submissions");
  const query = await searchParams;
  const requested = (query.status ?? "PENDING").toUpperCase();
  const status: Filter = (FILTERS as readonly string[]).includes(requested) ? (requested as Filter) : "PENDING";
  const [listings, pendingCount] = await Promise.all([
    listListingsForAdmin({ reviewStatus: status }),
    countPendingListings(),
  ]);

  return (
    <PortalPage
      eyebrow="Desk"
      title="Listing submissions"
      description="Seller-submitted products waiting for a decision. Nothing here is visible to a buyer."
    >
      {query.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{query.ok}</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Awaiting review" hint="Across all suppliers." value={String(pendingCount)} />
        <Stat label="Showing" hint={`Filter: ${REVIEW_LABELS[status]}`} value={String(listings.length)} />
      </div>

      <Panel title="Submissions" description="Approve to accept a submission, or reject with a reason the seller reads.">
        <form method="get" action="/admin/listing-submissions" className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Show" htmlFor="listing-status">
            <Select id="listing-status" name="status" defaultValue={status}>
              {FILTERS.map((value) => (
                <option key={value} value={value}>
                  {REVIEW_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>

        <div className="space-y-4">
          {listings.length === 0 ? (
            <Table caption="Submissions">
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Supplier</TH>
                  <TH>Submitted</TH>
                  <TH>Review</TH>
                </TR>
              </THead>
              <TBody>
                <EmptyRow colSpan={4}>No submissions with this review status.</EmptyRow>
              </TBody>
            </Table>
          ) : (
            listings.map((listing) => (
              <div key={listing.id} className="rounded-lg border border-steel-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-navy-900">{listing.title}</p>
                    <p className="mt-1 text-xs text-steel-500">
                      {listing.supplierName ?? "Unknown supplier"} · {listing.categoryLabel ?? "No category"} ·{" "}
                      {listing.manufacturer ?? "No manufacturer"} · submitted {listing.submittedAt.toISOString().slice(0, 10)}
                    </p>
                    {listing.quantityKg ? <p className="mt-1 text-xs text-steel-500">Declared quantity: {listing.quantityKg} kg</p> : null}
                    {listing.description ? <p className="mt-2 max-w-3xl whitespace-pre-line text-sm leading-6 text-navy-900">{listing.description}</p> : null}
                    {listing.specification ? (
                      <p className="mt-2 max-w-3xl whitespace-pre-line rounded-md bg-steel-50 px-3 py-2 text-xs leading-5 text-navy-900">
                        Specification: {listing.specification}
                      </p>
                    ) : null}
                    {listing.supportingInfo ? (
                      <p className="mt-2 max-w-3xl whitespace-pre-line text-xs leading-5 text-steel-600">Supporting: {listing.supportingInfo}</p>
                    ) : null}
                    {listing.images.length > 0 ? (
                      <p className="mt-2 break-all text-xs leading-5 text-steel-500">Images: {listing.images.join(", ")}</p>
                    ) : null}
                    {listing.rejectionReason ? (
                      <p className="mt-2 text-xs text-red-700">Rejection reason: {listing.rejectionReason}</p>
                    ) : null}
                  </div>
                  <Badge tone={listing.reviewStatus === "APPROVED" ? "green" : listing.reviewStatus === "REJECTED" ? "red" : "amber"}>
                    {REVIEW_LABELS[listing.reviewStatus]}
                  </Badge>
                </div>

                {listing.reviewStatus === "PENDING" ? (
                  <div className="mt-4 grid gap-4 border-t border-steel-200 pt-4 lg:grid-cols-2">
                    <form method="post" action="/api/admin/listings" className="space-y-2">
                      <input type="hidden" name="listingId" value={listing.id} />
                      <input type="hidden" name="action" value="approve" />
                      <p className="text-xs leading-5 text-steel-600">
                        Approval marks the submission accepted. It does not publish a catalogue product — that is a separate
                        catalogue action.
                      </p>
                      <Button type="submit">Approve listing</Button>
                    </form>
                    <form method="post" action="/api/admin/listings" className="space-y-2">
                      <input type="hidden" name="listingId" value={listing.id} />
                      <input type="hidden" name="action" value="reject" />
                      <Field label="Rejection reason" htmlFor={`reject-${listing.id}`} hint="At least 5 characters. The seller reads it.">
                        <Textarea id={`reject-${listing.id}`} name="reason" rows={2} maxLength={500} required minLength={5} />
                      </Field>
                      <Button type="submit" variant="secondary">
                        Reject listing
                      </Button>
                    </form>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Panel>
    </PortalPage>
  );
}
