import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel, PortalPage } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { requirePage } from "@/lib/auth/guards";
import { ENQUIRY_STATUS_LABELS, getEnquiryForOrganisation } from "@/lib/data/enquiries";

export const metadata: Metadata = { title: "Enquiry" };
export const dynamic = "force-dynamic";

/**
 * One enquiry, for the organisation that raised it.
 *
 * `getEnquiryForOrganisation` takes both the organisation and the id. A buyer who edits the URL to
 * another company's enquiry gets the same 404 as an id that never existed, so the page cannot be used to
 * learn whether another company exists.
 */
export default async function BuyerEnquiryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePage(["BUYER"], "/buyer/enquiries");
  const { id } = await params;
  const enquiry = user.organisationId ? await getEnquiryForOrganisation(id, user.organisationId) : null;
  if (!enquiry) notFound();

  return (
    <PortalPage
      eyebrow="Buyer portal"
      title={enquiry.reference}
      description={`Raised ${enquiry.createdAt.toISOString().slice(0, 10)} · ${enquiry.productTitle}`}
      actions={
        <Badge tone={enquiry.status === "WON" ? "green" : enquiry.status === "LOST" || enquiry.status === "CANCELLED" ? "red" : "amber"}>
          {ENQUIRY_STATUS_LABELS[enquiry.status] ?? enquiry.status}
        </Badge>
      }
    >
      <Panel title="Request">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Product</dt>
            <dd className="text-steel-800">{enquiry.productTitle}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Quantity</dt>
            <dd className="text-steel-800">
              {enquiry.quantity} {enquiry.unit}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Delivery location</dt>
            <dd className="text-steel-800">{enquiry.deliveryLocation ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Last update</dt>
            <dd className="text-steel-800">{enquiry.updatedAt.toISOString().slice(0, 10)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Requirement</dt>
            <dd className="whitespace-pre-line text-steel-800">{enquiry.requirements}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Contact</dt>
            <dd className="text-steel-800">
              {enquiry.contactName} · {enquiry.contactEmail}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Phone</dt>
            <dd className="text-steel-800">{enquiry.contactPhone ?? "—"}</dd>
          </div>
        </dl>
      </Panel>

      <p className="text-sm">
        <Link className="underline" href="/buyer/enquiries">
          Back to your enquiries
        </Link>
      </p>
    </PortalPage>
  );
}
