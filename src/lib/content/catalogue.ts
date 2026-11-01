/**
 * Domain structure for the admin-managed catalogue, lot register, inspection,
 * rejection and dispatch-risk screens.
 *
 * Everything here is EXAMPLE data. It exists to show field structure and the
 * declared-versus-tested distinction the quality workflow has to preserve. None of it
 * is a real lot, supplier, inspector, inspection finding or test result.
 *
 * Two rules are enforced by the shape of these types, not by convention:
 *   1. No money. Purchase rates, quotation rates, margins and cost lines are typed as
 *      `MoneyValue`, which is `null` until a ledger exists. Internal commercial data
 *      therefore cannot be printed by accident.
 *   2. No measured composition without a method, a date and a report. A measured value
 *      carries `method`, `testedOn` and `reportOnFile`; a null measurement is a normal,
 *      displayable state and must never be rendered as a verified result.
 */

export type CategoryKind = "SCRAP" | "SPARE_PARTS";
export type PublicationState = "PUBLISHED" | "DRAFT" | "ARCHIVED";
export type PriceMode = "FIXED" | "REQUEST" | "BULK_TIERED";
export type CommercialModel = "PRINCIPAL" | "AGENCY" | "MANAGED_SUPPLY";

/** No commercial figure is available before the ledger exists. */
export type MoneyValue = null;

export const EMPTY_MONEY: MoneyValue = null;

export type VerificationStatus =
  | "SUPPLIER_DECLARED"
  | "SAMPLE_TESTED"
  | "LABORATORY_VERIFIED"
  | "BUYER_APPROVED"
  | "NOT_YET_VERIFIED";

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  SUPPLIER_DECLARED: "Supplier declared",
  SAMPLE_TESTED: "Sample tested",
  LABORATORY_VERIFIED: "Laboratory verified",
  BUYER_APPROVED: "Buyer approved",
  NOT_YET_VERIFIED: "Not yet verified",
};

export const VERIFICATION_TONE: Record<
  VerificationStatus,
  "green" | "amber" | "steel" | "navy" | "red"
> = {
  SUPPLIER_DECLARED: "steel",
  SAMPLE_TESTED: "amber",
  LABORATORY_VERIFIED: "green",
  BUYER_APPROVED: "green",
  NOT_YET_VERIFIED: "red",
};

export type InspectionMethod =
  | "SUPPLIER_DECLARATION"
  | "PHYSICAL_INSPECTION"
  | "REPRESENTATIVE_SAMPLING"
  | "HANDHELD_XRF"
  | "INDEPENDENT_LABORATORY"
  | "BUYER_APPOINTED";

export const INSPECTION_METHODS: { key: InspectionMethod; label: string; use: string }[] = [
  {
    key: "SUPPLIER_DECLARATION",
    label: "Supplier declaration",
    use: "Default basis. Recorded as declared only, never as verified.",
  },
  {
    key: "PHYSICAL_INSPECTION",
    label: "Physical inspection",
    use: "Grade, form, contamination and foreign material at the supplier site.",
  },
  {
    key: "REPRESENTATIVE_SAMPLING",
    label: "Representative sampling",
    use: "Where a lot is mixed or the buyer requires a retained sample.",
  },
  {
    key: "HANDHELD_XRF",
    label: "Handheld XRF",
    use: "Where alloy identity or composition is commercially material.",
  },
  {
    key: "INDEPENDENT_LABORATORY",
    label: "Independent laboratory",
    use: "Where a specification dispute is possible or a buyer requires it.",
  },
  {
    key: "BUYER_APPOINTED",
    label: "Buyer-appointed inspection",
    use: "When the buyer appoints its own inspector or agency.",
  },
];

export type CompositionBasis = "MIN" | "MAX" | "TARGET" | "RANGE";

/**
 * One configurable elemental or physical attribute. Attributes are rows, not columns:
 * adding an element is data entry, not a schema change.
 */
export type CompositionAttribute = {
  symbol: string;
  name: string;
  unit: "%" | "ppm";
  basis: CompositionBasis;
  referenceMin: string | null;
  referenceMax: string | null;
  referenceTarget: string | null;
  /** Where the reference range came from - buyer specification, supplier sheet, contract. */
  source: string;
  /** Supplier-declared value. A declaration, not a measurement. */
  declared: string | null;
  /** Measured value. Only present with method, date and a report reference. */
  measured: string | null;
  method: InspectionMethod | null;
  testedOn: string | null;
  agency: string | null;
  reportOnFile: boolean;
  verification: VerificationStatus;
};

