import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { MATERIALS } from "@/lib/content/materials";

export const metadata: Metadata = { title: "Scrap sourcing" };

export default function BuyerScrapSourcingPage() {
  return (
    <PortalPage
      eyebrow="Sourcing"
      title="Scrap sourcing"
      description="Grades available to your account, with the acceptance basis each brief is written against."
      actions={<PreviewAction>New scrap brief</PreviewAction>}
    >
      <NotConnected>
        Account-specific grades, tonnage and pricing are database records. The grades listed below
        are the public reference catalogue and carry no availability or price.
      </NotConnected>

      <Panel title="Reference grades" description="Static catalogue shared with the public materials pages.">
        <Table caption="Reference grades">
          <THead>
            <TR>
              <TH>Grade</TH>
              <TH>Group</TH>
              <TH>Typical basis</TH>
              <TH>Public page</TH>
            </TR>
          </THead>
          <TBody>
            {MATERIALS.map((material) => (
              <TR key={material.slug}>
                <TD className="font-medium text-navy-950">{material.name}</TD>
                <TD>{material.group}</TD>
                <TD className="text-xs">{material.acceptance[0]?.value ?? "Agreed per brief"}</TD>
                <TD>
                  <Link
                    href={`/scrap-metals/${material.slug}`}
                    className="text-xs font-medium text-green-700 underline underline-offset-2"
                  >
                    View grade
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Your enrolment" description="Grades and delivery points attached to your account.">
          <Table caption="Account grades">
            <THead>
              <TR>
                <TH>Grade</TH>
                <TH>Agreed basis</TH>
                <TH>Since</TH>
              </TR>
            </THead>
            <TBody>
              <EmptyRow colSpan={3}>
                No enrolment records. These appear once accounts and enquiries are live.
              </EmptyRow>
            </TBody>
          </Table>
        </Panel>

        <Panel title="Open scrap briefs" description="Briefs awaiting a specification review or quotation.">
          <Table caption="Open scrap briefs">
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Grade</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              <EmptyRow colSpan={3}>No open briefs.</EmptyRow>
            </TBody>
          </Table>
        </Panel>
      </div>
    </PortalPage>
  );
}
