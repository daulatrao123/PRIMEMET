import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { PARTS } from "@/lib/content/parts";

export const metadata: Metadata = { title: "Product catalogue" };

export default function AdminProductsPage() {
  return (
    <PortalPage
      eyebrow="Catalogues"
      title="Product catalogue"
      description="Spare-parts categories and individual products, including obsolete and manufactured-to-drawing items."
      actions={<PreviewAction>Add product</PreviewAction>}
    >
      <NotConnected>
        Product records — part numbers, manufacturer, condition and price — belong in PostgreSQL and
        are not present. Category names below are static copy from
        <code className="mx-1 font-mono text-[0.8em]">src/lib/content/parts.ts</code>and carry no stock
        or price.
      </NotConnected>

      <Panel title="Categories" description="Category structure currently served as static copy.">
        <Table caption="Product categories">
          <THead>
            <TR>
              <TH>Category</TH>
              <TH>Slug</TH>
              <TH>Typical items</TH>
              <TH>Required inputs</TH>
              <TH>Published</TH>
            </TR>
          </THead>
          <TBody>
            {PARTS.map((part) => (
              <TR key={part.slug}>
                <TD className="font-medium text-navy-950">{part.name}</TD>
                <TD className="font-mono text-xs text-steel-500">{part.slug}</TD>
                <TD>{part.typicalItems.length}</TD>
                <TD>{part.requiredInputs.length}</TD>
                <TD>
                  <span className="rounded-full border border-steel-300 bg-steel-50 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-steel-500">
                    Static copy
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel title="Individual products" description="Part-level records — none exist yet.">
        <Table caption="Individual products">
          <THead>
            <TR>
              <TH>Part reference</TH>
              <TH>Description</TH>
              <TH>Category</TH>
              <TH>Condition</TH>
              <TH>Price</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No product records. Part numbers, manufacturer, condition and price will be managed
              here once the product table is connected.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}
