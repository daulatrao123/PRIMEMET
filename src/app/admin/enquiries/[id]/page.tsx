import type { Metadata } from "next";
import Link from "next/link";
import { ReadinessIndicator } from "@/components/enquiry/readiness";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CLARIFICATION_FLAGS, FIELD_GROUPS, STATUS_LABEL } from "@/lib/content/enquiry-fields";

export const metadata: Metadata = { title: "Enquiry detail" };

/**
 * Admin enquiry detail — the grouped screen the desk works from.
 *
 * With no database there is no enquiry to load, so every group is rendered empty and
 * labelled. The structure, the field list and the readiness rules are the deliverable.
 *
 * TODO (Stage 2): load the enquiry by id with its lines, attachments, supplier matches,
 * supplier quotations and tax configuration; gate contact detail behind the contact-share
 * permission; record every group-level edit in the audit log.
 */

/** Sections in the order the desk works through them (spec §Task 3). */
const SECTIONS = [
  { n: 1, title: "Buyer & business details", body: "Contact, company, business type, GSTIN, billing and delivery address. Contact detail is admin-only until an introduction is approved." },
  { n: 2, title: "Material / product specifications", body: "Grade, form, condition, purity, contamination — or part number, brand, machine model and equivalent policy." },
  { n: 3, title: "Quantity & units", body: "Requested quantity with its unit, plus monthly volume where the requirement is recurring." },
  { n: 4, title: "Delivery & logistics", body: "Destination, PIN, freight preference, loading responsibility, weighbridge and site equipment." },
  { n: 5, title: "Commercial requirements", body: "Target price (private), tax preference, payment terms, credit period, quote validity." },
  { n: 6, title: "Attachments", body: "Photographs, drawings, datasheets, BOM. Served only through signed URLs; never public." },
  { n: 7, title: "Missing information & clarification checklist", body: "Every field the buyer left unknown, with the reason it matters." },
  { n: 8, title: "Supplier matching", body: "Matched suppliers, match rationale and shortlist approval before any RFQ leaves the building." },
  { n: 9, title: "Supplier quotation comparison", body: "Confidential supplier offers compared on landed basis, not headline rate." },
  { n: 10, title: "Buyer quotation preparation", body: "Selected offer, transaction model, commission or margin, transaction-specific tax, approvals." },
];

/** Fields this preview records as unknown — drives the readiness indicator honestly. */
const UNKNOWN_IN_PREVIEW = ["B.grade", "B.purity", "C.partNumber"];

export default function AdminEnquiryDetailPage() {
  return (
    <PortalPage
      eyebrow="Desk"
      title="Enquiry detail"
      description="One buyer requirement, grouped the way the desk works it: specification, readiness, sourcing, then quotation."
      actions={
        <>
          <PreviewAction>Assign owner</PreviewAction>
          <PreviewAction>Request clarification</PreviewAction>
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
        <Link href="/admin/quotation-preparation" className="text-green-700 underline underline-offset-4 hover:text-navy-950">
          Buyer quotation preparation →
        </Link>
      </nav>

      <NotConnected>
        No enquiry is loaded. Enquiries live in PostgreSQL, so this screen shows the review
        structure and the readiness rules only — no buyer record is invented for display.
      </NotConnected>

      <ReadinessIndicator unknownFields={UNKNOWN_IN_PREVIEW} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Reference", hint: "Allocated on submission (ENQ-YYYY-NNNNNN)." },
          { label: "Status", hint: "Workflow state — see the state machine in the architecture doc." },
          { label: "Transaction model", hint: "INTERMEDIARY or PRINCIPAL, set by an admin." },
          { label: "Owner", hint: "Desk administrator responsible for the next checkpoint." },
        ].map((item) => (
          <div key={item.label} className="rounded-card border border-steel-200 bg-white p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-steel-500">{item.label}</p>
            <p className="mt-2 text-xl font-semibold text-steel-500" aria-label="Not loaded in this preview">
              —
            </p>
            <p className="mt-1 text-xs leading-5 text-steel-500">{item.hint}</p>
          </div>
        ))}
      </div>

      <Panel
        title="Grouped review"
        description="Ten sections, in working order. Each one is filled from the enquiry record once the database is connected."
      >
        <ol className="space-y-3">
          {SECTIONS.map((section) => (
            <li key={section.n} className="rounded-card border border-steel-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm bg-navy-950 font-mono text-[0.65rem] text-white">
                  {String(section.n).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-navy-950">{section.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-steel-600">{section.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        title="Clarification checklist"
        description="Technical facts the buyer may legitimately not know. These flag the lead — they never reject it."
      >
        <Table caption="Fields requiring desk clarification">
          <THead>
            <TR>
              <TH>Field</TH>
              <TH>Why it matters</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            {CLARIFICATION_FLAGS.map((flag) => (
              <TR key={`${flag.group}.${flag.key}`}>
                <TD className="font-mono text-xs text-navy-900">
                  {flag.group}.{flag.key}
                </TD>
                <TD>{flag.reason}</TD>
                <TD>
                  <Badge tone="amber">Open</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel
        title="Field catalogue captured at intake"
        description="Every field an enquiry can carry, with the status the wizard enforces."
      >
        <Table caption="Enquiry field catalogue by group">
          <THead>
            <TR>
              <TH>Group</TH>
              <TH>Field</TH>
              <TH>Status</TH>
              <TH>Unit / example</TH>
            </TR>
          </THead>
          <TBody>
            {FIELD_GROUPS.flatMap((group) =>
              group.fields.map((field) => (
                <TR key={`${group.key}.${field.key}`}>
                  <TD className="whitespace-nowrap font-mono text-xs text-steel-500">{group.key}</TD>
                  <TD className="font-medium text-navy-900">{field.label}</TD>
                  <TD className="whitespace-nowrap text-xs">{STATUS_LABEL[field.status]}</TD>
                  <TD className="text-xs">{field.format ?? field.example ?? "—"}</TD>
                </TR>
              )),
            )}
          </TBody>
        </Table>
      </Panel>

      <Panel title="Supplier matches" description="Shortlist approval happens before any RFQ is issued.">
        <Table caption="Supplier matches for this enquiry">
          <THead>
            <TR>
              <TH>Supplier</TH>
              <TH>Location</TH>
              <TH>Match basis</TH>
              <TH>Shortlist</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={4}>No suppliers matched. Matching runs once the enquiry is stored.</EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="Activity" description="Append-only history: status changes, contact shares, approvals.">
        <Table caption="Enquiry activity">
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Actor</TH>
              <TH>Event</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={3}>No history. The audit trail is written when the workflow is live.</EmptyRow>
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}