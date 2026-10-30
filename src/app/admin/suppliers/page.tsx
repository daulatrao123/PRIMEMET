import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction, Stat } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Suppliers" };

export default function AdminSuppliersPage() {
  return (
    <PortalPage
      eyebrow="Desk"
      title="Supplier management"
      description="Qualification, categories handled and preparation capability. Supplier identity stays internal."
      actions={<PreviewAction>Invite supplier</PreviewAction>}
    >
      <NotConnected>
        Supplier records, licence references and qualification status will be read from PostgreSQL.
        No supplier exists in this build.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Registered suppliers" hint="Not yet counted — no database." />
        <Stat label="Pending qualification" hint="Not yet counted — no database." />
        <Stat label="Qualified" hint="Not yet counted — no database." />
        <Stat label="Suspended" hint="Not yet counted — no database." />
      </div>

      <Panel title="Supplier register" description="Every supplier with its qualification state and categories.">
        <Table caption="Supplier register">
          <THead>
            <TR>
              <TH>Supplier</TH>
              <TH>Country</TH>
              <TH>Categories</TH>
              <TH>Licences</TH>
              <TH>Qualification</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No suppliers recorded. Registrations submitted through the supplier route will be
              listed here for review.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="Qualification checklist" description="Applied to every supplier before a first brief is offered.">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            "Legal identity and trading address confirmed",
            "Licences and permits checked for validity",
            "Preparation capability verified (cutting, sorting, baling)",
            "Weighbridge and documentation practice reviewed",
            "Category fit confirmed against live briefs",
            "Payment and inspection terms agreed in writing",
          ].map((item) => (
            <div
              key={item}
              className="flex items-start gap-3 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm text-navy-900"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm border border-steel-300 bg-white"
              />
              {item}
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-steel-500">
          Checklist items are recorded against the supplier once the profile tables are live.
        </p>
      </Panel>
    </PortalPage>
  );
}
