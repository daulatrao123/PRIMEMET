import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NotConnected } from "@/components/ui/not-connected";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";
import { MATERIALS, type Material } from "@/lib/content/materials";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Scrap metals",
  description: "Ferrous, non-ferrous and alloy scrap grades sourced against a written specification: sizing, contamination limits, presentation and inspection standard agreed before dispatch.",
  path: "/scrap-metals",
});

function MaterialCard({ material }: { material: Material }) {
  return (
    <Card className="group relative flex flex-col p-6 transition-colors hover:border-navy-300">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-navy-950">
          <a href={`/scrap-metals/${material.slug}`} className="after:absolute after:inset-0">
            {material.name}
          </a>
        </h3>
        <span className="shrink-0 font-mono text-[0.65rem] uppercase tracking-widest text-steel-500">
          {material.group}
        </span>
      </div>
      <p className="mt-3 flex-1 text-sm leading-6 text-steel-600">{material.summary}</p>
      <span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-green-700">
        Grade detail
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 transition-transform group-hover:translate-x-0.5" fill="none">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Card>
  );
}

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-steel-200 pb-4 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-navy-950">{title}</h2>
        <p className="text-sm text-steel-500">{description}</p>
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

export default function ScrapMetalsPage() {
  const ferrous = MATERIALS.filter((material) => material.group === "Ferrous");
  const nonFerrous = MATERIALS.filter((material) => material.group === "Non-ferrous");
  const alloys = MATERIALS.filter((material) => material.group === "Alloys");

  return (
    <>
      <PageHero
        eyebrow="Materials"
        title="Scrap metals sourced to a written specification"
        description="Grade names carry regional variation. Every brief PRIMEMET runs fixes the sizing, contamination limits, presentation and inspection standard before a supplier is confirmed."
        crumbs={[{ label: "Scrap metals" }]}
        actions={
          <>
            <ButtonLink href="/request-a-quote" size="lg">
              Request a quote
            </ButtonLink>
            <ButtonLink href="/how-it-works" variant="secondary" size="lg">
              How sourcing runs
            </ButtonLink>
          </>
        }
      />

      <Section tone="light">
        <NotConnected compact className="mb-12">
          Grade information below is reference copy for this preview. Live grades, tonnage and
          pricing will be served from the platform once PostgreSQL is connected.
        </NotConnected>

        <div className="space-y-14">
          <Group title="Ferrous" description="Charge material for mills, foundries and melt shops">
            {ferrous.map((material) => (
              <MaterialCard key={material.slug} material={material} />
            ))}
          </Group>

          <Group title="Non-ferrous" description="Sorted metals with documented composition">
            {nonFerrous.map((material) => (
              <MaterialCard key={material.slug} material={material} />
            ))}
          </Group>

          <Group title="Alloys" description="Higher-value grades handled with traceability">
            {alloys.map((material) => (
              <MaterialCard key={material.slug} material={material} />
            ))}
          </Group>
        </div>
      </Section>

      <Section tone="grey">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <SectionHeading
            eyebrow="Not listed?"
            title="Send the specification instead of a grade name"
            description="If your brief describes chemistry, sizing or contamination rather than a catalogue name, that is a better starting point than matching it to a heading on this page."
          />
          <div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {[
                "Sizing and maximum dimensions",
                "Contamination and coating limits",
                "Presentation: loose, baled or boxed",
                "Inspection standard and records required",
                "Delivery window and destination",
                "Volume and delivery cadence",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-steel-600">
                  <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-green-600" />
                  {item}
                </li>
              ))}
            </ul>
            <ButtonLink href="/request-a-quote" className="mt-8">
              Start a brief
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
