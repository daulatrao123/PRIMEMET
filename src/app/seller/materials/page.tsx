import type { Metadata } from "next";

import { requirePage } from "@/lib/auth/guards";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Material listings" };

export default async function SellerMaterialsPage() {
  // A preview, but still a seller area: an anonymous visitor is redirected before anything renders.
  await requirePage(["SELLER"], "/seller/materials");
  return (
    <PortalPage
      eyebrow="Listings"
      title="Material listings"
      description="The grades you can supply, in what presentation, and the volume you can commit to."
      actions={<PreviewAction>Add material listing</PreviewAction>}
    >
      <NotConnected>
        Listings are supplier records in PostgreSQL. Nothing you add here would be saved, and no
        listing in this build is visible to the desk.
      </NotConnected>

      <Panel title="Your listings" description="One row per grade offered, with the presentation and capacity you are held to.">
        <Table caption="Material listings">
          <THead>
            <TR>
              <TH>Grade</TH>
              <TH>Presentation</TH>
              <TH>Monthly capacity</TH>
              <TH>Location</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No material listings. Listings appear here once a supplier account exists and can store
              records.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="What a listing carries" description="Designed so the desk can match a brief without a follow-up call.">
        <Table caption="Listing fields">
          <THead>
            <TR>
              <TH>Field</TH>
              <TH>Why it matters</TH>
            </TR>
          </THead>
          <TBody>
            {[
              ["Grade and group", "Determines which briefs the listing is matched against."],
              ["Presentation", "Loose, baled or boxed changes handling and freight."],
              ["Sizing capability", "Whether you can cut to a buyer's maximum dimension."],
              ["Monthly capacity", "Sets expectation before a brief is offered."],
              ["Collection location", "Drives freight and route selection."],
              ["Validity", "A listing that is out of date misleads the desk."],
            ].map(([field, why]) => (
              <TR key={field}>
                <TD className="font-medium text-navy-950">{field}</TD>
                <TD className="text-sm leading-6">{why}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}
