import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/guards";
import { buyerDashboard } from "@/lib/data/buyer-portal";
import { ENQUIRY_STATUS_LABELS, listEnquiriesForOrganisation } from "@/lib/data/enquiries";

export const metadata: Metadata = { title: "Your enquiries" };
export const dynamic = "force-dynamic";

/**
 * The buyer's enquiry history.
 *
 * `listEnquiriesForOrganisation` filters by the session's organisation and projects the buyer view, which
 * has no `internalNotes` field. A buyer therefore sees the conversation about their request but never the
 * desk's private working notes.
 */
export default async function BuyerEnquiriesPage() {
  const user = await requirePage(["BUYER"], "/buyer/enquiries");
  const organisationId = user.organisationId;

  const [enquiries, dashboard] = await Promise.all([
    organisationId ? listEnquiriesForOrganisation(organisationId) : Promise.resolve([]),
    buyerDashboard(user),
  ]);

  return (
    <PortalPage
      eyebrow="Buyer portal"
      title="Enquiries"
      description="Every request your organisation has raised, with the status the desk has set."
      actions={<ButtonLink href="/products">New enquiry</ButtonLink>}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Raised" value={String(dashboard.total)} />
        <Stat label="Open" value={String(dashboard.open)} />
        <Stat label="Won" value={String(dashboard.won)} />
      </div>

      <Panel title="History" description={`${enquiries.length} enquir${enquiries.length === 1 ? "y" : "ies"} for your organisation.`}>
        <Table caption="Your enquiries">
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Product</TH>
              <TH>Quantity</TH>
              <TH>Delivery</TH>
              <TH>Status</TH>
              <TH>Raised</TH>
            </TR>
          </THead>
          <TBody>
            {enquiries.length === 0 ? (
              <EmptyRow colSpan={6}>
                Nothing here yet.{" "}
                <Link className="underline" href="/products">
                  Browse the catalogue
                </Link>{" "}
                and enquire about a product.
              </EmptyRow>
            ) : (
              enquiries.map((enquiry) => (
                <TR key={enquiry.id}>
                  <TD>
                    <Link className="font-medium text-navy-900 underline" href={`/buyer/enquiries/${enquiry.id}`}>
                      {enquiry.reference}
                    </Link>
                  </TD>
                  <TD>{enquiry.productTitle}</TD>
                  <TD>
                    {enquiry.quantity} {enquiry.unit}
                  </TD>
                  <TD>{enquiry.deliveryLocation ?? "—"}</TD>
                  <TD>
                    <Badge tone={enquiry.status === "WON" ? "green" : enquiry.status === "LOST" || enquiry.status === "CANCELLED" ? "red" : "amber"}>
                      {ENQUIRY_STATUS_LABELS[enquiry.status] ?? enquiry.status}
                    </Badge>
                  </TD>
                  <TD>{enquiry.createdAt.toISOString().slice(0, 10)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}
