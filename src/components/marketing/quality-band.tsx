import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section, SectionHeading } from "@/components/ui/section";
import { VERIFICATION_LABELS } from "@/lib/content/catalogue";

/**
 * Homepage quality band.
 *
 * Summarises the coordination promise and links to the full quality page. It states no
 * composition, no tonnage and no acceptance rate, because those belong to a transaction
 * and not to a marketing page.
 */
export function QualityBand() {
  return (
    <Section tone="grey" id="quality">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-start lg:gap-16">
        <div>
          <SectionHeading
            eyebrow="Quality assurance"
            title="Quality verified. Commercially coordinated. Delivered with confidence."
            description="Industrial scrap transactions require more than a price quotation. Material grade, composition, contamination, quantity and delivery conditions all matter."
          />
          <p className="mt-6 max-w-xl text-base leading-7 text-steel-600">
            PRIMEMET coordinates material inspection, quality documentation, buyer approval and
            dispatch processes to help reduce avoidable disputes and transportation risks.
          </p>

          <div className="mt-8 flex flex-wrap gap-2">
            {(Object.keys(VERIFICATION_LABELS) as (keyof typeof VERIFICATION_LABELS)[]).map((key) => (
              <Badge key={key} tone={key === "NOT_YET_VERIFIED" ? "red" : "outline"}>
                {VERIFICATION_LABELS[key]}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-steel-500">
            Every recorded value carries one of these states. A supplier declaration is never shown as
            an independently verified result.
          </p>

          <div className="mt-8">
            <ButtonLink href="/quality-assurance" variant="secondary">
              How quality is coordinated
            </ButtonLink>
          </div>
        </div>

        <div className="grid gap-4">
          {[
            {
              step: "01",
              title: "Inspected before it is offered",
              body: "Grade, contamination, foreign material and weight are recorded per lot. XRF and laboratory analysis are added where the material, value and buyer requirement call for it.",
            },
            {
              step: "02",
              title: "Approved by the buyer who receives it",
              body: "Photographs, findings and any test report are shared against a specific lot. The buyer approves, rejects or asks for further inspection, and that decision is kept with the evidence.",
            },
            {
              step: "03",
              title: "Released through a dispatch gate",
              body: "Approval, confirmed terms, documented tolerance, freight responsibility and loading weighment are recorded before material leaves the yard.",
            },
            {
              step: "04",
              title: "Settled against what arrived",
              body: "Destination weighment and findings decide the accepted quantity and final value, and a dispute follows the procedure agreed before dispatch.",
            },
          ].map((item) => (
            <Card key={item.step} className="flex gap-4 p-5">
              <span className="mt-0.5 font-mono text-xs font-semibold text-green-600">{item.step}</span>
              <div>
                <h3 className="text-sm font-semibold text-navy-950">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-steel-600">{item.body}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Section>
  );
}