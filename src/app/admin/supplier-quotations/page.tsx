import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Supplier quotations" };

/**
 * Supplier quotation comparison.
 *
 * Comparison is on a landed basis, because a lower headline rate with freight, loading and
 * testing excluded is usually the more expensive offer. Supplier identity and costs are
 * internal: this screen must never be reachable by a buyer or a supplier.
 *
 * TODO (Stage 2): load quote lines for one enquiry, normalise each to the enquiry's unit,
 * compute landed cost through the pricing engine, and log every shortlist decision.
 */

const COMPARISON_FIELDS = [
  { field: "Offered item & matching specification", note: "Does it actually meet the brief, or only the grade name?" },
  { field: "Offered grade / brand / model", note: "Equivalents must be identifiable as equivalents." },
  { field: "Available quantity", note: "Below the requested volume changes the whole quotation." },
  { field: "Basic price & unit", note: "Per kg, per MT or per piece — normalised before comparison." },
  { field: "Tax treatment & rate", note: "Stored per quote; no universal rate is assumed." },
  { field: "Freight", note: "Included or separate — the single most common source of false comparison." },
  { field: "Loading / unloading", note: "Who pays, and who physically provides equipment." },
  { field: "Packaging & handling", note: "Matters for parts far more than for bulk scrap." },
  { field: "Inspection / testing", note: "Third-party testing is a cost, not a footnote." },
  { field: "Delivery timeline", note: "Lead time against the buyer's required date." },
  { field: "Payment terms", note: "Credit terms carry a financing cost." },
  { field: "Quote validity", note: "A price that expires before award is not a price." },
  { field: "Stock confirmation", note: "Held, allocated or 'available on order' are different offers." },
  { field: "Certificates & documents", note: "Test reports, mill certificates, compliance." },
  { field: "Supplier remarks", note: "Conditions attached to the offer." },
];

/** Illustrative header only — no supplier names, costs or prices are invented. */
const COLUMNS = ["Supplier A", "Supplier B", "Supplier C"];

export default function AdminSupplierQuotationsPage() {
  return (
    <PortalPage
      eyebrow="Desk"
      title="Supplier quotation comparison"
      description="Compare offers on a landed basis. Supplier identity and cost are internal to PRIMEMET and never appear on a buyer-facing document."
      actions={
        <>
          <PreviewAction>Request quotations</PreviewAction>
          <PreviewAction>Export comparison</PreviewAction>
        </>
      }
    >
      <nav aria-label="Related screens" className="flex flex-wrap gap-3 text-xs font-semibold">
        <Link href="/admin/enquiries" className="text-green-700 underline underline-offset-4 hover:text-navy-950">
          ← Enquiry register
        </Link>
        <Link href="/admin/quotation-preparation" className="text-green-700 underline underline-offset-4 hover:text-navy-950">
          Buyer quotation preparation →
        </Link>
        <Link href="/admin/enquiries/example" className="text-green-700 underline underline-offset-4 hover:text-navy-950">
          Enquiry detail preview →
        </Link>
      </nav>

      <NotConnected>
        Supplier quotations live in PostgreSQL. The comparison below shows the fields and the
        ordering logic only — no supplier, price or cost figure is displayed or invented.
      </NotConnected>

      <div className="rounded-card border border-navy-800 bg-navy-950 px-5 py-4 text-white">
        <h2 className="text-sm font-semibold">Confidential — internal only</h2>
        <p className="mt-1.5 text-xs leading-5 text-navy-300">
          Buyer-visible quotations are generated from these figures, never copied from them. The
          buyer never sees supplier identity, supplier cost, or the margin applied on top.
        </p>
      </div>

      <Panel
        title="Comparison matrix"
        description="One column per returned quote. Columns are illustrative placeholders; no offer is recorded."
      >
        <Table caption="Supplier quotation comparison matrix">
          <THead>
            <TR>
              <TH>Comparison field</TH>
              {COLUMNS.map((col) => (
                <TH key={col}>{col}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {COMPARISON_FIELDS.map((row) => (
              <TR key={row.field}>
                <TD>
                  <span className="block font-medium text-navy-900">{row.field}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-steel-500">{row.note}</span>
                </TD>
                {COLUMNS.map((col) => (
                  <TD key={col} className="text-steel-400">
                    —
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Ranking rules" description="How the desk orders competing offers.">
          <ol className="space-y-2.5 text-xs leading-5 text-steel-600">
            {[
              "Landing cost first: basic price plus freight, loading, packaging, testing and tax.",
              "Specification compliance second: an offer that misses the brief is not cheaper, it is different.",
              "Delivery against the buyer's required date third.",
              "Payment terms and quote validity fourth.",
              "Supplier reliability and prior batch performance last, but never ignored.",
            ].map((item, index) => (
              <li key={item} className="flex gap-2.5">
                <span className="font-mono text-[0.65rem] text-steel-500">{String(index + 1).padStart(2, "0")}</span>
                {item}
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Status of this enquiry's quotes" description="One row per supplier approached.">
          <Table caption="Supplier quote statuses">
            <THead>
              <TR>
                <TH>Supplier</TH>
                <TH>RFQ sent</TH>
                <TH>Quote state</TH>
              </TR>
            </THead>
            <TBody>
              <EmptyRow colSpan={3}>
                No quotations requested. RFQs are issued only after the shortlist is approved.
              </EmptyRow>
            </TBody>
          </Table>
        </Panel>
      </div>

      <Panel title="What is deliberately not shown" description="Rules the UI must keep, live or in preview.">
        <ul className="grid gap-2.5 text-xs leading-5 text-steel-600 sm:grid-cols-2">
          {[
            ["Supplier cost, margin and commission", "Internal. Never on a buyer document."],
            ["Buyer target price and budget", "Private to the desk. Never shown to a supplier."],
            ["Supplier identity on buyer quotes", "Withheld until an introduction is approved."],
            ["Buyer identity on RFQs", "RFQs carry a redacted brief only."],
          ].map(([title, note]) => (
            <li key={title} className="rounded-md border border-steel-200 bg-white p-3">
              <span className="block text-xs font-semibold text-navy-900">{title}</span>
              <span className="mt-1 block text-steel-600">{note}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3">
          <Badge tone="green">Enforced in the serialiser</Badge>
        </p>
      </Panel>
    </PortalPage>
  );
}