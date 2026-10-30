import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";
import { PARTS } from "@/lib/content/parts";

export const metadata: Metadata = { title: "Spare-parts requests" };

export default function BuyerSparePartsPage() {
  return (
    <PortalPage
      eyebrow="Sourcing"
      title="Spare-parts requests"
      description="Part requests raised against your account, from identifiable OEM numbers to items that have to be reverse engineered."
      actions={<PreviewAction>New part request</PreviewAction>}
    >
      <NotConnected>
        Part requests, quotations and stock positions are database records. None exist in this build.
      </NotConnected>

      <Panel title="Your requests" description="One row per part, with its sourcing route.">
        <Table caption="Spare-parts requests">
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Part</TH>
              <TH>Machine</TH>
              <TH>Route</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No part requests. Requests will be listed here once the buyer forms are connected.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="What helps on a request" description="The detail that turns a request into a sourcing route.">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            "Nameplate or marking photograph",
            "Drawing or manual page if available",
            "Machine, duty and operating environment",
            "Whether a documented equivalent is acceptable",
            "Quantity and required window",
            "Any material or hardness requirement",
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
      </Panel>

      <Panel title="Categories we source" description="Public category pages, for reference.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PARTS.map((part) => (
            <Link
              key={part.slug}
              href={`/spare-parts/${part.slug}`}
              className="rounded-card border border-steel-200 bg-white p-4 text-sm font-medium text-navy-900 transition-colors hover:border-navy-300 hover:bg-steel-50"
            >
              {part.name}
            </Link>
          ))}
        </div>
      </Panel>
    </PortalPage>
  );
}
