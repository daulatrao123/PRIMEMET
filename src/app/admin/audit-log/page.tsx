import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import { listAuditPage } from "@/lib/data/admin-console";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

function tone(severity: string): "red" | "amber" | "steel" {
  if (severity === "CRITICAL" || severity === "WARNING") return "red";
  if (severity === "NOTICE") return "amber";
  return "steel";
}

/**
 * The append-only audit log.
 *
 * Every row is a stored `audit_logs` document written by the operation it describes. Nothing here is
 * generated for display, and nothing can edit or delete a row: the collection is append-only in the DAO
 * and the database refuses a rewrite through the application path.
 */
export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdminPage("/admin/audit-log");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const listing = await listAuditPage({ q, page, pageSize: 25 });
  const pages = Math.max(1, Math.ceil(listing.total / listing.pageSize));

  return (
    <PortalPage
      eyebrow="Oversight"
      title="Audit log"
      description="An append-only record of who changed what, kept so a decision can be reconstructed later."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Entries" value={String(listing.total)} hint="Matching this search." />
        <Stat label="Page" value={`${listing.page} / ${pages}`} hint="Newest first." />
        <Stat label="Written by" value="Server" hint="Actor resolved from the session, never the request." />
        <Stat label="Editable" value="No" hint="Append-only; entries are never rewritten." />
      </div>

      <Panel title="Find an entry" description="Search by action or entity type, e.g. seller.application or Enquiry.">
        <form method="get" action="/admin/audit-log" className="flex flex-wrap items-end gap-3">
          <Field label="Search" htmlFor="audit-q">
            <Input id="audit-q" name="q" defaultValue={q} placeholder="seller.application, Product, Enquiry" maxLength={120} />
          </Field>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {q ? (
            <Link className="text-sm underline" href="/admin/audit-log">
              Clear
            </Link>
          ) : null}
        </form>
      </Panel>

      <Panel title="Entries" description={`${listing.total} entr${listing.total === 1 ? "y" : "ies"} · page ${listing.page} of ${pages}.`}>
        <Table caption="Audit log entries">
          <THead>
            <TR>
              <TH>When (UTC)</TH>
              <TH>Actor</TH>
              <TH>Role</TH>
              <TH>Action</TH>
              <TH>Entity</TH>
              <TH>Severity</TH>
            </TR>
          </THead>
          <TBody>
            {listing.items.length === 0 ? (
              <EmptyRow colSpan={6}>
                No audit entry matches. Entries appear as soon as a privileged action is performed.
              </EmptyRow>
            ) : (
              listing.items.map((entry) => (
                <TR key={entry.id}>
                  <TD className="font-mono text-xs">{entry.occurredAt.toISOString().slice(0, 16).replace("T", " ")}</TD>
                  <TD>{entry.actorEmail ?? "—"}</TD>
                  <TD>{entry.actorRole ?? "—"}</TD>
                  <TD className="font-medium">{entry.action}</TD>
                  <TD>
                    {entry.entityType}
                    {entry.entityId ? <span className="block font-mono text-[0.65rem] text-steel-500">{entry.entityId}</span> : null}
                  </TD>
                  <TD>
                    <Badge tone={tone(entry.severity)}>{entry.severity}</Badge>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span />
          <span className="flex gap-4">
            {listing.page > 1 ? (
              <Link className="underline" href={`/admin/audit-log?q=${encodeURIComponent(q)}&page=${listing.page - 1}`}>
                ← Previous
              </Link>
            ) : null}
            {listing.page < pages ? (
              <Link className="underline" href={`/admin/audit-log?q=${encodeURIComponent(q)}&page=${listing.page + 1}`}>
                Next →
              </Link>
            ) : null}
          </span>
        </div>
      </Panel>
    </PortalPage>
  );
}