export type CompositionProfile = {
  key: string;
  material: string;
  /** Rule that applies to the whole profile. */
  note: string;
  attributes: CompositionAttribute[];
};

const declaredOnly = (
  symbol: string,
  name: string,
  basis: CompositionBasis,
  min: string | null,
  max: string | null,
): CompositionAttribute => ({
  symbol,
  name,
  unit: "%",
  basis,
  referenceMin: min,
  referenceMax: max,
  referenceTarget: null,
  source: "Buyer-agreed reference specification",
  declared: null,
  measured: null,
  method: null,
  testedOn: null,
  agency: null,
  reportOnFile: false,
  verification: "NOT_YET_VERIFIED",
});

export const COMPOSITION_PROFILES: CompositionProfile[] = [
  {
    key: "copper",
    material: "Copper",
    note: "Two attributes. A trade grade does not by itself guarantee the impurity level below.",
    attributes: [
      {
        ...declaredOnly("Cu", "Copper", "MIN", "99.9", null),
        // A declaration may exist without any measurement. That is the normal case.
        declared: "Declared at or above the reference minimum",
        verification: "SUPPLIER_DECLARED",
      },
      declaredOnly("Impurities", "Total impurities", "MAX", null, "0.1"),
    ],
  },
  {
    key: "brass",
    material: "Brass",
    note: "Five attributes. Zinc range is the commercially material one; lead is buyer-restricted.",
    attributes: [
      declaredOnly("Cu", "Copper", "RANGE", "60", "63"),
      declaredOnly("Zn", "Zinc", "RANGE", "35", "39"),
      declaredOnly("Pb", "Lead", "MAX", null, "0.3"),
      declaredOnly("Sn", "Tin", "MAX", null, "0.2"),
      declaredOnly("Fe", "Iron", "MAX", null, "0.3"),
    ],
  },
  {
    key: "aluminium",
    material: "Aluminium",
    note: "Seven attributes. Silicon and magnesium determine the alloy family.",
    attributes: [
      declaredOnly("Al", "Aluminium", "MIN", "95", null),
      declaredOnly("Mg", "Magnesium", "MAX", null, "1.0"),
      declaredOnly("Si", "Silicon", "MAX", null, "2.0"),
      declaredOnly("Cu", "Copper", "MAX", null, "0.6"),
      declaredOnly("Zn", "Zinc", "MAX", null, "0.5"),
      declaredOnly("Fe", "Iron", "MAX", null, "0.7"),
      declaredOnly("Mn", "Manganese", "MAX", null, "0.4"),
    ],
  },
  {
    key: "stainless",
    material: "Stainless steel",
    note: "Five attributes. Nickel and molybdenum move the value most; carbon drives grade identity.",
    attributes: [
      declaredOnly("Cr", "Chromium", "RANGE", "16", "18"),
      declaredOnly("Ni", "Nickel", "RANGE", "8", "10"),
      declaredOnly("Mo", "Molybdenum", "MAX", null, "0.5"),
      declaredOnly("Mn", "Manganese", "MAX", null, "2.0"),
      declaredOnly("C", "Carbon", "MAX", null, "0.08"),
    ],
  },
];

export const COMPOSITION_RULES = [
  "A trade grade name is a description, not a chemical guarantee. The composition table is the specification that applies to a transaction.",
  "Reference, declared and measured values are three different fields and are never merged into one column.",
  "A measured value cannot be saved without a method, a test date and a report reference.",
  "Supplier-declared values stay labelled as declared after a measurement is added; the measured value is shown beside it, not in place of it.",
  "No value is pre-filled. An empty composition field is a valid, visible state.",
];

export type CategoryRecord = {
  slug: string;
  name: string;
  kind: CategoryKind;
  description: string;
  displayOrder: number;
  publication: PublicationState;
  /** Why a delete is refused. Deletion protection is a rule, not a warning dialog. */
  deletionGuard: string;
  imageCount: number;
};

