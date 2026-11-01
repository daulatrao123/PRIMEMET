import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { ExampleData, InternalOnly, NotRecorded } from "@/components/portal/example-data";
import { NotConnected } from "@/components/ui/not-connected";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  BUYER_APPROVAL_LABELS,
  COMMERCIAL_MODEL_LABELS,
  COMPOSITION_PROFILES,
  DISPATCH_CHECKS,
  INSPECTIONS,
  LOTS,
  REJECTIONS,
  REJECTION_REASONS,
  RESOLUTION_OPTIONS,
  RISK_EXPOSURE_LINES,
  STAGE_LABELS,
  VERIFICATION_LABELS,
  VERIFICATION_TONE,
  type BuyerApprovalState,
  type CompositionAttribute,
  type DispatchState,
} from "@/lib/content/catalogue";

export function generateStaticParams() {
  return LOTS.map((lot) => ({ ref: lot.reference }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { ref } = await params;
  return { title: `Lot ${ref}` };
}

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

const BASIS_LABEL: Record<CompositionAttribute["basis"], string> = {
  MIN: "min",
  MAX: "max",
  TARGET: "target",
  RANGE: "range",
};

/**
 * A maximum must read as a maximum. Printing the bare number would let an upper
 * limit on impurities look like a target composition, which is exactly the
 * ambiguity a specification screen has to remove.
 */
function formatReference(attribute: CompositionAttribute) {
  if (attribute.basis === "RANGE") {
    return `${attribute.referenceMin} – ${attribute.referenceMax} ${attribute.unit}`;
  }
  const bound = attribute.referenceMin ?? attribute.referenceMax;
  if (!bound) return "Not set";
  return `${BASIS_LABEL[attribute.basis]} ${bound} ${attribute.unit}`;
}

export default async function AdminLotDetailPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const lot = LOTS.find((candidate) => candidate.reference === ref);
  if (!lot) notFound();

  const profile = COMPOSITION_PROFILES.find((candidate) => candidate.key === lot.compositionProfile);
  const inspection = INSPECTIONS.find((candidate) => candidate.lot === lot.reference);
  const rejection = REJECTIONS.find((candidate) => candidate.lot === lot.reference);

  return (
    <PortalPage
      eyebrow="Lot record"
      title={lot.reference}
      description={`${lot.material} · ${lot.grade} · ${lot.supplier}`}
      actions={
        <>
          <PreviewAction>Record inspection</PreviewAction>
          <PreviewAction>Share with buyer</PreviewAction>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="navy">{STAGE_LABELS[lot.stage]}</Badge>
        <Badge tone={APPROVAL_TONE[lot.buyerApproval]}>
          Buyer: {BUYER_APPROVAL_LABELS[lot.buyerApproval]}
        </Badge>
        <Badge tone={DISPATCH_TONE[lot.dispatch]}>
          Dispatch: {lot.dispatch.replace(/_/g, " ")}
        </Badge>
        <Badge tone="steel">Model: {COMMERCIAL_MODEL_LABELS[lot.commercialModel]}</Badge>
        <Link
          href="/admin/lots"
          className="text-xs font-semibold text-steel-600 underline decoration-steel-300 underline-offset-2 hover:text-navy-950"
        >
          Back to lot register
        </Link>
      </div>

      <NotConnected>
        This lot record will be read from PostgreSQL in Stage 3. The values on this page illustrate
        the structure of the record and the distinctions it must preserve.
      </NotConnected>

      <ExampleData>
        No quantity, weight, rate, cost or settlement figure is shown, because no ledger exists. Every
        composition value below is unverified placeholder text.
      </ExampleData>

      <Panel
        title="Declared versus tested composition"
        description="A supplier declaration is never presented as an independently verified result."
      >
        {profile ? (
          <Table caption={`Composition for ${lot.material}, showing reference, declared, measured and verification state`}>
            <THead>
              <TR>
                <TH>Attribute</TH>
                <TH>Reference</TH>
                <TH>Declared</TH>
                <TH>Measured</TH>
                <TH>Method and date</TH>
                <TH>Verification</TH>
              </TR>
            </THead>
            <TBody>
              {profile.attributes.map((attribute) => (
                <TR key={attribute.symbol}>
                  <TD>
                    <span className="font-mono text-xs font-semibold text-navy-950">
                      {attribute.symbol}
                    </span>
                    <span className="mt-0.5 block text-xs text-steel-500">{attribute.name}</span>
                  </TD>
                  <TD className="whitespace-nowrap font-mono text-xs">
                    {formatReference(attribute)}
                  </TD>
                  <TD className="text-xs">
                    {attribute.declared ?? <NotRecorded label="No declaration" />}
                  </TD>
                  <TD className="text-xs">{attribute.measured ?? <NotRecorded />}</TD>
                  <TD className="text-xs">
                    {attribute.method ? (
                      <>
                        <span className="font-mono text-[0.68rem]">{attribute.method}</span>
                        <span className="mt-0.5 block text-steel-500">
                          {attribute.testedOn ?? "No test date recorded"}
                        </span>
                      </>
                    ) : (
                      <NotRecorded label="No test recorded" />
                    )}
                  </TD>
                  <TD>
                    <Badge tone={VERIFICATION_TONE[attribute.verification]}>
                      {VERIFICATION_LABELS[attribute.verification]}
                    </Badge>
                    <span className="mt-1 block text-[0.68rem] text-steel-500">
                      {attribute.reportOnFile ? "Report on file" : "No report on file"}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-sm leading-6 text-steel-600">
            This lot has no composition profile. Spare parts are specified by part number and
            manufacturer rather than by elemental composition.
          </p>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Inspection" description="Evidence recorded against this lot.">
          <dl className="space-y-3 text-sm">
            {[
              ["Inspection record", inspection?.reference ?? "Not created"],
              ["Inspected on", inspection?.inspectedOn ?? "Not yet inspected"],
              ["Inspector", inspection?.inspector ?? "Not assigned"],
              ["Agency", inspection?.agency ?? "Not assigned"],
              ["Methods", inspection?.methods.join(", ") ?? "None recorded"],
              ["Visual", inspection?.visual ?? "Not recorded"],
              ["Contamination", inspection?.contamination ?? "Not recorded"],
              ["Weight verification", inspection?.weightVerification ?? "Not recorded"],
              ["Recommendation", inspection?.recommendation ?? "Pending"],
            ].map(([label, value]) => (
              <div key={label} className="grid gap-1 border-b border-steel-100 pb-2 sm:grid-cols-[10rem_1fr]">
                <dt className="text-xs uppercase tracking-[0.1em] text-steel-500">{label}</dt>
                <dd className="text-navy-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel
          title="Buyer approval"
          description="Approval is bound to a lot and to the version of the evidence that was shared."
        >
          <div className="space-y-3 text-sm leading-6 text-steel-600">
            <p>
              <span className="font-semibold text-navy-950">State: </span>
              {BUYER_APPROVAL_LABELS[lot.buyerApproval]}
            </p>
            <p>
              The record keeps the approved specification, approval date, approved quantity, agreed
              price, the inspection report version approved, acceptance tolerances and buyer
              comments.
            </p>
            <p className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 text-xs leading-5">
              If a re-inspection produces a new evidence version, the previous approval no longer
              authorises dispatch and approval must be obtained again.
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        title="Commercial confirmation"
        description="Recorded before dispatch, per transaction. The model is stated rather than assumed."
      >
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {[
            ["Commercial model", COMMERCIAL_MODEL_LABELS[lot.commercialModel]],
            ["Agreed rate", "Not recorded"],
            ["Quantity and weight basis", "Not recorded"],
            ["Freight responsibility", "Not recorded"],
            ["Loading and unloading", "Not recorded"],
            ["Inspection and testing costs", "Not recorded"],
            ["Payment terms", "Not recorded"],
            ["Quality tolerance", "Not recorded"],
            ["Permitted deductions", "Not recorded"],
            ["Rejection procedure", "Not recorded"],
            ["Transit risk and damage", "Not recorded"],
            ["Dispute resolution", "Not recorded"],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-steel-100 pb-2">
              <dt className="text-xs uppercase tracking-[0.1em] text-steel-500">{label}</dt>
              <dd className="mt-0.5 text-navy-900">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-5 text-steel-500">
          PRIMEMET is not assumed to be the seller in every transaction. The model recorded here
          decides who sells, who invoices and who carries the risk.
        </p>
      </Panel>

      <Panel
        title="Dispatch gate"
        description="Each line blocks release until it is satisfied, or until an authorised override records a reason."
        actions={
          <Badge tone={DISPATCH_TONE[lot.dispatch]}>
            {lot.dispatch === "AUTHORISED" ? "Released" : "Not released"}
          </Badge>
        }
      >
        <ul className="space-y-2.5">
          {DISPATCH_CHECKS.map((check) => (
            <li key={check.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span
                aria-hidden="true"
                className="mt-1.5 grid size-4 shrink-0 place-items-center rounded-sm border border-steel-300 bg-steel-50"
              />
              <span className="text-navy-900">{check.label}</span>
              <span className="text-xs leading-5 text-steel-500">{check.blocks}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Estimated rejection exposure"
        description="An internal estimate of what is at stake on this lot. It is not a predicted loss."
        actions={<InternalOnly />}
      >
        <Table caption="Estimated rejection exposure lines for this lot">
          <THead>
            <TR>
              <TH>Exposure line</TH>
              <TH>Amount</TH>
              <TH>Why it matters</TH>
            </TR>
          </THead>
          <TBody>
            {RISK_EXPOSURE_LINES.map((line) => (
              <TR key={line.key}>
                <TD className="font-medium text-navy-950">{line.label}</TD>
                <TD>
                  <NotRecorded label="No amount" />
                </TD>
                <TD className="text-xs leading-5">{line.note}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="mt-3 text-xs leading-5 text-steel-500">
          An exposure total is shown only once cost lines exist. It is presented as an estimate of
          risk, never as a guaranteed loss or saving.
        </p>
      </Panel>

      {rejection ? (
        <Panel
          title="Rejection and dispute"
          description="Recorded against a documented reason, with responsibility taken from the agreed terms."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <dl className="space-y-2 text-sm">
              {[
                ["Case", rejection.reference],
                ["Reason", REJECTION_REASONS.find((reason) => reason.key === rejection.reason)?.label ?? ""],
                ["Rejected quantity", "Not recorded"],
                ["Evidence", `${rejection.evidenceCount} items recorded`],
                ["Responsibility", rejection.responsibility],
                ["Decision", rejection.decision],
                ["Resolution", rejection.resolution ? RESOLUTION_OPTIONS.find((option) => option.key === rejection.resolution)?.label ?? "" : "Not decided"],
                ["Status", rejection.status.replace(/_/g, " ")],
              ].map(([label, value]) => (
                <div key={label} className="border-b border-steel-100 pb-2">
                  <dt className="text-xs uppercase tracking-[0.1em] text-steel-500">{label}</dt>
                  <dd className="mt-0.5 text-navy-900">{value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="text-xs uppercase tracking-[0.1em] text-steel-500">Cost lines</p>
              <ul className="mt-2 space-y-1.5 text-sm text-steel-600">
                {rejection.costLines.map((line) => (
                  <li key={line.label} className="flex items-baseline justify-between gap-3 border-b border-steel-100 pb-1.5">
                    <span>{line.label}</span>
                    <NotRecorded label="No amount" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      ) : null}
    </PortalPage>
  );
}
