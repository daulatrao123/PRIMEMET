import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PortalPage, Stat } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/guards";
import { ACCOUNT_STATUS_LABELS, sellerDashboard } from "@/lib/data/seller-portal";
import { REVIEW_LABELS } from "@/lib/data/listings";

export const metadata: Metadata = { title: "Seller dashboard" };
export const dynamic = "force-dynamic";

/**
 * The seller's own desk.
 *
 * Every figure comes from `sellerDashboard(user)`, which derives the supplier profile from the session.
 * A seller page never takes an organisation id, so there is no query string that shows another
 * company's submissions.
 */
export default async function SellerDashboardPage() {
  const user = await requirePage(["SELLER"], "/seller/dashboard");
  const dashboard = await sellerDashboard(user);
  const approved = dashboard.accountStatus === "ACTIVE";
  const rejected = dashboard.accountStatus === "REJECTED";

  return (
    <PortalPage
      eyebrow="Overview"
      title={dashboard.legalName ?? "Supplier desk"}
      description="Your company record, the listings you have submitted and the desk's decision on each one."
      actions={<ButtonLink href="/seller/products">Submit a listing</ButtonLink>}
    >
      <div
        className={
          "rounded-lg border px-4 py-3 text-sm " +
          (approved
            ? "border-green-200 bg-green-50 text-green-800"
            : rejected
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-amber-200 bg-amber-50 text-amber-900")
        }
      >
        <p className="font-medium">
          Registration status: {ACCOUNT_STATUS_LABELS[dashboard.accountStatus] ?? dashboard.accountStatus}
        </p>
        {dashboard.reviewFeedback ? <p className="mt-1 leading-6">{dashboard.reviewFeedback}</p> : null}
        {!approved && !rejected ? (
          <p className="mt-1 leading-6">
            A PRIMEMET administrator has to approve your application before you can sign in. You can
            prepare your profile and listings now; nothing you submit is published without an approval.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Listings submitted" hint="All submissions, any state." value={String(dashboard.total)} />
        <Stat label="Awaiting review" hint="With the PRIMEMET desk." value={String(dashboard.pending)} />
        <Stat label="Approved" hint="Reviewed and accepted." value={String(dashboard.approved)} />
        <Stat label="Rejected" hint="Read the reason on each one." value={String(dashboard.rejected)} />
      </div>

      <Panel title="Recent submissions" description="The last five listings you submitted, whatever their state.">
        <Table caption="Recent submissions">
          <THead>
            <TR>
              <TH>Product</TH>
              <TH>Category</TH>
              <TH>Submitted</TH>
              <TH>Review</TH>
            </TR>
          </THead>
          <TBody>
            {dashboard.recent.length === 0 ? (
              <EmptyRow colSpan={4}>
                No listings yet.{" "}
                <Link href="/seller/products" className="font-medium text-green-700 underline underline-offset-2">
                  Submit your first listing
                </Link>
                .
              </EmptyRow>
            ) : (
              dashboard.recent.map((listing) => (
                <TR key={listing.id}>
                  <TD>{listing.title}</TD>
                  <TD>{listing.categoryLabel ?? "—"}</TD>
                  <TD>{listing.submittedAt.toISOString().slice(0, 10)}</TD>
                  <TD>
                    <Badge tone={listing.reviewStatus === "APPROVED" ? "green" : listing.reviewStatus === "REJECTED" ? "red" : "amber"}>
                      {REVIEW_LABELS[listing.reviewStatus]}
                    </Badge>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </Panel>

      <Panel title="Set up your account" description="What the desk reviews, in order.">
        <ol className="space-y-2">
          {[
            { href: "/seller/profile", label: "Company profile and registered address" },
            { href: "/seller/tax", label: "Tax and GST details (recorded, not auto-verified)" },
            { href: "/seller/products", label: "Product listings submitted for review" },
          ].map((item, index) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex items-center gap-3 rounded-md border border-steel-200 px-4 py-3 text-sm font-medium text-navy-900 transition-colors hover:border-navy-300 hover:bg-steel-50"
              >
                <span className="font-mono text-[0.7rem] text-steel-500">{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </Link>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="What happens to a listing" description="A submission is a request for review, not a publication.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            "Every listing is submitted as PENDING and is invisible to buyers.",
            "The desk reviews the product, specification and quantity you declared.",
            "A rejection carries a reason and you can resubmit a corrected listing.",
            "Only after PRIMEMET publishes a catalogue product does anything appear publicly.",
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