export const CATALOGUE_CATEGORIES: CategoryRecord[] = [
  {
    slug: "example-copper-alloys",
    name: "Copper & copper alloys",
    kind: "SCRAP",
    description: "Example category. Grades are published per material group.",
    displayOrder: 1,
    publication: "PUBLISHED",
    deletionGuard: "Delete refused while grades or historical lots reference this category.",
    imageCount: 1,
  },
  {
    slug: "example-aluminium",
    name: "Aluminium",
    kind: "SCRAP",
    description: "Example category for the aluminium material group.",
    displayOrder: 2,
    publication: "PUBLISHED",
    deletionGuard: "Delete refused while grades or historical lots reference this category.",
    imageCount: 1,
  },
  {
    slug: "example-stainless",
    name: "Stainless & alloys",
    kind: "SCRAP",
    description: "Example category for nickel-bearing and stainless grades.",
    displayOrder: 3,
    publication: "DRAFT",
    deletionGuard: "Draft categories with no links may be deleted; published ones are archived instead.",
    imageCount: 0,
  },
  {
    slug: "example-bearing-housings",
    name: "Bearing housings & spares",
    kind: "SPARE_PARTS",
    description: "Example spare-parts category, published with request-price mode.",
    displayOrder: 4,
    publication: "PUBLISHED",
    deletionGuard: "Delete refused while products reference this category.",
    imageCount: 1,
  },
];

export type GradeRecord = {
  sku: string;
  name: string;
  categorySlug: string;
  manufacturer: string | null;
  brand: string | null;
  priceMode: PriceMode;
  moq: string;
  availability: string;
  publication: PublicationState;
  displayOrder: number;
  imageCount: number;
  compositionProfile: string | null;
};

export const CATALOGUE_GRADES: GradeRecord[] = [
  {
    sku: "EX-CU-001",
    name: "Example copper grade 1",
    categorySlug: "example-copper-alloys",
    manufacturer: null,
    brand: null,
    priceMode: "REQUEST",
    moq: "Buyer-agreed",
    availability: "Recurring supply, confirmed per lot",
    publication: "PUBLISHED",
    displayOrder: 1,
    imageCount: 0,
    compositionProfile: "copper",
  },
  {
    sku: "EX-CU-002",
    name: "Example brass grade",
    categorySlug: "example-copper-alloys",
    manufacturer: null,
    brand: null,
    priceMode: "BULK_TIERED",
    moq: "Buyer-agreed",
    availability: "Subject to inspection",
    publication: "PUBLISHED",
    displayOrder: 2,
    imageCount: 0,
    compositionProfile: "brass",
  },
  {
    sku: "EX-AL-001",
    name: "Example aluminium grade",
    categorySlug: "example-aluminium",
    manufacturer: null,
    brand: null,
    priceMode: "REQUEST",
    moq: "Buyer-agreed",
    availability: "Recurring supply, confirmed per lot",
    publication: "PUBLISHED",
    displayOrder: 3,
    imageCount: 0,
    compositionProfile: "aluminium",
  },
  {
    sku: "EX-SS-001",
    name: "Example stainless grade",
    categorySlug: "example-stainless",
    manufacturer: null,
    brand: null,
    priceMode: "REQUEST",
    moq: "Buyer-agreed",
    availability: "Not published",
    publication: "DRAFT",
    displayOrder: 4,
    imageCount: 0,
    compositionProfile: "stainless",
  },
  {
    sku: "EX-BRG-001",
    name: "Example bearing housing",
    categorySlug: "example-bearing-housings",
    manufacturer: "Manufacturer recorded per part",
    brand: "Brand recorded per part",
    priceMode: "REQUEST",
    moq: "Buyer-agreed",
    availability: "Sourced to order",
    publication: "PUBLISHED",
    displayOrder: 5,
    imageCount: 0,
    compositionProfile: null,
  },
];

export type LotStage =
  | "SUPPLIER_SUBMISSION"
  | "INSPECTION"
  | "BUYER_REVIEW"
  | "COMMERCIAL_CONFIRMATION"
  | "DISPATCH_AUTHORISATION"
  | "DESTINATION_INSPECTION"
  | "CLOSED";

