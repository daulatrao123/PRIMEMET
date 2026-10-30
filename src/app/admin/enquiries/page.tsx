import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction, Stat } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Enquiries" };

const FILTERS = ["All enquiries", "New", "Specified", "Sourcing", "Quoted", "Closed"];

export default function AdminEnquiriesPage() {
  return (
    <PortalPage
      eyebrow="Desk"
      title="Enquiries"
      description="Structured buyer requirements: material or part, volume, destination and the standard the lot must meet."
      actions={<PreviewAction>Create enquiry</PreviewAction>}
    >
      <NotConnected>
        Enquiry records sit in PostgreSQL. Status filters, assignment and search are wired to the
        database in the integration stage, so this view is empty by design.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open enquiries" hint="Not yet counted — no database." />
        <Stat label="Awaiting specification" hint="Not yet counted — no database." />
        <Stat label="In sourcing" hint="Not yet counted — no database." />
        <Stat label="Quoted this month" hint="Not yet counted — no database." />
      </div>

      <Panel
        title="Enquiry register"
        description="One row per submitted brief, with the desk owner and current checkpoint."
        actions={
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((filter, index) => (
              <span
                key={filter}
                aria-disabled="true"
                className={
                  index === 0
                    ? "rounded-md bg-navy-950 px-2.5 py-1 text-[0.68rem] font-semibold text-white opacity-60"
                    : "rounded-md border border-steel-200 px-2.5 py-1 text-[0.68rem] font-medium text-steel-500 opacity-60"
                }
              >
                {filter}
              </span>
            ))}
          </div>
        }
      >
        <Table caption="Enquiry register">
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Buyer</TH>
              <TH>Type</TH>
              <TH>Requirement</TH>
              <TH>Destination</TH>
              <TH>Checkpoint</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={6}>
              No enquiries recorded. When the buyer forms submit, each brief will appear here with
              its specification and checkpoint.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="How an enquiry is handled" description="The desk sequence applied to every brief.">
        <ol className="grid gap-4 sm:grid-cols-2">
          {[
            "Confirm the specification back to the buyer in writing and flag anything ambiguous.",
            "Identify suitable suppliers and check licences, capacity and preparation capability.",
            "Collect and compare supplier quotations on the internal side of the desk.",
            "Prepare the buyer-facing quotation, showing specification, price and delivery terms only.",
          ].map((item, index) => (
            <li key={item} className="flex gap-3 text-sm leading-6 text-steel-600">
              <span className="font-mono text-[0.7rem] text-steel-500">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item}
            </li>
          ))}
        </ol>
      </Panel>
    </PortalPage>
  );
}
