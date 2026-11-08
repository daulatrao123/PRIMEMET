import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel, PortalPage } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import { getSellerApplicationDetail } from "@/lib/data/seller-admin";

export const metadata: Metadata = { title: "Seller application" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting decision",
  ACTIVE: "Approved",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
};

const REVIEW_LABELS: Record<string, string> = {
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/**
 * One seller application, with the decision.
 *
 * The page is ADMIN-guarded and the organisation is the URL parameter — an administrator is legitimately
 * choosing which company to review. Every action posts to `/api/admin/sellers`, which re-checks the role
 * at the route AND at the data layer.
 */
export default async function AdminSellerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const query = await searchParams;
  const application = await getSellerApplicationDetail(id);
  if (!application) notFound();

  const organisation = application.organisation;
  const pending = organisation.accountStatus === "PENDING_APPROVAL";

  return (
    <PortalPage
      eyebrow="Seller application"
      title={organisation.name}
      description="Company details, the address on record, the submissions received and the desk's decision."
      actions={
        <Badge tone={organisation.accountStatus === "ACTIVE" ? "green" : organisation.accountStatus === "REJECTED" || organisation.accountStatus === "SUSPENDED" ? "red" : "amber"}>
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
        <Link href="/admin/suppliers" className="font-medium text-green-700 underline underline-offset-2">
          Back to the seller queue
        </Link>
      </p>

      <Panel title="Company record" description="As declared by the applicant. Nothing here is verified by the system.">
        <dl className="grid gap-4 sm:grid-cols-2">
          {[
            ["Legal name", organisation.name],
            ["Trading name", application.tradeName ?? "—"],
            ["Business type", organisation.businessType ?? "—"],
            ["GSTIN", organisation.gstin ?? "Not provided"],
            ["PAN", application.pan ?? "Not provided"],
            ["GSTIN verification", organisation.verification ?? "NOT_SUBMITTED"],
            ["Contact", organisation.contactName ?? "—"],
            ["Email", organisation.email ?? "—"],
            ["Telephone", organisation.phone ?? "—"],
            ["Website", application.website ?? "—"],
            ["Registered at", organisation.createdAt.toISOString().slice(0, 10)],
            ["Login status", organisation.userStatus ?? "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-steel-500">{label}</dt>
              <dd className="mt-1 break-words text-sm text-navy-900">{value}</dd>
            </div>
          ))}
        </dl>
        {application.description ? (
          <p className="mt-5 whitespace-pre-line rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm leading-6 text-navy-900">
            {application.description}
          </p>
        ) : null}
      </Panel>

      <Panel title="Registered address" description="The address the applicant declared as its registered office.">
        {application.address ? (
          <address className="text-sm not-italic leading-6 text-navy-900">
            {[application.address.line1, application.address.line2].filter(Boolean).map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
            <span className="block">
              {[application.address.city, application.address.stateCode, application.address.postalCode].filter(Boolean).join(", ")}
            </span>
            <span className="block">{application.address.countryCode ?? "IN"}</span>
          </address>
        ) : (
          <p className="text-sm text-steel-600">No registered address was supplied.</p>
        )}
      </Panel>

      <Panel title="Verification records" description="Tax and identity checks recorded against this company.">
        {application.verifications.length === 0 ? (
          <p className="text-sm text-steel-600">No verification record has been created for this company.</p>
        ) : (
          <Table caption="Verification records">
            <THead>
              <TR>
                <TH>Check</TH>
                <TH>Status</TH>
                <TH>Reference</TH>
                <TH>Verified</TH>
              </TR>
            </THead>
            <TBody>
              {application.verifications.map((row) => (
                <TR key={row.id}>
                  <TD>{row.type}</TD>
                  <TD>
                    <Badge tone={row.status === "VERIFIED" ? "green" : row.status === "REJECTED" ? "red" : "amber"}>{row.status}</Badge>
                  </TD>
                  <TD className="font-mono text-xs">{row.referenceValue ?? "—"}</TD>
                  <TD>{row.verifiedAt ? row.verifiedAt.toISOString().slice(0, 10) : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          Document upload is not available in this build: no secure object store exists, so a certificate
          or licence file cannot be attached here. Registration documents are requested and checked out of
          band; that limitation is carried in the M4 and M5 reports.
        </p>
      </Panel>

      <Panel title="Listing submissions" description="Everything this supplier has submitted, newest first.">
        <Table caption="Listing submissions">
          <THead>
            <TR>
              <TH>Product</TH>
              <TH>Category</TH>
              <TH>Submitted</TH>
              <TH>Review</TH>
              <TH>Reason</TH>
            </TR>
          </THead>
          <TBody>
            {application.listings.length === 0 ? (
              <EmptyRow colSpan={5}>No listings submitted yet.</EmptyRow>
            ) : (
              application.listings.map((listing) => (
                <TR key={listing.id}>
                  <TD>{listing.title}</TD>
                  <TD>{listing.categoryLabel ?? "—"}</TD>
                  <TD>{listing.submittedAt.toISOString().slice(0, 10)}</TD>
                  <TD>
                    <Badge tone={listing.reviewStatus === "APPROVED" ? "green" : listing.reviewStatus === "REJECTED" ? "red" : "amber"}>
                      {REVIEW_LABELS[listing.reviewStatus] ?? listing.reviewStatus}
                    </Badge>
                  </TD>
                  <TD>{listing.rejectionReason ?? "—"}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
        <p className="mt-4 text-xs leading-5 text-steel-500">
          Approve or reject individual submissions on{" "}
          <Link href="/admin/listing-submissions" className="font-medium text-green-700 underline underline-offset-2">
            listing submissions
          </Link>
          .
        </p>
      </Panel>

      {pending ? (
        <Panel title="Decision" description="Approving activates the login. Rejecting requires a reason the seller will read.">
          <div className="grid gap-6 lg:grid-cols-2">
            <form method="post" action="/api/admin/sellers" className="space-y-3">
              <input type="hidden" name="organisationId" value={organisation.organisationId} />
              <input type="hidden" name="action" value="approve" />
              <p className="text-sm leading-6 text-steel-600">
                Approve this application. GSTIN verification stays as recorded ({organisation.verification ?? "NOT_SUBMITTED"})
                and is not changed by an approval.
              </p>
              <Button type="submit">Approve seller</Button>
            </form>
            <form method="post" action="/api/admin/sellers" className="space-y-3">
              <input type="hidden" name="organisationId" value={organisation.organisationId} />
              <input type="hidden" name="action" value="reject" />
              <Field label="Rejection reason" htmlFor="reject-reason" hint="At least 5 characters. The seller sees this.">
                <Textarea id="reject-reason" name="reason" rows={3} maxLength={1000} required minLength={5} />
              </Field>
              <Button type="submit" variant="secondary">
                Reject application
              </Button>
            </form>
          </div>
        </Panel>
      ) : (
        <Panel title="Decision on record" description="Recorded by the administrator who acted.">
          <p className="text-sm leading-6 text-navy-900">
            {STATUS_LABELS[organisation.accountStatus] ?? organisation.accountStatus}
            {application.reviewedAt ? ` on ${application.reviewedAt.toISOString().slice(0, 10)}` : ""}.
          </p>
          {application.reviewFeedback ? (
            <p className="mt-2 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm leading-6 text-navy-900">
              Seller-facing note: {application.reviewFeedback}
            </p>
          ) : null}
        </Panel>
      )}

      <Panel title="Account standing" description="A suspension blocks sign-in for the seller's people. The reason is internal.">
        {organisation.accountStatus === "SUSPENDED" ? (
          <form method="post" action="/api/admin/accounts" className="space-y-3">
            <input type="hidden" name="organisationId" value={organisation.organisationId} />
            <input type="hidden" name="action" value="reactivate" />
            <input type="hidden" name="returnTo" value={"/admin/suppliers/" + organisation.organisationId} />
            <p className="text-sm leading-6 text-steel-600">
              Suspended{organisation.suspendedAt ? " on " + organisation.suspendedAt.toISOString().slice(0, 10) : ""}
              {organisation.suspensionReason ? " — " + organisation.suspensionReason : ""}. Reactivating restores the
              organisation and its login to ACTIVE in one transaction.
            </p>
            <Button type="submit">Reactivate seller</Button>
          </form>
        ) : organisation.accountStatus === "ACTIVE" ? (
          <form method="post" action="/api/admin/accounts" className="space-y-3">
            <input type="hidden" name="organisationId" value={organisation.organisationId} />
            <input type="hidden" name="action" value="suspend" />
            <input type="hidden" name="returnTo" value={"/admin/suppliers/" + organisation.organisationId} />
            <Field label="Reason" htmlFor="suspend-seller-reason" hint="At least 5 characters. Recorded internally, never shown to the seller.">
              <Textarea id="suspend-seller-reason" name="reason" rows={3} maxLength={300} required minLength={5} />
            </Field>
            <Button type="submit" variant="secondary">
              Suspend seller
            </Button>
          </form>
        ) : (
          <p className="text-sm text-steel-600">
            This application is {STATUS_LABELS[organisation.accountStatus] ?? organisation.accountStatus}. Suspension applies to active accounts only.
          </p>
        )}
      </Panel>

      <Panel title="Internal notes" description="Never shown to the seller. Appended with your identity and the time.">
        {application.internalNotes ? (
          <pre className="mb-4 whitespace-pre-wrap rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-xs leading-5 text-navy-900">
            {application.internalNotes}
          </pre>
        ) : (
          <p className="mb-4 text-sm text-steel-600">No internal notes recorded.</p>
        )}
        <form method="post" action="/api/admin/sellers" className="space-y-3">
          <input type="hidden" name="organisationId" value={organisation.organisationId} />
          <input type="hidden" name="action" value="note" />
          <Field label="Add a note" htmlFor="internal-note" hint="Site visit, reference calls, document checks.">
            <Textarea id="internal-note" name="note" rows={3} maxLength={4000} required minLength={2} />
          </Field>
          <Button type="submit" variant="secondary">
            Record note
          </Button>
        </form>
      </Panel>

      <Panel title="Audit trail" description="Privileged actions recorded against this organisation.">
        {application.auditTrail.length === 0 ? (
          <p className="text-sm text-steel-600">No audit entries recorded for this organisation yet.</p>
        ) : (
          <ul className="space-y-2">
            {application.auditTrail.map((entry) => (
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
