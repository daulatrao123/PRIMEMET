import type { Metadata } from "next";

import { requirePage } from "@/lib/auth/guards";
import { Panel, PortalPage } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Enquiries" };

export default async function SellerEnquiriesPage() {
  // A preview, but still a seller area: an anonymous visitor is redirected before anything renders.
  await requirePage(["SELLER"], "/seller/enquiries");
  return (
    <PortalPage
      eyebrow="Commercial"
      title="Enquiries sent to you"
      description="Briefs the desk has matched to your categories. Buyer identity and contact details are withheld until a programme is agreed."
    >
      <NotConnected>
        Enquiry matching needs both a buyer and a supplier record. Neither exists in this build, so
        this view is empty by design.
      </NotConnected>

      <Panel title="Matched briefs" description="What you see before quoting: the requirement, not the buyer.">
        <Table caption="Matched briefs">
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Requirement</TH>
              <TH>Volume</TH>
              <TH>Destination region</TH>
              <TH>Deadline</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No briefs. Qualified suppliers receive briefs once the matching workflow is connected.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="What is withheld, and why" description="Buyer privacy is part of the model, not an oversight.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            "Buyer name and contact details — released only to a selected supplier under an agreed programme.",
            "Buyer's commercial position and competing quotations.",
            "PRIMEMET's margin or commission on the programme.",
            "Other suppliers' submissions for the same brief.",
          ].map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm leading-6 text-navy-900"
            >
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-steel-400" />
              {item}
            </li>
          ))}
        </ul>
      </Panel>
    </PortalPage>
  );
}
