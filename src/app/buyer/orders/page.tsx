import type { Metadata } from "next";
import { Panel, PortalPage } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Order history" };

export default function BuyerOrdersPage() {
  return (
    <PortalPage
      eyebrow="Commercial"
      title="Order history"
      description="Confirmed orders and their consignments, with the records that travelled with each load."
    >
      <NotConnected>
        Orders and consignments are database records. This build creates no order and simulates no
        transaction.
      </NotConnected>

      <Panel title="Orders" description="One row per confirmed order.">
        <Table caption="Order history">
          <THead>
            <TR>
              <TH>Order</TH>
              <TH>Quotation</TH>
              <TH>Material / part</TH>
              <TH>Quantity</TH>
              <TH>Delivered</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={6}>
              No orders. Order records arrive with the quotation-to-order workflow in a later stage.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="Consignment records" description="Weighbridge tickets, photographs and non-conformance notes per load.">
        <Table caption="Consignment records">
          <THead>
            <TR>
              <TH>Consignment</TH>
              <TH>Order</TH>
              <TH>Weighbridge</TH>
              <TH>Inspection record</TH>
              <TH>Non-conformance</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No consignment records. These are generated during delivery once orders are live.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}
