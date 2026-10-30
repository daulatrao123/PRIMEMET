"use client";

import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Advance, EnquiryWizard, Step, StatusNote, WhenKind, type WizardStep } from "./wizard";

/**
 * The buyer enquiry wizard: requirements A–F from the quotation-ready lead spec.
 *
 * Field statuses come from src/lib/content/enquiry-fields.ts; this file is only the
 * presentation of those fields. Conditional groups (scrap vs spare parts) disappear
 * when they do not apply, and technical facts the buyer may not know offer an explicit
 * "Unknown / not specified" option instead of forcing a guess.
 *
 * UI-only: no action, no endpoint, no persistence. See the TODO in ./wizard.
 */

const KINDS = [
  { value: "MATERIAL", label: "Scrap metal" },
  { value: "PRODUCT", label: "Spare parts" },
  { value: "MIXED", label: "Both / mixed" },
] as const;

const STEPS: readonly WizardStep[] = [
  { id: "A", title: "Business", summary: "Who is asking, and where the material must arrive." },
  { id: "B", title: "Requirement", summary: "What you need, in enough detail to source and price it." },
  { id: "D", title: "Delivery", summary: "How it must arrive, and what the site can accept." },
  { id: "E", title: "Commercial", summary: "Your commercial expectations. Target price stays private to the desk." },
  { id: "F", title: "Documents", summary: "Anything that saves a round of questions." },
];

/** "Unknown / not specified" is a real answer for technical facts — never a rejection. */
function UnknownOption() {
  return <option value="unknown">Unknown / not specified</option>;
}