/** The seven stages of the transaction workflow, with what each stage must record. */
export const WORKFLOW_STAGES: {
  key: LotStage;
  step: string;
  title: string;
  owner: string;
  records: string[];
}[] = [
  {
    key: "SUPPLIER_SUBMISSION",
    step: "01",
    title: "Supplier submission",
    owner: "Supplier, recorded by PRIMEMET",
    records: [
      "Material and grade",
      "Estimated quantity and location",
      "Photos and video",
      "Declared specification",
      "Availability and expected price",
      "Unique lot reference",
    ],
  },
  {
    key: "INSPECTION",
    step: "02",
    title: "PRIMEMET inspection",
    owner: "PRIMEMET, with inspector or agency",
    records: [
      "Physical inspection",
      "Sample collection where required",
      "XRF or laboratory testing where required",
      "Weighment verification",
      "Inspection evidence",
    ],
  },
  {
    key: "BUYER_REVIEW",
    step: "03",
    title: "Buyer review and approval",
    owner: "Buyer",
    records: [
      "Material and grade",
      "Photos and video",
      "Inspection findings and report",
      "Quantity, location and proposed terms",
      "Approval, rejection or request for further inspection",
      "Approved specification and acceptance tolerances",
    ],
  },
  {
    key: "COMMERCIAL_CONFIRMATION",
    step: "04",
    title: "Commercial confirmation",
    owner: "PRIMEMET with both parties",
    records: [
      "Commercial model: principal, agency or managed supply",
      "Agreed rate and weight basis",
      "Freight, loading and unloading responsibility",
      "Inspection and testing costs",
      "Payment terms and quality tolerance",
      "Permitted deductions, rejection and dispute procedure",
    ],
  },
  {
    key: "DISPATCH_AUTHORISATION",
    step: "05",
    title: "Dispatch authorisation",
    owner: "PRIMEMET",
    records: [
      "Buyer approval reference",
      "Inspection completion",
      "Final commercial confirmation",
      "Dispatch photographs",
      "Vehicle and transporter details",
      "Loading weighment and statutory documents",
    ],
  },
  {
    key: "DESTINATION_INSPECTION",
    step: "06",
    title: "Destination inspection",
    owner: "Buyer, with PRIMEMET coordination",
    records: [
      "Arrival date and destination weighment",
      "Accepted and rejected quantity",
      "Dispatch-to-arrival weight difference",
      "Quality findings, contamination or damage",
      "Final accepted price and deductions",
      "Dispute status",
    ],
  },
  {
    key: "CLOSED",
    step: "07",
    title: "Transaction closure",
    owner: "PRIMEMET",
    records: [
      "Final accepted quantity and transaction value",
      "Supplier and buyer payment",
      "Transport, inspection and handling expenses",
      "Deductions and PRIMEMET revenue",
      "Closure date",
      "Complete transaction history retained",
    ],
  },
];

export type BuyerApprovalState =
  | "NOT_SHARED"
  | "AWAITING_REVIEW"
  | "APPROVED"
  | "APPROVED_WITH_TOLERANCE"
  | "REJECTED"
  | "FURTHER_INSPECTION_REQUESTED";

export const BUYER_APPROVAL_LABELS: Record<BuyerApprovalState, string> = {
  NOT_SHARED: "Not shared",
  AWAITING_REVIEW: "Awaiting review",
  APPROVED: "Approved",
  APPROVED_WITH_TOLERANCE: "Approved with tolerance",
  REJECTED: "Rejected",
  FURTHER_INSPECTION_REQUESTED: "Further inspection requested",
};

export type DispatchState = "NOT_READY" | "BLOCKED" | "AUTHORISED" | "DISPATCHED" | "DELIVERED";

export type LotRecord = {
  reference: string;
  material: string;
  grade: string;
  categorySlug: string;
  supplier: string;
  quantity: string | null;
  unit: string;
  location: string;
  compositionProfile: string;
  stage: LotStage;
  buyerApproval: BuyerApprovalState;
  dispatch: DispatchState;
  commercialModel: CommercialModel;
  reserved: boolean;
  photos: number;
  /** Admin-only. Null until the ledger exists; never part of a public payload. */
  internalPurchaseRate: MoneyValue;
  buyerQuotationRate: MoneyValue;
};

