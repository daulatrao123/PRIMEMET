import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { NotConnected } from "@/components/ui/not-connected";

export const metadata: Metadata = { title: "Business profile" };

/**
 * Supplier business profile preview.
 * Fields are empty on purpose: no account is loaded and nothing is saved.
 */
export default function SellerProfilePage() {
  return (
    <PortalPage
      eyebrow="Account"
      title="Business profile"
      description="Legal identity, operating location and what your business can actually prepare or manufacture."
      actions={<PreviewAction>Save profile</PreviewAction>}
    >
      <NotConnected>
        Supplier profile records will be read from and written to PostgreSQL, and reviewed by the
        desk before qualification. Nothing on this page is stored.
      </NotConnected>

      <Panel title="Legal entity" description="Must match the documentation provided at qualification.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Registered name" htmlFor="sp-company">
            <Input id="sp-company" name="company" placeholder="Registered business name" />
          </Field>
          <Field label="Trading name" htmlFor="sp-trading" hint="Optional">
            <Input id="sp-trading" name="tradingName" placeholder="If different from the registered name" />
          </Field>
          <Field label="Registration number" htmlFor="sp-registration">
            <Input id="sp-registration" name="registrationNumber" placeholder="Company registration number" />
          </Field>
          <Field label="Country of operation" htmlFor="sp-country">
            <Input id="sp-country" name="country" placeholder="Country" />
          </Field>
          <Field label="Operating location" htmlFor="sp-location" hint="Yard, works or workshop address used for collection">
            <Input id="sp-location" name="location" placeholder="City / region" />
          </Field>
          <Field label="Year established" htmlFor="sp-established" hint="Optional">
            <Input id="sp-established" name="established" placeholder="e.g. 1998" inputMode="numeric" />
          </Field>
        </div>
      </Panel>

      <Panel title="Capability" description="What the desk needs to know before matching a brief.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Categories supplied" htmlFor="sp-categories">
            <Select id="sp-categories" name="categories" defaultValue="" multiple size={6}>
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
          <Field label="Preparation capability" htmlFor="sp-prep" hint="Cutting, sorting, baling, screening, testing">
            <Textarea
              id="sp-prep"
              name="prep"
              rows={6}
              placeholder="Describe the equipment and processes you can apply to meet a buyer's specification."
            />
          </Field>
          <Field label="Monthly capacity" htmlFor="sp-capacity" className="sm:col-span-2" hint="Only what you would actually commit to">
            <Input id="sp-capacity" name="capacity" placeholder="e.g. tonnes per month, or units per month" />
          </Field>
        </div>
      </Panel>

      <Panel title="Licences and permits" description="Reference numbers now; certificates requested during onboarding.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Waste carrier / permit reference" htmlFor="sp-permit">
            <Input id="sp-permit" name="permit" placeholder="Reference number" />
          </Field>
          <Field label="Export registration" htmlFor="sp-export" hint="If applicable">
            <Input id="sp-export" name="export" placeholder="Reference number" />
          </Field>
        </div>
      </Panel>
    </PortalPage>
  );
}
