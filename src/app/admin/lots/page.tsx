import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { ExampleData, InternalOnly, NotRecorded } from "@/components/portal/example-data";
import { NotConnected } from "@/components/ui/not-connected";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  BUYER_APPROVAL_LABELS,
  COMMERCIAL_MODEL_LABELS,
  LOTS,
  STAGE_LABELS,
  STAGE_REQUIREMENTS,
  type BuyerApprovalState,
  type DispatchState,
} from "@/lib/content/catalogue";

export const metadata: Metadata = { title: "Scrap lots" };

const APPROVAL_TONE: Record<BuyerApprovalState, "green" | "amber" | "red" | "steel"> = {
  NOT_SHARED: "steel",
  AWAITING_REVIEW: "amber",
  APPROVED: "green",
  APPROVED_WITH_TOLERANCE: "green",
  REJECTED: "red",
  FURTHER_INSPECTION_REQUESTED: "amber",
};

const DISPATCH_TONE: Record<DispatchState, "green" | "amber" | "red" | "steel" | "navy"> = {
  NOT_READY: "steel",
  BLOCKED: "red",
  AUTHORISED: "amber",
  DISPATCHED: "navy",
  DELIVERED: "green",
};

export default function AdminLotsPage() {
  return (
    <PortalPage
      eyebrow="Quality & inspection"
      title="Scrap lots"
      description="Actual lots held or under offer, kept separate from the grade catalogue. A grade describes a material; a lot is a specific consignment with its own inspection, approval and settlement."
      actions={<PreviewAction>Register lot</PreviewAction>}
    >
      <NotConnected>
        Lots will be created by the supplier submission flow and stored in PostgreSQL in Stage 3.
        The rows below illustrate the register and its states; they are not real consignments.
      </NotConnected>

      <ExampleData>
        No quantity, weight, purchase rate or quotation rate is shown for these rows. Those figures
        arrive with a weighed and priced lot, and they are internal until a quotation is issued.
      </ExampleData>

      <Panel
        title="Lot register"
        description="Every lot carries a reference, the stage it has reached, whether the buyer has approved it, and whether dispatch is released."
      >
        <Table caption="Scrap lots with stage, buyer approval, dispatch state and commercial model">
          <THead>
            <TR>
              <TH>Lot</TH>
              <TH>Material</TH>
              <TH>Supplier</TH>
              <TH>Stage</TH>
              <TH>Buyer approval</TH>
              <TH>Dispatch</TH>
              <TH>Model</TH>
            </TR>
          </THead>
          <TBody>
            {LOTS.map((lot) => (
              <TR key={lot.reference}>
                <TD>
                  <Link
                    href={`/admin/lots/${lot.reference}`}
                    className="font-mono text-xs font-semibold text-navy-950 underline decoration-steel-300 underline-offset-2 hover:decoration-navy-950"
                  >
                    {lot.reference}
                  </Link>
                  <span className="mt-1 block text-xs text-steel-500">
                    {lot.photos} photos · {lot.location}
                  </span>
                </TD>
                <TD>
                  <span className="font-medium text-navy-950">{lot.material}</span>
                  <span className="mt-0.5 block text-xs text-steel-500">{lot.grade}</span>
                </TD>
                <TD className="text-xs">{lot.supplier}</TD>
                <TD>
                  <Badge tone="steel">{STAGE_LABELS[lot.stage]}</Badge>
                </TD>
                <TD>
                  <Badge tone={APPROVAL_TONE[lot.buyerApproval]}>
                    {BUYER_APPROVAL_LABELS[lot.buyerApproval]}
                  </Badge>
                </TD>
                <TD>
                  <Badge tone={DISPATCH_TONE[lot.dispatch]}>{lot.dispatch.replace(/_/g, " ")}</Badge>
                </TD>
                <TD className="text-xs">{COMMERCIAL_MODEL_LABELS[lot.commercialModel]}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel
        title="Stage gates"
        description="A lot cannot move to a stage until the previous stage has recorded what it requires. These checks belong on the server, not in the interface."
      >
        <ul className="space-y-4">
          {STAGE_REQUIREMENTS.map((requirement) => (
            <li key={requirement.stage} className="border-l-2 border-steel-200 pl-4">
              <p className="text-sm font-semibold text-navy-950">
                To reach {STAGE_LABELS[requirement.stage]}
              </p>
              <ul className="mt-1.5 space-y-1">
                {requirement.requires.map((item) => (
                  <li key={item} className="flex gap-2 text-sm leading-6 text-steel-600">
                    <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-steel-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Internal figures are withheld" description="Why no commercial column is shown on this register.">
        <div className="space-y-3 text-sm leading-6 text-steel-600">
          <p className="flex flex-wrap items-center gap-2">
            <InternalOnly /> Internal purchase rate, supplier terms and margin never appear on this
            screen, in a buyer-facing view, or in any public API payload.
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <NotRecorded label="Not available"/> Purchase and quotation rates are absent rather than
            zero until a ledger exists, so an unpriced lot cannot be mistaken for a free one.
          </p>
        </div>
      </Panel>
    </PortalPage>
  );
}
