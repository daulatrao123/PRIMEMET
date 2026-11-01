import type { Metadata } from "next";
import { SupplierOfferWizard } from "@/components/enquiry/supplier-offer-form";
import { Card } from "@/components/ui/card";
import { NotConnected } from "@/components/ui/not-connected";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";
import { pageMetadata } from "@/lib/seo";


export const metadata: Metadata = pageMetadata({
  title: "Sell scrap",
  description: "Offer ferrous, non-ferrous or alloy scrap to PRIMEMET with a defined grade, volume and location. Grading discipline and documented offtake for yards and plants.",
  path: "/sell-scrap",
});

const STEPS = [
  { title: "Describe the material", body: "Grade, presentation, volume and where it is held. A photograph helps more than a description." },
  { title: "Grading review", body: "We confirm how the material will be graded and what would need separating before it can move." },
  { title: "Offer and offtake", body: "A route is proposed — one-off collection or a recurring offtake — with the terms stated in writing." },
  { title: "Collection and record", body: "Weighbridge figures and photographs are recorded per consignment, so both sides hold the same numbers." },
];

export default function SellScrapPage() {
  return (
    <>
      <PageHero
        eyebrow="Sell scrap"
        title="Sell scrap on grading, not on guesswork"
        description="If your yard or plant accumulates metal without a consistent offtake route, the value usually leaks at the grading stage. Tell us what you hold and we will tell you how it needs to be prepared."
        crumbs={[{ label: "Sell scrap" }]}
        actions={null}
      />

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="How selling runs"
              title="Four steps from pile to consignment"
              description="No obligation until the terms of an offtake are agreed in writing."
            />

            <ol className="mt-8 space-y-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm bg-navy-950 font-mono text-[0.65rem] text-white">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-navy-950">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-steel-600">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <Card className="mt-8 border-steel-200 bg-steel-50 p-5">
              <h3 className="text-sm font-semibold text-navy-950">What we buy</h3>
              <p className="mt-2 text-sm leading-6 text-steel-600">
                Ferrous grades (HMS, shredded, plate and structural), non-ferrous (copper, aluminium,
                brass) and austenitic stainless. Industrial spare parts and surplus stock are handled
                as a separate route.
              </p>
            </Card>
          </div>

          <div>
            <NotConnected compact className="mb-5">
              The offer form below is a layout preview. Nothing is submitted, stored or emailed from
              this page.
            </NotConnected>

            <SupplierOfferWizard id="sell-scrap" />
          </div>
        </div>
      </Section>
    </>
  );
}
