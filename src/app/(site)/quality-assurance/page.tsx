import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";
import {
  COMPOSITION_RULES,
  DISPATCH_CHECKS,
  INSPECTION_METHODS,
  REJECTION_REASONS,
  RESOLUTION_OPTIONS,
  VERIFICATION_LABELS,
  WORKFLOW_STAGES,
  type VerificationStatus,
} from "@/lib/content/catalogue";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Quality assurance",
  description: "How PRIMEMET coordinates material inspection, quality documentation, buyer approval and dispatch to reduce rejection, dispute and transport risk in industrial scrap transactions.",
  path: "/quality-assurance",
});

/** The five verification states, in order of evidentiary strength. */
const VERIFICATION_STATES: {
  key: VerificationStatus;
  meaning: string;
  limits: string;
}[] = [
  {
    key: "SUPPLIER_DECLARED",
    meaning: "The supplier has stated the composition or grade. PRIMEMET has recorded the declaration against the lot.",
    limits: "This is a claim by the supplier. PRIMEMET has not independently confirmed it.",
  },
  {
    key: "SAMPLE_TESTED",
    meaning: "A sample was taken and tested, and the result is recorded against the lot with its method and date.",
    limits: "A sample describes the sample. It is not a guarantee for the whole lot unless the sampling basis says so.",
  },
  {
    key: "LABORATORY_VERIFIED",
    meaning: "An independent laboratory has issued a report, and that report is held with the lot record.",
    limits: "The report covers the sample submitted to that laboratory on that date.",
  },
  {
    key: "BUYER_APPROVED",
    meaning: "The buyer has reviewed the evidence for a specific lot and inspection version and approved it.",
    limits: "Approval is bound to that version. A later re-inspection requires fresh approval.",
  },
  {
    key: "NOT_YET_VERIFIED",
    meaning: "No verification has been completed. The field is shown as unverified rather than left blank or filled with an assumption.",
    limits: "Nothing is implied. An unverified field is exactly that.",
  },
];

