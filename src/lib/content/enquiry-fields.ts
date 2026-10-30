/**
 * Buyer enquiry / RFQ field catalogue.
 *
 * One source of truth for the multi-step enquiry wizard (public and portal) and for the
 * field-status tables in docs/PRIMEMET_STAGE_2_ARCHITECTURE.md. The status of every field
 * is declared here, not decided in a page component, so the documentation and the UI
 * cannot drift apart.
 *
 * Status values:
 *   REQUIRED     — always required to open an enquiry.
 *   SCRAP        — required only when the requirement is scrap material.
 *   PRODUCT      — required only when the requirement is industrial spare parts.
 *   DELIVERY     — required only when the quotation must include delivery.
 *   OPTIONAL     — optional, but recommended; the desk values the information.
 *   LATER        — collected before final quotation or order, not at submission.
 *
 * "Unknown / not specified" is a permitted answer for technical facts a buyer may not
 * know (grade, purity, contamination). It flags the enquiry for Admin clarification
 * rather than rejecting it — see NOT_REJECTED / readiness rules below.
 *
 * Nothing here is submitted, stored or emailed. No DB, no auth, no transport.
 */

export type FieldStatus = "REQUIRED" | "SCRAP" | "PRODUCT" | "DELIVERY" | "OPTIONAL" | "LATER";

export type EnquiryKind = "MATERIAL" | "PRODUCT" | "MIXED";

export const STATUS_LABEL: Record<FieldStatus, string> = {
  REQUIRED: "Required",
  SCRAP: "Scrap only",
  PRODUCT: "Parts only",
  DELIVERY: "Delivered quote",
  OPTIONAL: "Optional",
  LATER: "Collected later",
};

export const STATUS_MEANING: Record<FieldStatus, string> = {
  REQUIRED: "Required on every enquiry.",
  SCRAP: "Required only for scrap material requirements.",
  PRODUCT: "Required only for industrial spare-part requirements.",
  DELIVERY: "Required only when the quotation must include delivery.",
  OPTIONAL: "Optional but recommended — helps the desk price accurately.",
  LATER: "Collected later, before the final quotation or order.",
};

export type FieldGroupKey = "A" | "B" | "C" | "D" | "E" | "F";

export type EnquiryField = {
  /** Stable key, mirrored as the future column/JSONB key. */
  key: string;
  label: string;
  status: FieldStatus;
  /** Units or accepted values, shown to the buyer. */
  format?: string;
  /** Helpful example, shown to the buyer. */
  example?: string;
  /** True when "Unknown / not specified" is a legitimate answer. */
  allowsUnknown?: boolean;
  /** Human note for the desk / documentation. */
  note?: string;
};

export type FieldGroup = {
  key: FieldGroupKey;
  title: string;
  summary: string;
  kindScoped: boolean;
  fields: EnquiryField[];
};

