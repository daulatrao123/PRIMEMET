import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth/guards";
import { adminOverview, recentActivity } from "@/lib/data/admin-console";
import { ENQUIRY_STATUS_LABELS } from "@/lib/data/enquiries";

export const metadata: Metadata = { title: "Control centre" };
export const dynamic = "force-dynamic";

const WORKFLOW = [
  { step: "01", title: "Review the enquiry", to: "/admin/enquiries" },
  { step: "02", title: "Qualify buyers and sellers", to: "/admin/suppliers" },
  { step: "03", title: "Review listing submissions", to: "/admin/listing-submissions" },
  { step: "04", title: "Maintain the catalogue", to: "/admin/products" },
];

const ACTION_LABELS: Record<string, string> = {
  "seller.application.approved": "Seller approved",
  "seller.application.rejected": "Seller rejected",
  "account.suspended": "Account suspended",
  "account.reactivated": "Account reactivated",
  "catalogue.product.created": "Product created",
  "catalogue.product.updated": "Product updated",
  "catalogue.product.published": "Product published",
  "catalogue.product.unpublished": "Product unpublished",
  "catalogue.product.archived": "Product archived",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PENDING_APPROVAL: "Pending",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
};

function when(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The control centre.
 *
 * Every figure is a count over MongoDB (two `$group` aggregations and three counts in `adminOverview`),
 * and every row below is a stored document or an append-only audit entry. There is no fixture on this
 * page: an empty platform renders zeroes and empty states, which is the honest answer.
 */
export default async function AdminDashboardPage() {
  const user = await requireAdminPage("/admin/dashboard");
  const [overview, activity] = await Promise.all([adminOverview(), recentActivity(6)]);

  return (
    <PortalPage
      eyebrow="Overview"
      title="Control centre"
      description={`Signed in as ${user.email}. Live counts from MongoDB, newest activity first.`}
      actions={<span className="text-xs text-steel-500">Read at {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</span>}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Buyers" value={String(overview.buyers)} hint="Buyer organisations on record." />
        <Stat
          label="Sellers"
          value={String(overview.sellers)}
          hint={`${overview.pendingSellers} awaiting decision · ${overview.approvedSellers} approved`}
        />
        <Stat label="Suspended accounts" value={String(overview.suspendedAccounts)} hint="Buyers and sellers the desk has stopped." />
        <Stat label="Pending listings" value={String(overview.pendingListings)} hint="Seller submissions awaiting review." />
        <Stat label="Products" value={String(overview.products)} hint={`${overview.publishedProducts} published · ${overview.categories} categories`} />
        <Stat label="Enquiries" value={String(overview.enquiries)} hint={`${overview.newEnquiries} new · ${overview.inProgressEnquiries} in progress`} />
        <Stat label="Completed enquiries" value={String(overview.completedEnquiries)} hint="Won. An enquiry is not an order." />
        <Stat label="Published products" value={String(overview.publishedProducts)} hint="Visible in the public catalogue." />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Recent registrations" description="The newest buyer and seller organisations.">
          <Table caption="Recent registrations">
            <THead>
              <TR>
                <TH>Company</TH>
                <TH>Type</TH>
                <TH>State</TH>
                <TH>Registered</TH>
              </TR>
            </THead>
            <TBody>
              {activity.registrations.length === 0 ? (
                <EmptyRow colSpan={4}>No organisation has registered yet.</EmptyRow>
              ) : (
                activity.registrations.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <Link className="font-medium text-navy-900 underline" href={row.href}>
                        {row.name}
                      </Link>
                    </TD>
                    <TD>{row.orgType === "SELLER" ? "Seller" : "Buyer"}</TD>
                    <TD>
                      <Badge tone={row.accountStatus === "ACTIVE" ? "green" : row.accountStatus === "REJECTED" ? "red" : "amber"}>
                        {STATUS_LABELS[row.accountStatus] ?? row.accountStatus}
                      </Badge>
                    </TD>
                    <TD>{when(row.occurredAt)}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </Panel>

        <Panel title="Recent enquiries" description="Buyer requests, newest first.">
          <Table caption="Recent enquiries">
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Buyer</TH>
                <TH>Product</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {activity.enquiries.length === 0 ? (
                <EmptyRow colSpan={4}>No enquiry has been raised yet.</EmptyRow>
              ) : (
                activity.enquiries.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <Link className="font-medium text-navy-900 underline" href={`/admin/enquiries/${row.id}`}>
                        {row.reference}
                      </Link>
                    </TD>
                    <TD>{row.buyerName ?? "—"}</TD>
                    <TD>{row.productTitle}</TD>
                    <TD>{ENQUIRY_STATUS_LABELS[row.status] ?? row.status}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </Panel>

        <Panel title="Account decisions" description="Seller approvals, rejections and suspensions from the audit log.">
          <Table caption="Account decisions">
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Decision</TH>
                <TH>Organisation</TH>
              </TR>
            </THead>
            <TBody>
              {activity.approvals.length === 0 ? (
                <EmptyRow colSpan={3}>No account decision has been recorded yet.</EmptyRow>
              ) : (
                activity.approvals.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-mono text-xs">{when(row.occurredAt)}</TD>
                    <TD>{ACTION_LABELS[row.action] ?? row.action}</TD>
                    <TD>{row.entityName ?? "—"}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </Panel>

        <Panel title="Product publication" description="Catalogue changes recorded against the acting administrator.">
          <Table caption="Product publication activity">
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Action</TH>
                <TH>Product</TH>
              </TR>
            </THead>
            <TBody>
              {activity.publications.length === 0 ? (
                <EmptyRow colSpan={3}>No product change has been recorded yet.</EmptyRow>
              ) : (
                activity.publications.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-mono text-xs">{when(row.occurredAt)}</TD>
                    <TD>{ACTION_LABELS[row.action] ?? row.action}</TD>
                    <TD>{row.productTitle ?? "—"}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </Panel>
      </div>

      <Panel title="Desk workflow" description="The order every brief follows.">
        <ol className="grid gap-3 sm:grid-cols-2">
          {WORKFLOW.map((item) => (
            <li key={item.step}>
              <Link
                href={item.to}
                className="flex items-center gap-3 rounded-md border border-steel-200 px-4 py-3 transition-colors hover:border-navy-300 hover:bg-steel-50"
              >
                <span className="font-mono text-[0.7rem] text-steel-500">{item.step}</span>
                <span className="text-sm font-medium text-navy-900">{item.title}</span>
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs leading-5 text-steel-500">
          The full history of every privileged action is on the{" "}
          <Link className="underline" href="/admin/audit-log">
            audit log
          </Link>
          . An enquiry is a request: it becomes a confirmed order only once a quotation is accepted.
        </p>
      </Panel>
    </PortalPage>
  );
}
