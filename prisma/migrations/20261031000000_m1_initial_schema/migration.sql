-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."user_role" AS ENUM ('ADMIN', 'BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "public"."user_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."admin_tier" AS ENUM ('SUPER_ADMIN', 'SOURCING_OPS_ADMIN', 'CATALOGUE_MANAGER', 'READ_ONLY_ADMIN');

-- CreateEnum
CREATE TYPE "public"."admin_permission" AS ENUM ('ENQUIRY_VIEW', 'ENQUIRY_CREATE', 'ENQUIRY_EDIT', 'ENQUIRY_CANCEL', 'ENQUIRY_ASSIGN', 'ENQUIRY_CLOSE', 'QUOTE_VIEW', 'QUOTE_PREPARE', 'QUOTE_SUBMIT_FOR_APPROVAL', 'QUOTE_APPROVE', 'QUOTE_SEND', 'QUOTE_REVISE', 'SUPPLIER_QUOTE_REQUEST', 'SUPPLIER_QUOTE_VIEW', 'SUPPLIER_QUOTE_COMPARE', 'LOT_VIEW', 'LOT_CREATE', 'LOT_EDIT_DECLARATION', 'LOT_SCHEDULE_INSPECTION', 'LOT_RECORD_INSPECTION', 'LOT_AUTHORISE_DISPATCH', 'LOT_OVERRIDE_GATE', 'LOT_CLOSE', 'APPROVAL_REQUEST', 'APPROVAL_RECORD', 'REJECTION_RAISE', 'REJECTION_RESOLVE', 'REJECTION_MANAGE_DISPUTE', 'REJECTION_PREPARE_SETTLEMENT', 'REJECTION_APPROVE_SETTLEMENT', 'CONTACT_VIEW_RESTRICTED', 'CONTACT_APPROVE_SHARE', 'CATALOGUE_VIEW', 'CATALOGUE_EDIT', 'CATALOGUE_PUBLISH', 'CATALOGUE_EDIT_COMPOSITION', 'CATALOGUE_APPROVE_COMPOSITION', 'PRICING_EDIT', 'PRICING_APPROVE', 'PRICING_VIEW_INTERNAL', 'TAX_EDIT', 'TAX_APPROVE', 'TAX_VIEW_SNAPSHOT', 'INVOICE_VIEW', 'INVOICE_ISSUE', 'DOCUMENT_VIEW_INTERNAL', 'DOCUMENT_UPLOAD', 'AUDIT_VIEW', 'AUDIT_EXPORT', 'REPORT_VIEW', 'USER_VIEW', 'USER_INVITE', 'USER_SUSPEND', 'ACCESS_ASSIGN_ROLE', 'ACCESS_GRANT_PERMISSION', 'SEO_EDIT', 'SEO_PUBLISH', 'CONTENT_GENERATE', 'CONTENT_REVIEW', 'REDIRECT_MANAGE', 'PARTY_VIEW', 'PARTY_EDIT', 'PARTY_VERIFY', 'PARTY_SUSPEND', 'ORDER_VIEW', 'ORDER_EDIT', 'ORDER_CANCEL', 'NOTIFICATION_VIEW', 'NOTIFICATION_RETRY', 'DATABASE_VIEW_STATUS', 'DATABASE_VIEW_MIGRATIONS', 'DATABASE_VIEW_HISTORY', 'DATABASE_APPLY_MIGRATION', 'DATABASE_VIEW_BACKUP_STATUS');

-- CreateEnum
CREATE TYPE "public"."org_type" AS ENUM ('BUYER', 'SELLER', 'BOTH');

-- CreateEnum
CREATE TYPE "public"."verification_status" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."verification_type" AS ENUM ('GST', 'PAN', 'CIN', 'TRADE_LICENCE', 'ISO', 'IEC', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."transaction_model" AS ENUM ('PRINCIPAL', 'AGENCY', 'MANAGED_SUPPLY');

-- CreateEnum
CREATE TYPE "public"."enquiry_status" AS ENUM ('NEW', 'UNDER_REVIEW', 'MATCHING_SUPPLIERS', 'QUOTES_REQUESTED', 'QUOTES_RECEIVED', 'COMPARING_QUOTES', 'QUOTE_DRAFTED', 'QUOTE_SENT', 'NEGOTIATION', 'BUYER_SELLER_INTRODUCTION', 'WON', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."enquiry_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."enquiry_source" AS ENUM ('WEB_FORM', 'PHONE', 'EMAIL', 'REFERRAL', 'EXISTING_CUSTOMER', 'ADMIN_ENTRY');

-- CreateEnum
CREATE TYPE "public"."supplier_match_status" AS ENUM ('PROPOSED', 'APPROVED_FOR_RFQ', 'RFQ_SENT', 'QUOTE_RECEIVED', 'DECLINED', 'WITHDRAWN', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "public"."supplier_quote_status" AS ENUM ('DRAFT', 'SUBMITTED', 'SUPERSEDED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."buyer_quote_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED', 'NEGOTIATION', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."approval_action" AS ENUM ('SUBMIT_FOR_APPROVAL', 'APPROVE', 'REJECT', 'REQUEST_CHANGES', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "public"."contact_share_status" AS ENUM ('REQUESTED', 'APPROVED', 'DENIED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."contact_share_scope" AS ENUM ('PARTY_NAME', 'CONTACT_PERSON', 'EMAIL', 'PHONE', 'ADDRESS', 'ALL_CONTACT');

-- CreateEnum
CREATE TYPE "public"."pricing_rule_status" AS ENUM ('DRAFT', 'TESTING', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."pricing_component_type" AS ENUM ('BASE_RATE', 'GRADE_ADJUSTMENT', 'CONTAMINATION_DEDUCTION', 'QUANTITY_ADJUSTMENT', 'LOCATION_ADJUSTMENT', 'FREIGHT', 'HANDLING', 'LOADING', 'PACKAGING', 'TESTING', 'MARGIN', 'COMMISSION', 'DISCOUNT', 'SURCHARGE', 'ROUNDING', 'MIN_ORDER_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."charge_party" AS ENUM ('PURCHASE', 'SALE', 'BOTH');

-- CreateEnum
CREATE TYPE "public"."visibility" AS ENUM ('INTERNAL', 'BUYER_VISIBLE', 'SUPPLIER_VISIBLE');

-- CreateEnum
CREATE TYPE "public"."tax_rule_status" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."tax_base_rule" AS ENUM ('GOODS_VALUE', 'SERVICE_VALUE', 'COMMISSION_VALUE', 'FREIGHT_VALUE', 'GOODS_PLUS_FREIGHT', 'TAXABLE_SUBTOTAL');

-- CreateEnum
CREATE TYPE "public"."tax_applies_to" AS ENUM ('PURCHASE', 'SALE', 'BOTH');

-- CreateEnum
CREATE TYPE "public"."order_status" AS ENUM ('DRAFT', 'CONFIRMED', 'SOURCING', 'READY_TO_DISPATCH', 'IN_TRANSIT', 'DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."payment_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "public"."payment_direction" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "public"."cost_type" AS ENUM ('SUPPLIER_PURCHASE', 'INBOUND_FREIGHT', 'HANDLING', 'EXPENSE', 'COMMISSION', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."shipment_status" AS ENUM ('PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "public"."listing_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "public"."product_condition" AS ENUM ('NEW', 'REFURBISHED', 'USED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."document_type" AS ENUM ('GST_CERTIFICATE', 'PAN_CARD', 'TRADE_LICENCE', 'ISO_CERTIFICATE', 'ENQUIRY_ATTACHMENT', 'SUPPLIER_QUOTE_ATTACHMENT', 'PURCHASE_ORDER', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'WEIGHMENT_SLIP', 'TEST_REPORT', 'EWAY_BILL', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."document_visibility" AS ENUM ('INTERNAL', 'BUYER_VISIBLE', 'SUPPLIER_VISIBLE');

-- CreateEnum
CREATE TYPE "public"."scan_status" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."email_status" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'BOUNCED', 'SUPPRESSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."audit_severity" AS ENUM ('INFO', 'NOTICE', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."category_kind" AS ENUM ('SCRAP', 'SPARE_PARTS');

-- CreateEnum
CREATE TYPE "public"."publication_state" AS ENUM ('PUBLISHED', 'DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."price_mode" AS ENUM ('FIXED', 'REQUEST', 'BULK_TIERED');

-- CreateEnum
CREATE TYPE "public"."composition_basis" AS ENUM ('MIN', 'MAX', 'TARGET', 'RANGE');

-- CreateEnum
CREATE TYPE "public"."composition_unit" AS ENUM ('PERCENT', 'PPM', 'MM', 'MICRON', 'COUNT', 'RATIO');

-- CreateEnum
CREATE TYPE "public"."inspection_method" AS ENUM ('VISUAL', 'CHEMICAL_ASSAY', 'XRF', 'LABORATORY', 'MOISTURE', 'CONTAMINATION', 'FOREIGN_MATERIAL', 'WEIGHT_VERIFICATION', 'DIMENSIONAL', 'PHOTO_DOCUMENTATION');

-- CreateEnum
CREATE TYPE "public"."inspection_recommendation" AS ENUM ('PENDING', 'ACCEPT', 'REJECT', 'REINSPECT');

-- CreateEnum
CREATE TYPE "public"."buyer_approval_state" AS ENUM ('NOT_SHARED', 'AWAITING_REVIEW', 'APPROVED', 'APPROVED_WITH_TOLERANCE', 'REJECTED', 'FURTHER_INSPECTION_REQUESTED');

-- CreateEnum
CREATE TYPE "public"."lot_stage" AS ENUM ('SUPPLIER_SUBMISSION', 'INSPECTION', 'BUYER_REVIEW', 'COMMERCIAL_CONFIRMATION', 'DISPATCH_AUTHORISATION', 'DESTINATION_INSPECTION', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."dispatch_state" AS ENUM ('NOT_READY', 'BLOCKED', 'AUTHORISED', 'DISPATCHED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "public"."rejection_reason" AS ENUM ('GRADE_MISMATCH', 'COMPOSITION_OUT_OF_SPEC', 'CONTAMINATION_EXCESS', 'MOISTURE_EXCESS', 'FOREIGN_MATERIAL', 'WEIGHT_SHORTFALL', 'DOCUMENTATION_DEFICIENT', 'LATE_DELIVERY', 'DAMAGE_IN_TRANSIT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."resolution_option" AS ENUM ('ACCEPT_WITH_DEDUCTION', 'RETURN_TO_SUPPLIER', 'REPLACE_LOT', 'REGRADE_AND_RENEGOTIATE', 'REINSPECT_JOINTLY', 'REJECT_AND_REFUND');

-- CreateEnum
CREATE TYPE "public"."dispute_status" AS ENUM ('OPEN', 'UNDER_REVIEW', 'AWAITING_COUNTERPARTY', 'RESOLVED', 'WITHDRAWN', 'ESCALATED');

-- CreateEnum
CREATE TYPE "public"."settlement_status" AS ENUM ('PENDING', 'PARTIALLY_SETTLED', 'SETTLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "public"."weighment_stage" AS ENUM ('SUPPLIER_SITE', 'DISPATCH', 'DESTINATION', 'JOINT');

-- CreateEnum
CREATE TYPE "public"."seo_page_type" AS ENUM ('CATEGORY', 'SCRAP_GRADE', 'PRODUCT', 'SERVICE', 'LOCATION_CITY', 'LOCATION_DISTRICT', 'LOCATION_INDUSTRIAL_AREA', 'LOCATION_STATE', 'GUIDE');

-- CreateEnum
CREATE TYPE "public"."content_source" AS ENUM ('HUMAN', 'AI_ASSISTED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "public"."content_review_state" AS ENUM ('UNREVIEWED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "public"."coverage_level" AS ENUM ('SERVICED', 'PICKUP_ONLY', 'REFERRAL_ONLY', 'NOT_SERVICED');

-- CreateEnum
CREATE TYPE "public"."redirect_status_code" AS ENUM ('MOVED_PERMANENTLY_301', 'MOVED_TEMPORARILY_302', 'GONE_410');

-- CreateEnum
CREATE TYPE "public"."invoice_role" AS ENUM ('ANY', 'MATERIAL', 'COMMISSION', 'SERVICE_FEE', 'FREIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."invoice_status" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'CREDITED');

-- CreateEnum
CREATE TYPE "public"."inventory_mode" AS ENUM ('BACK_TO_BACK', 'STOCK');

-- CreateEnum
CREATE TYPE "public"."tax_review_decision" AS ENUM ('APPROVED', 'ADJUSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."migration_direction" AS ENUM ('UP', 'DOWN');

-- CreateEnum
CREATE TYPE "public"."migration_run_status" AS ENUM ('PENDING', 'VALIDATED', 'APPLYING', 'APPLIED', 'FAILED', 'ROLLED_BACK', 'FAULTED');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "password_hash" TEXT,
    "password_changed_at" TIMESTAMPTZ(6),
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "public"."user_role" NOT NULL,
    "status" "public"."user_status" NOT NULL DEFAULT 'INVITED',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_ciphertext" TEXT,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role_at_issue" "public"."user_role" NOT NULL,
    "ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "email_attempted" TEXT,
    "event_type" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "detail" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "staff_code" TEXT NOT NULL,
    "tier" "public"."admin_tier" NOT NULL,
    "job_title" TEXT,
    "desk" TEXT,
    "mfa_required" BOOLEAN NOT NULL DEFAULT true,
    "approval_limit" DECIMAL(18,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_permission_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "permission" "public"."admin_permission" NOT NULL,
    "effect" TEXT NOT NULL,
    "granted_by_id" UUID,
    "reason" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."portal_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "role" "public"."user_role" NOT NULL,
    "organisation_id" UUID,
    "invited_by_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organisations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "org_type" "public"."org_type" NOT NULL,
    "registration_number" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "iec" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "state_code" TEXT,
    "city" TEXT,
    "website" TEXT,
    "verification_status" "public"."verification_status" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "account_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "is_listable" BOOLEAN NOT NULL DEFAULT false,
    "internal_notes" TEXT,
    "org_kind" TEXT NOT NULL DEFAULT 'OTHER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organisation_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "postal_code" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organisation_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "role_label" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "shareable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organisation_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "type" "public"."verification_type" NOT NULL,
    "status" "public"."verification_status" NOT NULL DEFAULT 'PENDING',
    "reference_value" TEXT,
    "document_id" UUID,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reference_sequences" (
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "reference_sequences_pkey" PRIMARY KEY ("prefix","year")
);

-- CreateTable
CREATE TABLE "public"."categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "kind" "public"."category_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "short_description" TEXT,
    "long_description" TEXT,
    "hero_document_id" UUID,
    "publication_state" "public"."publication_state" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_families" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "publication_state" "public"."publication_state" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "part_number" TEXT,
    "alternate_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brand" TEXT,
    "manufacturer" TEXT,
    "title" TEXT NOT NULL,
    "short_description" TEXT,
    "technical_specification" TEXT,
    "condition" "public"."product_condition" NOT NULL DEFAULT 'UNKNOWN',
    "price_mode" "public"."price_mode" NOT NULL DEFAULT 'REQUEST',
    "publication_state" "public"."publication_state" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_specifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "attribute" TEXT NOT NULL,
    "value_text" TEXT NOT NULL,
    "unit" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_specifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_compatibilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "equipment_make" TEXT NOT NULL,
    "equipment_model" TEXT NOT NULL,
    "fitment_type" TEXT NOT NULL,
    "source_note" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_compatibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."scrap_grades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_description" TEXT,
    "trade_description" TEXT,
    "typical_origin" TEXT,
    "hazard_class" TEXT,
    "default_price_mode" "public"."price_mode" NOT NULL DEFAULT 'REQUEST',
    "publication_state" "public"."publication_state" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "scrap_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."composition_attribute_defs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonical_unit" "public"."composition_unit" NOT NULL,
    "is_elemental" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "composition_attribute_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."grade_composition_attributes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grade_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "basis" "public"."composition_basis" NOT NULL,
    "reference_min" DECIMAL(12,6),
    "reference_max" DECIMAL(12,6),
    "reference_target" DECIMAL(12,6),
    "unit" "public"."composition_unit" NOT NULL,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "tolerance_pct" DECIMAL(9,4),
    "source_note" TEXT,
    "verification" "public"."verification_status" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_composition_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."grade_reference_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grade_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "reference" TEXT,
    "document_id" UUID,
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_reference_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inspection_methods_ref" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" "public"."inspection_method" NOT NULL,
    "label" TEXT NOT NULL,
    "use_note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_methods_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supplier_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "user_id" UUID,
    "contact_role" TEXT,
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "can_submit_quotes" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "materials_handled" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "geographic_reach" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monthly_capacity_kg" DECIMAL(18,3),
    "has_weighbridge" BOOLEAN,
    "has_testing_facility" BOOLEAN,
    "payment_terms_days" INTEGER,
    "credit_terms_days" INTEGER,
    "verification" "public"."verification_status" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "rating_internal" DECIMAL(3,2),
    "notes_internal" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."buyer_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organisation_id" UUID NOT NULL,
    "user_id" UUID,
    "job_title" TEXT,
    "department" TEXT,
    "approval_limit" DECIMAL(18,2),
    "preferred_currency" CHAR(3),
    "default_ship_to_id" UUID,
    "industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferred_grades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "typical_monthly_kg" DECIMAL(18,3),
    "delivery_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "credit_terms_days" INTEGER,
    "credit_limit" DECIMAL(18,2),
    "verification" "public"."verification_status" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "notes_internal" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supplier_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_id" UUID NOT NULL,
    "grade_id" UUID,
    "product_id" UUID,
    "quantity_kg" DECIMAL(18,3),
    "location_city_id" UUID,
    "available_from" DATE,
    "available_to" DATE,
    "status" "public"."listing_status" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."location_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "tax_region_code" TEXT,
    "is_serviced" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pricing_rule_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "public"."pricing_rule_status" NOT NULL DEFAULT 'DRAFT',
    "currency_code" CHAR(3) NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tax_components_ref" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_statutory" BOOLEAN NOT NULL,
    "applies_at" "public"."tax_applies_to" NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_components_ref_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "public"."tax_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "component_code" TEXT NOT NULL,
    "jurisdiction_state_id" UUID,
    "invoice_role" "public"."invoice_role" NOT NULL DEFAULT 'ANY',
    "applies_to" "public"."tax_applies_to" NOT NULL,
    "transaction_model" "public"."transaction_model",
    "hsn_sac_code" TEXT,
    "rate_pct" DECIMAL(9,4) NOT NULL,
    "taxable_base_rule" "public"."tax_base_rule" NOT NULL,
    "includes_freight" BOOLEAN NOT NULL DEFAULT false,
    "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
    "threshold_amount" DECIMAL(18,2),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "public"."tax_rule_status" NOT NULL DEFAULT 'DRAFT',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "legal_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tax_treatments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transaction_model" "public"."transaction_model" NOT NULL,
    "applies_to" "public"."tax_applies_to" NOT NULL,
    "invoice_role" "public"."invoice_role" NOT NULL DEFAULT 'ANY',
    "jurisdiction_state_id" UUID,
    "rule_ids" UUID[],
    "requires_admin_review" BOOLEAN NOT NULL DEFAULT true,
    "status" "public"."tax_rule_status" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "document_type" "public"."document_type" NOT NULL,
    "visibility" "public"."document_visibility" NOT NULL DEFAULT 'INTERNAL',
    "sensitivity" TEXT NOT NULL DEFAULT 'NORMAL',
    "owner_org_id" UUID,
    "uploaded_by_id" UUID,
    "scan_status" "public"."scan_status" NOT NULL DEFAULT 'PENDING',
    "scan_result" TEXT,
    "retention_until" DATE,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_access_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "user_id" UUID,
    "org_id" UUID,
    "action" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "purpose" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "public"."user_role",
    "actor_ip_hash" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before_state" JSONB,
    "after_state" JSONB,
    "severity" "public"."audit_severity" NOT NULL DEFAULT 'INFO',
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_log_failures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempted_at" TIMESTAMPTZ(6) NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."migration_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "migration_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "file_checksum_sha256" TEXT NOT NULL,
    "direction" "public"."migration_direction" NOT NULL DEFAULT 'UP',
    "objects_affected" JSONB NOT NULL,
    "destructive" BOOLEAN NOT NULL DEFAULT false,
    "requires_backup" BOOLEAN NOT NULL DEFAULT true,
    "app_version" TEXT NOT NULL,
    "schema_before" TEXT,
    "schema_after" TEXT,
    "backup_verified" BOOLEAN NOT NULL DEFAULT false,
    "backup_reference" TEXT,
    "dry_run_result" JSONB,
    "status" "public"."migration_run_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "error_detail" TEXT,
    "applied_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "public"."users"("role", "status");

-- CreateIndex
CREATE INDEX "users_status_created_at_idx" ON "public"."users"("status", "created_at");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "public"."users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "public"."sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "public"."sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "public"."sessions"("expires_at");

-- CreateIndex
CREATE INDEX "sessions_revoked_at_idx" ON "public"."sessions"("revoked_at");

-- CreateIndex
CREATE INDEX "auth_events_user_id_occurred_at_idx" ON "public"."auth_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "auth_events_email_attempted_occurred_at_idx" ON "public"."auth_events"("email_attempted", "occurred_at");

-- CreateIndex
CREATE INDEX "auth_events_event_type_occurred_at_idx" ON "public"."auth_events"("event_type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_user_id_key" ON "public"."admin_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_staff_code_key" ON "public"."admin_profiles"("staff_code");

-- CreateIndex
CREATE INDEX "admin_permission_grants_admin_id_idx" ON "public"."admin_permission_grants"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_permission_grants_admin_id_permission_key" ON "public"."admin_permission_grants"("admin_id", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "portal_invitations_token_hash_key" ON "public"."portal_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "portal_invitations_email_expires_at_idx" ON "public"."portal_invitations"("email", "expires_at");

-- CreateIndex
CREATE INDEX "portal_invitations_organisation_id_idx" ON "public"."portal_invitations"("organisation_id");

-- CreateIndex
CREATE INDEX "organisations_org_type_verification_status_idx" ON "public"."organisations"("org_type", "verification_status");

-- CreateIndex
CREATE INDEX "organisations_state_code_idx" ON "public"."organisations"("state_code");

-- CreateIndex
CREATE INDEX "organisations_deleted_at_idx" ON "public"."organisations"("deleted_at");

-- CreateIndex
CREATE INDEX "organisation_addresses_organisation_id_kind_idx" ON "public"."organisation_addresses"("organisation_id", "kind");

-- CreateIndex
CREATE INDEX "organisation_contacts_organisation_id_is_primary_idx" ON "public"."organisation_contacts"("organisation_id", "is_primary");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_contacts_organisation_id_email_key" ON "public"."organisation_contacts"("organisation_id", "email");

-- CreateIndex
CREATE INDEX "organisation_verifications_status_expires_at_idx" ON "public"."organisation_verifications"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_verifications_organisation_id_type_key" ON "public"."organisation_verifications"("organisation_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "public"."categories"("slug");

-- CreateIndex
CREATE INDEX "categories_kind_publication_state_sort_order_idx" ON "public"."categories"("kind", "publication_state", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_families_slug_key" ON "public"."product_families"("slug");

-- CreateIndex
CREATE INDEX "product_families_category_id_publication_state_sort_order_idx" ON "public"."product_families"("category_id", "publication_state", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "public"."products"("slug");

-- CreateIndex
CREATE INDEX "products_family_id_publication_state_idx" ON "public"."products"("family_id", "publication_state");

-- CreateIndex
CREATE INDEX "products_brand_condition_idx" ON "public"."products"("brand", "condition");

-- CreateIndex
CREATE INDEX "products_part_number_idx" ON "public"."products"("part_number");

-- CreateIndex
CREATE INDEX "products_publication_state_published_at_idx" ON "public"."products"("publication_state", "published_at");

-- CreateIndex
CREATE INDEX "product_specifications_product_id_sort_order_idx" ON "public"."product_specifications"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_compatibilities_product_id_idx" ON "public"."product_compatibilities"("product_id");

-- CreateIndex
CREATE INDEX "product_compatibilities_equipment_make_equipment_model_idx" ON "public"."product_compatibilities"("equipment_make", "equipment_model");

-- CreateIndex
CREATE UNIQUE INDEX "scrap_grades_slug_key" ON "public"."scrap_grades"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "scrap_grades_code_key" ON "public"."scrap_grades"("code");

-- CreateIndex
CREATE INDEX "scrap_grades_category_id_publication_state_idx" ON "public"."scrap_grades"("category_id", "publication_state");

-- CreateIndex
CREATE UNIQUE INDEX "composition_attribute_defs_symbol_key" ON "public"."composition_attribute_defs"("symbol");

-- CreateIndex
CREATE INDEX "composition_attribute_defs_sort_order_idx" ON "public"."composition_attribute_defs"("sort_order");

-- CreateIndex
CREATE INDEX "grade_composition_attributes_grade_id_sort_order_idx" ON "public"."grade_composition_attributes"("grade_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "grade_composition_attributes_grade_id_attribute_id_key" ON "public"."grade_composition_attributes"("grade_id", "attribute_id");

-- CreateIndex
CREATE INDEX "grade_reference_sources_grade_id_source_type_idx" ON "public"."grade_reference_sources"("grade_id", "source_type");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_methods_ref_key_key" ON "public"."inspection_methods_ref"("key");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_profiles_organisation_id_key" ON "public"."supplier_profiles"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_profiles_user_id_key" ON "public"."supplier_profiles"("user_id");

-- CreateIndex
CREATE INDEX "supplier_profiles_verification_idx" ON "public"."supplier_profiles"("verification");

-- CreateIndex
CREATE INDEX "supplier_profiles_capabilities_idx" ON "public"."supplier_profiles" USING GIN ("capabilities");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_profiles_organisation_id_key" ON "public"."buyer_profiles"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_profiles_user_id_key" ON "public"."buyer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "buyer_profiles_verification_idx" ON "public"."buyer_profiles"("verification");

-- CreateIndex
CREATE INDEX "buyer_profiles_industries_idx" ON "public"."buyer_profiles" USING GIN ("industries");

-- CreateIndex
CREATE INDEX "supplier_listings_supplier_id_status_idx" ON "public"."supplier_listings"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "supplier_listings_grade_id_status_idx" ON "public"."supplier_listings"("grade_id", "status");

-- CreateIndex
CREATE INDEX "supplier_listings_product_id_status_idx" ON "public"."supplier_listings"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "location_states_code_key" ON "public"."location_states"("code");

-- CreateIndex
CREATE INDEX "location_states_country_code_is_serviced_idx" ON "public"."location_states"("country_code", "is_serviced");

-- CreateIndex
CREATE INDEX "pricing_rule_sets_status_effective_from_idx" ON "public"."pricing_rule_sets"("status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rule_sets_key_version_key" ON "public"."pricing_rule_sets"("key", "version");

-- CreateIndex
CREATE INDEX "tax_rules_component_code_transaction_model_invoice_role_jur_idx" ON "public"."tax_rules"("component_code", "transaction_model", "invoice_role", "jurisdiction_state_id", "effective_from");

-- CreateIndex
CREATE INDEX "tax_rules_status_effective_from_idx" ON "public"."tax_rules"("status", "effective_from");

-- CreateIndex
CREATE INDEX "tax_treatments_transaction_model_invoice_role_status_effect_idx" ON "public"."tax_treatments"("transaction_model", "invoice_role", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "public"."documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_document_type_created_at_idx" ON "public"."documents"("document_type", "created_at");

-- CreateIndex
CREATE INDEX "documents_owner_org_id_idx" ON "public"."documents"("owner_org_id");

-- CreateIndex
CREATE INDEX "documents_scan_status_idx" ON "public"."documents"("scan_status");

-- CreateIndex
CREATE INDEX "documents_visibility_idx" ON "public"."documents"("visibility");

-- CreateIndex
CREATE INDEX "documents_checksum_sha256_idx" ON "public"."documents"("checksum_sha256");

-- CreateIndex
CREATE INDEX "document_access_log_document_id_created_at_idx" ON "public"."document_access_log"("document_id", "created_at");

-- CreateIndex
CREATE INDEX "document_access_log_user_id_created_at_idx" ON "public"."document_access_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_occurred_at_idx" ON "public"."audit_logs"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_occurred_at_idx" ON "public"."audit_logs"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurred_at_idx" ON "public"."audit_logs"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_severity_occurred_at_idx" ON "public"."audit_logs"("severity", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_failures_resolved_attempted_at_idx" ON "public"."audit_log_failures"("resolved", "attempted_at");

-- CreateIndex
CREATE INDEX "migration_runs_migration_id_started_at_idx" ON "public"."migration_runs"("migration_id", "started_at");

-- CreateIndex
CREATE INDEX "migration_runs_status_started_at_idx" ON "public"."migration_runs"("status", "started_at");

-- CreateIndex
CREATE INDEX "migration_runs_applied_by_id_started_at_idx" ON "public"."migration_runs"("applied_by_id", "started_at");

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."auth_events" ADD CONSTRAINT "auth_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admin_permission_grants" ADD CONSTRAINT "admin_permission_grants_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admin_permission_grants" ADD CONSTRAINT "admin_permission_grants_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "public"."admin_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portal_invitations" ADD CONSTRAINT "portal_invitations_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portal_invitations" ADD CONSTRAINT "portal_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organisation_addresses" ADD CONSTRAINT "organisation_addresses_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organisation_contacts" ADD CONSTRAINT "organisation_contacts_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organisation_contacts" ADD CONSTRAINT "organisation_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organisation_verifications" ADD CONSTRAINT "organisation_verifications_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organisation_verifications" ADD CONSTRAINT "organisation_verifications_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organisation_verifications" ADD CONSTRAINT "organisation_verifications_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "public"."admin_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."categories" ADD CONSTRAINT "categories_hero_document_id_fkey" FOREIGN KEY ("hero_document_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_families" ADD CONSTRAINT "product_families_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_specifications" ADD CONSTRAINT "product_specifications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_compatibilities" ADD CONSTRAINT "product_compatibilities_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scrap_grades" ADD CONSTRAINT "scrap_grades_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."grade_composition_attributes" ADD CONSTRAINT "grade_composition_attributes_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "public"."scrap_grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."grade_composition_attributes" ADD CONSTRAINT "grade_composition_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "public"."composition_attribute_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."grade_reference_sources" ADD CONSTRAINT "grade_reference_sources_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "public"."scrap_grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."grade_reference_sources" ADD CONSTRAINT "grade_reference_sources_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_profiles" ADD CONSTRAINT "supplier_profiles_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_profiles" ADD CONSTRAINT "supplier_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."buyer_profiles" ADD CONSTRAINT "buyer_profiles_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."buyer_profiles" ADD CONSTRAINT "buyer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."buyer_profiles" ADD CONSTRAINT "buyer_profiles_default_ship_to_id_fkey" FOREIGN KEY ("default_ship_to_id") REFERENCES "public"."organisation_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_listings" ADD CONSTRAINT "supplier_listings_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_listings" ADD CONSTRAINT "supplier_listings_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "public"."scrap_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_listings" ADD CONSTRAINT "supplier_listings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pricing_rule_sets" ADD CONSTRAINT "pricing_rule_sets_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tax_rules" ADD CONSTRAINT "tax_rules_component_code_fkey" FOREIGN KEY ("component_code") REFERENCES "public"."tax_components_ref"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tax_rules" ADD CONSTRAINT "tax_rules_jurisdiction_state_id_fkey" FOREIGN KEY ("jurisdiction_state_id") REFERENCES "public"."location_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tax_rules" ADD CONSTRAINT "tax_rules_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tax_treatments" ADD CONSTRAINT "tax_treatments_jurisdiction_state_id_fkey" FOREIGN KEY ("jurisdiction_state_id") REFERENCES "public"."location_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_access_log" ADD CONSTRAINT "document_access_log_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_access_log" ADD CONSTRAINT "document_access_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_access_log" ADD CONSTRAINT "document_access_log_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."migration_runs" ADD CONSTRAINT "migration_runs_applied_by_id_fkey" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."migration_runs" ADD CONSTRAINT "migration_runs_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

