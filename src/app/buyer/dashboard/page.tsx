import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/guards";
import { buyerDashboard, getBuyerProfile } from "@/lib/data/buyer-portal";
import { ENQUIRY_STATUS_LABELS } from "@/lib/data/enquiries";

export const metadata: Metadata = { title: "Buyer dashboard" };
export const dynamic = "force-dynamic";

/**
 * Buyer dashboard.
 *
 * Every figure is counted from MongoDB for the session's organisation only — the aggregation filter is
 * `buyerOrganisationId: <organisation from the session>`, so a buyer's dashboard cannot describe another
 * company's activity.
 */
export default async function BuyerDashboardPage() {
  const user = await requirePage(["BUYER"], "/buyer/dashboard");
  const [dashboard, profile] = await Promise.all([buyerDashboard(user), getBuyerProfile(user)]);
  const company = profile.organisation?.legalName ?? "your organisation";

  return (
    <PortalPage
      eyebrow="Buyer portal"
      title={`Welcome, ${user.fullName.split(" ")[0]}`}
      description={`Enquiries and sourcing activity for ${company}.`}
      actions={<ButtonLink href="/products">Browse catalogue</ButtonLink>}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Enquiries raised" value={String(dashboard.total)} hint="All time, for your organisation." />
        <Stat label="Open" value={String(dashboard.open)} hint="Being sourced or quoted." />
        <Stat label="Won" value={String(dashboard.won)} />
        <Stat label="Not proceeding" value={String(dashboard.lost)} />
      </div>

      <Panel
        title="Latest enquiries"
        description="Status updates are made by the PRIMEMET desk and appear here immediately."
        actions={
          <Link className="text-sm underline" href="/buyer/enquiries">
            All enquiries
          </Link>
        }
      >
        <Table caption="Your latest enquiries">
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Product</TH>
              <TH>Quantity</TH>
              <TH>Status</TH>
              <TH>Raised</TH>
            </TR>
          </THead>
          <TBody>
            {dashboard.recent.length === 0 ? (
              <EmptyRow colSpan={5}>
                No enquiry yet.{" "}
                <Link className="underline" href="/products">
                  Find a product
                </Link>{" "}
                and use Enquire now.
              </EmptyRow>
            ) : (
              dashboard.recent.map((enquiry) => (
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