export const FIELD_GROUPS: FieldGroup[] = [
  {
    key: "A",
    title: "Buyer and business details",
    summary: "Who is asking, on behalf of which business, and where it is registered.",
    kindScoped: false,
    fields: [
      { key: "contactPersonName", label: "Contact person name", status: "REQUIRED", example: "R. Sharma" },
      { key: "businessName", label: "Company / business name", status: "REQUIRED", example: "Northfield Alloys Pvt Ltd" },
      { key: "mobile", label: "Mobile number (with country code)", status: "REQUIRED", format: "E.164", example: "+91 98765 43210" },
      { key: "businessEmail", label: "Business email", status: "REQUIRED", example: "purchase@company.com", note: "Free-mail addresses are allowed but flagged for review." },
      { key: "businessType", label: "Business type", status: "REQUIRED", format: "Trader / Manufacturer / Fabricator / Foundry / EPC / Other" },
      { key: "gstin", label: "GSTIN, where applicable", status: "OPTIONAL", format: "15 characters", example: "27ABCDE1234F1Z5", note: "Required before a tax invoice, not to open the enquiry." },
      { key: "website", label: "Company website", status: "OPTIONAL", format: "https URL", example: "https://company.com" },
      { key: "billingAddress", label: "Billing address", status: "LATER", note: "Financing and invoice-party checks need this before the order, not at lead capture." },
      { key: "deliveryCity", label: "Delivery city", status: "REQUIRED", example: "Pune" },
      { key: "deliveryState", label: "Delivery state / region", status: "REQUIRED", note: "Also a tax jurisdiction input — see group D." },
      { key: "deliveryPostalCode", label: "Delivery PIN code", status: "REQUIRED", format: "6 digits (India) or local equivalent" },
    ],
  },
  {
    key: "B",
    title: "Scrap material requirement",
    summary: "Shown only when the requirement is scrap metal. Unknown answers are flagged, never rejected.",
    kindScoped: true,
    fields: [
      { key: "materialCategory", label: "Material category", status: "SCRAP", format: "Ferrous / Non-ferrous / Alloy / Stainless", allowsUnknown: true },
      { key: "metalType", label: "Metal / material type", status: "SCRAP", example: "Copper, Aluminium, Mild steel", allowsUnknown: false },
      { key: "grade", label: "Grade", status: "SCRAP", example: "HMS 1&2, Millberry, 304", allowsUnknown: true },
      { key: "specification", label: "Specification", status: "SCRAP", example: "Size 0–300 mm, no turnings", allowsUnknown: true },
      { key: "scrapForm", label: "Scrap form", status: "SCRAP", format: "Sheets / Plates / Pipes / Wires / Cables / Turnings / Borings / Ingots / Offcuts / HMS / Mixed / Other", allowsUnknown: true },
      { key: "quantity", label: "Quantity", status: "SCRAP", format: "number", example: "250" },
      { key: "unit", label: "Unit", status: "SCRAP", format: "kg / MT / tonne" },
      { key: "condition", label: "Condition", status: "SCRAP", format: "Clean / Mixed / Contaminated / Processed / Unprocessed / Unknown", allowsUnknown: true },
      { key: "purity", label: "Purity / composition", status: "SCRAP", format: "%", example: "98.5", allowsUnknown: true },
      { key: "contaminationPct", label: "Contamination", status: "SCRAP", format: "%", example: "2", allowsUnknown: true },
      { key: "scrapSource", label: "Source of scrap", status: "OPTIONAL", example: "Demolition, machining, decommissioned plant" },
      { key: "materialPhotos", label: "Material photographs", status: "OPTIONAL", format: "JPG / PNG, up to 10 files", note: "Photographs are the strongest single input for grading." },
      { key: "inspectionRequired", label: "Inspection requirement", status: "DELIVERY", format: "None / Visual / Sampling / Third-party" },
      { key: "sampleAvailable", label: "Sample availability", status: "SCRAP", format: "Yes / No / On request" },
    ],
  },
  {
    key: "C",
    title: "Industrial spare-part requirement",
    summary: "Shown only when the requirement is spare parts. Part numbers may be unknown and filled in later.",
    kindScoped: true,
    fields: [
      { key: "productCategory", label: "Product category", status: "PRODUCT", example: "Pumps, bearings, valves, gearboxes" },
      { key: "productName", label: "Product name", status: "PRODUCT" },
      { key: "manufacturer", label: "Manufacturer / brand", status: "PRODUCT", allowsUnknown: true },
      { key: "partNumber", label: "Part number / SKU", status: "PRODUCT", allowsUnknown: true, note: "If unknown, a nameplate photograph substitutes for it." },
      { key: "technicalSpec", label: "Technical specification", status: "PRODUCT", allowsUnknown: true },
      { key: "materialGrade", label: "Material / grade", status: "OPTIONAL", allowsUnknown: true },
      { key: "quantity", label: "Quantity", status: "PRODUCT", format: "number" },
      { key: "unit", label: "Unit", status: "PRODUCT", format: "pcs / set / m" },
      { key: "condition", label: "Condition required", status: "PRODUCT", format: "New / Refurbished / Used" },
      { key: "compatibleMachine", label: "Compatible machine / model", status: "OPTIONAL" },
      { key: "partAttachments", label: "Drawing / datasheet / photo", status: "PRODUCT", format: "PDF, DWG, JPG, XLSX", note: "A drawing or datasheet is what makes an obsolete part quotable." },
      { key: "equivalentAcceptable", label: "Approved equivalents acceptable?", status: "PRODUCT", format: "Yes / No / Only with approval" },
    ],
  },
  {
    key: "D",
    title: "Delivery and logistics",
    summary: "Where the lot must arrive and what the site can physically accept.",
    kindScoped: false,
    fields: [
      { key: "deliveryLocation", label: "Delivery / pickup location", status: "REQUIRED" },
      { key: "deliveryPostalCode", label: "Delivery PIN code", status: "REQUIRED" },
      { key: "fullDeliveryAddress", label: "Full delivery address", status: "DELIVERY", note: "Needed before dispatch, not to price the brief." },
      { key: "freightPreference", label: "Freight preference", status: "DELIVERY", format: "Included / Separate / Buyer-arranged" },
      { key: "loadingResponsibility", label: "Loading / unloading responsibility", status: "DELIVERY", format: "Seller / Buyer / Shared" },
      { key: "pickupArrangements", label: "Pickup arrangements (scrap)", status: "SCRAP", example: "Loadable by forklift, gate height 4 m" },
      { key: "weighbridgeAvailable", label: "Weighbridge available", status: "OPTIONAL", format: "Yes / No" },
      { key: "siteInspection", label: "Site inspection / loading equipment", status: "OPTIONAL", format: "Crane / Hydra / Forklift / None" },
      { key: "preferredDeliveryDate", label: "Preferred delivery date", status: "DELIVERY", format: "YYYY-MM-DD" },
      { key: "transportRestrictions", label: "Transport restrictions", status: "OPTIONAL", example: "No 6-axle trailers, day entry only" },
    ],
  },
  {
    key: "E",
    title: "Commercial details",
    summary: "Your commercial expectations. Target price stays private to the PRIMEMET desk.",
    kindScoped: false,
    fields: [
      { key: "targetUnitPrice", label: "Target price and unit", status: "OPTIONAL", format: "amount + unit", allowsUnknown: true, note: "Private: never shown to suppliers, never echoed publicly." },
      { key: "taxPreference", label: "Tax preference", status: "REQUIRED", format: "Included in price / Extra as applicable", note: "Preference only — the rate itself is configured per transaction, never hardcoded." },
      { key: "paymentPreference", label: "Payment preference", status: "OPTIONAL", format: "Advance / Against delivery / Credit" },
      { key: "advancePayment", label: "Advance payment possible", status: "OPTIONAL", format: "% of value" },
      { key: "creditPeriod", label: "Requested credit period", status: "OPTIONAL", format: "days" },
      { key: "requirementFrequency", label: "One-time or recurring", status: "REQUIRED", format: "ONE_TIME / RECURRING" },
      { key: "monthlyQuantity", label: "Monthly quantity (recurring)", status: "SCRAP", format: "number + unit", note: "Required only when the requirement is recurring." },
      { key: "quotationValidity", label: "Quotation validity preference", status: "OPTIONAL", format: "days" },
      { key: "commercialRemarks", label: "Commercial remarks", status: "OPTIONAL" },
    ],
  },
  {
    key: "F",
    title: "Additional information",
    summary: "The context that saves a round of questions — and attachments.",
    kindScoped: false,
    fields: [
      { key: "requirementDescription", label: "Requirement description", status: "REQUIRED", example: "What it is for, and what failure would cost" },
      { key: "attachments", label: "Photos, PDFs, Excel/BOM, drawings", status: "OPTIONAL", format: "Up to 10 files, 10 MB each" },
      { key: "sampleRequirement", label: "Sample requirement", status: "OPTIONAL", format: "Not needed / Before award / Before dispatch" },
      { key: "inspectionAvailability", label: "Inspection availability", status: "OPTIONAL", format: "Open / By appointment / None" },
      { key: "preferredCommunication", label: "Preferred communication", status: "OPTIONAL", format: "Email / Phone / WhatsApp" },
      { key: "additionalInstructions", label: "Additional instructions", status: "OPTIONAL" },
    ],
  },
];

