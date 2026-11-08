/**
 * PRIMEMET — enumerated value sets, for MongoDB validators.
 *
 * GENERATED from prisma/schema.prisma by scripts/gen-mongo-enums.mjs. Do not hand-edit: the Prisma
 * schema remains the single source of truth for enum membership (architecture §5.1 — an enum value is
 * append-only), and MongoDB validators enforce those sets on every insert and update.
 *
 * 1 locally declared name(s) are merged in from db/enums-local.mjs (Prisma declares no such enum).
 * 68 enums. Regenerate with: npm run db:enums
 * Verify with:     npm run check:enums
 */

export const AdminPermission = ["ENQUIRY_VIEW","ENQUIRY_CREATE","ENQUIRY_EDIT","ENQUIRY_CANCEL","ENQUIRY_ASSIGN","ENQUIRY_CLOSE","QUOTE_VIEW","QUOTE_PREPARE","QUOTE_SUBMIT_FOR_APPROVAL","QUOTE_APPROVE","QUOTE_SEND","QUOTE_REVISE","SUPPLIER_QUOTE_REQUEST","SUPPLIER_QUOTE_VIEW","SUPPLIER_QUOTE_COMPARE","LOT_VIEW","LOT_CREATE","LOT_EDIT_DECLARATION","LOT_SCHEDULE_INSPECTION","LOT_RECORD_INSPECTION","LOT_AUTHORISE_DISPATCH","LOT_OVERRIDE_GATE","LOT_CLOSE","APPROVAL_REQUEST","APPROVAL_RECORD","REJECTION_RAISE","REJECTION_RESOLVE","REJECTION_MANAGE_DISPUTE","REJECTION_PREPARE_SETTLEMENT","REJECTION_APPROVE_SETTLEMENT","CONTACT_VIEW_RESTRICTED","CONTACT_APPROVE_SHARE","CATALOGUE_VIEW","CATALOGUE_EDIT","CATALOGUE_PUBLISH","CATALOGUE_EDIT_COMPOSITION","CATALOGUE_APPROVE_COMPOSITION","PRICING_EDIT","PRICING_APPROVE","PRICING_VIEW_INTERNAL","TAX_EDIT","TAX_APPROVE","TAX_VIEW_SNAPSHOT","INVOICE_VIEW","INVOICE_ISSUE","DOCUMENT_VIEW_INTERNAL","DOCUMENT_UPLOAD","AUDIT_VIEW","AUDIT_EXPORT","REPORT_VIEW","USER_VIEW","USER_INVITE","USER_SUSPEND","ACCESS_ASSIGN_ROLE","ACCESS_GRANT_PERMISSION","SEO_EDIT","SEO_PUBLISH","CONTENT_GENERATE","CONTENT_REVIEW","REDIRECT_MANAGE","PARTY_VIEW","PARTY_EDIT","PARTY_VERIFY","PARTY_SUSPEND","ORDER_VIEW","ORDER_EDIT","ORDER_CANCEL","NOTIFICATION_VIEW","NOTIFICATION_RETRY","DATABASE_VIEW_STATUS","DATABASE_VIEW_MIGRATIONS","DATABASE_VIEW_HISTORY","DATABASE_APPLY_MIGRATION","DATABASE_VIEW_BACKUP_STATUS"];
export const AdminTier = ["SUPER_ADMIN","SOURCING_OPS_ADMIN","CATALOGUE_MANAGER","READ_ONLY_ADMIN"];
export const AliasDecision = ["SUBMITTED","VERIFIED","REJECTED","RETIRED"];
export const ApprovalAction = ["SUBMIT_FOR_APPROVAL","APPROVE","REJECT","REQUEST_CHANGES","WITHDRAW"];
export const AuditSeverity = ["INFO","NOTICE","WARNING","CRITICAL"];
export const BuyerApprovalState = ["NOT_SHARED","AWAITING_REVIEW","APPROVED","APPROVED_WITH_TOLERANCE","REJECTED","FURTHER_INSPECTION_REQUESTED"];
export const BuyerQuoteStatus = ["DRAFT","PENDING_APPROVAL","APPROVED","SENT","VIEWED","NEGOTIATION","ACCEPTED","REJECTED","EXPIRED","SUPERSEDED","CANCELLED"];
export const CategoryKind = ["SCRAP","SPARE_PARTS"];
export const ChargeParty = ["PURCHASE","SALE","BOTH"];
export const CompositionBasis = ["MIN","MAX","TARGET","RANGE"];
export const CompositionUnit = ["PERCENT","PPM","MM","MICRON","COUNT","RATIO"];
export const ContactShareScope = ["PARTY_NAME","CONTACT_PERSON","EMAIL","PHONE","ADDRESS","ALL_CONTACT"];
export const ContactShareStatus = ["REQUESTED","APPROVED","DENIED","REVOKED","EXPIRED"];
export const ContentReviewState = ["UNREVIEWED","IN_REVIEW","APPROVED","REJECTED","PUBLISHED"];
export const ContentSource = ["HUMAN","AI_ASSISTED","IMPORTED"];
export const CostType = ["SUPPLIER_PURCHASE","INBOUND_FREIGHT","HANDLING","EXPENSE","COMMISSION","OTHER"];
export const CoverageLevel = ["SERVICED","PICKUP_ONLY","REFERRAL_ONLY","NOT_SERVICED"];
export const DispatchState = ["NOT_READY","BLOCKED","AUTHORISED","DISPATCHED","DELIVERED"];
export const DisputeStatus = ["OPEN","UNDER_REVIEW","AWAITING_COUNTERPARTY","RESOLVED","WITHDRAWN","ESCALATED"];
export const DocumentType = ["GST_CERTIFICATE","PAN_CARD","TRADE_LICENCE","ISO_CERTIFICATE","ENQUIRY_ATTACHMENT","SUPPLIER_QUOTE_ATTACHMENT","PURCHASE_ORDER","SALES_INVOICE","PURCHASE_INVOICE","WEIGHMENT_SLIP","TEST_REPORT","EWAY_BILL","OTHER"];
export const DocumentVisibility = ["INTERNAL","BUYER_VISIBLE","SUPPLIER_VISIBLE"];
export const EmailStatus = ["QUEUED","SENDING","SENT","FAILED","BOUNCED","SUPPRESSED","CANCELLED"];
export const EnquiryPriority = ["LOW","NORMAL","HIGH","URGENT"];
export const EnquirySource = ["WEB_FORM","PHONE","EMAIL","REFERRAL","EXISTING_CUSTOMER","ADMIN_ENTRY"];
export const EnquiryStatus = ["NEW","UNDER_REVIEW","MATCHING_SUPPLIERS","QUOTES_REQUESTED","QUOTES_RECEIVED","COMPARING_QUOTES","QUOTE_DRAFTED","QUOTE_SENT","NEGOTIATION","BUYER_SELLER_INTRODUCTION","WON","LOST","CANCELLED"];
export const EquivalenceBasis = ["EXACT_DESIGNATION","ISRI_EQUIVALENT","PROCESS_SYNONYM"];
export const EquivalenceDecisionStatus = ["PENDING","APPROVED","REJECTED"];
export const GrantEffect = ["GRANT","DENY","REVOKE"];
export const InspectionMethod = ["VISUAL","CHEMICAL_ASSAY","XRF","LABORATORY","MOISTURE","CONTAMINATION","FOREIGN_MATERIAL","WEIGHT_VERIFICATION","DIMENSIONAL","PHOTO_DOCUMENTATION"];
export const InspectionRecommendation = ["PENDING","ACCEPT","REJECT","REINSPECT"];
export const InventoryMode = ["BACK_TO_BACK","STOCK"];
export const InvoiceRole = ["ANY","MATERIAL","COMMISSION","SERVICE_FEE","FREIGHT","OTHER"];
export const InvoiceStatus = ["DRAFT","ISSUED","PARTIALLY_PAID","PAID","VOID","CREDITED"];
export const ListingStatus = ["DRAFT","ACTIVE","PAUSED","EXPIRED","WITHDRAWN"];
export const LotStage = ["SUPPLIER_SUBMISSION","INSPECTION","BUYER_REVIEW","COMMERCIAL_CONFIRMATION","DISPATCH_AUTHORISATION","DESTINATION_INSPECTION","CLOSED"];
export const MigrationDirection = ["UP","DOWN"];
export const MigrationRunStatus = ["PENDING","VALIDATED","APPLYING","APPLIED","FAILED","ROLLED_BACK","FAULTED"];
export const OrderStatus = ["DRAFT","CONFIRMED","SOURCING","READY_TO_DISPATCH","IN_TRANSIT","DELIVERED","INVOICED","CLOSED","CANCELLED"];
export const OrgType = ["BUYER","SELLER","BOTH"];
export const PaymentDirection = ["RECEIVABLE","PAYABLE"];
export const PaymentStatus = ["UNPAID","PARTIALLY_PAID","PAID","OVERDUE","WAIVED"];
export const PriceMode = ["FIXED","REQUEST","BULK_TIERED"];
export const PricingComponentType = ["BASE_RATE","GRADE_ADJUSTMENT","CONTAMINATION_DEDUCTION","QUANTITY_ADJUSTMENT","LOCATION_ADJUSTMENT","FREIGHT","HANDLING","LOADING","PACKAGING","TESTING","MARGIN","COMMISSION","DISCOUNT","SURCHARGE","ROUNDING","MIN_ORDER_ADJUSTMENT"];
export const PricingRuleStatus = ["DRAFT","TESTING","PENDING_APPROVAL","ACTIVE","RETIRED"];
export const ProductCondition = ["NEW","REFURBISHED","USED","UNKNOWN"];
export const PublicationState = ["PUBLISHED","DRAFT","ARCHIVED"];
export const RedirectStatusCode = ["MOVED_PERMANENTLY_301","MOVED_TEMPORARILY_302","GONE_410"];
export const RejectionReason = ["GRADE_MISMATCH","COMPOSITION_OUT_OF_SPEC","CONTAMINATION_EXCESS","MOISTURE_EXCESS","FOREIGN_MATERIAL","WEIGHT_SHORTFALL","DOCUMENTATION_DEFICIENT","LATE_DELIVERY","DAMAGE_IN_TRANSIT","OTHER"];
export const ResolutionOption = ["ACCEPT_WITH_DEDUCTION","RETURN_TO_SUPPLIER","REPLACE_LOT","REGRADE_AND_RENEGOTIATE","REINSPECT_JOINTLY","REJECT_AND_REFUND"];
export const ScanStatus = ["PENDING","CLEAN","INFECTED","FAILED"];
export const SearchIntentType = ["MATERIAL","PRODUCT_TYPE","SPECIFICATION","PROCESS","LOCATION","TRANSACTIONAL","NAVIGATIONAL"];
export const SeoPageType = ["CATEGORY","SCRAP_GRADE","PRODUCT","SERVICE","LOCATION_CITY","LOCATION_DISTRICT","LOCATION_INDUSTRIAL_AREA","LOCATION_STATE","GUIDE"];
export const SettlementStatus = ["PENDING","PARTIALLY_SETTLED","SETTLED","WRITTEN_OFF"];
export const ShipmentStatus = ["PLANNED","DISPATCHED","IN_TRANSIT","DELIVERED","FAILED","RETURNED"];
export const SpecAttributeDataType = ["TEXT","NUMERIC","BOOLEAN","ENUMERATION","RANGE"];
export const SupplierMatchStatus = ["PROPOSED","APPROVED_FOR_RFQ","RFQ_SENT","QUOTE_RECEIVED","DECLINED","WITHDRAWN","EXCLUDED"];
export const SupplierQuoteStatus = ["DRAFT","SUBMITTED","SUPERSEDED","WITHDRAWN","EXPIRED"];
export const TaxAppliesTo = ["PURCHASE","SALE","BOTH"];
export const TaxBaseRule = ["GOODS_VALUE","SERVICE_VALUE","COMMISSION_VALUE","FREIGHT_VALUE","GOODS_PLUS_FREIGHT","TAXABLE_SUBTOTAL"];
export const TaxReviewDecision = ["APPROVED","ADJUSTED","REJECTED"];
export const TaxRuleStatus = ["DRAFT","ACTIVE","RETIRED"];
export const TransactionModel = ["PRINCIPAL","AGENCY","MANAGED_SUPPLY"];
export const UserRole = ["ADMIN","BUYER","SELLER"];
export const UserStatus = ["INVITED","ACTIVE","SUSPENDED","DISABLED","ARCHIVED"];
export const VerificationStatus = ["NOT_SUBMITTED","PENDING","UNDER_REVIEW","VERIFIED","REJECTED","EXPIRED"];
export const VerificationType = ["GST","PAN","CIN","TRADE_LICENCE","ISO","IEC","OTHER"];
export const Visibility = ["INTERNAL","BUYER_VISIBLE","SUPPLIER_VISIBLE"];
export const WeighmentStage = ["SUPPLIER_SITE","DISPATCH","DESTINATION","JOINT"];

