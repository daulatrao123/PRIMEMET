import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import { listBuyersPage } from "@/lib/data/admin-console";

export const metadata: Metadata = { title: "Buyers" };
export const dynamic = "force-dynamic";

const STATUSES = ["ACTIVE", "PENDING_APPROVAL", "SUSPENDED", "REJECTED"];

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PENDING_APPROVAL: "Pending",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
};

function tone(status: string): "green" | "amber" | "red" | "steel" {
  if (status === "ACTIVE") return "green";
  if (status === "SUSPENDED" || status === "REJECTED") return "red";
  return "amber";
}

/** The buyer register: search, filter, page — and the standing of each account. */
export default async function AdminBuyersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; ok?: string; error?: string }>;
}) {
  await requireAdminPage("/admin/buyers");
  const params = await searchParams;

  const q = params.q?.trim() ?? "";
  const status = STATUSES.includes(params.status ?? "") ? (params.status as string) : "";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const listing = await listBuyersPage({ q, status, page, pageSize: 20 });
  const pages = Math.max(1, Math.ceil(listing.total / listing.pageSize));
  const returnTo = `/admin/buyers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${page}`;

  return (
    <PortalPage
      eyebrow="Desk"
      title="Buyer management"
      description="Buyer organisations, their main contact and their enquiry history. Suspension is recorded and audited."
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
        <Stat label="Active buyers" value={String(listing.counts.ACTIVE ?? 0)} hint="Can sign in and raise enquiries." />
        <Stat label="Pending" value={String(listing.counts.PENDING_APPROVAL ?? 0)} hint="Registered, not yet active." />
        <Stat label="Suspended" value={String(listing.counts.SUSPENDED ?? 0)} hint="Blocked from signing in." />
        <Stat label="Rejected" value={String(listing.counts.REJECTED ?? 0)} hint="Applications the desk declined." />
      </div>

      <Panel title="Buyer register" description="Search matches company, trading name, GSTIN, city and the main contact.">
        <form method="get" action="/admin/buyers" className="mb-4 grid gap-3 sm:grid-cols-[1fr_16rem_auto]">
          <Field label="Search" htmlFor="buyer-q">
            <Input id="buyer-q" name="q" defaultValue={q} placeholder="Company, contact, email, GSTIN" maxLength={120} />
          </Field>
          <Field label="Status" htmlFor="buyer-status">
            <Select id="buyer-status" name="status" defaultValue={status}>
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

        <Table caption="Buyer register">
          <THead>
            <TR>
              <TH>Organisation</TH>
              <TH>Main contact</TH>
              <TH>GSTIN</TH>
              <TH>Location</TH>
              <TH>Enquiries</TH>
              <TH>Status</TH>
              <TH>Standing</TH>
            </TR>
          </THead>
          <TBody>
            {listing.items.length === 0 ? (
              <EmptyRow colSpan={7}>No buyer organisation matches this filter.</EmptyRow>
            ) : (
              listing.items.map((row) => (
                <TR key={row.organisationId}>
                  <TD>
                    <Link href={`/admin/buyers/${row.organisationId}`} className="font-medium text-navy-900 underline underline-offset-2">
                      {row.name}
                    </Link>
                  </TD>
                  <TD>
                    {row.contactName ?? "—"}
                    {row.email ? <span className="mt-0.5 block text-xs text-steel-500">{row.email}</span> : null}
                  </TD>
                  <TD className="font-mono text-xs">{row.gstin ?? "—"}</TD>
                  <TD>{[row.city, row.stateCode].filter(Boolean).join(", ") || "—"}</TD>
                  <TD>
                    {row.enquiries}
                    {row.lastEnquiryAt ? (
                      <span className="mt-0.5 block text-xs text-steel-500">last {row.lastEnquiryAt.toISOString().slice(0, 10)}</span>
                    ) : null}
                  </TD>
                  <TD>
                    <Badge tone={tone(row.accountStatus)}>{STATUS_LABELS[row.accountStatus] ?? row.accountStatus}</Badge>
                  </TD>
                  <TD>
                    {row.accountStatus === "ACTIVE" ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium text-red-700 underline">Suspend</summary>
                        <form method="post" action="/api/admin/accounts" className="mt-2 space-y-2">
                          <input type="hidden" name="organisationId" value={row.organisationId} />
                          <input type="hidden" name="action" value="suspend" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <textarea
                            name="reason"
                            required
                            minLength={5}
                            maxLength={300}
                            rows={2}
                            placeholder="Reason (internal)"
                            className="w-48 rounded-md border border-steel-300 px-2 py-1 text-xs"
                          />
                          <button type="submit" className="block font-medium text-red-700 underline">
                            Confirm suspension
                          </button>
                        </form>
                      </details>
                    ) : row.accountStatus === "SUSPENDED" ? (
                      <form method="post" action="/api/admin/accounts">
                        <input type="hidden" name="organisationId" value={row.organisationId} />
                        <input type="hidden" name="action" value="reactivate" />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button type="submit" className="text-xs font-medium text-green-700 underline">
                          Reactivate
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-steel-500">—</span>
                    )}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-steel-500">
            {listing.total} organisation{listing.total === 1 ? "" : "s"} · page {listing.page} of {pages}
          </span>
          <span className="flex gap-4">
            {listing.page > 1 ? (
              <Link className="underline" href={`/admin/buyers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${listing.page - 1}`}>
                ← Previous
              </Link>
            ) : null}
            {listing.page < pages ? (
              <Link className="underline" href={`/admin/buyers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${listing.page + 1}`}>
                Next →
              </Link>
            ) : null}
          </span>
        </div>
      </Panel>

      <Panel title="What a suspension does" description="One transaction, both records, one audit entry.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            "The organisation is marked SUSPENDED with the reason and the instant, and its login is marked SUSPENDED in the same transaction.",
            "A suspended account cannot sign in; the session guard reads the user status from the database on every request.",
            "Reactivation restores ACTIVE for both records and clears the suspension note. Both actions are audited.",
            "Only an active account can be suspended, so the same account cannot be suspended twice for one event.",
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
