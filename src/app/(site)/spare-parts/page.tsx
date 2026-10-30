import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NotConnected } from "@/components/ui/not-connected";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";
import { PARTS, type Part } from "@/lib/content/parts";

export const metadata: Metadata = {
  title: "Industrial spare parts",
  description:
    "Bearings, pumps, valves, gearboxes and obsolete OEM components sourced by designation, dimension or drawing — including reverse-engineered replacement.",
};

function PartCard({ part }: { part: Part }) {
  return (
    <Card className="group relative flex flex-col p-6 transition-colors hover:border-navy-300">
      <h3 className="text-base font-semibold text-navy-950">
        <a href={`/spare-parts/${part.slug}`} className="after:absolute after:inset-0">
          {part.name}
        </a>
      </h3>
      <p className="mt-3 flex-1 text-sm leading-6 text-steel-600">{part.summary}</p>
      <ul className="mt-5 space-y-2 border-t border-steel-200 pt-4">
        {part.typicalItems.slice(0, 3).map((item) => (
          <li key={item} className="flex items-start gap-2 text-xs leading-5 text-steel-500">
            <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-green-600" />
            {item}
          </li>
        ))}
      </ul>
      <span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-green-700">
        Category detail
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 transition-transform group-hover:translate-x-0.5" fill="none">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Card>
  );
}

const ROUTES = [
  {
    title: "OEM / authorised",
    body: "Current-production parts routed through authorised channels so traceability and warranty stay intact.",
  },
  {
    title: "Documented equivalent",
    body: "Where the original is discontinued or uneconomic, an alternative is proposed with its differences in writing.",
  },
  {
    title: "Manufacture to drawing",
    body: "Legacy items re-made from a drawing or a measured sample, with critical dimensions agreed before production.",
  },
];

export default function SparePartsPage() {
  return (
    <>
      <PageHero
        eyebrow="Spare parts"
        title="Spare-parts procurement that reads the drawing, not just the part number"
        description="Obsolescence, long lead times and single-source risk handled by a desk that establishes what the part must do before it proposes what to buy."
        crumbs={[{ label: "Industrial spare parts" }]}
        actions={
          <>
            <ButtonLink href="/request-a-quote" size="lg">
              Request a part
            </ButtonLink>
            <ButtonLink href="/how-it-works" variant="secondary" size="lg">
              How sourcing runs
            </ButtonLink>
          </>
        }
      />

      <Section tone="light">
        <NotConnected compact className="mb-12">
          Category pages below are reference copy. Part records, stock position and pricing will be
          served from the platform once PostgreSQL is connected.
        </NotConnected>

        <div className="grid gap-5 sm:grid-cols-2">
          {PARTS.map((part) => (
            <PartCard key={part.slug} part={part} />
          ))}
        </div>
      </Section>

      <Section tone="grey">
        <SectionHeading
          eyebrow="Sourcing routes"
          title="Three routes, chosen on evidence"
          description="The route is decided by what is known about the part, not by what is quickest to order. Each proposal states its differences before you commit."
        />
        <ol className="mt-12 grid gap-px overflow-hidden rounded-card bg-steel-200 sm:grid-cols-3">
          {ROUTES.map((route, index) => (
            <li key={route.title} className="bg-white p-7">
              <span className="font-mono text-xs tracking-widest text-steel-500">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-base font-semibold text-navy-950">{route.title}</h3>
              <p className="mt-2 text-sm leading-6 text-steel-600">{route.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 rounded-card border border-steel-200 bg-white p-7">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-steel-500">
            What helps most on the first message
          </h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              "Nameplate or marking photo",
              "Drawing or manual page",
              "Machine and duty description",
              "Quantity and required window",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-steel-600">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-green-600" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </>
  );
}
