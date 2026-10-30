import type { Metadata } from "next";
import { PreviewForm } from "@/components/marketing/form-preview";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Become a supplier",
  description:
    "Register a yard, stockist or specialist workshop as a PRIMEMET supplier. Categories handled, operating location and applicable licences are reviewed against live briefs.",
};

const ASKED = [
  "The categories you actually handle, not the full list of metals that exist.",
  "Where you operate, and whether you can prepare material to a buyer's sizing.",
  "The licences and permits that apply to your activity, and their validity.",
  "A reference or two from industrial buyers, where you have them.",
];

const CRITERIA = [
  { title: "Preparation capability", body: "You can cut, sort, bale or screen material to a specification rather than shipping what happens to be in the yard." },
  { title: "Traceable paperwork", body: "Weighbridge tickets and basic documentation are routine for you, not an exception you produce on request." },
  { title: "Honest capacity", body: "You will say when you cannot take a job. A declined brief costs far less than a failed consignment." },
  { title: "Industrial focus", body: "You are set up for B2B supply and industrial volumes rather than consumer drop-off." },
];

export default function BecomeSupplierPage() {
  return (
    <>
      <PageHero
        eyebrow="Suppliers"
        title="Supply PRIMEMET with material or parts you actually handle"
        description="We qualify suppliers on capability and preparation standard, not on the size of a claimed network. If you can meet a written specification and document what you ship, the desk wants to know."
        crumbs={[{ label: "Become a supplier" }]}
      />

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <div>
            <SectionHeading eyebrow="What we look for" title="Four things decide a supplier review" />
            <ul className="mt-8 space-y-4">
              {CRITERIA.map((item, index) => (
                <li key={item.title} className="flex gap-4">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm bg-green-600 font-mono text-[0.65rem] text-white">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-navy-950">{item.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-steel-600">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <Card className="mt-8 border-navy-800 bg-navy-950 p-6 text-white">
              <h3 className="text-sm font-semibold">What we will ask you for</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-navy-300">
                {ASKED.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <PreviewForm
            id="supplier-register"
            title="Supplier registration"
            description="Layout preview of the supplier form. Nothing is submitted from this page."
            submitLabel="Submit registration"
          >
            <Field label="Company" htmlFor="sup-company">
              <Input id="sup-company" name="company" placeholder="Registered business name" autoComplete="organization" />
            </Field>
            <Field label="Contact name" htmlFor="sup-name">
              <Input id="sup-name" name="name" placeholder="Full name" autoComplete="name" />
            </Field>
            <Field label="Work email" htmlFor="sup-email">
              <Input id="sup-email" name="email" type="email" placeholder="name@company.com" autoComplete="email" />
            </Field>
            <Field label="Country" htmlFor="sup-country">
              <Input id="sup-country" name="country" placeholder="Country of operation" autoComplete="country-name" />
            </Field>
            <Field label="Categories handled" htmlFor="sup-categories" className="sm:col-span-2">
              <Select id="sup-categories" name="categories" defaultValue="" multiple size={5}>
                <option>Ferrous — HMS and shredded</option>
                <option>Ferrous — plate and structural</option>
                <option>Non-ferrous — copper</option>
                <option>Non-ferrous — aluminium</option>
                <option>Non-ferrous — brass</option>
                <option>Stainless and alloys</option>
                <option>Industrial spare parts</option>
                <option>Machining and fabrication</option>
              </Select>
            </Field>
            <Field label="Preparation capability" htmlFor="sup-prep" className="sm:col-span-2">
              <Textarea
                id="sup-prep"
                name="prep"
                placeholder="Cutting, sorting, baling or screening you can carry out, and any testing you can arrange."
              />
            </Field>
            <Field label="Licences and permits" htmlFor="sup-licences" className="sm:col-span-2" hint="Reference numbers only — certificates are requested during onboarding">
              <Input id="sup-licences" name="licences" placeholder="e.g. waste carrier licence, export registration" />
            </Field>
          </PreviewForm>
        </div>
      </Section>
    </>
  );
}
