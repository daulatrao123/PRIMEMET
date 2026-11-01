import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { INDUSTRIES } from "@/lib/content/industries";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Industries",
  description: "Sectors PRIMEMET sources for: steel and rolling, foundries, fabrication, cement and aggregates, power and utilities, and recycling.",
  path: "/industries",
});

export default function IndustriesPage() {
  return (
    <>
      <PageHero
        eyebrow="Industries"
        title="Sourcing shaped by how the plant actually runs"
        description="A mill, a foundry and a fabrication shop each consume scrap and spares differently. The programme is written around the operating constraint, not a generic service list."
        crumbs={[{ label: "Industries" }]}
        actions={
          <ButtonLink href="/request-a-quote" size="lg">
            Request a quote
          </ButtonLink>
        }
      />

      <Section tone="light">
        <div className="space-y-5">
          {INDUSTRIES.map((industry) => (
            <Card key={industry.slug} className="overflow-hidden">
              <div className="grid lg:grid-cols-[0.9fr_1.05fr_1.05fr]">
                <div className="border-b border-steel-200 bg-navy-950 p-6 text-white lg:border-b-0 lg:border-r">
                  <h2 className="text-lg font-semibold tracking-tight">{industry.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-navy-300">{industry.summary}</p>
                  <p className="mt-4 text-xs leading-5 text-steel-400">{industry.body}</p>
                </div>

                <div className="border-b border-steel-200 p-6 lg:border-b-0 lg:border-r">
                  <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-steel-500">
                    Typical pressures
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {industry.pressures.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm leading-6 text-steel-600">
                        <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-steel-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-6">
                  <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-green-700">
                    Where we help
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {industry.howWeHelp.map((item) => (
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
          ))}
        </div>
      </Section>
    </>
  );
}
