import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel, PortalPage } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import { getBuyerDetail } from "@/lib/data/admin-console";
import { ENQUIRY_STATUS_LABELS } from "@/lib/data/enquiries";

export const metadata: Metadata = { title: "Buyer" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PENDING_APPROVAL: "Pending",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
};

/**
 * One buyer organisation.
 *
 * The URL carries the organisation because an administrator is legitimately choosing which company to
 * look at. Everything here is read-only except the account standing, which posts to the guarded
 * `/api/admin/accounts` endpoint; internal notes are shown but never leave the desk.
 */
export default async function AdminBuyerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const query = await searchParams;
  const detail = await getBuyerDetail(id);
  if (!detail) notFound();

  const organisation = detail.organisation;
  const returnTo = `/admin/buyers/${organisation.organisationId}`;

  return (
    <PortalPage
      eyebrow="Buyer"
      title={organisation.name}
      description="Company record, the people on it, the enquiries it has raised and the account's standing."
      actions={
        <Badge tone={organisation.accountStatus === "ACTIVE" ? "green" : organisation.accountStatus === "SUSPENDED" || organisation.accountStatus === "REJECTED" ? "red" : "amber"}>
          {STATUS_LABELS[organisation.accountStatus] ?? organisation.accountStatus}
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

      <p className="text-sm text-steel-600">
        <Link href="/admin/buyers" className="font-medium text-green-700 underline underline-offset-2">
          Back to the buyer register
        </Link>
      </p>

      {organisation.accountStatus === "SUSPENDED" ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Suspended{organisation.suspendedAt ? ` on ${organisation.suspendedAt.toISOString().slice(0, 10)}` : ""}
          {organisation.suspensionReason ? ` — ${organisation.suspensionReason}` : ""}.
        </p>
      ) : null}

      <Panel title="Company record" description="As declared at registration. Nothing here is verified by the system unless stated.">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Legal name", organisation.name],
            ["Trading name", organisation.tradeName ?? "—"],
            ["GSTIN", organisation.gstin ?? "Not provided"],
            ["PAN", organisation.pan ?? "Not provided"],
            ["IEC", organisation.iec ?? "Not provided"],
            ["GST verification", organisation.verification ?? "NOT_SUBMITTED"],
            ["Verification status", organisation.verificationStatus],
            ["Website", organisation.website ?? "—"],
            ["Country", organisation.countryCode ?? "—"],
            ["Registered", organisation.createdAt.toISOString().slice(0, 10)],
            ["Enquiries", String(organisation.enquiries)],
            ["Last enquiry", organisation.lastEnquiryAt ? organisation.lastEnquiryAt.toISOString().slice(0, 10) : "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-steel-500">{label}</dt>
              <dd className="mt-1 break-words text-sm text-navy-900">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Registered address" description="The address declared as the registered office.">
          {detail.address ? (
            <address className="text-sm not-italic leading-6 text-navy-900">
              {[detail.address.line1, detail.address.line2].filter(Boolean).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              <span className="block">
                {[detail.address.city, detail.address.stateCode, detail.address.postalCode].filter(Boolean).join(", ")}
              </span>
              <span className="block">{detail.address.countryCode ?? "IN"}</span>
            </address>
          ) : (
            <p className="text-sm text-steel-600">No registered address was supplied.</p>
          )}
        </Panel>

        <Panel title="Contacts" description="Everyone recorded against this organisation.">
          <Table caption="Buyer contacts">
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Email</TH>
                <TH>Phone</TH>
              </TR>
            </THead>
            <TBody>
              {detail.contacts.length === 0 ? (
                <EmptyRow colSpan={4}>No contact recorded.</EmptyRow>
              ) : (
                detail.contacts.map((contact) => (
                  <TR key={contact.id}>
                    <TD>
                      {contact.fullName}
                      {contact.isPrimary ? <span className="ml-2 text-xs text-green-700">primary</span> : null}
                    </TD>
                    <TD>{contact.roleLabel ?? "—"}</TD>
                    <TD>{contact.email ?? "—"}</TD>
                    <TD>{contact.phone ?? "—"}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </Panel>
      </div>

      <Panel title="Account standing" description="Suspension blocks sign-in. The reason is internal and never shown to the buyer.">
        {organisation.accountStatus === "SUSPENDED" ? (
          <form method="post" action="/api/admin/accounts" className="space-y-3">
            <input type="hidden" name="organisationId" value={organisation.organisationId} />
            <input type="hidden" name="action" value="reactivate" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <p className="text-sm leading-6 text-steel-600">
              Reactivating restores the organisation and its login to ACTIVE in one transaction. The
              suspension note is cleared; the audit entry remains.
            </p>
            <Button type="submit">Reactivate account</Button>
          </form>
        ) : organisation.accountStatus === "ACTIVE" ? (
          <form method="post" action="/api/admin/accounts" className="space-y-3">
            <input type="hidden" name="organisationId" value={organisation.organisationId} />
            <input type="hidden" name="action" value="suspend" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field label="Reason" htmlFor="suspend-reason" hint="At least 5 characters. Recorded internally, never shown to the buyer.">
              <Textarea id="suspend-reason" name="reason" rows={3} maxLength={300} required minLength={5} />
            </Field>
            <Button type="submit" variant="secondary">
              Suspend account
            </Button>
          </form>
        ) : (
          <p className="text-sm text-steel-600">This account is {STATUS_LABELS[organisation.accountStatus] ?? organisation.accountStatus} and cannot be suspended or reactivated here.</p>
        )}
      </Panel>

      <Panel title="Enquiry history" description="Every request this organisation has raised, newest first. An enquiry is not an order.">
        <Table caption="Buyer enquiry history">
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Product</TH>
              <TH>Quantity</TH>
              <TH>Status</TH>
              <TH>Raised</TH>
              <TH>Notes</TH>
            </TR>
          </THead>
          <TBody>
            {detail.enquiryHistory.length === 0 ? (
              <EmptyRow colSpan={6}>No enquiry has been raised by this organisation.</EmptyRow>
            ) : (
              detail.enquiryHistory.map((enquiry) => (
                <TR key={enquiry.id}>
                  <TD>
                    <Link className="font-medium text-navy-900 underline" href={`/admin/enquiries/${enquiry.id}`}>
                      {enquiry.reference}
                    </Link>
                  </TD>
                  <TD>{enquiry.productTitle}</TD>
                  <TD>
                    {enquiry.quantity} {enquiry.unit}
                  </TD>
                  <TD>{ENQUIRY_STATUS_LABELS[enquiry.status] ?? enquiry.status}</TD>
                  <TD>{enquiry.createdAt.toISOString().slice(0, 10)}</TD>
                  <TD>{enquiry.internalNotes ? "Internal note on file" : "—"}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </Panel>

      {organisation.internalNotes ? (
        <Panel title="Internal notes" description="Recorded by the desk. Never exposed to a buyer or seller page.">
          <pre className="whitespace-pre-wrap rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-xs leading-5 text-navy-900">
            {organisation.internalNotes}
          </pre>
        </Panel>
      ) : null}

      <Panel title="Audit trail" description="Privileged actions recorded against this organisation.">
        {detail.auditTrail.length === 0 ? (
          <p className="text-sm text-steel-600">No audit entry recorded for this organisation yet.</p>
        ) : (
          <ul className="space-y-2">
            {detail.auditTrail.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-sm text-navy-900">
                <span className="font-mono text-xs text-steel-500">{entry.occurredAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                <span className="font-medium">{entry.action}</span>
                <span className="text-xs text-steel-500">{entry.actorRole ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </PortalPage>
  );
}