export const LOTS: LotRecord[] = [
  {
    reference: "EX-LOT-0001",
    material: "Copper",
    grade: "Example copper grade 1",
    categorySlug: "example-copper-alloys",
    supplier: "Example supplier A",
    quantity: null,
    unit: "kg",
    location: "Supplier yard",
    compositionProfile: "copper",
    stage: "BUYER_REVIEW",
    buyerApproval: "AWAITING_REVIEW",
    dispatch: "BLOCKED",
    commercialModel: "PRINCIPAL",
    reserved: false,
    photos: 0,
    internalPurchaseRate: EMPTY_MONEY,
    buyerQuotationRate: EMPTY_MONEY,
  },
  {
    reference: "EX-LOT-0002",
    material: "Brass",
    grade: "Example brass grade",
    categorySlug: "example-copper-alloys",
    supplier: "Example supplier B",
    quantity: null,
    unit: "kg",
    location: "Supplier yard",
    compositionProfile: "brass",
    stage: "INSPECTION",
    buyerApproval: "NOT_SHARED",
    dispatch: "NOT_READY",
    commercialModel: "AGENCY",
    reserved: false,
    photos: 0,
    internalPurchaseRate: EMPTY_MONEY,
    buyerQuotationRate: EMPTY_MONEY,
  },
  {
    reference: "EX-LOT-0003",
    material: "Aluminium",
    grade: "Example aluminium grade",
    categorySlug: "example-aluminium",
    supplier: "Example supplier C",
    quantity: null,
    unit: "kg",
    location: "Third-party yard",
    compositionProfile: "aluminium",
    stage: "DISPATCH_AUTHORISATION",
    buyerApproval: "APPROVED_WITH_TOLERANCE",
    dispatch: "AUTHORISED",
    commercialModel: "MANAGED_SUPPLY",
    reserved: true,
    photos: 0,
    internalPurchaseRate: EMPTY_MONEY,
    buyerQuotationRate: EMPTY_MONEY,
  },
];

export type InspectionRecommendation = "PENDING" | "ACCEPT" | "REJECT" | "REINSPECT";

export type InspectionRecord = {
  reference: string;
  lot: string;
  supplier: string;
  material: string;
  declaredGrade: string;
  inspectedOn: string | null;
  location: string;
  inspector: string;
  agency: string;
  methods: InspectionMethod[];
  visual: string;
  chemical: string;
  xrf: string;
  laboratory: string;
  moisture: string;
  contamination: string;
  foreignMaterial: string;
  weightVerification: string;
  media: number;
  remarks: string;
  recommendation: InspectionRecommendation;
};

const NOT_REQUIRED = "Not required for this grade";
const NOT_RECORDED = "Not recorded yet";

export const INSPECTIONS: InspectionRecord[] = [
  {
    reference: "EX-INS-0001",
    lot: "EX-LOT-0001",
    supplier: "Example supplier A",
    material: "Copper",
    declaredGrade: "Example copper grade 1",
    inspectedOn: null,
    location: "Supplier yard",
    inspector: "Not assigned",
    agency: "Internal inspection",
    methods: ["PHYSICAL_INSPECTION"],
    visual: NOT_RECORDED,
    chemical: NOT_RECORDED,
    xrf: "Recommended for this grade",
    laboratory: NOT_REQUIRED,
    moisture: NOT_REQUIRED,
    contamination: NOT_RECORDED,
    foreignMaterial: NOT_RECORDED,
    weightVerification: NOT_RECORDED,
    media: 0,
    remarks: "Inspection scheduled. No finding has been recorded.",
    recommendation: "PENDING",
  },
  {
    reference: "EX-INS-0002",
    lot: "EX-LOT-0002",
    supplier: "Example supplier B",
    material: "Brass",
    declaredGrade: "Example brass grade",
    inspectedOn: null,
    location: "Supplier yard",
    inspector: "Not assigned",
    agency: "Buyer-appointed agency",
    methods: ["REPRESENTATIVE_SAMPLING", "BUYER_APPOINTED"],
    visual: NOT_RECORDED,
    chemical: NOT_RECORDED,
    xrf: "Required before buyer approval",
    laboratory: "Buyer may require an independent report",
    moisture: NOT_REQUIRED,
    contamination: NOT_RECORDED,
    foreignMaterial: NOT_RECORDED,
    weightVerification: NOT_RECORDED,
    media: 0,
    remarks: "Awaiting sample collection. No finding has been recorded.",
    recommendation: "PENDING",
  },
];

export type LotStageRequirement = { stage: LotStage; requires: string[] };

