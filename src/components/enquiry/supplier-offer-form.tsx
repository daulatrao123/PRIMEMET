"use client";

import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Advance, EnquiryWizard, Step, WhenKind, type WizardStep } from "./wizard";

/**
 * Supplier material/parts offer wizard for /sell-scrap.
 *
 * Mirrors the buyer wizard's conditional scrap-vs-parts structure from the seller's
 * side: an offer is priced from grading and logistics facts, so those are the fields
 * asked for first. No prices are published here — suppliers quote confidentially.
 *
 * UI-only: no action, no endpoint, no persistence.
 */

const KINDS = [
  { value: "MATERIAL", label: "Scrap metal" },
  { value: "PRODUCT", label: "Spare parts / surplus stock" },
] as const;

const STEPS: readonly WizardStep[] = [
  { id: "A", title: "Business", summary: "Who is offering, and where the material is held." },
  { id: "B", title: "Material", summary: "Grade, presentation and volume — photographs help more than adjectives." },
  { id: "D", title: "Collection", summary: "How the material can be loaded and moved." },
  { id: "E", title: "Terms", summary: "What you expect from the offtake." },
  { id: "F", title: "Documents", summary: "Anything that supports grading or compliance." },
];

export function SupplierOfferWizard({ id }: { id: string }) {
  const p = (name: string) => `sell-${name}`;

  return (
    <EnquiryWizard id={id} steps={STEPS} kinds={KINDS}>
      <Step id="A">
        <Field label="Contact person" htmlFor={p("contact")}>
          <Input id={p("contact")} name="contactPersonName" placeholder="Full name" autoComplete="name" />
        </Field>
        <Field label="Company / business name" htmlFor={p("company")}>
          <Input id={p("company")} name="businessName" placeholder="Registered business name" autoComplete="organization" />
        </Field>
        <Field label="Mobile" htmlFor={p("mobile")} hint="Country code required.">
          <Input id={p("mobile")} name="mobile" placeholder="+91 98765 43210" autoComplete="tel" />
        </Field>
        <Field label="Business email" htmlFor={p("email")}>
          <Input id={p("email")} name="businessEmail" type="email" placeholder="sales@company.com" autoComplete="email" />
        </Field>
        <Field label="Yard / site city" htmlFor={p("city")}>
          <Input id={p("city")} name="siteCity" placeholder="City or port" />
        </Field>
        <Field label="State / region" htmlFor={p("state")}>
          <Input id={p("state")} name="siteState" placeholder="State" />
        </Field>
        <Field label="GSTIN (where applicable)" htmlFor={p("gstin")} hint="Optional now; needed before a purchase invoice.">
          <Input id={p("gstin")} name="gstin" placeholder="27ABCDE1234F1Z5" maxLength={15} />
        </Field>
        <Field label="Materials handled" htmlFor={p("handled")} hint="Optional — helps routing the offer.">
          <Input id={p("handled")} name="materialsHandled" placeholder="e.g. ferrous, copper, stainless" />
        </Field>
      </Step>

      <Step id="B">
        <WhenKind for={["MATERIAL"]}>
          <Field label="Material category" htmlFor={p("category")}>
            <Select id={p("category")} name="materialCategory" defaultValue="">
              <option value="" disabled>
                Select a category
              </option>
              <option>Ferrous — HMS</option>
              <option>Ferrous — shredded</option>
              <option>Ferrous — plate and structural</option>
              <option>Non-ferrous — copper</option>
              <option>Non-ferrous — aluminium</option>
              <option>Non-ferrous — brass</option>
              <option>Stainless / alloys</option>
              <option>Mixed or other</option>
            </Select>
          </Field>
          <Field label="Grade" htmlFor={p("grade")} hint="If unsure, describe what it is and we will grade it.">
            <Input id={p("grade")} name="grade" placeholder="e.g. HMS 1&2, Millberry" />
          </Field>
          <Field label="Scrap form" htmlFor={p("form")}>
            <Select id={p("form")} name="scrapForm" defaultValue="">
              <option value="" disabled>
                Select a form
              </option>
              {["Sheets", "Plates", "Pipes", "Wires", "Cables", "Turnings", "Borings", "Ingots", "Offcuts", "HMS", "Mixed scrap", "Other"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </Select>
          </Field>
          <Field label="Condition" htmlFor={p("condition")}>
            <Select id={p("condition")} name="condition" defaultValue="">
              <option value="" disabled>
                Select a condition
              </option>
              {["Clean", "Mixed", "Contaminated", "Processed", "Unprocessed", "Unknown"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Available quantity" htmlFor={p("qty")}>
            <Input id={p("qty")} name="quantity" placeholder="250" inputMode="decimal" />
          </Field>
          <Field label="Unit" htmlFor={p("unit")}>
            <Select id={p("unit")} name="unit" defaultValue="MT">
              <option value="KG">kg</option>
              <option value="MT">MT</option>
              <option value="TONNE">tonne</option>
            </Select>
          </Field>
          <Field label="Recurring or one-off" htmlFor={p("freq")}>
            <Select id={p("freq")} name="availability" defaultValue="ONE_OFF">
              <option value="ONE_OFF">One-off lot</option>
              <option value="RECURRING">Recurring arisings</option>
            </Select>
          </Field>
          <Field label="Monthly arisings" htmlFor={p("monthly")} hint="Only if the material repeats.">
            <Input id={p("monthly")} name="monthlyQuantity" placeholder="e.g. 120 MT / month" />
          </Field>
        </WhenKind>

        <WhenKind for={["PRODUCT"]}>
          <Field label="Product category" htmlFor={p("pcat")}>
            <Input id={p("pcat")} name="productCategory" placeholder="Pumps, bearings, valves" />
          </Field>
          <Field label="Product name" htmlFor={p("pname")}>
            <Input id={p("pname")} name="productName" placeholder="What the item is" />
          </Field>
          <Field label="Manufacturer / brand" htmlFor={p("brand")}>
            <Input id={p("brand")} name="manufacturer" placeholder="OEM brand" />
          </Field>
          <Field label="Part number / SKU" htmlFor={p("part")}>
            <Input id={p("part")} name="partNumber" placeholder="OEM part number" />
          </Field>
          <Field label="Condition" htmlFor={p("pcond")}>
            <Select id={p("pcond")} name="productCondition" defaultValue="">
              <option value="" disabled>
                Select a condition
              </option>
              <option>New</option>
              <option>Refurbished</option>
              <option>Used</option>
            </Select>
          </Field>
          <Field label="Quantity" htmlFor={p("pqty")}>
            <Input id={p("pqty")} name="quantity" placeholder="4" inputMode="decimal" />
          </Field>
        </WhenKind>

        <Advance title="Photographs and preparation" hint="Uploads are not connected in this preview.">
          <div className="sm:col-span-2 space-y-3">
            <p className="text-xs leading-5 text-steel-600">
              If the material is already separated and photographed, say so here — prepared lots are
              graded faster. The live form will accept up to 10 files at 10 MB each.
            </p>
            <Checkbox id={p("prepared")} name="prepared" label="Material is already segregated by grade." />
            <Checkbox id={p("photos")} name="photos" label="I can supply photographs of the lot." />
          </div>
        </Advance>
      </Step>

      <Step id="D">
        <Field label="Collection location" htmlFor={p("location")}>
          <Input id={p("location")} name="collectionLocation" placeholder="Yard address, city or port" />
        </Field>
        <Field label="PIN code" htmlFor={p("pin")}>
          <Input id={p("pin")} name="collectionPostalCode" placeholder="411001" inputMode="numeric" />
        </Field>
        <Field label="Loading equipment on site" htmlFor={p("equipment")}>
          <Select id={p("equipment")} name="loadingEquipment" defaultValue="">
            <option value="" disabled>
              Select equipment
            </option>
            <option>Crane</option>
            <option>Hydra</option>
            <option>Forklift</option>
            <option>Manual only</option>
          </Select>
        </Field>
        <Field label="Weighbridge available" htmlFor={p("weighbridge")}>
          <Select id={p("weighbridge")} name="weighbridgeAvailable" defaultValue="">
            <option value="">Not specified</option>
            <option>Yes — own weighbridge</option>
            <option>Yes — third-party nearby</option>
            <option>No</option>
          </Select>
        </Field>
        <Field label="Pickup or delivered" htmlFor={p("pickup")}>
          <Select id={p("pickup")} name="pickupPreference" defaultValue="">
            <option value="" disabled>
              Select a preference
            </option>
            <option>Buyer collects</option>
            <option>Can deliver</option>
            <option>Either</option>
          </Select>
        </Field>
        <Field label="Earliest available date" htmlFor={p("date")}>
          <Input id={p("date")} name="earliestDate" type="date" />
        </Field>
        <Field label="Access restrictions" htmlFor={p("restrictions")} className="sm:col-span-2">
          <Input id={p("restrictions")} name="accessRestrictions" placeholder="e.g. gate height limits, permitted hours" />
        </Field>
      </Step>

      <Step id="E">
        <Field label="Expected price" htmlFor={p("price")} hint="Optional — leave blank and the desk will offer against grading.">
          <Input id={p("price")} name="expectedPrice" placeholder="e.g. 42000" inputMode="decimal" />
        </Field>
        <Field label="Price unit" htmlFor={p("priceunit")}>
          <Select id={p("priceunit")} name="priceUnit" defaultValue="">
            <option value="">Not stated</option>
            <option>per kg</option>
            <option>per MT</option>
            <option>per tonne</option>
            <option>per piece</option>
          </Select>
        </Field>
        <Field label="Tax expectation" htmlFor={p("tax")} hint="Your invoice terms; the rate is applied per transaction.">
          <Select id={p("tax")} name="taxPreference" defaultValue="">
            <option value="">Not specified</option>
            <option>Tax extra</option>
            <option>Inclusive of tax</option>
            <option>Exempt / no tax</option>
          </Select>
        </Field>
        <Field label="Preferred payment terms" htmlFor={p("pay")}>
          <Select id={p("pay")} name="paymentPreference" defaultValue="">
            <option value="">Not specified</option>
            <option>On collection</option>
            <option>Advance</option>
            <option>Credit</option>
          </Select>
        </Field>
        <Field label="Offer validity" htmlFor={p("validity")} hint="Days the offer holds.">
          <Input id={p("validity")} name="offerValidity" placeholder="7" inputMode="numeric" />
        </Field>
        <Field label="Remarks" htmlFor={p("remarks")}>
          <Input id={p("remarks")} name="remarks" placeholder="Any condition attached to the offer" />
        </Field>
      </Step>

      <Step id="F">
        <Field label="Lot description" htmlFor={p("desc")} className="sm:col-span-2" hint="How it is stored, what it is mixed with, anything that limits collection.">
          <Textarea id={p("desc")} name="lotDescription" rows={4} placeholder="Describe the lot" />
        </Field>
        <Field label="Licences held" htmlFor={p("licences")} hint="Optional — supports onboarding.">
          <Input id={p("licences")} name="licences" placeholder="e.g. trade licence, pollution consent" />
        </Field>
        <Field label="Preferred communication" htmlFor={p("comm")}>
          <Select id={p("comm")} name="preferredCommunication" defaultValue="">
            <option value="">No preference</option>
            <option>Email</option>
            <option>Phone</option>
            <option>WhatsApp</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            id={p("docs")}
            name="documents"
            label="I can supply test certificates or weighment records with the lot."
          />
        </div>
      </Step>
    </EnquiryWizard>
  );
}