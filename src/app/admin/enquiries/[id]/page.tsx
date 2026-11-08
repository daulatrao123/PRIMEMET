import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/input";
import { Panel, PortalPage } from "@/components/portal/blocks";
import { requireAdminPage } from "@/lib/auth/guards";
import { getEnquiryAuditTrail } from "@/lib/data/admin-console";
import {
  ADMIN_SELECTABLE_STATUSES,
  ENQUIRY_STATUS_LABELS,
  getEnquiryForAdmin,
} from "@/lib/data/enquiries";

export const metadata: Metadata = { title: "Enquiry" };
export const dynamic = "force-dynamic";

/**
 * One enquiry, as the desk works it.
 *
 * Two forms, both posting to `/api/admin/enquiries`: a status change and an internal note. They are
 * separate because they are different acts with different consequences — one is visible to the buyer, the
 * other never is — and a single save button would make it easy to publish a private note by accident.
 */
export default async function AdminEnquiryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdminPage("/admin/enquiries");
  const { id } = await params;
  const query = await searchParams;

  const [enquiry, history] = await Promise.all([getEnquiryForAdmin(id), getEnquiryAuditTrail(id)]);
  if (!enquiry) notFound();

  return (
    <PortalPage
      eyebrow="Desk"
      title={enquiry.reference}
      description={`${enquiry.buyerOrganisationName ?? "Unknown buyer"} · raised ${enquiry.createdAt.toISOString().slice(0, 10)}`}
      actions={
        <Badge tone={enquiry.status === "WON" ? "green" : enquiry.status === "LOST" || enquiry.status === "CANCELLED" ? "red" : "amber"}>
          {ENQUIRY_STATUS_LABELS[enquiry.status] ?? enquiry.status}
        </Badge>
      }
    >
      {query.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{query.ok}</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error}
        </p>
      ) : null}

      <Panel title="Request">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Product</dt>
            <dd className="text-steel-800">{enquiry.productTitle}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Quantity</dt>
            <dd className="text-steel-800">
              {enquiry.quantity} {enquiry.unit}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Delivery location</dt>
            <dd className="text-steel-800">{enquiry.deliveryLocation ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Buyer organisation</dt>
            <dd className="text-steel-800">
              <Link className="underline" href={`/admin/buyers/${enquiry.buyerOrganisationId}`}>
                {enquiry.buyerOrganisationName ?? "Unknown buyer"}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Buyer contact</dt>
            <dd className="text-steel-800">
              {enquiry.contactName} · {enquiry.contactEmail}
              {enquiry.contactPhone ? ` · ${enquiry.contactPhone}` : ""}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-[0.12em] text-steel-500">Requirement</dt>
            <dd className="whitespace-pre-line text-steel-800">{enquiry.requirements}</dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Status" description="Visible to the buyer immediately.">
        <form method="post" action="/api/admin/enquiries" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={enquiry.id} />
          <Field label="New status" htmlFor="enquiry-status">
            <Select id="enquiry-status" name="status" defaultValue={enquiry.status}>
              {ADMIN_SELECTABLE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ENQUIRY_STATUS_LABELS[value] ?? value}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Update status</Button>
        </form>
      </Panel>

      <Panel title="Internal notes" description="Never shown to the buyer.">
        <form method="post" action="/api/admin/enquiries" className="space-y-3">
          <input type="hidden" name="id" value={enquiry.id} />
          <Field label="Notes" htmlFor="enquiry-notes">
            <Textarea id="enquiry-notes" name="internalNotes" rows={5} maxLength={4000} defaultValue={enquiry.internalNotes ?? ""} />
          </Field>
          <Button type="submit">Save note</Button>
        </form>
      </Panel>

      <Panel title="Enquiry history" description="Status changes and note writes, newest first. Append-only.">
        {history.length === 0 ? (
          <p className="text-sm text-steel-600">No status change or note has been recorded for this enquiry yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-sm text-navy-900">
                <span className="font-mono text-xs text-steel-500">{entry.occurredAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                <span className="font-medium">{entry.action}</span>
                <span className="text-xs text-steel-500">{entry.actorRole ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-5 text-steel-500">
          An enquiry is a request for a quotation. It does not create an order, a reservation or a price.
        </p>
      </Panel>

      <p className="text-sm">
        <Link className="underline" href="/admin/enquiries">
          Back to the queue
        </Link>
      </p>
    </PortalPage>
  );
}