/** What must be true before a lot may move past a stage. Enforced server-side in Stage 3. */
export const STAGE_REQUIREMENTS: LotStageRequirement[] = [
  { stage: "BUYER_REVIEW", requires: ["Inspection record created", "Evidence uploaded"] },
  {
    stage: "COMMERCIAL_CONFIRMATION",
    requires: ["Buyer approval recorded against a specific inspection version"],
  },
  {
    stage: "DISPATCH_AUTHORISATION",
    requires: [
      "Buyer approval",
      "Inspection completed for the risk band",
      "Commercial terms confirmed",
      "Dispatch checklist complete or an override with reason and audit record",
    ],
  },
  {
    stage: "DESTINATION_INSPECTION",
    requires: ["Dispatch weighment recorded", "Transporter details recorded"],
  },
  { stage: "CLOSED", requires: ["Destination acceptance recorded", "Final settlement recorded"] },
];

export type DispatchCheck = { key: string; label: string; blocks: string };

/** The dispatch gate. Every line is a blocking condition, not an advisory note. */
export const DISPATCH_CHECKS: DispatchCheck[] = [
  { key: "inspection", label: "Material inspection completed", blocks: "Dispatch stays blocked until an inspection record exists for the lot." },
  { key: "evidence", label: "Buyer has reviewed the evidence", blocks: "Evidence must be shared before approval can be requested." },
  { key: "approval", label: "Buyer has approved the specific lot", blocks: "Approval is bound to a lot and an inspection version, so a re-inspection invalidates it." },
  { key: "terms", label: "Commercial terms confirmed", blocks: "Model, rate, weight basis and payment terms are recorded before dispatch." },
  { key: "tolerance", label: "Quality tolerance documented", blocks: "Undocumented tolerance is an undocumented deduction." },
  { key: "rejection", label: "Rejection procedure documented", blocks: "Who bears return freight and handling is agreed before loading." },
  { key: "freight", label: "Freight and handling confirmed", blocks: "Responsibility for outbound and return freight is recorded." },
  { key: "weight", label: "Dispatch weight recorded", blocks: "Loading weighment is the basis of the arrival comparison." },
  { key: "transporter", label: "Transporter details recorded", blocks: "Vehicle, carrier and documents are recorded for the consignment." },
];

export type RiskExposureLine = { key: string; label: string; amount: MoneyValue; note: string };

/**
 * Estimated rejection exposure. All amounts are null until cost lines exist.
 * The estimate is an exposure indication, never a guaranteed loss or saving.
 */
export const RISK_EXPOSURE_LINES: RiskExposureLine[] = [
  { key: "outbound", label: "Outbound freight", amount: EMPTY_MONEY, note: "Charged to the trade whether or not the lot is accepted." },
  { key: "return", label: "Potential return freight", amount: EMPTY_MONEY, note: "Only arises on rejection, but is the largest single exposure." },
  { key: "handling", label: "Loading and unloading", amount: EMPTY_MONEY, note: "Charged twice on a rejected load." },
  { key: "inspection", label: "Inspection and testing", amount: EMPTY_MONEY, note: "Sunk cost if the lot is rejected." },
  { key: "storage", label: "Storage", amount: EMPTY_MONEY, note: "Accrues per day while a dispute is open." },
  { key: "movement", label: "Price movement exposure", amount: EMPTY_MONEY, note: "The period between agreement and settlement exposes the rate." },
  { key: "capital", label: "Working capital exposure", amount: EMPTY_MONEY, note: "Capital tied up while the lot is neither accepted nor settled." },
];

export type RejectionReason =
  | "GRADE_MISMATCH"
  | "COMPOSITION_MISMATCH"
  | "CONTAMINATION"
  | "MOISTURE"
  | "QUANTITY_SHORT"
  | "WEIGHT_DISCREPANCY"
  | "TRANSPORT_DAMAGE"
  | "NOT_AS_APPROVED_SAMPLE"
  | "BUYER_SPECIFICATION_CHANGE"
  | "OTHER";

export const REJECTION_REASONS: { key: RejectionReason; label: string }[] = [
  { key: "GRADE_MISMATCH", label: "Incorrect material grade" },
  { key: "COMPOSITION_MISMATCH", label: "Chemical composition mismatch" },
  { key: "CONTAMINATION", label: "Excessive contamination" },
  { key: "MOISTURE", label: "Excessive moisture" },
  { key: "QUANTITY_SHORT", label: "Incorrect quantity" },
  { key: "WEIGHT_DISCREPANCY", label: "Weight discrepancy" },
  { key: "TRANSPORT_DAMAGE", label: "Transport damage" },
  { key: "NOT_AS_APPROVED_SAMPLE", label: "Material different from approved sample" },
  { key: "BUYER_SPECIFICATION_CHANGE", label: "Buyer specification change" },
  { key: "OTHER", label: "Other documented reason" },
];

