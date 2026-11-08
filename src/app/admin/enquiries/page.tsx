import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import {
  ENQUIRY_STATUS_LABELS,
  countEnquiriesByStatus,
  countEnquiriesForAdmin,
  listEnquiriesForAdmin,
} from "@/lib/data/enquiries";

export const metadata: Metadata = { title: "Enquiries" };
export const dynamic = "force-dynamic";

const STATUSES = [
  "NEW",
  "UNDER_REVIEW",
  "MATCHING_SUPPLIERS",
  "QUOTES_REQUESTED",
  "QUOTES_RECEIVED",
  "QUOTE_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
  "CANCELLED",
];

/**
 * The enquiry desk.
 *
 * This is the administrator's view of what buyers actually submitted: reference, buying organisation,
 * product, quantity and status, read from MongoDB. Internal notes are in the detail screen, never here, so
 * a screen-share of the list cannot leak the desk's private commentary.
 */
export default async function AdminEnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; ok?: string; error?: string }>;
}) {
  await requireAdminPage("/admin/enquiries");
  const params = await searchParams;

  const status = STATUSES.includes(params.status ?? "") ? (params.status as string) : "";
  const q = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const [enquiries, total, counts] = await Promise.all([
    listEnquiriesForAdmin({ status: status || undefined, q, page, pageSize: 20 }),
    countEnquiriesForAdmin({ status: status || undefined, q }),
    countEnquiriesByStatus(),
  ]);

  const pages = Math.max(1, Math.ceil(total / 20));
  const open = STATUSES.slice(0, 7).reduce((sum, key) => sum + (counts[key] ?? 0), 0);

  return (
    <PortalPage
      eyebrow="Desk"
      title="Enquiries"
      description="Every buyer request, newest first. Status changes and internal notes are recorded in the audit log."
    >
      {params.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{params.ok}</p>
      ) : null}
      {params.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {params.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="All enquiries" value={String(Object.values(counts).reduce((a, b) => a + b, 0))} />
        <Stat label="Open" value={String(open)} hint="Received through negotiation." />
        <Stat label="Won" value={String(counts.WON ?? 0)} />
        <Stat label="Lost / cancelled" value={String((counts.LOST ?? 0) + (counts.CANCELLED ?? 0))} />
      </div>

      <Panel title="Filter" description="Search by reference, product, buyer contact or company.">
        <form method="get" action="/admin/enquiries" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            Search
            <Input name="q" defaultValue={q} placeholder="ENQ-2026-000001" />
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
            Status
            <Select name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ENQUIRY_STATUS_LABELS[value] ?? value}
                </option>
              ))}
            </Select>
          </label>
          <button type="submit" className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white">
            Apply
          </button>
          {status || q ? (
            <Link className="text-sm underline" href="/admin/enquiries">
              Clear
            </Link>
          ) : null}
        </form>
      </Panel>

      <Panel title="Queue" description={`${total} enquir${total === 1 ? "y" : "ies"} · page ${page} of ${pages}.`}>
        <Table caption="Buyer enquiries">
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Buyer</TH>
              <TH>Product</TH>
              <TH>Quantity</TH>
              <TH>Status</TH>
              <TH>Raised</TH>
            </TR>
          </THead>
          <TBody>
            {enquiries.length === 0 ? (
              <EmptyRow colSpan={6}>No enquiry matches these filters.</EmptyRow>
            ) : (
              enquiries.map((enquiry) => (
                <TR key={enquiry.id}>
                  <TD>
                    <Link className="font-medium text-navy-900 underline" href={`/admin/enquiries/${enquiry.id}`}>
                      {enquiry.reference}
                    </Link>
                  </TD>
                  <TD>
                    <span className="block text-steel-800">{enquiry.buyerOrganisationName ?? "—"}</span>
                    <span className="block text-xs text-steel-500">{enquiry.contactEmail}</span>
                  </TD>
                  <TD>{enquiry.productTitle}</TD>
                  <TD>
                    {enquiry.quantity} {enquiry.unit}
                  </TD>
                  <TD>
                    <Badge tone={enquiry.status === "WON" ? "green" : enquiry.status === "LOST" || enquiry.status === "CANCELLED" ? "red" : "amber"}>
                      {ENQUIRY_STATUS_LABELS[enquiry.status] ?? enquiry.status}
                    </Badge>
                  </TD>
                  <TD>{enquiry.createdAt.toISOString().slice(0, 10)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-steel-500">An enquiry is a request, not a confirmed order.</span>
          <span className="flex gap-4">
            {page > 1 ? (
              <Link className="underline" href={`/admin/enquiries?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${page - 1}`}>
                ← Previous
              </Link>
            ) : null}
            {page < pages ? (
              <Link className="underline" href={`/admin/enquiries?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${page + 1}`}>
                Next →
              </Link>
            ) : null}
          </span>
        </div>
      </Panel>
    </PortalPage>
  );
}
