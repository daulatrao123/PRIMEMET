import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Quotation preparation" };

/**
 * Buyer quotation preparation.
 *
 * The calculation inputs are fixed by the spec; the values are not. Nothing here renders a
 * currency figure, because there is no database and no price may be invented. What the
 * screen does establish is which inputs exist, which of them are internal, and the rule
 * that tax is configured per transaction rather than applied from a constant.
 *
 * TODO (Stage 2): compute from the selected supplier quote through the pricing engine,
 * resolve tax from the transaction's tax treatment, freeze a snapshot of requirement,
 * supplier offer, rate versions, margin and tax into an immutable quote version, and
 * require a second admin's approval before the quote can be sent.
 */

const INPUTS: { group: string; items: { label: string; visibility: "INTERNAL" | "BUYER" | "SNAPSHOT"; note: string }[] }[] = [
  {
    group: "Source",
    items: [
      { label: "Buyer requirement snapshot", visibility: "SNAPSHOT", note: "Frozen as submitted, so the quote can always be read against the brief." },
      { label: "Selected supplier offer", visibility: "INTERNAL", note: "One chosen quote, with its lines and conditions." },
      { label: "Supplier procurement price", visibility: "INTERNAL", note: "Never appears on the buyer document." },
    ],
  },
  {
    group: "Cost build-up",
    items: [
      { label: "Freight", visibility: "INTERNAL", note: "Included or separate, per the buyer's freight preference." },
      { label: "Handling and loading", visibility: "INTERNAL", note: "Charged per the transaction, not a fixed rate." },
      { label: "Other procurement costs", visibility: "INTERNAL", note: "Testing, certification, weighbridge, documentation." },
    ],
  },
  {
    group: "Model and margin",
    items: [
      { label: "Transaction model", visibility: "SNAPSHOT", note: "INTERMEDIARY or PRINCIPAL — recorded on the quotation and the order." },
      { label: "Commission or trading margin", visibility: "INTERNAL", note: "Intermediary: agreed fee. Principal: buy/sell spread. Never disclosed." },
    ],
  },
  {
    group: "Tax",
    items: [
      { label: "Transaction-specific tax configuration", visibility: "SNAPSHOT", note: "Type, rate, base, jurisdiction and effective date — resolved per transaction." },
      { label: "Tax calculation snapshot", visibility: "SNAPSHOT", note: "The exact computation is stored with the approved version, not recomputed later." },
    ],
  },
  {
    group: "Terms",
    items: [
      { label: "Delivery terms", visibility: "BUYER", note: "Stated on the quotation." },
      { label: "Payment terms", visibility: "BUYER", note: "Stated on the quotation." },
      { label: "Quote validity", visibility: "BUYER", note: "An explicit expiry date." },
      { label: "Exclusions and special conditions", visibility: "BUYER", note: "What the price does not cover." },
    ],
  },
];

const VISIBILITY_TONE = {
  INTERNAL: "navy",
  BUYER: "green",
  SNAPSHOT: "steel",
} as const;

export default function AdminQuotationPreparationPage() {
  return (
    <PortalPage
      eyebrow="Desk"
      title="Buyer quotation preparation"
      description="Supplier cost becomes a buyer price through the transaction model, the margin and the tax configuration for this transaction alone."
      actions={
        <>
          <PreviewAction>Save draft</PreviewAction>
          <PreviewAction>Submit for approval</PreviewAction>
        </>
      }
    >
      <nav aria-label="Related screens" className="flex flex-wrap gap-3 text-xs font-semibold">
        <Link href="/admin/enquiries" className="text-green-700 underline underline-offset-4 hover:text-navy-950">
          ← Enquiry register
        </Link>
        <Link href="/admin/supplier-quotations" className="text-green-700 underline underline-offset-4 hover:text-navy-950">
          Supplier quotation comparison →
        </Link>
      </nav>

      <NotConnected>
        No quotation is loaded. Prices, margins and tax amounts are stored in PostgreSQL, so this
        screen explains the calculation inputs and their visibility rather than displaying numbers.
      </NotConnected>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Quotation state", hint: "DRAFT → PENDING_APPROVAL → APPROVED → SENT." },
          { label: "Transaction model", hint: "Set per transaction; drives the accounting flow." },
          { label: "Tax basis", hint: "Resolved per transaction — never a hardcoded rate." },
        ].map((item) => (
          <div key={item.label} className="rounded-card border border-steel-200 bg-white p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-steel-500">{item.label}</p>
            <p className="mt-2 text-xl font-semibold text-steel-500" aria-label="No value in this preview">
              —
            </p>
            <p className="mt-1 text-xs leading-5 text-steel-500">{item.hint}</p>
          </div>
        ))}
      </div>

      <div className="rounded-card border border-amber-200 bg-amber-50 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="amber">Approval required</Badge>
          <p className="text-xs font-medium text-navy-900">
            No quotation leaves the desk without an authorised admin review.
          </p>
        </div>
        <p className="mt-2 text-xs leading-5 text-steel-600">
          The approver checks the specification match, the landed cost basis, the margin applied and
          the tax configuration. Approval limits are recorded per admin, and every approval is written
          to the audit log.
        </p>
      </div>

      <div className="space-y-4">
        {INPUTS.map((section) => (
          <Panel key={section.group} title={section.group} description="Calculation inputs and their visibility.">
            <ul className="space-y-2.5">
              {section.items.map((item) => (
                <li key={item.label} className="rounded-md border border-steel-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-navy-900">{item.label}</span>
                    <Badge tone={VISIBILITY_TONE[item.visibility]}>
                      {item.visibility === "INTERNAL" ? "Internal" : item.visibility === "BUYER" ? "Buyer-visible" : "Frozen in version"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-steel-600">{item.note}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <Panel
        title="Tax treatment for this transaction"
        description="Type, rate, base, jurisdiction and effective date are properties of the transaction."
      >
        <Table caption="Transaction tax configuration fields">
          <THead>
            <TR>
              <TH>Field</TH>
              <TH>What it holds</TH>
              <TH>Source</TH>
            </TR>
          </THead>
          <TBody>
            {[
              ["Tax type", "The applicable type for this transaction", "Tax rule resolved at quote time"],
              ["Rate", "The rate applied, stored as a Decimal", "Tax rule version, effective-dated"],
              ["Taxable base", "Goods, service, commission or goods-plus-freight", "Tax base rule on the treatment"],
              ["Jurisdiction", "Seller-of-record and place of supply", "Organisation and delivery address"],
              ["Effective date", "The date the rate version applies from", "Tax rule effective range"],
              ["Calculation snapshot", "The computed amount, preserved with the approved version", "Written on approval, never recomputed"],
            ].map(([field, holds, source]) => (
              <TR key={field}>
                <TD className="font-medium text-navy-900">{field}</TD>
                <TD>{holds}</TD>
                <TD className="text-xs">{source}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="mt-3 text-xs leading-5 text-steel-600">
          Intermediary and principal transactions can carry different tax treatment where the law
          treats them differently. No universal rate is stored anywhere in the system.
        </p>
      </Panel>

      <Panel title="Version history" description="Approved versions are immutable; a revision creates a new version.">
        <Table caption="Quotation versions">
          <THead>
            <TR>
              <TH>Version</TH>
              <TH>Created</TH>
              <TH>Approved by</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={4}>
              No versions. Each approved quotation will freeze the requirement, supplier offer, rate
              versions, margin and tax snapshot together.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}