/** Fields whose answer can legitimately be unknown; these flag clarification, not rejection. */
export const UNKNOWN_ALLOWED = FIELD_GROUPS.flatMap((group) =>
  group.fields.filter((field) => field.allowsUnknown).map((field) => `${group.key}.${field.key}`),
);

/**
 * Control name → status, so each `<Field>` can mark its own input without the status being
 * repeated by hand in the form (where it would drift from the catalogue).
 *
 * First group wins on a shared key: the scrap branch owns `condition`, `quantity` and `unit`,
 * and the parts branch uses its own control names so both branches can hold a value at once.
 */
export const STATUS_BY_CONTROL_NAME: Record<string, FieldStatus> = (() => {
  const map: Record<string, FieldStatus> = {};
  for (const group of FIELD_GROUPS) {
    for (const field of group.fields) {
      if (!(field.key in map)) map[field.key] = field.status;
    }
  }
  return {
    ...map,
    // Controls that exist only in the parts branch of the form.
    productCondition: "PRODUCT",
    productQuantity: "PRODUCT",
    productUnit: "PRODUCT",
    // The unit selector belongs to the optional target-price field.
    targetUnit: "OPTIONAL",
    // Attachment/BOM confirmations from group F.
    bom: "OPTIONAL",
  };
})();

