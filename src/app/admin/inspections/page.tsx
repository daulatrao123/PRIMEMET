import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { ExampleData, NotRecorded } from "@/components/portal/example-data";
import { NotConnected } from "@/components/ui/not-connected";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  INSPECTIONS,
  INSPECTION_METHODS,
  type InspectionRecommendation,
} from "@/lib/content/catalogue";

export const metadata: Metadata = { title: "Quality & inspection" };

const RECOMMENDATION_TONE: Record<InspectionRecommendation, "green" | "amber" | "red" | "steel"> = {
  PENDING: "steel",
  ACCEPT: "green",
  REJECT: "red",
  REINSPECT: "amber",
};

/** Fields every inspection record carries. Listed once so the form and the record agree. */
const INSPECTION_FIELDS = [
  "lot reference",
  "supplier and material",
  "declared grade",
  "inspection date",
  "inspection location",
  "inspector or agency",
  "inspection method",
  "visual inspection result",
  "chemical composition result",
  "XRF readings",
  "laboratory report",
  "moisture assessment",
  "oil, rust and coating assessment",
  "foreign material assessment",
  "quantity and weight verification",
  "photographs and video",
  "inspector remarks",
  "accept or reject recommendation",
];

export default function AdminInspectionsPage() {
  return (
    <PortalPage
      eyebrow="Quality & inspection"
      title="Quality & inspection management"
      description="Inspection records for each lot, so grade, composition, contamination and weight are documented before a buyer is asked to accept anything."
      actions={<PreviewAction>New inspection</PreviewAction>}
    >
      <NotConnected>
        Inspection records will be written to PostgreSQL in Stage 3, with evidence stored in a
        private bucket. No finding on this screen has been recorded.
      </NotConnected>

      <ExampleData>
        These records exist to show the shape of an inspection, not its content. Every finding reads
        as unrecorded because none has been captured, and no result is invented to fill a column.
      </ExampleData>

      <Panel
        title="Open inspections"
        description="An inspection is open until it carries a recommendation. A lot cannot reach buyer review without one."
      >
        <Table caption="Inspection records with lot, methods, findings and recommendation">
          <THead>
            <TR>
              <TH>Inspection</TH>
              <TH>Lot and material</TH>
              <TH>Inspector</TH>
              <TH>Methods</TH>
              <TH>Findings</TH>
              <TH>Recommendation</TH>
            </TR>
          </THead>
          <TBody>
            {INSPECTIONS.map((inspection) => (
              <TR key={inspection.reference}>
                <TD>
                  <span className="font-mono text-xs font-semibold text-navy-950">
                    {inspection.reference}
                  </span>
                  <span className="mt-1 block text-xs text-steel-500">
                    {inspection.inspectedOn ?? "Not yet inspected"}
                  </span>
                </TD>
                <TD>
                  <span className="font-mono text-xs text-steel-600">{inspection.lot}</span>
                  <span className="mt-0.5 block text-xs text-steel-500">
                    {inspection.material} · {inspection.declaredGrade}
                  </span>
                </TD>
                <TD className="text-xs">
                  {inspection.inspector}
                  <span className="mt-0.5 block text-steel-500">{inspection.agency}</span>
                </TD>
                <TD className="text-xs">
                  {inspection.methods
                    .map(
                      (method) =>
                        INSPECTION_METHODS.find((candidate) => candidate.key === method)?.label ?? method,
                    )
                    .join(", ")}
                </TD>
                <TD className="text-xs">
                  <span className="block">Visual: {inspection.visual}</span>
                  <span className="block">Contamination: {inspection.contamination}</span>
                  <span className="block">Weight: {inspection.weightVerification}</span>
                  <span className="mt-1 block text-steel-500">{inspection.media} media items</span>
                </TD>
                <TD>
                  <Badge tone={RECOMMENDATION_TONE[inspection.recommendation]}>
                    {inspection.recommendation}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Inspection record fields" description="Captured for every inspection, relevant or marked not required.">
          <div className="grid gap-2 sm:grid-cols-2">
            {INSPECTION_FIELDS.map((field) => (
              <div
                key={field}
                className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 font-mono text-[0.7rem] text-steel-600"
              >
                {field}
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Choosing the method"
          description="Requirement follows material, grade, value and buyer instruction. Nothing here is mandatory for every lot."
        >
          <ul className="space-y-3">
            {INSPECTION_METHODS.map((method) => (
              <li key={method.key}>
                <p className="text-sm font-semibold text-navy-950">{method.label}</p>
                <p className="mt-0.5 text-sm leading-6 text-steel-600">{method.use}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Findings that must never be assumed"
        description="Rules inherited from the composition model."
      >
        <ul className="space-y-2.5 text-sm leading-6 text-steel-600">
          {[
            "A declared grade is not a chemical composition. The composition table carries that claim separately.",
            "An XRF reading is recorded with its method, date and operator, and remains a sample result.",
            "A laboratory report is attached to the record that cites it, so the finding and the evidence cannot separate.",
            "Where a finding is not required, the record says so explicitly rather than leaving the field blank.",
            "No finding is visible to a buyer until an admin releases the specific version to that buyer.",
          ].map((rule) => (
            <li key={rule} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
              {rule}
            </li>
          ))}
        </ul>
        <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-steel-500">
          Unrecorded fields render as
          <NotRecorded />
          rather than as a value, a zero or a dash that could read as a measurement.
        </p>
      </Panel>
    </PortalPage>
  );
}
