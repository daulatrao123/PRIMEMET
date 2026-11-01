import type { Metadata } from "next";
import { BuyerEnquiryWizard } from "@/components/enquiry/enquiry-form";
import { Card } from "@/components/ui/card";
import { NotConnected } from "@/components/ui/not-connected";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";
import { pageMetadata } from "@/lib/seo";


export const metadata: Metadata = pageMetadata({
  title: "Source scrap",
  description: "Source ferrous, non-ferrous and alloy scrap through PRIMEMET managed programmes: written specification, qualified suppliers, inspection before dispatch and reconciled delivery.",
  path: "/source-scrap",
});

const INCLUDED = [
  { title: "Written specification", body: "Sizing, contamination limits, presentation and inspection standard confirmed back to you before sourcing starts." },
  { title: "Qualified suppliers", body: "Only yards and stockists screened on licences, capacity and past batches enter the shortlist." },
  { title: "Inspection before dispatch", body: "Screening, visual grading and a photographic record attached to the consignment." },
  { title: "One reconciled record", body: "Weighbridge figures from both ends and a non-conformance log against the original brief." },
];

export default function SourceScrapPage() {
  return (
    <>
      <PageHero
        eyebrow="Source scrap"
        title="Source scrap against the specification your furnace needs"
        description="Most sourcing problems are specification problems. Set the grade, sizing and contamination limits in writing, and the delivered lot has something concrete to be measured against."
        crumbs={[{ label: "Source scrap" }]}
      />

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="What a programme includes"
              title="Everything between the brief and the weighbridge"
            />
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {INCLUDED.map((item) => (
                <li key={item.title}>
                  <Card className="h-full p-5">
                    <h3 className="text-sm font-semibold text-navy-950">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-steel-600">{item.body}</p>
                  </Card>
                </li>
              ))}
            </ul>

            <Card className="mt-8 border-navy-800 bg-navy-950 p-6 text-white">
              <h3 className="text-sm font-semibold">Not sure what to specify?</h3>
              <p className="mt-2 text-sm leading-6 text-navy-300">
                Describe the furnace, charger or furnace campaign and the desk will propose a grade
                framing and the inspection points that matter for it.
              </p>
            </Card>
          </div>

          <div>
            <NotConnected compact className="mb-5">
              This sourcing wizard is a layout preview. Nothing is submitted, stored or emailed from
              this page.
            </NotConnected>

            <BuyerEnquiryWizard id="source-scrap" idPrefix="ss" />
          </div>
        </div>
      </Section>
    </>
  );
}
