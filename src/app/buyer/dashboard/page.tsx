import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PortalPage, PreviewAction, Stat } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Buyer dashboard" };

export default function BuyerDashboardPage() {
  return (
    <PortalPage
      eyebrow="Overview"
      title="Your sourcing desk"
      description="Enquiries you have raised, quotations addressed to you and consignments in progress."
      actions={<PreviewAction>New enquiry</PreviewAction>}
    >
      <NotConnected>
        This dashboard is scoped to one buyer account. No account exists in this build, so no
        enquiry, quotation or order can be listed.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open enquiries" hint="Not yet counted — no database." />
        <Stat label="Quotations received" hint="Not yet counted — no database." />
        <Stat label="Consignments in transit" hint="Not yet counted — no database." />
        <Stat label="Completed orders" hint="Not yet counted — no database." />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Your enquiries" description="Briefs raised against your account.">
          <Table caption="Your enquiries">
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Requirement</TH>
                <TH>Raised</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              <EmptyRow colSpan={4}>
                No enquiries yet. Submitting a brief requires the buyer forms to be connected.
              </EmptyRow>
            </TBody>
          </Table>
        </Panel>

        <Panel title="Start a brief" description="The three routes a buyer can take.">
          <div className="space-y-2">
            {[
              { href: "/buyer/enquiries/new", label: "Submit a sourcing enquiry" },
              { href: "/buyer/scrap-sourcing", label: "Scrap sourcing" },
              { href: "/buyer/spare-parts", label: "Spare-parts request" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between gap-3 rounded-md border border-steel-200 px-4 py-3 text-sm font-medium text-navy-900 transition-colors hover:border-navy-300 hover:bg-steel-50"
              >
                {item.label}
                <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 text-steel-400" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-steel-500">
            The forms on those pages are layout previews. Nothing is transmitted yet.
          </p>
        </Panel>
      </div>

      <Panel title="What you can expect" description="How PRIMEMET handles a brief once it is submitted.">
        <ol className="grid gap-4 sm:grid-cols-2">
          {[
            "Your specification is confirmed back to you in writing before sourcing starts.",
            "Only qualified suppliers are shortlisted for the grade or part.",
            "You receive one quotation with the offered price, delivery terms and validity.",
            "Inspection records travel with the consignment, and the delivered lot is reconciled against the brief.",
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
