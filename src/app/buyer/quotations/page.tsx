import type { Metadata } from "next";
import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Quotations" };

export default function BuyerQuotationsPage() {
  return (
    <PortalPage
      eyebrow="Commercial"
      title="Quotations"
      description="Quotations issued to your organisation, with the specification, offered price and validity."
    >
      <NotConnected>
        Quotations are prepared by the PRIMEMET desk against a confirmed specification. None has been
        issued in this build, and no price is displayed here.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Awaiting your decision" hint="Not yet counted — no database." />
        <Stat label="Accepted" hint="Not yet counted — no database." />
        <Stat label="Expired" hint="Not yet counted — no database." />
      </div>

      <Panel title="Your quotations" description="Buyer-facing documents only: no supplier identity, cost or margin appears in them.">
        <Table caption="Your quotations">
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Enquiry</TH>
              <TH>Specification</TH>
              <TH>Offered price</TH>
              <TH>Valid until</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={6}>
              No quotations yet. A quotation is prepared after the desk reviews a brief and selects a
              supplier route.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="What a quotation contains" description="So you know what to expect when one arrives.">
        <Table caption="Quotation contents">
          <THead>
            <TR>
              <TH>Included</TH>
              <TH>Excluded by design</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD className="text-sm leading-6 text-navy-900">
                Specification and grade or part reference · Offered price and validity · Delivery
                terms and window · Inspection and documentation included
              </TD>
              <TD className="text-sm leading-6">
                Supplier identity and contact · Supplier purchase cost · Margin and commission ·
                Internal notes
              </TD>
            </TR>
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}
