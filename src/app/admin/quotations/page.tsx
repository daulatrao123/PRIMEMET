import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction, Stat } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Customer quotations" };

export default function AdminQuotationsPage() {
  return (
    <PortalPage
      eyebrow="Quotations"
      title="Customer quotations"
      description="Buyer-facing quotations prepared from a specification and the selected supplier route."
      actions={<PreviewAction>Prepare quotation</PreviewAction>}
    >
      <NotConnected>
        Quotations, their line items and their validity periods are database records. Nothing has
        been issued from this build.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Draft quotations" hint="Not yet counted — no database." />
        <Stat label="Issued" hint="Not yet counted — no database." />
        <Stat label="Accepted" hint="Not yet counted — no database." />
        <Stat label="Expired" hint="Not yet counted — no database." />
      </div>

      <Panel title="Quotation register" description="Buyer-facing documents and their state.">
        <Table caption="Customer quotation register">
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Buyer</TH>
              <TH>Enquiry</TH>
              <TH>Offered price</TH>
              <TH>Valid until</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={6}>
              No quotations. A quotation can only be prepared once an enquiry has a specification and
              a supplier route.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="Document contents" description="Exactly what a buyer-facing quotation carries.">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            "Quotation reference and issue date",
            "Material or part specification",
            "Volume and delivery terms",
            "Offered price with validity",
            "Inspection and documentation included",
            "No supplier identity, cost or margin",
          ].map((item) => (
            <div
              key={item}
              className="rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm text-navy-900"
            >
              {item}
            </div>
          ))}
        </div>
      </Panel>
    </PortalPage>
  );
}
