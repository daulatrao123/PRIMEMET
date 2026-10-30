import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { Field, Input, Select } from "@/components/ui/input";
import { NotConnected } from "@/components/ui/not-connected";

export const metadata: Metadata = { title: "Tax & GST details" };

/**
 * Tax registration interface.
 *
 * Displayed fields are masked placeholders — no real tax identifier is requested here and
 * nothing is stored, transmitted or verified. Actual identifiers are collected through the
 * onboarding process, not through a preview form.
 *
 * TODO (Stage 2): store registrations against the supplier profile, validate the format per
 * jurisdiction and gate quotation submission on a verified registration.
 */
export default function SellerTaxPage() {
  return (
    <PortalPage
      eyebrow="Account"
      title="Tax and GST details"
      description="Registration details used on quotations, invoices and export documentation."
      actions={<PreviewAction>Save details</PreviewAction>}
    >
      <NotConnected>
        Tax registrations are stored with the supplier profile in PostgreSQL. Nothing is captured or
        verified in this build, and no reference number is pre-filled.
      </NotConnected>

      <Panel title="Primary registration" description="The jurisdiction you invoice from.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Tax scheme" htmlFor="st-scheme">
            <Select id="st-scheme" name="scheme" defaultValue="">
              <option value="" disabled>
                Select a scheme
              </option>
              <option>GST (India)</option>
              <option>VAT (EU / UK)</option>
              <option>Sales tax</option>
              <option>Other</option>
            </Select>
          </Field>
          <Field label="Jurisdiction" htmlFor="st-jurisdiction" hint="State or country that issued the registration">
            <Input id="st-jurisdiction" name="jurisdiction" placeholder="e.g. Maharashtra, IN" />
          </Field>
          <Field label="Registration number" htmlFor="st-number" hint="Full value is entered during onboarding, not in this preview">
            <Input id="st-number" name="registrationNumber" placeholder="Registration reference" />
          </Field>
          <Field label="Registered legal name" htmlFor="st-legal-name">
            <Input id="st-legal-name" name="legalName" placeholder="Exactly as registered" />
          </Field>
          <Field label="Registered address" htmlFor="st-address" className="sm:col-span-2">
            <Input id="st-address" name="address" placeholder="Address as it appears on the registration" />
          </Field>
        </div>
      </Panel>

      <Panel title="Additional registrations" description="Other states or countries you are registered in.">
        <div className="rounded-md border border-dashed border-steel-300 bg-steel-50 px-4 py-6 text-center text-sm text-steel-600">
          No additional registrations. Additional entries are added once records can be stored.
        </div>
      </Panel>

      <Panel title="How these details are used" description="Nothing here is published.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            "Carried on quotations and invoices issued to buyers",
            "Used to determine the applicable tax treatment on a consignment",
            "Kept on the internal side of the platform",
            "Never displayed on public pages",
          ].map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm leading-6 text-navy-900"
            >
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-steel-400" />
              {item}
            </li>
          ))}
        </ul>
      </Panel>
    </PortalPage>
  );
}
