import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PortalPage, PreviewAction, Stat } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Seller dashboard" };

export default function SellerDashboardPage() {
  return (
    <PortalPage
      eyebrow="Overview"
      title="Supplier desk"
      description="Your listings, the briefs the PRIMEMET desk has sent you, and your quotation submissions."
      actions={<PreviewAction>Add listing</PreviewAction>}
    >
      <NotConnected>
        This dashboard is scoped to one supplier account. No account exists in this build, so no
        listing, brief or quotation can be listed.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active listings" hint="Not yet counted — no database." />
        <Stat label="Briefs received" hint="Not yet counted — no database." />
        <Stat label="Quotations submitted" hint="Not yet counted — no database." />
        <Stat label="Qualification state" hint="Assigned during supplier review." />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Briefs sent to you" description="Requirements the desk has matched to your categories.">
          <Table caption="Briefs sent to you">
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Requirement</TH>
                <TH>Volume</TH>
                <TH>Deadline</TH>
              </TR>
            </THead>
            <TBody>
              <EmptyRow colSpan={4}>
                No briefs. Matching a brief to a supplier requires qualification records and a
                connected database.
              </EmptyRow>
            </TBody>
          </Table>
        </Panel>

        <Panel title="Set up your account" description="The sequence a supplier completes before quoting.">
          <ol className="space-y-2">
            {[
              { href: "/seller/profile", label: "Business profile" },
              { href: "/seller/tax", label: "Tax and GST details" },
              { href: "/seller/materials", label: "Material listings" },
              { href: "/seller/products", label: "Product listings" },
            ].map((item, index) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-md border border-steel-200 px-4 py-3 text-sm font-medium text-navy-900 transition-colors hover:border-navy-300 hover:bg-steel-50"
                >
                  <span className="font-mono text-[0.7rem] text-steel-500">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel title="How supplier quotations are handled" description="What happens to a price you submit.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            "Your quotation is compared with others for the same brief, internally.",
            "Your identity, price and terms are never shown to the buyer.",
            "The buyer receives one consolidated quotation from PRIMEMET.",
            "If you are selected, the brief, specification and delivery terms are confirmed with you in writing.",
          ].map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm leading-6 text-navy-900"
            >
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-green-600" />
              {item}
            </li>
          ))}
        </ul>
      </Panel>
    </PortalPage>
  );
}
