import type { Metadata } from "next";
import { PreviewForm } from "@/components/marketing/form-preview";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHero } from "@/components/ui/page-hero";
import { Section, SectionHeading } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Source scrap",
  description:
    "Source ferrous, non-ferrous and alloy scrap through PRIMEMET managed programmes: written specification, qualified suppliers, inspection before dispatch and reconciled delivery.",
};

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

          <PreviewForm
            id="source-scrap"
            title="Send a sourcing brief"
            description="Layout preview of the buyer brief form. Nothing is submitted from this page."
            submitLabel="Submit brief"
          >
            <Field label="Company" htmlFor="source-company">
              <Input id="source-company" name="company" placeholder="Registered business name" autoComplete="organization" />
            </Field>
            <Field label="Contact name" htmlFor="source-name">
              <Input id="source-name" name="name" placeholder="Full name" autoComplete="name" />
            </Field>
            <Field label="Work email" htmlFor="source-email">
              <Input id="source-email" name="email" type="email" placeholder="name@company.com" autoComplete="email" />
            </Field>
            <Field label="Delivery destination" htmlFor="source-destination">
              <Input id="source-destination" name="destination" placeholder="Site or port of delivery" />
            </Field>
            <Field label="Grade required" htmlFor="source-grade">
              <Select id="source-grade" name="grade" defaultValue="">
                <option value="" disabled>
                  Select a grade
                </option>
                <option>HMS 1&2</option>
                <option>Shredded</option>
                <option>Plate and structural</option>
                <option>Copper millberry</option>
                <option>Aluminium taint/tabor</option>
                <option>Brass solids</option>
                <option>Stainless 304 / 316</option>
                <option>Not listed — describe below</option>
              </Select>
            </Field>
            <Field label="Volume and cadence" htmlFor="source-volume">
              <Input id="source-volume" name="volume" placeholder="e.g. 1,200 t / quarter" />
            </Field>
            <Field label="Specification notes" htmlFor="source-spec" className="sm:col-span-2">
              <Textarea
                id="source-spec"
                name="spec"
                placeholder="Sizing, contamination limits, presentation, and the inspection standard or documentation you require."
              />
            </Field>
            <Field label="Required delivery window" htmlFor="source-window" className="sm:col-span-2">
              <Input id="source-window" name="window" placeholder="e.g. first load within Q1, monthly thereafter" />
            </Field>
          </PreviewForm>
        </div>
      </Section>
    </>
  );
}
