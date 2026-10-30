import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { Field, Input, Select } from "@/components/ui/input";
import { NotConnected } from "@/components/ui/not-connected";

export const metadata: Metadata = { title: "Buyer profile" };

/**
 * Buyer profile preview.
 * Fields render empty; nothing is loaded from or saved to a database.
 */
export default function BuyerProfilePage() {
  return (
    <PortalPage
      eyebrow="Account"
      title="Profile"
      description="Organisation details, delivery sites and the contact who receives sourcing correspondence."
      actions={<PreviewAction>Save changes</PreviewAction>}
    >
      <NotConnected>
        Profile data will be read from and written to PostgreSQL. The fields below are empty because
        no account exists — they are not pre-filled with sample values.
      </NotConnected>

      <Panel title="Organisation" description="Used on quotations and delivery documentation.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Registered name" htmlFor="bp-company">
            <Input id="bp-company" name="company" placeholder="Registered business name" />
          </Field>
          <Field label="Trading name" htmlFor="bp-trading" hint="Optional">
            <Input id="bp-trading" name="tradingName" placeholder="If different from the registered name" />
          </Field>
          <Field label="Country" htmlFor="bp-country">
            <Input id="bp-country" name="country" placeholder="Country of operation" />
          </Field>
          <Field label="Tax registration" htmlFor="bp-tax" hint="Confirmed during account activation">
            <Input id="bp-tax" name="taxReference" placeholder="VAT / GSTIN reference" />
          </Field>
          <Field label="Industry" htmlFor="bp-industry">
            <Select id="bp-industry" name="industry" defaultValue="">
              <option value="" disabled>
                Select your sector
              </option>
              <option>Steel and rolling</option>
              <option>Foundry and casting</option>
              <option>Fabrication and machining</option>
              <option>Cement and aggregates</option>
              <option>Power and utilities</option>
              <option>Recycling and waste</option>
            </Select>
          </Field>
          <Field label="Primary procurement contact" htmlFor="bp-contact">
            <Input id="bp-contact" name="contact" placeholder="Name" />
          </Field>
        </div>
      </Panel>

      <Panel title="Delivery sites" description="Where consignments are received, with any access restrictions.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Site name" htmlFor="bp-site">
            <Input id="bp-site" name="siteName" placeholder="e.g. main plant" />
          </Field>
          <Field label="City / region" htmlFor="bp-site-location">
            <Input id="bp-site-location" name="siteLocation" placeholder="Delivery location" />
          </Field>
          <Field label="Receiving hours" htmlFor="bp-site-hours" hint="Including any restrictions on delivery size">
            <Input id="bp-site-hours" name="siteHours" placeholder="e.g. weekdays 07:00–15:00" />
          </Field>
          <Field label="Site contact" htmlFor="bp-site-contact">
            <Input id="bp-site-contact" name="siteContact" placeholder="Name and telephone" />
          </Field>
        </div>
        <p className="mt-4 text-xs leading-5 text-steel-500">
          Additional sites will be added from this panel once records can be stored.
        </p>
      </Panel>
    </PortalPage>
  );
}
