import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { ExampleData, InternalOnly, NotRecorded } from "@/components/portal/example-data";
import { NotConnected } from "@/components/ui/not-connected";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { REJECTIONS, REJECTION_REASONS, RESOLUTION_OPTIONS } from "@/lib/content/catalogue";

export const metadata: Metadata = { title: "Rejections & disputes" };

export default function AdminRejectionsPage() {
  return (
    <PortalPage
      eyebrow="Quality & inspection"
      title="Rejections and disputes"
      description="A rejection is a documented event with a reason, evidence, an agreed responsibility and a resolution. It is not a price adjustment made quietly at settlement."
      actions={<PreviewAction>Record rejection</PreviewAction>}
    >
      <NotConnected>
        Rejection cases will be stored in PostgreSQL in Stage 3 and linked to the lot, the inspection
        version that was approved and the commercial terms that govern responsibility.
      </NotConnected>

      <ExampleData>
        One illustrative case is shown to demonstrate the record. No quantity, photograph, test
        report or amount is real.
      </ExampleData>

      <Panel
        title="Rule of responsibility"
        description="The software records the split; it does not decide it."
      >
        <div className="space-y-3 text-sm leading-6 text-steel-600">
          <p>
            Responsibility for a rejection follows the transaction terms agreed before dispatch and
            the evidence recorded at inspection and arrival. It is never assigned automatically by
            the system, and never by whichever party reports the problem first.
          </p>
          <p className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 text-xs leading-5">
            Where the agreed terms are silent on a cause of loss, the case is settled by negotiation
            and the basis is written into the settlement record.
          </p>
        </div>
      </Panel>

      <Panel title="Open cases" description="Each case keeps its reason, rejected quantity, evidence, costs and settlement.">
        <Table caption="Rejection cases with reason, responsibility, resolution and cost lines">
          <THead>
            <TR>
              <TH>Case</TH>
              <TH>Parties</TH>
              <TH>Reason</TH>
              <TH>Rejected quantity</TH>
              <TH>Resolution</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {REJECTIONS.map((rejection) => (
              <TR key={rejection.reference}>
                <TD>
                  <span className="font-mono text-xs font-semibold text-navy-950">
                    {rejection.reference}
                  </span>
                  <span className="mt-1 block font-mono text-xs text-steel-500">{rejection.lot}</span>
                </TD>
                <TD className="text-xs">
                  <span className="block">Buyer: {rejection.buyer}</span>
                  <span className="block">Supplier: {rejection.supplier}</span>
                </TD>
                <TD className="text-xs">
                  {REJECTION_REASONS.find((reason) => reason.key === rejection.reason)?.label}
                  <span className="mt-1 block text-steel-500">
                    {rejection.evidenceCount} evidence items
                  </span>
                </TD>
                <TD>
                  <NotRecorded label="Not recorded" />
                </TD>
                <TD className="text-xs">
                  {rejection.resolution
                    ? RESOLUTION_OPTIONS.find((option) => option.key === rejection.resolution)?.label
                    : "Not decided"}
                </TD>
                <TD>
                  <Badge
                    tone={rejection.status === "SETTLED" ? "green" : rejection.status === "OPEN" ? "red" : "amber"}
                  >
                    {rejection.status.replace(/_/g, " ")}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Reasons available" description="A rejection requires a documented reason from this list.">
          <ul className="grid gap-2 sm:grid-cols-2">
            {REJECTION_REASONS.map((reason) => (
              <li
                key={reason.key}
                className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 text-xs leading-5 text-steel-600"
              >
                {reason.label}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Resolution options" description="What each route means for the parties.">
          <ul className="space-y-3">
            {RESOLUTION_OPTIONS.map((option) => (
              <li key={option.key}>
                <p className="text-sm font-semibold text-navy-950">{option.label}</p>
                <p className="mt-0.5 text-sm leading-6 text-steel-600">{option.effect}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Cost lines"
        description="Costs are attached to the case, not absorbed silently into a later price."
        actions={<InternalOnly />}
      >
        <p className="text-sm leading-6 text-steel-600">
          Every case carries the same cost lines: additional transport, loading and unloading,
          storage, testing, and the final loss or recovery. Each amount stays unavailable until a
          ledger exists, so a missing figure is visible rather than treated as zero.
        </p>
      </Panel>
    </PortalPage>
  );
}
