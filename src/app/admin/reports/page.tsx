import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Reports" };

const REPORTS = [
  { title: "Enquiry volume by grade", body: "Which grades buyers ask for, and how often a brief converts." },
  { title: "Supplier performance", body: "Non-conformance rate per supplier against delivered consignments." },
  { title: "Quotation to order conversion", body: "Where briefs stall between quotation and confirmation." },
  { title: "Landed cost variance", body: "Quoted cost against the final reconciled cost per consignment." },
];

export default function AdminReportsPage() {
  return (
    <PortalPage
      eyebrow="Oversight"
      title="Reports"
      description="Operational reporting across enquiries, quotations, consignments and supplier performance."
      actions={<PreviewAction>Export</PreviewAction>}
    >
      <NotConnected>
        Reports are aggregations over the enquiry, quotation and consignment tables. With no
        database connected, every report here has no data source and no output.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-2">
        {REPORTS.map((report) => (
          <Panel key={report.title} title={report.title} description={report.body}>
            <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-steel-300 bg-steel-50 text-xs text-steel-500">
              Chart available once reporting data exists
            </div>
          </Panel>
        ))}
      </div>

      <Panel title="Scheduled exports" description="Recurring reports for internal review.">
        <Table caption="Scheduled reports">
          <THead>
            <TR>
              <TH>Report</TH>
              <TH>Frequency</TH>
              <TH>Recipients</TH>
              <TH>Last run</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={4}>
              No scheduled reports. Exports require the reporting tables and a mail integration.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}
