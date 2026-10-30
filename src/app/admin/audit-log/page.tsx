import type { Metadata } from "next";
import { Panel, PortalPage } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Audit log" };

const TRACKED = [
  "Sign-in attempts and role changes",
  "Enquiry creation, specification confirmation and closure",
  "Supplier qualification decisions",
  "Quotation issue, revision and acceptance",
  "Catalogue and price-formula changes",
  "Consignment and non-conformance records",
];

export default function AdminAuditLogPage() {
  return (
    <PortalPage
      eyebrow="Oversight"
      title="Audit log"
      description="An append-only record of who changed what, kept so a decision can be reconstructed later."
    >
      <NotConnected>
        An audit log is only meaningful with authenticated actors. Nothing is recorded in this build,
        and no entry below is real.
      </NotConnected>

      <Panel title="Entries" description="Newest first. Append-only: entries are not edited or deleted.">
        <Table caption="Audit log entries">
          <THead>
            <TR>
              <TH>Timestamp</TH>
              <TH>Actor</TH>
              <TH>Role</TH>
              <TH>Action</TH>
              <TH>Entity</TH>
              <TH>Detail</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={6}>
              No entries. The log activates with Stage 2 authentication, which supplies the actor and
              role.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="Events intended for the log" description="Planned coverage of the audit trail.">
        <div className="grid gap-3 sm:grid-cols-2">
          {TRACKED.map((item) => (
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
    </PortalPage>
  );
}
