import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction, Stat } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Buyers" };

export default function AdminBuyersPage() {
  return (
    <PortalPage
      eyebrow="Desk"
      title="Buyer management"
      description="Buyer organisations, the sites they receive at, and the enquiries raised against them."
      actions={<PreviewAction>Invite buyer</PreviewAction>}
    >
      <NotConnected>
        Buyer organisations and contacts will be read from PostgreSQL. No buyer exists in this build.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Registered buyers" hint="Not yet counted — no database." />
        <Stat label="Awaiting activation" hint="Not yet counted — no database." />
        <Stat label="Active this quarter" hint="Not yet counted — no database." />
        <Stat label="Open enquiries" hint="Not yet counted — no database." />
      </div>

      <Panel title="Buyer register" description="One row per organisation, with the main contact and delivery region.">
        <Table caption="Buyer register">
          <THead>
            <TR>
              <TH>Organisation</TH>
              <TH>Country</TH>
              <TH>Main contact</TH>
              <TH>Enquiries</TH>
              <TH>Account state</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No buyers recorded. Registrations submitted through the buyer route will be listed
              here once accounts can be created.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="Data visibility" description="What a buyer account will and will not expose.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-steel-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-navy-950">Visible to the buyer</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-steel-600">
              {["Their own enquiries and specifications", "Quotations addressed to them", "Delivery terms and windows", "Inspection records for their consignments"].map(
                (item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
                    {item}
                  </li>
                ),
              )}
            </ul>
          </div>
          <div className="rounded-card border border-navy-800 bg-navy-950 p-5 text-white">
            <h3 className="text-sm font-semibold">Never exposed</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-navy-300">
              {["Supplier identity and contact details", "Supplier purchase prices", "Margin, commission and internal notes", "Other buyers' enquiries"].map(
                (item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-steel-500" />
                    {item}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </Panel>
    </PortalPage>
  );
}
