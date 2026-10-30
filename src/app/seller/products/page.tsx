import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Product listings" };

export default function SellerProductsPage() {
  return (
    <PortalPage
      eyebrow="Listings"
      title="Product listings"
      description="Spare parts and manufactured components you can supply, including items made to drawing."
      actions={<PreviewAction>Add product listing</PreviewAction>}
    >
      <NotConnected>
        Product listings are supplier records in PostgreSQL. No part number, price or stock position
        is stored in this build.
      </NotConnected>

      <Panel title="Your products" description="One row per part or manufactured item.">
        <Table caption="Product listings">
          <THead>
            <TR>
              <TH>Part reference</TH>
              <TH>Description</TH>
              <TH>Category</TH>
              <TH>Capacity</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No product listings. They appear once a supplier account can store records.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Items that fit this route" description="What buyers ask the desk for most often.">
          <ul className="space-y-2 text-sm leading-6 text-steel-600">
            {[
              "Bearings, seals and housings",
              "Pumps, valves and actuators",
              "Gearboxes, couplings and drives",
              "Wear plates, liners and castings",
              "Obsolete components manufactured to drawing",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
                {item}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Manufacturing listings" description="Only relevant if you machine or fabricate to a drawing.">
          <p className="text-sm leading-6 text-steel-600">
            A manufactured listing states the materials and tolerances you can hold, and the
            inspection you can arrange. Buyers approve the drawing before production, so the listing
            is about capability rather than stock.
          </p>
          <div className="mt-4 rounded-md border border-dashed border-steel-300 bg-steel-50 px-4 py-3 text-xs leading-5 text-steel-600">
            Drawing upload and version control are not implemented. Storage is decided in a later
            stage, and no file is accepted on this page.
          </div>
        </Panel>
      </div>
    </PortalPage>
  );
}
