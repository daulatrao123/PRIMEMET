import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "About PRIMEMET",
  description:
    "PRIMEMET runs managed industrial scrap sourcing and spare-parts procurement programmes for plants, mills and maintenance teams — one accountable desk, one record of truth.",
};

const PRINCIPLES = [
  {
    title: "Specification first",
    body: "A grade named on paper is not a grade delivered. Every brief is written down, agreed and measured against what actually arrives.",
  },
  {
    title: "Records by default",
    body: "Inspection photographs, weighbridge tickets and non-conformance notes belong to the consignment, not to somebody's inbox.",
  },
  {
    title: "No undisclosed parties",
    body: "You know which yard or workshop a lot came from. Sub-sourcing chains are declared, not buried inside a margin.",
  },
  {
    title: "Engineering before price",
    body: "On spares, the replacement has to fit, resist and interface correctly. A cheaper part that fails in service is not a saving.",
  },
];

const NOT_WE_DO = [
  "We do not sell you a grade we have not specified and inspected.",
  "We do not propose a substitute without stating how it differs.",
  "We do not pass a supplier's problem to you as your problem.",
  "We do not publish prices, stock or availability that we have not verified.",
];

const STRUCTURE = [
  { label: "Remit", value: "Ferrous, non-ferrous, alloys, industrial spare parts" },
  { label: "Model", value: "Managed sourcing programme, disclosed supply chain" },
  { label: "Buyers served", value: "Plants, mills, foundries, maintenance and procurement teams" },
  { label: "Suppliers used", value: "Qualified yards, stockists and specialist workshops" },
  { label: "Reporting", value: "Consignment-level records and non-conformance log" },
  { label: "Commercial", value: "Agreed per brief — no published commodity or parts pricing" },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="A sourcing desk, not a scrap broker"
        description="PRIMEMET exists for procurement and maintenance teams who cannot afford a delivery that fails the furnace, the line or the audit. We run the sourcing programme and stay accountable for the result."
        crumbs={[{ label: "About" }]}
      />

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="Why we exist"
              title="Two procurement problems that keep showing up"
            />
            <div className="mt-6 space-y-4 text-base leading-7 text-steel-600">
              <p>
                The first is scrap that does not match its description. A grade is agreed on a
                call, a load arrives, and the difference is discovered at the weighbridge or —
                worse — in the heat analysis. By then the argument is about blame rather than
                metal.
              </p>
              <p>
                The second is the spare that cannot be identified. The machine is twenty years
                old, the part number returns nothing, and the line is waiting. What is needed is
                not another catalogue but somebody willing to establish what the part has to do.
              </p>
              <p>
                Both problems have the same root: sourcing split across parties who each own a
                fragment and none owns the outcome. PRIMEMET consolidates that into one programme,
                with the specification written down and the record kept.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-2">
              <Badge tone="green">Managed programmes</Badge>
              <Badge tone="outline">Disclosed supply chain</Badge>
              <Badge tone="outline">Written specification</Badge>
              <Badge tone="outline">Consignment records</Badge>
            </div>
          </div>

          <Card className="overflow-hidden self-start">
            <div className="border-b border-steel-200 bg-navy-950 px-6 py-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-green-400">
                The business, at a glance
              </h2>
            </div>
            <dl className="divide-y divide-steel-200">
              {STRUCTURE.map((row) => (
                <div key={row.label} className="px-6 py-4">
                  <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-steel-500">
                    {row.label}
                  </dt>
                  <dd className="mt-1 text-sm leading-6 text-navy-900">{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-steel-200 bg-steel-50 px-6 py-4 text-xs leading-5 text-steel-500">
              Trading history, registrations and insurance certificates are provided during
              supplier or buyer onboarding, not published as marketing claims.
            </div>
          </Card>
        </div>
      </Section>

      <Section tone="grey">
        <SectionHeading
          eyebrow="Operating principles"
          title="How the desk makes decisions"
          description="These are the rules that decide what we accept, what we refuse and what we tell you when something goes wrong."
        />
        <ul className="mt-12 grid gap-px overflow-hidden rounded-card bg-steel-200 sm:grid-cols-2">
          {PRINCIPLES.map((principle, index) => (
            <li key={principle.title} className="bg-white p-7">
              <span className="font-mono text-xs tracking-widest text-steel-500">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-base font-semibold text-navy-950">{principle.title}</h3>
              <p className="mt-2 text-sm leading-6 text-steel-600">{principle.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <SectionHeading
            eyebrow="Boundaries"
            title="What PRIMEMET does not do"
            description="A sourcing partner is defined as much by its refusals as by its offers. These are ours."
          />
          <ul className="space-y-3">
            {NOT_WE_DO.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-card border border-steel-200 bg-steel-50 px-5 py-4 text-sm leading-6 text-navy-900"
              >
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-green-600" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-16 flex flex-col gap-6 rounded-card border border-steel-200 bg-white p-7 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h2 className="text-lg font-semibold text-navy-950">Talk to the desk</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-steel-600">
              Send one brief — a single grade or a single part number is enough to see how the
              programme runs.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <ButtonLink href="/request-a-quote">Request a quote</ButtonLink>
            <ButtonLink href="/how-it-works" variant="secondary">
              How it works
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
