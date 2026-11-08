import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import { countSellerApplications, listSellerApplications, type SellerQueueStatus } from "@/lib/data/seller-admin";

export const metadata: Metadata = { title: "Suppliers" };
export const dynamic = "force-dynamic";

const STATUSES: SellerQueueStatus[] = ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "REJECTED"];

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting decision",
  ACTIVE: "Approved",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
};

function tone(status: string): "green" | "amber" | "red" {
  if (status === "ACTIVE") return "green";
  if (status === "REJECTED" || status === "SUSPENDED") return "red";
  return "amber";
}

/**
 * The seller approval queue.
 *
 * An administrator's work queue: pending first, then suspended, then rejected, then approved, with a
 * search term, a status filter and a page. Every row links to the review page, where the decision is
 * made — the queue itself never posts a decision, so an accidental click cannot approve a company.
 */
export default async function AdminSuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; ok?: string; error?: string }>;
}) {
  await requireAdminPage("/admin/suppliers");
  const query = await searchParams;
  const status = (STATUSES as readonly string[]).includes(query.status ?? "") ? (query.status as SellerQueueStatus) : "";
  const q = query.q?.trim() ?? "";
  const page = Math.max(1, Number(query.page ?? "1") || 1);

  const [rows, total] = await Promise.all([
    listSellerApplications({ status, q, page, pageSize: 20 }),
    countSellerApplications({ status, q }),
  ]);
  const pages = Math.max(1, Math.ceil(total / 20));
  const pending = rows.filter((row) => row.accountStatus === "PENDING_APPROVAL").length;

  return (
    <PortalPage
      eyebrow="Desk"
      title="Supplier management"
      description="Seller applications, the company record behind each one, the listings received and the standing of the account."
    >
      {query.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{query.ok}</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sellers matching" value={String(total)} hint="Across every status." />
        <Stat label="Awaiting decision" value={String(pending)} hint="On this page." />
        <Stat label="Approved on this page" value={String(rows.filter((row) => row.accountStatus === "ACTIVE").length)} hint="Can sign in and submit listings." />
        <Stat label="Suspended on this page" value={String(rows.filter((row) => row.accountStatus === "SUSPENDED").length)} hint="Blocked from signing in." />
      </div>

      <Panel title="Seller register" description="Pending first. Search matches company, contact, email, GSTIN, city and business type.">
        <form method="get" action="/admin/suppliers" className="mb-4 grid gap-3 sm:grid-cols-[1fr_16rem_auto]">
          <Field label="Search" htmlFor="supplier-q">
            <Input id="supplier-q" name="q" defaultValue={q} placeholder="Company, contact, GSTIN" maxLength={120} />
          </Field>
          <Field label="Status" htmlFor="supplier-status">
            <Select id="supplier-status" name="status" defaultValue={status}>
              <option value="">All</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </div>
        </form>

        <Table caption="Seller register">
          <THead>
            <TR>
              <TH>Company</TH>
              <TH>Contact</TH>
              <TH>GSTIN</TH>
              <TH>Location</TH>
              <TH>Listings</TH>
              <TH>Status</TH>
              <TH>Review</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7}>No seller application matches this filter.</EmptyRow>
            ) : (
              rows.map((row) => (
                <TR key={row.organisationId}>
                  <TD>
                    <Link href={`/admin/suppliers/${row.organisationId}`} className="font-medium text-navy-900 underline underline-offset-2">
                      {row.name}
                    </Link>
                    {row.businessType ? <span className="mt-0.5 block text-xs text-steel-500">{row.businessType}</span> : null}
                  </TD>
                  <TD>
                    {row.contactName ?? "—"}
                    {row.email ? <span className="mt-0.5 block text-xs text-steel-500">{row.email}</span> : null}
                  </TD>
                  <TD className="font-mono text-xs">{row.gstin ?? "—"}</TD>
                  <TD>{[row.city, row.stateCode].filter(Boolean).join(", ") || "—"}</TD>
                  <TD>
                    {row.listings}
                    {row.pendingListings > 0 ? <span className="mt-0.5 block text-xs text-amber-700">{row.pendingListings} pending</span> : null}
                  </TD>
                  <TD>
                    <Badge tone={tone(row.accountStatus)}>{STATUS_LABELS[row.accountStatus] ?? row.accountStatus}</Badge>
                  </TD>
                  <TD>
                    <Link href={`/admin/suppliers/${row.organisationId}`} className="text-sm font-medium text-green-700 underline underline-offset-2">
                      Review
                    </Link>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-steel-500">
            {total} seller{total === 1 ? "" : "s"} · page {page} of {pages}
          </span>
          <span className="flex gap-4">
            {page > 1 ? (
              <Link className="underline" href={`/admin/suppliers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${page - 1}`}>
                ← Previous
              </Link>
            ) : null}
            {page < pages ? (
              <Link className="underline" href={`/admin/suppliers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${page + 1}`}>
                Next →
              </Link>
            ) : null}
          </span>
        </div>
      </Panel>

      <Panel title="What the decision does" description="Approval is an account decision, not a tax verification.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            "Approving activates the login and the organisation, in one transaction.",
            "GSTIN verification is recorded separately and never follows from an approval.",
            "Rejection requires a reason; the seller reads it on their profile.",
            "Every decision and every suspension writes an audit row with the actor and the before-state.",
          ].map((item) => (
            <li key={item} className="flex items-start gap-3 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm leading-6 text-navy-900">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-green-600" />
              {item}
            </li>
          ))}
        </ul>
      </Panel>
    </PortalPage>
  );
}
