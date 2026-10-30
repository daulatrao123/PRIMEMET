import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Supplier quotations" };

export default function AdminSupplierQuotationsPage() {
  return (
    <PortalPage
      eyebrow="Quotations"
      title="Supplier quotation comparison"
      description="Line-by-line comparison of supplier offers for one brief. Internal only — never shown to a buyer."
      actions={<PreviewAction>Compare offers</PreviewAction>}
    >
      <NotConnected>
        Supplier quotations, purchase costs and scoring are internal records. They will be compared
        here once the quotation tables exist; this build holds none of them.
      </NotConnected>

      <Panel title="Comparison grid" description="Columns are suppliers; rows are the comparable cost components.">
        <Table caption="Supplier quotation comparison">
          <THead>
            <TR>
              <TH>Component</TH>
              <TH>Supplier A</TH>
              <TH>Supplier B</TH>
              <TH>Supplier C</TH>
              <TH>Notes</TH>
            </TR>
          </THead>
          <TBody>
            {[
              "Material or part cost",
              "Preparation and processing",
              "Freight to destination",
              "Inspection and testing",
              "Lead time",
              "Validity",
            ].map((row) => (
              <TR key={row}>
                <TH scope="row" className="px-5 py-3.5 font-semibold text-navy-950">
                  {row}
                </TH>
                <TD>—</TD>
                <TD>—</TD>
                <TD>—</TD>
                <TD className="text-xs text-steel-500">Awaiting supplier records</TD>
              </TR>
            ))}
            <EmptyRow colSpan={5}>
              Column headings are structure only. Supplier identity and prices populate once a brief
              receives supplier quotations.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Scoring criteria" description="How competing offers are weighed.">
          <ul className="space-y-2 text-sm leading-6 text-steel-600">
            {[
              "Total landed cost against the agreed specification",
              "Preparation and grading capability",
              "Documented inspection and traceability",
              "Lead time against the required window",
              "Quote validity and payment terms",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
                {item}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="What the buyer receives" description="The comparison above is condensed into this.">
          <ul className="space-y-2 text-sm leading-6 text-steel-600">
            {[
              "Specification and grade offered",
              "One offered price with its validity",
              "Delivery terms and window",
              "Inspection records proposed",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-steel-500">
            Supplier name, purchase cost, margin and internal notes are excluded by design.
          </p>
        </Panel>
      </div>
    </PortalPage>
  );
}
