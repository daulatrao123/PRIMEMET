import type { Metadata } from "next";
import Link from "next/link";

import { PortalPage } from "@/components/portal/blocks";

export const metadata: Metadata = { title: "Record not found" };

/**
 * A record the desk asked for does not exist — an old link, a deleted organisation, a mistyped id.
 *
 * This boundary lives inside the admin layout on purpose: the administrator keeps the navigation and
 * stays in the control centre, instead of being dropped onto the public site's not-found page with its
 * marketing header and footer.
 */
export default function AdminRecordNotFound() {
  return (
    <PortalPage
      eyebrow="Control centre"
      title="This record is not in the control centre"
      description="The organisation, enquiry or product may have been removed, or the address may be mistyped. No data was changed."
    >
      <div className="rounded-lg border border-steel-200 bg-white p-6 text-sm leading-6 text-steel-600">
        <p>
          Search the register for the record you meant, or return to the dashboard and start from the
          overview.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm font-medium">
          <Link className="underline" href="/admin/dashboard">
            Control centre overview
          </Link>
          <Link className="underline" href="/admin/buyers">
            Buyer register
          </Link>
          <Link className="underline" href="/admin/suppliers">
            Supplier queue
          </Link>
          <Link className="underline" href="/admin/enquiries">
            Enquiries
          </Link>
        </div>
      </div>
    </PortalPage>
  );
}
