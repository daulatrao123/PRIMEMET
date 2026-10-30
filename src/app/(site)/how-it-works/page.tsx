import type { Metadata } from "next";
import { NotConnected } from "@/components/ui/not-connected";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How a PRIMEMET sourcing brief moves from specification to delivery: four checkpoints with an owner, a decision and a record at each stage.",
};

const CHECKPOINTS = [
  {
    step: "01",
    title: "Brief",
    summary: "The specification is written down before anything is bought.",
    youSend: ["Material grade or part identification", "Volume and delivery cadence", "Destination and required window"],
    weDo: [
      "Confirm the specification back in writing",
      "Flag anything ambiguous or unachievable",
      "Agree the inspection standard and records required",
    ],
  },
  {
    step: "02",
    title: "Qualify",
    summary: "Only qualified yards and workshops enter the shortlist.",
    youSend: ["Any approved-supplier list you require", "Site or documentation constraints"],
    weDo: [
      "Screen suppliers on licences, capacity and past batches",
      "Check the material or part can actually be produced",
      "Confirm the sourcing route and why it was chosen",
    ],
  },
  {
    step: "03",
    title: "Inspect",
    summary: "The lot is checked against the brief before it is dispatched.",
    youSend: ["Any third-party inspection you require", "Acceptance criteria for substitutes"],
    weDo: [
      "Screen and grade the lot at origin",
      "Attach photographs and a condition record",
      "Log any non-conformance before loading, not after",
    ],
  },
  {
    step: "04",
    title: "Deliver",
    summary: "Freight, weighbridge and paperwork are reconciled to the brief.",
    youSend: ["Receiving constraints and documentation needs"],
    weDo: [
      "Coordinate freight and Incoterms",
      "Reconcile weighbridge figures at both ends",
      "Issue the consignment record against the original brief",
    ],
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="A brief moves through four checkpoints"
        description="No enquiry disappears into a broker's inbox. Each checkpoint has an owner, a decision and a record you can audit later."
        crumbs={[{ label: "How it works" }]}
        actions={
          <ButtonLink href="/request-a-quote" size="lg">
            Start a brief
          </ButtonLink>
        }
      />

      <Section tone="light">
        <ol className="space-y-4">
          {CHECKPOINTS.map((checkpoint) => (
            <li key={checkpoint.step}>
              <Card className="overflow-hidden">
                <div className="grid lg:grid-cols-[0.85fr_1fr_1fr]">
                  <div className="border-b border-steel-200 bg-steel-50 p-6 lg:border-b-0 lg:border-r">
                    <span className="font-mono text-xs tracking-widest text-green-700">
                      {checkpoint.step}
                    </span>
                    <h2 className="mt-3 text-lg font-semibold text-navy-950">{checkpoint.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-steel-600">{checkpoint.summary}</p>
                  </div>

                  <div className="border-b border-steel-200 p-6 lg:border-b-0 lg:border-r">
                    <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-steel-500">
                      What you send
                    </h3>
                    <ul className="mt-3 space-y-2">
                      {checkpoint.youSend.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-sm leading-6 text-navy-900">
                          <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-steel-400" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-6">
                    <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-green-700">
                      What PRIMEMET does
                    </h3>
                    <ul className="mt-3 space-y-2">
                      {checkpoint.weDo.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-sm leading-6 text-navy-900">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 16 16"
                            className="mt-1 size-3.5 shrink-0 text-green-600"
                            fill="none"
                          >
                            <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="grey">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionHeading
            eyebrow="Separation of information"
            title="What you see, and what stays internal"
            description="PRIMEMET compares supplier quotations and prepares your quotation. The internal side of that work — supplier identity, purchase cost, margin — is deliberately kept out of buyer-facing screens."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-6">
              <h3 className="text-sm font-semibold text-navy-950">Buyer-facing</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-steel-600">
                {["Specification and grade", "Offered price and validity", "Delivery terms and window", "Inspection records"].map(
                  (item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </Card>
            <Card className="border-navy-800 bg-navy-950 p-6 text-white">
              <h3 className="text-sm font-semibold">Internal only</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-navy-300">
                {["Supplier identity and contact", "Supplier quotations and purchase cost", "Margin and commission", "Internal notes and scoring"].map(
                  (item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-steel-500" />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </Card>
          </div>
        </div>

        <NotConnected className="mt-10">
          These screens are described here only. The buyer and admin areas that apply this separation
          are interface previews until the platform database and permissions are connected.
        </NotConnected>
      </Section>
    </>
  );
}
