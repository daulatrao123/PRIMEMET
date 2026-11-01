import type { Metadata } from "next";
import { PreviewForm } from "@/components/marketing/form-preview";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { pageMetadata } from "@/lib/seo";


export const metadata: Metadata = pageMetadata({
  title: "Contact",
  description: "Contact the PRIMEMET sourcing desk about scrap supply, spare-parts procurement or supplier registration.",
  path: "/contact",
});

const DESKS = [
  { title: "Scrap sourcing", body: "Bulk ferrous, non-ferrous and alloy enquiries, including specification and inspection standards." },
  { title: "Spare parts", body: "Bearings, pumps, valves, gearboxes, obsolete items and reverse-engineered replacements." },
  { title: "Supplier desk", body: "Registration, categories handled, preparation capability and onboarding documentation." },
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the sourcing desk"
        description="One desk handles buyers, suppliers and parts enquiries, so the same person who takes the brief stays accountable for it."
        crumbs={[{ label: "Contact" }]}
      />

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-navy-950">Direct lines</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-steel-600">
              Published contact details — telephone, office address and a monitored mailbox — are
              added before the site goes live. They are deliberately not invented here.
            </p>

            <div className="mt-6 rounded-card border border-dashed border-steel-300 bg-steel-50 p-5">
              <p className="text-sm font-semibold text-navy-900">Contact details pending publication</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-steel-600">
                <li className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-steel-400" />
                  Telephone and office address: to be confirmed
                </li>
                <li className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-steel-400" />
                  Mailbox: to be confirmed alongside the mail integration
                </li>
                <li className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-steel-400" />
                  Desk hours: weekdays, 08:00 to 18:00 CET
                </li>
              </ul>
            </div>

            <ul className="mt-8 space-y-4">
              {DESKS.map((desk) => (
                <li key={desk.title}>
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-navy-950">{desk.title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-steel-600">{desk.body}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </div>

          <PreviewForm
            id="contact"
            title="Send a message"
            description="Layout preview of the contact form. Nothing is submitted from this page."
            submitLabel="Send message"
          >
            <Field label="Name" htmlFor="contact-name">
              <Input id="contact-name" name="name" placeholder="Full name" autoComplete="name" />
            </Field>
            <Field label="Company" htmlFor="contact-company">
              <Input id="contact-company" name="company" placeholder="Registered business name" autoComplete="organization" />
            </Field>
            <Field label="Work email" htmlFor="contact-email">
              <Input id="contact-email" name="email" type="email" placeholder="name@company.com" autoComplete="email" />
            </Field>
            <Field label="Telephone" htmlFor="contact-phone" hint="Optional">
              <Input id="contact-phone" name="phone" type="tel" placeholder="+00 000 000 000" autoComplete="tel" />
            </Field>
            <Field label="Reason for contact" htmlFor="contact-topic" className="sm:col-span-2">
              <Select id="contact-topic" name="topic" defaultValue="">
                <option value="" disabled>
                  Select a topic
                </option>
                <option>Scrap metal supply</option>
                <option>Spare parts</option>
                <option>Supplier registration</option>
                <option>Existing enquiry</option>
                <option>Something else</option>
              </Select>
            </Field>
            <Field label="Message" htmlFor="contact-message" className="sm:col-span-2">
              <Textarea
                id="contact-message"
                name="message"
                rows={5}
                placeholder="What you need, the volume or part, and how quickly it is required."
              />
            </Field>
          </PreviewForm>
        </div>
      </Section>
    </>
  );
}
