import type { Metadata } from "next";
import { PreviewForm } from "@/components/marketing/form-preview";
import { PortalPage } from "@/components/portal/blocks";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { NotConnected } from "@/components/ui/not-connected";

export const metadata: Metadata = { title: "Submit enquiry" };

/**
 * Buyer enquiry form preview.
 *
 * TODO (Stage 2): replace with a server action that validates input, writes an Enquiry
 * row scoped to the signed-in buyer, assigns a reference and notifies the desk.
 */
export default function BuyerEnquiryPage() {
  return (
    <PortalPage
      eyebrow="Sourcing"
      title="Submit an enquiry"
      description="One brief per requirement. The desk confirms the specification back to you before any supplier is contacted."
    >
      <NotConnected>
        Enquiry submission is not connected. The form below is a layout preview: it does not send,
        store or email anything.
      </NotConnected>

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <PreviewForm
          id="buyer-enquiry"
          title="Requirement"
          description="Give the desk enough to specify and source against."
          submitLabel="Submit to desk"
          footnote="Nothing on this page is transmitted. Use the public enquiry desk for a live conversation today."
        >
          <Field label="Requirement type" htmlFor="bq-type" className="sm:col-span-2">
            <Select id="bq-type" name="type" defaultValue="">
              <option value="" disabled>
                Select what you need
              </option>
              <option>Scrap metal — ferrous</option>
              <option>Scrap metal — non-ferrous</option>
              <option>Stainless / alloys</option>
              <option>Industrial spare parts</option>
              <option>Obsolete or reverse-engineered component</option>
            </Select>
          </Field>

          <Field label="Grade or part reference" htmlFor="bq-reference">
            <Input id="bq-reference" name="reference" placeholder="e.g. HMS 1&2, or OEM part number" />
          </Field>
          <Field label="Volume or quantity" htmlFor="bq-quantity">
            <Input id="bq-quantity" name="quantity" placeholder="e.g. 800 t / quarter, or 2 off" />
          </Field>
          <Field label="Delivery destination" htmlFor="bq-destination">
            <Input id="bq-destination" name="destination" placeholder="Site, city or port" />
          </Field>
          <Field label="Required window" htmlFor="bq-window">
            <Input id="bq-window" name="window" placeholder="Required by, or recurring cadence" />
          </Field>
          <Field label="Site contact" htmlFor="bq-contact" className="sm:col-span-2" hint="Who receives the load on site">
            <Input id="bq-contact" name="siteContact" placeholder="Name and telephone for delivery coordination" />
          </Field>
          <Field label="Specification" htmlFor="bq-spec" className="sm:col-span-2">
            <Textarea
              id="bq-spec"
              name="spec"
              rows={5}
              placeholder="Sizing, contamination limits, presentation, inspection standard, certification or drawing requirements."
            />
          </Field>
        </PreviewForm>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-navy-950">Before submitting</h2>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-steel-600">
              {[
                "Specify size and contamination limits, not just a grade name.",
                "State the inspection standard you must meet.",
                "Say whether a documented equivalent is acceptable for parts.",
                "Give the real delivery window, including site restrictions.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-1.5 size-1 rounded-full bg-green-600" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="border-steel-200 bg-steel-50 p-5">
            <h2 className="text-sm font-semibold text-navy-950">What happens next</h2>
            <p className="mt-2 text-xs leading-5 text-steel-600">
              The desk reviews the brief, confirms the specification in writing and returns a
              quotation against a chosen sourcing route. Nothing is ordered without your approval.
            </p>
          </Card>
        </aside>
      </div>
    </PortalPage>
  );
}