export type ResolutionOption =
  | "FULL_ACCEPTANCE"
  | "PARTIAL_ACCEPTANCE"
  | "PRICE_DEDUCTION"
  | "REINSPECTION"
  | "INDEPENDENT_LABORATORY"
  | "RETURN_TO_SUPPLIER"
  | "DIVERSION"
  | "NEGOTIATED_SETTLEMENT";

export const RESOLUTION_OPTIONS: { key: ResolutionOption; label: string; effect: string }[] = [
  { key: "FULL_ACCEPTANCE", label: "Full acceptance", effect: "Lot is accepted as dispatched; exposure is limited to the trade itself." },
  { key: "PARTIAL_ACCEPTANCE", label: "Partial acceptance", effect: "Accepted quantity is settled; the balance follows another route." },
  { key: "PRICE_DEDUCTION", label: "Price deduction", effect: "A revised rate applies to the accepted quantity; the basis must be recorded." },
  { key: "REINSPECTION", label: "Reinspection", effect: "A new inspection version is created and buyer approval must be re-obtained." },
  { key: "INDEPENDENT_LABORATORY", label: "Independent laboratory testing", effect: "Findings decide responsibility; both parties see the report." },
  { key: "RETURN_TO_SUPPLIER", label: "Return to supplier", effect: "Return freight and handling follow the agreed responsibility split." },
  { key: "DIVERSION", label: "Diversion to another buyer", effect: "Requires a buyer willing to accept the actual condition and evidence." },
  { key: "NEGOTIATED_SETTLEMENT", label: "Negotiated settlement", effect: "A written settlement recorded with its reason, not a silent adjustment." },
];

export type RejectionRecord = {
  reference: string;
  lot: string;
  buyer: string;
  supplier: string;
  reason: RejectionReason;
  rejectedQuantity: string | null;
  evidenceCount: number;
  /** Never assigned automatically by the software. */
  responsibility: string;
  decision: string;
  resolution: ResolutionOption | null;
  status: "OPEN" | "UNDER_REVIEW" | "SETTLED";
  costLines: { label: string; amount: MoneyValue }[];
};

export const REJECTIONS: RejectionRecord[] = [
  {
    reference: "EX-REJ-0001",
    lot: "EX-LOT-0003",
    buyer: "Example buyer A",
    supplier: "Example supplier C",
    reason: "WEIGHT_DISCREPANCY",
    rejectedQuantity: null,
    evidenceCount: 0,
    responsibility: "Determined from the agreed transaction terms and evidence",
    decision: "Pending arrival weighment and joint review",
    resolution: null,
    status: "UNDER_REVIEW",
    costLines: [
      { label: "Additional transport", amount: EMPTY_MONEY },
      { label: "Loading and unloading", amount: EMPTY_MONEY },
      { label: "Storage", amount: EMPTY_MONEY },
      { label: "Testing", amount: EMPTY_MONEY },
      { label: "Final loss or recovery", amount: EMPTY_MONEY },
    ],
  },
];

export const PUBLICATION_TONE: Record<PublicationState, "green" | "steel" | "amber"> = {
  PUBLISHED: "green",
  DRAFT: "amber",
  ARCHIVED: "steel",
};

export const PRICE_MODE_LABELS: Record<PriceMode, string> = {
  FIXED: "Fixed price",
  REQUEST: "Request price",
  BULK_TIERED: "Bulk tiers",
};

export const COMMERCIAL_MODEL_LABELS: Record<CommercialModel, string> = {
  PRINCIPAL: "Principal",
  AGENCY: "Agency",
  MANAGED_SUPPLY: "Managed supply",
};

export const STAGE_LABELS: Record<LotStage, string> = {
  SUPPLIER_SUBMISSION: "Supplier submission",
  INSPECTION: "Inspection",
  BUYER_REVIEW: "Buyer review",
  COMMERCIAL_CONFIRMATION: "Commercial confirmation",
  DISPATCH_AUTHORISATION: "Dispatch authorisation",
  DESTINATION_INSPECTION: "Destination inspection",
  CLOSED: "Closed",
};