/** Fields required for the enquiry to be considered priceable by the desk. */
export const READINESS_BLOCKERS: { group: FieldGroupKey; key: string; condition?: EnquiryKind[] }[] = [
  { group: "A", key: "contactPersonName" },
  { group: "A", key: "businessEmail" },
  { group: "A", key: "mobile" },
  { group: "D", key: "deliveryState" },
  { group: "E", key: "taxPreference" },
  { group: "E", key: "requirementFrequency" },
];

/** Clarification flags — the lead is still accepted, but the desk must confirm before quoting. */
export const CLARIFICATION_FLAGS: { group: FieldGroupKey; key: string; condition?: EnquiryKind[]; reason: string }[] = [
  { group: "B", key: "grade", condition: ["MATERIAL", "MIXED"], reason: "Grade not stated — the desk will propose a grade framing." },
  { group: "B", key: "specification", condition: ["MATERIAL", "MIXED"], reason: "No size or contamination limits stated." },
  { group: "B", key: "purity", condition: ["MATERIAL", "MIXED"], reason: "Purity unknown — sampling or a photograph is needed." },
  { group: "C", key: "partNumber", condition: ["PRODUCT", "MIXED"], reason: "No part number — a nameplate photograph or drawing is required." },
  { group: "C", key: "equivalentAcceptable", condition: ["PRODUCT", "MIXED"], reason: "Equivalent acceptance not confirmed — affects the sourcing route." },
];

export type ReadinessState = "BLOCKED" | "NEEDS_CLARIFICATION" | "QUOTATION_READY";

/**
 * Shape of the readiness result. Deliberately computed from `unknownFields` only:
 * this is a UI model of the rule the Admin screen will apply against real data.
 */
export function evaluateReadiness(unknownFields: readonly string[]): {
  state: ReadinessState;
  label: string;
  detail: string;
} {
  const unknown = new Set(unknownFields);
  const blockers = READINESS_BLOCKERS.filter((b) => !unknown.has(`${b.group}.${b.key}`));
  if (blockers.length > 0) {
    return {
      state: "BLOCKED",
      label: "Not quotation-ready",
      detail: `${blockers.length} field${blockers.length === 1 ? "" : "s"} needed before pricing can start.`,
    };
  }
  if (unknown.size > 0) {
    return {
      state: "NEEDS_CLARIFICATION",
      label: "Accepted — clarification needed",
      detail: `${unknown.size} unknown technical field${unknown.size === 1 ? "" : "s"} flagged for the desk.`,
    };
  }
  return {
    state: "QUOTATION_READY",
    label: "Quotation-ready",
    detail: "Essential information present; the desk can source and price.",
  };
}

/** Rule the UI and documentation both quote for conditional validation. */
export const VALIDATION_RULES = [
  { rule: "Required for every enquiry", detail: "Contact, business, email, mobile, delivery city/state/PIN, requirement description, tax preference, one-time vs recurring." },
  { rule: "Required only for scrap", detail: "Material type, quantity + unit, scrap form, condition, sample availability, monthly quantity when recurring." },
  { rule: "Required only for spare parts", detail: "Product name, quantity + unit, condition (new/refurbished/used), equivalent-acceptable answer." },
  { rule: "Required only for delivered quotations", detail: "Full delivery address, freight preference, loading responsibility, preferred delivery date, inspection requirement." },
  { rule: "Optional but recommended", detail: "Photographs, drawings, site equipment, weighbridge, payment preference, credit period, quotation validity." },
  { rule: "Collected later", detail: "Billing address and GSTIN — before the tax invoice, not to open the enquiry." },
  { rule: "Unknown is not invalid", detail: "Grade, purity, contamination, brand, part number and technical spec accept 'Unknown / not specified', which raises a clarification flag instead of rejecting the lead." },
] as const;