export default function QualityAssurancePage() {
  return (
    <>
      <PageHero
        eyebrow="Quality assurance"
        title="Quality verified. Commercially coordinated. Delivered with confidence."
        description="Industrial scrap transactions require more than a price quotation. Material grade, composition, contamination, quantity and delivery conditions all matter."
        crumbs={[{ label: "Quality assurance" }]}
        actions={
          <>
            <ButtonLink href="/request-a-quote">Request a quote</ButtonLink>
            <ButtonLink href="/how-it-works" variant="ghost">
              How we work
            </ButtonLink>
          </>
        }
      />

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="The problem"
              title="A price alone does not describe a load"
              description="Two consignments can share a grade name and differ in composition, contamination, moisture and weight. When those differences surface after delivery, the cost lands as return freight, storage, deductions and a disputed invoice."
            />
            <div className="mt-8 space-y-4 text-base leading-7 text-steel-600">
              <p>
                PRIMEMET coordinates material inspection, quality documentation, buyer approval and
                dispatch processes to help reduce avoidable disputes and transportation risks.
              </p>
              <p>
                The work is administrative as much as physical. Each lot carries a record of what was
                declared, what was inspected, what the buyer approved and what was despatched, so a
                question about a consignment is answered from evidence rather than recollection.
              </p>
            </div>
          </div>

          <Card className="border-navy-800 bg-navy-950 p-7 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-400">
              What coordination changes
            </p>
            <ul className="mt-6 space-y-5">
              {[
                {
                  title: "Declared and measured stay separate",
                  body: "A supplier declaration is never presented as a test result, and a measurement never silently replaces the declaration.",
                },
                {
                  title: "The buyer approves a specific lot",
                  body: "Approval is tied to a lot and an inspection version, so physical evidence travels with the decision.",
                },
                {
                  title: "Dispatch has a gate",
                  body: "A lot cannot be released on a verbal understanding. Each precondition is recorded before loading.",
                },
                {
                  title: "Disputes have a defined route",
                  body: "Tolerance, permitted deductions and the rejection procedure are agreed before the material moves.",
                },
              ].map((item) => (
                <li key={item.title} className="border-l-2 border-green-500/70 pl-4">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-navy-300">{item.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section tone="grey" id="process">
        <SectionHeading
          eyebrow="The transaction record"
          title="Seven stages, each with something recorded"
          description="Every lot moves through the same sequence. A stage is not complete because it was discussed; it is complete when its record exists."
        />

        <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW_STAGES.map((stage) => (
            <li key={stage.key}>
              <Card className="flex h-full flex-col p-6">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs font-semibold text-green-600">{stage.step}</span>
                  <h3 className="text-base font-semibold text-navy-950">{stage.title}</h3>
                </div>
                <p className="mt-2 text-xs uppercase tracking-[0.12em] text-steel-500">{stage.owner}</p>
                <ul className="mt-4 space-y-1.5 border-t border-steel-200 pt-4">
                  {stage.records.map((record) => (
                    <li key={record} className="flex gap-2 text-sm leading-6 text-steel-600">
                      <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-steel-400" />
                      {record}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="light" id="verification">
        <SectionHeading
          eyebrow="Declared versus tested"
          title="Five states, and what each one actually means"
          description="A trade grade name describes a material; it does not by itself guarantee a chemical composition. Where a composition is recorded, its basis is stated with it."
        />

        <div className="mt-12 grid gap-3">
          {VERIFICATION_STATES.map((state) => (
            <Card key={state.key} className="p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,11rem)_1fr] sm:gap-8">
                <div>
                  <Badge tone={state.key === "NOT_YET_VERIFIED" ? "red" : "steel"}>
                    {VERIFICATION_LABELS[state.key]}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm leading-6 text-navy-900">{state.meaning}</p>
                  <p className="mt-2 text-sm leading-6 text-steel-500">
                    <span className="font-semibold text-steel-600">What it does not mean: </span>
                    {state.limits}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="mt-6 border-steel-300 bg-steel-50 p-6">
          <h3 className="text-sm font-semibold text-navy-950">How composition is recorded</h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {COMPOSITION_RULES.map((rule) => (
              <li key={rule} className="flex gap-2 text-sm leading-6 text-steel-600">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
                {rule}
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section tone="grey" id="inspection">
        <SectionHeading
          eyebrow="Inspection"
          title="Testing is matched to the risk, not applied to everything"
          description="XRF and laboratory analysis are not made mandatory for every material. The inspection requirement follows the material, the grade, the value and the buyer requirement."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {INSPECTION_METHODS.map((method) => (
            <Card key={method.key} className="p-6">
              <h3 className="text-sm font-semibold text-navy-950">{method.label}</h3>
              <p className="mt-2 text-sm leading-6 text-steel-600">{method.use}</p>
            </Card>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-navy-950">The dispatch gate</h3>
            <p className="mt-2 text-sm leading-6 text-steel-600">
              A lot is not released until each of the following is recorded. Where an exception is
              genuinely necessary, it requires an authorised override with a written reason and an
              audit record.
            </p>
            <ul className="mt-5 space-y-2.5">
              {DISPATCH_CHECKS.map((check) => (
                <li key={check.key} className="flex gap-2.5 text-sm leading-6 text-navy-900">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-green-600"
                  >
                    <span className="size-1.5 rounded-full bg-green-600" />
                  </span>
                  {check.label}
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="text-sm font-semibold text-navy-950">Reasons a load can be rejected</h3>
              <p className="mt-2 text-sm leading-6 text-steel-600">
                Rejections are recorded against a documented reason, not a general objection.
              </p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {REJECTION_REASONS.map((reason) => (
                  <li key={reason.key}>
                    <Badge>{reason.label}</Badge>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-6">
              <h3 className="text-sm font-semibold text-navy-950">How a rejection is resolved</h3>
              <p className="mt-2 text-sm leading-6 text-steel-600">
                Responsibility follows the agreed transaction terms and the evidence. It is not
                assigned automatically by the software or by whichever party raises the issue first.
              </p>
              <ul className="mt-4 space-y-2">
                {RESOLUTION_OPTIONS.map((option) => (
                  <li key={option.key} className="text-sm leading-6 text-steel-600">
                    <span className="font-semibold text-navy-900">{option.label}</span>
                    {" — "}
                    {option.effect}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </Section>

      <Section tone="light">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <SectionHeading
            eyebrow="What we do not claim"
            title="The limits of this page"
            description="Coordination reduces avoidable risk. It does not remove it, and it is not a warranty of composition."
          />
          <div className="space-y-4">
            {[
              {
                title: "No specification is stated in advance of a transaction",
                body: "The applicable grade, composition basis and tolerances are agreed for each transaction. Nothing on this website is a standing offer of a particular composition.",
              },
              {
                title: "Inspection is not a guarantee of the whole lot",
                body: "Where testing is done, it reflects the sample and the method recorded. A supplier declaration remains a declaration even after other attributes are tested.",
              },
              {
                title: "Risk figures are estimates, not outcomes",
                body: "Where rejection exposure is calculated for a transaction, it is an internal estimate of what is at stake. It is not a prediction, a guaranteed loss or a guaranteed saving.",
              },
              {
                title: "Commercial model is recorded per transaction",
                body: "PRIMEMET acts as principal in some transactions, as agent in others and under a managed-supply arrangement in others. Whether PRIMEMET is the seller depends on what was agreed for that transaction.",
              },
            ].map((item) => (
              <Card key={item.title} className="p-5">
                <h3 className="text-sm font-semibold text-navy-950">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-steel-600">{item.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </Section>

      <Section tone="navy">
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Tell us the material, the quantity and the destination
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-navy-200">
              Inspection requirements, evidence and commercial terms are confirmed in writing before
              material moves. Send the specification and we will set out what coordination the
              transaction needs.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/request-a-quote" size="lg">
              Request a quote
            </ButtonLink>
            <ButtonLink href="/trading-models" size="lg" variant="ghost">
              Trading models
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}