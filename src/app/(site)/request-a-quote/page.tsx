import type { Metadata } from "next";
import { PreviewForm } from "@/components/marketing/form-preview";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { NotConnected } from "@/components/ui/not-connected";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Request a quote",
  description:
    "Send a scrap or spare-parts brief to PRIMEMET. Specification review first, then an indicative sourcing route — no obligation.",
};

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
            <NotConnected compact className="mb-8">
              This form is a layout preview. When the platform is live, submissions will be stored
              as enquiries with a reference number and routed to the PRIMEMET desk.
            </NotConnected>

            <PreviewForm
              id="request-quote"
              title="Sourcing brief"
              description="Tell us what you need and how it has to arrive."
              submitLabel="Submit brief"
              footnote="Nothing on this page is transmitted. Use the contact route for a live conversation today."
            >
              <Field label="Enquiry type" htmlFor="quote-type" className="sm:col-span-2">
                <Select id="quote-type" name="type" defaultValue="">
                  <option value="" disabled>
                    Select what you are sourcing
                  </option>
                  <option>Scrap metal — ferrous</option>
                  <option>Scrap metal — non-ferrous</option>
                  <option>Stainless / alloys</option>
                  <option>Industrial spare parts</option>
                  <option>Obsolete or reverse-engineered component</option>
                  <option>Something else</option>
                </Select>
              </Field>

              <Field label="Company" htmlFor="quote-company">
                <Input id="quote-company" name="company" placeholder="Registered business name" autoComplete="organization" />
              </Field>
              <Field label="Contact name" htmlFor="quote-name">
                <Input id="quote-name" name="name" placeholder="Full name" autoComplete="name" />
              </Field>
              <Field label="Work email" htmlFor="quote-email">
                <Input id="quote-email" name="email" type="email" placeholder="name@company.com" autoComplete="email" />
              </Field>
              <Field label="Country" htmlFor="quote-country">
                <Input id="quote-country" name="country" placeholder="Where the material is delivered" autoComplete="country-name" />
              </Field>
              <Field label="Grade or part reference" htmlFor="quote-reference">
                <Input id="quote-reference" name="reference" placeholder="e.g. HMS 1&2, or OEM part number" />
              </Field>
              <Field label="Volume or quantity" htmlFor="quote-quantity">
                <Input id="quote-quantity" name="quantity" placeholder="e.g. 800 t / quarter, or 2 off" />
              </Field>
              <Field label="Delivery window" htmlFor="quote-window">
                <Input id="quote-window" name="window" placeholder="Required by, or recurring cadence" />
              </Field>
              <Field label="Destination" htmlFor="quote-destination">
                <Input id="quote-destination" name="destination" placeholder="Site, city or port" />
              </Field>
              <Field label="Specification and standards" htmlFor="quote-spec" className="sm:col-span-2">
                <Textarea
                  id="quote-spec"
                  name="spec"
                  placeholder="Sizing, contamination limits, inspection standard, certification or drawing requirements."
                />
              </Field>
            </PreviewForm>
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
          </aside>
        </div>
      </Section>
    </>
  );
}
