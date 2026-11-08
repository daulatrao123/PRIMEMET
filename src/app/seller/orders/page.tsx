import type { Metadata } from "next";

import { requirePage } from "@/lib/auth/guards";
import { Panel, PortalPage } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Orders" };

export default async function SellerOrdersPage() {
  // A preview, but still a seller area: an anonymous visitor is redirected before anything renders.
  await requirePage(["SELLER"], "/seller/orders");
  return (
    <PortalPage
      eyebrow="Commercial"
      title="Orders"
      description="Consignments awarded to you, with the delivery terms and records that follow each load."
    >
      <NotConnected>
        Orders, consignments and weighbridge records are database records. Nothing on this page is
        real and no order can be created in this build.
      </NotConnected>

      <Panel title="Awarded consignments" description="One row per consignment.">
        <Table caption="Awarded consignments">
          <THead>
            <TR>
              <TH>Consignment</TH>
              <TH>Material</TH>
              <TH>Quantity</TH>
              <TH>Collection window</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No consignments. Records appear here once an order is awarded through the platform.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="Records required per consignment" description="What the desk expects to receive with a load.">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            "Weighbridge ticket at origin",
            "Photographs of the prepared lot",
            "Inspection or testing results where required",
            "Non-conformance note if anything differs from the brief",
          ].map((item) => (
            <div
              key={item}
              className="flex items-start gap-3 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm text-navy-900"
            >
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-green-600" />
              {item}
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-steel-500">
          File upload is not implemented. Storage is decided in a later stage.
        </p>
      </Panel>
    </PortalPage>
  );
}
