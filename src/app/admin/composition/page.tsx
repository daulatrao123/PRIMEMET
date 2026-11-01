import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { ExampleData, NotRecorded } from "@/components/portal/example-data";
import { NotConnected } from "@/components/ui/not-connected";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  COMPOSITION_PROFILES,
  COMPOSITION_RULES,
  INSPECTION_METHODS,
  VERIFICATION_LABELS,
  VERIFICATION_TONE,
  type CompositionAttribute,
} from "@/lib/content/catalogue";

export const metadata: Metadata = { title: "Composition specifications" };

const BASIS_LABEL: Record<CompositionAttribute["basis"], string> = {
  MIN: "min",
  MAX: "max",
  TARGET: "target",
  RANGE: "range",
};

/** Renders the reference range from whichever bound the attribute carries. */
function reference(attribute: CompositionAttribute) {
  if (attribute.basis === "RANGE") {
    return `${attribute.referenceMin} – ${attribute.referenceMax} ${attribute.unit}`;
  }
  const bound = attribute.referenceMin ?? attribute.referenceMax;
  if (!bound) return null;
  return `${BASIS_LABEL[attribute.basis]} ${bound} ${attribute.unit}`;
}

export default function AdminCompositionPage() {
  return (
    <PortalPage
      eyebrow="Catalogue"
      title="Material and metal composition"
      description="Composition is configured as attributes, not as columns for each metal. Adding an element, or a physical property, is a data change rather than a schema migration."
      actions={<PreviewAction>New profile</PreviewAction>}
    >
      <NotConnected>
        Composition profiles, declared values and measured values will be stored in PostgreSQL in
        Stage 3. The profiles below illustrate the attribute model only.
      </NotConnected>

      <ExampleData>
        Reference ranges below are illustrative placeholders for the configuration model. They are
        not a specification, not a test result, and no measured value has been recorded for any of
        them.
      </ExampleData>

      <Panel
        title="How an attribute is configured"
        description="Every attribute carries the same fields, so any element or physical property is described the same way."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            "element name",
            "symbol",
            "basis: min | max | target | range",
            "lower and upper bound",
            "unit",
            "specification source",
            "declared value",
            "measured value",
            "test method",
            "test date",
            "testing agency",
            "report attachment",
            "verification status",
          ].map((field) => (
            <div
              key={field}
              className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 font-mono text-[0.7rem] text-steel-600"
            >
              {field}
            </div>
          ))}
        </div>
      </Panel>

      {COMPOSITION_PROFILES.map((profile) => (
        <Panel
          key={profile.key}
          title={profile.material}
          description={profile.note}
          actions={
            <>
              <Badge tone="steel">{profile.attributes.length} attributes</Badge>
              <PreviewAction>Edit profile</PreviewAction>
            </>
          }
        >
          <Table caption={`Composition attributes for ${profile.material}, showing reference, declared and measured values`}>
            <THead>
              <TR>
                <TH>Attribute</TH>
                <TH>Reference</TH>
                <TH>Declared</TH>
                <TH>Measured</TH>
                <TH>Method</TH>
                <TH>Verification</TH>
              </TR>
            </THead>
            <TBody>
              {profile.attributes.map((attribute) => (
                <TR key={`${profile.key}-${attribute.symbol}`}>
                  <TD>
                    <span className="font-mono text-xs font-semibold text-navy-950">
                      {attribute.symbol}
                    </span>
                    <span className="mt-0.5 block text-xs text-steel-500">{attribute.name}</span>
                  </TD>
                  <TD className="whitespace-nowrap font-mono text-xs">
                    {reference(attribute) ?? <NotRecorded label="Not set" />}
                    <span className="mt-1 block font-sans text-[0.68rem] leading-4 text-steel-500">
                      {attribute.source}
                    </span>
                  </TD>
                  <TD className="text-xs">
                    {attribute.declared ?? <NotRecorded label="No declaration" />}
                  </TD>
                  <TD className="text-xs">{attribute.measured ?? <NotRecorded />}</TD>
                  <TD className="text-xs">
                    {attribute.method ? (
                      <span className="font-mono text-[0.68rem]">
                        {
                          INSPECTION_METHODS.find((method) => method.key === attribute.method)
                            ?.label
                        }
                      </span>
                    ) : (
                      <NotRecorded label="None" />
                    )}
                  </TD>
                  <TD>
                    <Badge tone={VERIFICATION_TONE[attribute.verification]}>
                      {VERIFICATION_LABELS[attribute.verification]}
                    </Badge>
                    {attribute.reportOnFile ? (
                      <span className="mt-1 block text-[0.68rem] text-steel-500">Report on file</span>
                    ) : (
                      <span className="mt-1 block text-[0.68rem] text-steel-500">No report on file</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Panel>
      ))}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Rules the stored version must enforce" description="Why declared and measured are separate fields.">
          <ul className="space-y-2.5 text-sm leading-6 text-steel-600">
            {COMPOSITION_RULES.map((rule) => (
              <li key={rule} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
                {rule}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Inspection methods available" description="Testing is proportional to risk; none of these is mandatory for every material.">
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
    </PortalPage>
  );
}