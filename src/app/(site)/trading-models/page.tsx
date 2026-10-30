import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Flexible industrial trading & sourcing models",
  description:
    "PRIMEMET works through four commercial arrangements — principal trading, sourcing and procurement, agency and intermediary services, and managed industrial supply — with one point of contact for every enquiry.",
};

const MODELS = [
  {
    number: "01",
    title: "Principal Trading",
    summary:
      "PRIMEMET purchases materials from suppliers and resells them to buyers under its own commercial terms.",
  },
  {
    number: "02",
    title: "Sourcing & Procurement",
    summary:
      "We identify suitable suppliers, negotiate pricing, coordinate procurement and help customers fulfil their material requirements.",
  },
  {
    number: "03",
    title: "Agency & Intermediary Services",
    summary:
      "We facilitate transactions between buyers and sellers and coordinate commercial discussions, documentation and fulfilment under an agreed fee arrangement.",
  },
  {
    number: "04",
    title: "Managed Industrial Supply",
    summary:
      "We support recurring material requirements and industrial scrap disposal through supplier coordination, pricing management, logistics and transaction support.",
  },
];

export default function TradingModelsPage() {
  return (
    <>
      <PageHero
        eyebrow="Commercial models"
        title="Flexible industrial trading & sourcing models"
        description="PRIMEMET provides end-to-end industrial scrap trading, material sourcing and procurement services through flexible commercial arrangements."
        crumbs={[{ label: "Trading models" }]}
        actions={
          <>
            <ButtonLink href="/request-a-quote" size="lg">
              Start a brief
            </ButtonLink>
            <ButtonLink href="/how-it-works" variant="ghost" size="lg">
              How it works
            </ButtonLink>
          </>
        }
      />

      <Section tone="light">
        <SectionHeading
          eyebrow="Introduction"
          title="One partner, several ways to trade"
          description="We work with manufacturers, industrial buyers, suppliers, recyclers and authorised vendors to simplify material procurement and industrial scrap transactions."
        />

        <ol className="mt-12 grid gap-4 sm:grid-cols-2">
          {MODELS.map((model) => (
            <li key={model.number}>
              <Card className="flex h-full flex-col p-6 sm:p-7">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs tracking-widest text-green-700">
                    {model.number}
                  </span>
                  <Badge tone="steel">Commercial model</Badge>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-navy-950">{model.title}</h3>
                <p className="mt-3 text-sm leading-6 text-steel-600">{model.summary}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="navy">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <SectionHeading
            eyebrow="Coordination"
            title="One point of contact"
            description="Regardless of the commercial arrangement, PRIMEMET provides a central point of coordination for enquiries, quotations, supplier communication and transaction support."
            tone="dark"
          />

          <Card className="border-white/10 bg-white/5 p-6 text-white sm:p-7">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-green-400">
              Agreed per transaction
            </h3>
            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {[
                "Applicable commercial model",
                "Responsibilities",
                "Fees",
                "Payment terms",
                "Documentation",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm leading-6 text-navy-200">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-400" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-white/10 pt-5 text-sm leading-6 text-navy-300">
              The applicable commercial model, responsibilities, fees, payment terms and
              documentation are agreed for each transaction.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="grey">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeading
            eyebrow="Next step"
            title="Tell us the requirement — we agree the arrangement"
            description="Send the specification, volume and destination. The commercial model is confirmed in writing before any transaction proceeds."
          />
          <div className="shrink-0">
            <ButtonLink href="/request-a-quote" size="lg">
              Request a quote
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