export function BuyerEnquiryWizard({
  id,
  idPrefix = "enq",
  title,
}: {
  id: string;
  idPrefix?: string;
  title?: string;
}) {
  const p = (name: string) => `${idPrefix}-${name}`;

  return (
    <EnquiryWizard id={id} steps={STEPS} kinds={KINDS}>
      {title ? <input type="hidden" name="wizardTitle" value={title} /> : null}

      {/* ── A. Buyer and business details ─────────────────────────────────── */}
      <Step id="A">
        <Field label="Contact person" htmlFor={p("contact")} hint="Who the desk speaks to about this requirement.">
          <Input id={p("contact")} name="contactPersonName" placeholder="Full name" autoComplete="name" />
        </Field>
        <Field label="Company / business name" htmlFor={p("company")}>
          <Input id={p("company")} name="businessName" placeholder="Registered business name" autoComplete="organization" />
        </Field>
        <Field label="Mobile" htmlFor={p("mobile")} hint="Country code required — e.g. +91 98765 43210.">
          <Input id={p("mobile")} name="mobile" placeholder="+91 98765 43210" autoComplete="tel" inputMode="tel" />
        </Field>
        <Field label="Business email" htmlFor={p("email")} hint="Purchase or desk address, not a personal one if possible.">
          <Input id={p("email")} name="businessEmail" type="email" placeholder="purchase@company.com" autoComplete="email" />
        </Field>
        <Field label="Business type" htmlFor={p("btype")}>
          <Select id={p("btype")} name="businessType" defaultValue="">
            <option value="" disabled>
              Select a business type
            </option>
            <option>Trader</option>
            <option>Manufacturer</option>
            <option>Fabricator</option>
            <option>Foundry / smelter</option>
            <option>EPC / contractor</option>
            <option>Recycler</option>
            <option>Other</option>
          </Select>
        </Field>
        <Field label="GSTIN (where applicable)" htmlFor={p("gstin")} hint="Optional to open the enquiry; required before a tax invoice.">
          <Input id={p("gstin")} name="gstin" placeholder="27ABCDE1234F1Z5" maxLength={15} />
        </Field>
        <Field label="Company website" htmlFor={p("website")} hint="Optional.">
          <Input id={p("website")} name="website" placeholder="https://company.com" />
        </Field>
        <Field label="Delivery city" htmlFor={p("city")}>
          <Input id={p("city")} name="deliveryCity" placeholder="Pune" />
        </Field>
        <Field label="Delivery state / region" htmlFor={p("state")} hint="Also a tax jurisdiction input — the rate itself is set per quotation.">
          <Input id={p("state")} name="deliveryState" placeholder="Maharashtra" />
        </Field>
        <Field label="Delivery PIN code" htmlFor={p("pin")}>
          <Input id={p("pin")} name="deliveryPostalCode" placeholder="411001" inputMode="numeric" />
        </Field>

        <Advance title="Billing address & tax details" hint="Collected later — needed for the invoice, not to open the enquiry.">
          <Field label="Billing address" htmlFor={p("billing")} className="sm:col-span-2">
            <Textarea id={p("billing")} name="billingAddress" rows={3} placeholder="Registered billing address" />
          </Field>
        </Advance>
      </Step>

      {/* ── B. Scrap material requirement (conditional) ────────────────────── */}
      <Step id="B">
        <WhenKind for={["MATERIAL", "MIXED"]}>
          <Field label="Material category" htmlFor={p("category")}>
            <Select id={p("category")} name="materialCategory" defaultValue="">
              <option value="" disabled>
                Select a category
              </option>
              <option>Ferrous</option>
              <option>Non-ferrous</option>
              <option>Stainless / alloy steel</option>
              <option>Mixed scrap</option>
              <UnknownOption />
            </Select>
          </Field>
          <Field label="Metal / material type" htmlFor={p("metal")} hint="For example copper, aluminium, mild steel.">
            <Input id={p("metal")} name="metalType" placeholder="Copper" />
          </Field>
          <Field label="Grade" htmlFor={p("grade")} hint="Unsure is fine — the desk will propose a grade framing.">
            <Input id={p("grade")} name="grade" placeholder="e.g. HMS 1&2, Millberry, 304" />
          </Field>
          <Field label="Specification" htmlFor={p("spec")} hint="Sizing and limits matter more than the grade name.">
            <Input id={p("spec")} name="specification" placeholder="e.g. 0–300 mm, no turnings" />
          </Field>
          <Field label="Scrap form" htmlFor={p("form")}>
            <Select id={p("form")} name="scrapForm" defaultValue="">
              <option value="" disabled>
                Select a form
              </option>
              {["Sheets", "Plates", "Pipes", "Wires", "Cables", "Turnings", "Borings", "Ingots", "Offcuts", "HMS", "Mixed scrap", "Other"].map((f) => (
                <option key={f}>{f}</option>
              ))}
              <UnknownOption />
            </Select>
          </Field>
          <Field label="Condition" htmlFor={p("condition")}>
            <Select id={p("condition")} name="condition" defaultValue="">
              <option value="" disabled>
                Select a condition
              </option>
              {["Clean", "Mixed", "Contaminated", "Processed", "Unprocessed"].map((c) => (
                <option key={c}>{c}</option>
              ))}
              <UnknownOption />
            </Select>
          </Field>
          <Field label="Quantity" htmlFor={p("qty")}>
            <Input id={p("qty")} name="quantity" placeholder="250" inputMode="decimal" />
          </Field>
          <Field label="Unit" htmlFor={p("unit")}>
            <Select id={p("unit")} name="unit" defaultValue="MT">
              <option value="KG">kg</option>
              <option value="MT">MT</option>
              <option value="TONNE">tonne</option>
            </Select>
          </Field>
          <Field label="Purity / composition" htmlFor={p("purity")} hint="Percentage, if known.">
            <Input id={p("purity")} name="purity" placeholder="98.5" inputMode="decimal" />
          </Field>
          <Field label="Contamination" htmlFor={p("contam")} hint="Percentage, if known.">
            <Input id={p("contam")} name="contaminationPct" placeholder="2" inputMode="decimal" />
          </Field>
          <Field label="Source of scrap" htmlFor={p("source")} hint="Optional — helps judge consistency.">
            <Input id={p("source")} name="scrapSource" placeholder="Demolition, machining, decommissioned plant" />
          </Field>
          <Field label="Sample availability" htmlFor={p("sample")}>
            <Select id={p("sample")} name="sampleAvailable" defaultValue="">
              <option value="" disabled>
                Select an answer
              </option>
              <option>Yes</option>
              <option>No</option>
              <option>On request</option>
            </Select>
          </Field>
        </WhenKind>

        {/* ── C. Industrial spare-part requirement (conditional) ───────────── */}
        <WhenKind for={["PRODUCT", "MIXED"]}>
          <Field label="Product category" htmlFor={p("pcat")}>
            <Input id={p("pcat")} name="productCategory" placeholder="Pumps, bearings, valves, gearboxes" />
          </Field>
          <Field label="Product name" htmlFor={p("pname")}>
            <Input id={p("pname")} name="productName" placeholder="e.g. centrifugal pump casing" />
          </Field>
          <Field label="Manufacturer / brand" htmlFor={p("brand")}>
            <Input id={p("brand")} name="manufacturer" placeholder="OEM brand" />
          </Field>
          <Field label="Part number / SKU" htmlFor={p("part")} hint="If unknown, a nameplate photograph substitutes for it.">
            <Input id={p("part")} name="partNumber" placeholder="OEM part number" />
          </Field>
          <Field label="Technical specification" htmlFor={p("pspec")} hint="Size, rating, material, connection standard.">
            <Textarea id={p("pspec")} name="technicalSpec" rows={3} placeholder="Describe or paste the datasheet details" />
          </Field>
          <Field label="Material / grade (part)" htmlFor={p("pmat")}>
            <Input id={p("pmat")} name="materialGrade" placeholder="e.g. SS316, cast iron" />
          </Field>
          <Field label="Quantity (parts)" htmlFor={p("pqty")}>
            <Input id={p("pqty")} name="productQuantity" placeholder="2" inputMode="decimal" />
          </Field>
          <Field label="Unit (parts)" htmlFor={p("punit")}>
            <Select id={p("punit")} name="productUnit" defaultValue="PCS">
              <option value="PCS">pcs</option>
              <option value="SET">set</option>
              <option value="M">m</option>
            </Select>
          </Field>
          <Field label="Condition required" htmlFor={p("pcond")}>
            <Select id={p("pcond")} name="productCondition" defaultValue="">
              <option value="" disabled>
                Select a condition
              </option>
              <option>New</option>
              <option>Refurbished</option>
              <option>Used</option>
            </Select>
          </Field>
          <Field label="Compatible machine / model" htmlFor={p("machine")} hint="Optional, but it widens the sourcing route.">
            <Input id={p("machine")} name="compatibleMachine" placeholder="Machine make and model" />
          </Field>
          <Field label="Approved equivalents acceptable?" htmlFor={p("equiv")}>
            <Select id={p("equiv")} name="equivalentAcceptable" defaultValue="">
              <option value="" disabled>
                Select an answer
              </option>
              <option>Yes</option>
              <option>No — OEM only</option>
              <option>Only with approval</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Checkbox
              id={p("drawing")}
              name="partAttachments"
              label="I have a drawing, datasheet or nameplate photograph to attach (attachment upload is not connected in this preview)."
            />
          </div>
        </WhenKind>

        <Advance title="Photographs and drawings" hint="Attachment upload is not connected in this preview.">
          <div className="sm:col-span-2 space-y-3">
            <p className="text-xs leading-5 text-steel-600">
              Photographs and drawings are the strongest single input for accurate pricing — material
              photographs for scrap, nameplate or datasheet for parts. This preview does not accept
              uploads; the live form will take up to 10 files (JPG, PNG, PDF, DWG, XLSX) at 10 MB each.
            </p>
            <Checkbox
              id={p("files-ready")}
              name="attachments"
              label="I can supply photographs or drawings with this requirement."
            />
          </div>
        </Advance>
      </Step>

      {/* ── D. Delivery and logistics ─────────────────────────────────────── */}
      <Step id="D">
        <Field label="Delivery / pickup location" htmlFor={p("location")}>
          <Input id={p("location")} name="deliveryLocation" placeholder="Site, city or port" />
        </Field>
        <Field label="Preferred delivery date" htmlFor={p("date")} hint="Approximate is acceptable.">
          <Input id={p("date")} name="preferredDeliveryDate" type="date" />
        </Field>
        <Field label="Freight preference" htmlFor={p("freight")}>
          <Select id={p("freight")} name="freightPreference" defaultValue="">
            <option value="" disabled>
              Select a preference
            </option>
            <option>Included in the quotation</option>
            <option>Separate line item</option>
            <option>Buyer-arranged transport</option>
          </Select>
        </Field>
        <Field label="Loading / unloading responsibility" htmlFor={p("loading")}>
          <Select id={p("loading")} name="loadingResponsibility" defaultValue="">
            <option value="" disabled>
              Select a responsibility
            </option>
            <option>Seller</option>
            <option>Buyer</option>
            <option>Shared</option>
          </Select>
        </Field>
        <Field label="Weighbridge available" htmlFor={p("weighbridge")} hint="Optional — affects reconciliation on arrival.">
          <Select id={p("weighbridge")} name="weighbridgeAvailable" defaultValue="">
            <option value="">Not specified</option>
            <option>Yes</option>
            <option>No</option>
          </Select>
        </Field>
        <Field label="Site inspection / loading equipment" htmlFor={p("equipment")} hint="Optional.">
          <Select id={p("equipment")} name="siteInspection" defaultValue="">
            <option value="">Not specified</option>
            <option>Crane</option>
            <option>Hydra</option>
            <option>Forklift</option>
            <option>None</option>
          </Select>
        </Field>
        <Field label="Inspection requirement" htmlFor={p("inspection")}>
          <Select id={p("inspection")} name="inspectionRequired" defaultValue="">
            <option value="" disabled>
              Select an inspection level
            </option>
            <option>None</option>
            <option>Visual</option>
            <option>Sampling</option>
            <option>Third-party inspection</option>
          </Select>
        </Field>

        <Advance title="Restrictions and full address" hint="Collected when the delivery is quoted.">
          <Field label="Full delivery address" htmlFor={p("fulladdr")} className="sm:col-span-2">
            <Textarea id={p("fulladdr")} name="fullDeliveryAddress" rows={3} placeholder="Gate, plot, landmark and contact for entry" />
          </Field>
          <Field label="Transport restrictions" htmlFor={p("restrictions")} className="sm:col-span-2">
            <Input id={p("restrictions")} name="transportRestrictions" placeholder="e.g. no 6-axle trailers, day entry only" />
          </Field>
        </Advance>
      </Step>

      {/* ── E. Commercial details ─────────────────────────────────────────── */}
      <Step id="E">
        <Field label="Target price" htmlFor={p("target")} hint="Optional. Kept private — never shown to suppliers.">
          <Input id={p("target")} name="targetUnitPrice" placeholder="e.g. 54000" inputMode="decimal" />
        </Field>
        <Field label="Target price unit" htmlFor={p("targetunit")} hint="The basis of the figure above.">
          <Select id={p("targetunit")} name="targetUnit" defaultValue="">
            <option value="">Not stated</option>
            <option>per kg</option>
            <option>per MT</option>
            <option>per tonne</option>
            <option>per piece</option>
            <option>total</option>
          </Select>
        </Field>
        <Field label="Tax preference" htmlFor={p("tax")} hint="Preference only — the rate is configured per quotation, never fixed here.">
          <Select id={p("tax")} name="taxPreference" defaultValue="EXTRA">
            <option value="INCLUDED">Tax included in the quoted price</option>
            <option value="EXTRA">Extra as applicable</option>
          </Select>
        </Field>
        <Field label="Payment preference" htmlFor={p("pay")}>
          <Select id={p("pay")} name="paymentPreference" defaultValue="">
            <option value="">Not specified</option>
            <option>Advance</option>
            <option>Against delivery</option>
            <option>Credit</option>
          </Select>
        </Field>
        <Field label="Advance payment possible" htmlFor={p("advance")} hint="Percentage of value, if any.">
          <Input id={p("advance")} name="advancePayment" placeholder="30" inputMode="decimal" />
        </Field>
        <Field label="Requested credit period" htmlFor={p("credit")} hint="Days.">
          <Input id={p("credit")} name="creditPeriod" placeholder="30" inputMode="numeric" />
        </Field>
        <Field label="One-time or recurring" htmlFor={p("freq")}>
          <Select id={p("freq")} name="requirementFrequency" defaultValue="ONE_TIME">
            <option value="ONE_TIME">One-time requirement</option>
            <option value="RECURRING">Recurring requirement</option>
          </Select>
        </Field>
        <Field label="Monthly quantity (recurring only)" htmlFor={p("monthly")} hint="Required only when the requirement repeats.">
          <Input id={p("monthly")} name="monthlyQuantity" placeholder="e.g. 80 MT / month" />
        </Field>
        <Field label="Quotation validity preference" htmlFor={p("validity")} hint="Days you need the price to hold.">
          <Input id={p("validity")} name="quotationValidity" placeholder="15" inputMode="numeric" />
        </Field>
        <Field label="Commercial remarks" htmlFor={p("remarks")} className="sm:col-span-2">
          <Textarea id={p("remarks")} name="commercialRemarks" rows={3} placeholder="Anything commercial the desk should know" />
        </Field>
      </Step>

      {/* ── F. Additional information ─────────────────────────────────────── */}
      <Step id="F">
        <Field label="Requirement description" htmlFor={p("desc")} className="sm:col-span-2" hint="What it is for, and what failure would cost.">
          <Textarea id={p("desc")} name="requirementDescription" rows={4} placeholder="Context for the desk" />
        </Field>
        <Field label="Sample requirement" htmlFor={p("samplereq")}>
          <Select id={p("samplereq")} name="sampleRequirement" defaultValue="">
            <option value="">Not specified</option>
            <option>Not needed</option>
            <option>Before award</option>
            <option>Before dispatch</option>
          </Select>
        </Field>
        <Field label="Inspection availability" htmlFor={p("inspectav")}>
          <Select id={p("inspectav")} name="inspectionAvailability" defaultValue="">
            <option value="">Not specified</option>
            <option>Open</option>
            <option>By appointment</option>
            <option>None</option>
          </Select>
        </Field>
        <Field label="Preferred communication" htmlFor={p("comm")}>
          <Select id={p("comm")} name="preferredCommunication" defaultValue="">
            <option value="">No preference</option>
            <option>Email</option>
            <option>Phone</option>
            <option>WhatsApp</option>
          </Select>
        </Field>
        <Field label="Additional instructions" htmlFor={p("instr")} className="sm:col-span-2">
          <Textarea id={p("instr")} name="additionalInstructions" rows={3} placeholder="Anything else the desk needs" />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            id={p("excel")}
            name="bom"
            label="I have an Excel BOM or technical drawing to supply with this requirement."
          />
        </div>
      </Step>
    </EnquiryWizard>
  );
}

/** Small legend explaining the status markers used across the wizard. */
export function FieldStatusLegend() {
  return (
    <ul className="space-y-1.5 text-xs leading-5 text-steel-600">
      <li>
        <StatusNote status="REQUIRED" /> — needed to open the enquiry.
      </li>
      <li>
        <StatusNote status="SCRAP" /> / <StatusNote status="PRODUCT" /> — appear only for that requirement.
      </li>
      <li>
        <StatusNote status="DELIVERY" /> — needed before a quotation includes delivery.
      </li>
      <li>
        <StatusNote status="OPTIONAL" /> — helps the desk price accurately.
      </li>
      <li>
        <StatusNote status="LATER" /> — required before the invoice or order, not now.
      </li>
    </ul>
  );
}