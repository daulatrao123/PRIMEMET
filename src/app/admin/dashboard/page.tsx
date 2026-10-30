import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PortalPage, PreviewAction, Stat } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Admin dashboard" };

const QUEUES = [
  { label: "Enquiries awaiting review", hint: "Buyer briefs that have not been specified yet." },
  { label: "Suppliers pending qualification", hint: "Registrations waiting on licence and capability review." },
  { label: "Quotations awaiting supplier prices", hint: "Briefs shortlisted but not fully priced." },
  { label: "Customer quotations issued", hint: "Buyer-facing quotations sent in the current period." },
];

const WORKFLOW = [
  { step: "01", title: "Review the enquiry", to: "/admin/enquiries" },
  { step: "02", title: "Qualify suppliers", to: "/admin/suppliers" },
  { step: "03", title: "Compare supplier prices", to: "/admin/supplier-quotations" },
  { step: "04", title: "Issue the buyer quotation", to: "/admin/quotations" },
];

export default function AdminDashboardPage() {
  return (
    <PortalPage
      eyebrow="Overview"
      title="Desk overview"
      description="Where enquiries, suppliers and quotations stand across the sourcing desk."
      actions={<PreviewAction>New enquiry</PreviewAction>}
    >
      <NotConnected>
        Every figure on this page will come from PostgreSQL. Nothing is read, counted or written
        yet, so each tile shows no value rather than an invented one.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {QUEUES.map((queue) => (
          <Stat key={queue.label} label={queue.label} hint={queue.hint} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Panel
          title="Active enquiries"
          description="Live briefs across all desks. Rows appear once enquiries are persisted."
        >
          <Table caption="Active enquiries">
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Buyer</TH>
                <TH>Requirement</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              <EmptyRow colSpan={4}>
                No enquiry records. Enquiries will be stored here when the platform database is
                connected and the buyer forms begin submitting.
              </EmptyRow>
            </TBody>
          </Table>
        </Panel>

        <Panel title="Desk workflow" description="The order every brief follows.">
          <ol className="space-y-3">
            {WORKFLOW.map((item) => (
              <li key={item.step}>
                <Link
                  href={item.to}
                  className="flex items-center gap-3 rounded-md border border-steel-200 px-4 py-3 transition-colors hover:border-navy-300 hover:bg-steel-50"
                >
                  <span className="font-mono text-[0.7rem] text-steel-500">{item.step}</span>
                  <span className="text-sm font-medium text-navy-900">{item.title}</span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    className="ml-auto size-3.5 text-steel-400"
                    fill="none"
                  >
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs leading-5 text-steel-500">
            Buyer-facing screens show specification and offered price only. Supplier identity,
            purchase cost, margins and internal notes stay on this side of the desk.
          </p>
        </Panel>
      </div>

      <Panel title="Recent activity" description="Audit-log entries for the current session.">
        <Table caption="Recent activity">
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Entity</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={4}>
              No audit entries. Actions will be recorded to the audit log once authentication and the
              database are in place.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { href: "/admin/materials", label: "Materials" },
          { href: "/admin/products", label: "Products" },
          { href: "/admin/pricing", label: "Pricing formulas" },
          { href: "/admin/reports", label: "Reports" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-card border border-steel-200 bg-white px-5 py-4 text-sm font-medium text-navy-900 transition-colors hover:border-navy-300 hover:bg-steel-50"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </PortalPage>
  );
}
