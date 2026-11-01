import type { Metadata } from "next";
import { BuyerEnquiryWizard, FieldStatusLegend } from "@/components/enquiry/enquiry-form";
import { Card } from "@/components/ui/card";
import { NotConnected } from "@/components/ui/not-connected";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { pageMetadata } from "@/lib/seo";


export const metadata: Metadata = pageMetadata({
  title: "Request a quote",
  description: "Send a scrap or spare-parts brief to PRIMEMET. Specification review first, then an indicative sourcing route — no obligation.",
  path: "/request-a-quote",
});

const AFTER = [
  "The specification is confirmed back in writing, with anything ambiguous flagged.",
  "A sourcing route is proposed — authorised supply, documented equivalent, or manufacture.",
  "Commercial terms are quoted against that route, with validity stated.",
  "Nothing is ordered until you approve the route and the terms.",
];

export default function RequestQuotePage() {
  return (
    <>
      <PageHero
        eyebrow="Request a quote"
        title="One brief. One specification review."
        description="Start with a single grade or a single part number. You will get a written specification review and an indicative sourcing route before any commercial commitment."
        crumbs={[{ label: "Request a quote" }]}
      />

      <Section tone="light">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:gap-14">
          <div>
            <NotConnected compact className="mb-6">
              The brief below is a layout preview. When the platform is live, submissions will be
              stored as enquiries with a reference number and routed to the PRIMEMET desk.
            </NotConnected>

            <BuyerEnquiryWizard id="request-quote" idPrefix="rq" />
          </div>

          <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            <Card className="p-6">
              <h2 className="text-sm font-semibold text-navy-950">What happens next</h2>
              <ol className="mt-4 space-y-3">
                {AFTER.map((item, index) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-steel-600">
                    <span className="font-mono text-[0.7rem] text-steel-500">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {item}
                  </li>
                ))}
              </ol>
            </Card>

            <Card className="p-6">
              <h2 className="text-sm font-semibold text-navy-950">Required vs optional</h2>
              <p className="mt-2 text-xs leading-5 text-steel-600">
                Only the essentials are required to open an enquiry. Everything else can be
                supplied later, and technical facts you do not know are recorded as unknown rather
                than guessed.
              </p>
              <div className="mt-3">
                <FieldStatusLegend />
              </div>
            </Card>

            <Card className="border-steel-200 bg-steel-50 p-6">
              <h2 className="text-sm font-semibold text-navy-950">What helps most</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-steel-600">
                {[
                  "A nameplate or marking photograph for parts",
                  "Sizing and contamination limits for scrap",
                  "The inspection standard you must meet",
                  "Whether a documented equivalent is acceptable",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="border-navy-800 bg-navy-950 p-6 text-white">
              <h2 className="text-sm font-semibold">Your figures stay private</h2>
              <p className="mt-2 text-xs leading-5 text-navy-300">
                A target price you enter is visible only to the PRIMEMET desk. It is never shown to
                suppliers, and supplier costs are never shown to you.
              </p>
            </Card>
          </aside>
        </div>
      </Section>
    </>
  );
}