/** Every enum, keyed by its Prisma name. Used by validator generation and by tests. */
export const ENUMS = {
  AdminPermission,
  AdminTier,
  AliasDecision,
  ApprovalAction,
  AuditSeverity,
  BuyerApprovalState,
  BuyerQuoteStatus,
  CategoryKind,
  ChargeParty,
  CompositionBasis,
  CompositionUnit,
  ContactShareScope,
  ContactShareStatus,
  ContentReviewState,
  ContentSource,
  CostType,
  CoverageLevel,
  DispatchState,
  DisputeStatus,
  DocumentType,
  DocumentVisibility,
  EmailStatus,
  EnquiryPriority,
  EnquirySource,
  EnquiryStatus,
  EquivalenceBasis,
  EquivalenceDecisionStatus,
  GrantEffect,
  InspectionMethod,
  InspectionRecommendation,
  InventoryMode,
  InvoiceRole,
  InvoiceStatus,
  ListingStatus,
  LotStage,
  MigrationDirection,
  MigrationRunStatus,
  OrderStatus,
  OrgType,
  PaymentDirection,
  PaymentStatus,
  PriceMode,
  PricingComponentType,
  PricingRuleStatus,
  ProductCondition,
  PublicationState,
  RedirectStatusCode,
  RejectionReason,
  ResolutionOption,
  ScanStatus,
  SearchIntentType,
  SeoPageType,
  SettlementStatus,
  ShipmentStatus,
  SpecAttributeDataType,
  SupplierMatchStatus,
  SupplierQuoteStatus,
  TaxAppliesTo,
  TaxBaseRule,
  TaxReviewDecision,
  TaxRuleStatus,
  TransactionModel,
  UserRole,
  UserStatus,
  VerificationStatus,
  VerificationType,
  Visibility,
  WeighmentStage,
};
