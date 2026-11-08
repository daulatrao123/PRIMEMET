-- Phase 1 — canonical material / product-type / alias / specification catalogue.
-- Generated: prisma migrate diff (frozen M1 snapshot -> Phase 1 schema).
-- Additive only: 11 CREATE TABLE, 3 CREATE TYPE, 30 indexes, 18 FK constraints.
-- The single change to a pre-existing table is scrap_grades.material_id (nullable,
-- no default, ON DELETE SET NULL): every existing ScrapGrade row and relationship
-- remains valid and unbackfilled by design.

-- CreateEnum
CREATE TYPE "public"."spec_attribute_data_type" AS ENUM ('TEXT', 'NUMERIC', 'BOOLEAN', 'ENUMERATION', 'RANGE');

-- CreateEnum
CREATE TYPE "public"."alias_decision" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."search_intent_type" AS ENUM ('MATERIAL', 'PRODUCT_TYPE', 'SPECIFICATION', 'PROCESS', 'LOCATION', 'TRANSACTIONAL', 'NAVIGATIONAL');

-- AlterTable
ALTER TABLE "public"."scrap_grades" ADD COLUMN     "material_id" UUID;

-- CreateTable
CREATE TABLE "public"."material_families" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "publication_state" "public"."publication_state" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_grades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "uns_number" TEXT,
    "standard_body" TEXT,
    "description" TEXT,
    "verification" "public"."verification_status" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "publication_state" "public"."publication_state" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "material_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grade_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "internal_note" TEXT,
    "publication_state" "public"."publication_state" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_product_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "material_id" UUID NOT NULL,
    "product_type_id" UUID NOT NULL,
    "spec_template_id" UUID,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_product_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "material_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalised_alias" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "source" TEXT,
    "verification" "public"."verification_status" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "is_retired" BOOLEAN NOT NULL DEFAULT false,
    "retired_at" TIMESTAMPTZ(6),
    "retired_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."material_alias_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "alias_id" UUID NOT NULL,
    "decision" "public"."alias_decision" NOT NULL,
    "previous_verification" "public"."verification_status",
    "new_verification" "public"."verification_status" NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
    "evidence_document_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_alias_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."spec_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "product_type_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spec_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."spec_attributes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data_type" "public"."spec_attribute_data_type" NOT NULL,
    "canonical_unit" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spec_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."spec_template_attributes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "allowed_values" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_value" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spec_template_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."search_intent_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phrase" TEXT NOT NULL,
    "normalised_phrase" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "intent_type" "public"."search_intent_type" NOT NULL,
    "material_id" UUID,
    "product_type_id" UUID,
    "verification" "public"."verification_status" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_intent_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_families_slug_key" ON "public"."material_families"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "material_families_code_key" ON "public"."material_families"("code");

-- CreateIndex
CREATE INDEX "ix_material_families_category" ON "public"."material_families"("category_id", "publication_state", "sort_order");

-- CreateIndex
CREATE INDEX "ix_material_families_pub" ON "public"."material_families"("publication_state", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "material_grades_slug_key" ON "public"."material_grades"("slug");

-- CreateIndex
CREATE INDEX "ix_material_grades_pub" ON "public"."material_grades"("publication_state", "sort_order");

-- CreateIndex
CREATE INDEX "ix_material_grades_verification" ON "public"."material_grades"("verification");

-- CreateIndex
CREATE UNIQUE INDEX "uq_material_grades_family_code" ON "public"."material_grades"("family_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "materials_grade_id_key" ON "public"."materials"("grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "materials_slug_key" ON "public"."materials"("slug");

-- CreateIndex
CREATE INDEX "ix_materials_pub" ON "public"."materials"("publication_state", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_types_code_key" ON "public"."product_types"("code");

-- CreateIndex
CREATE INDEX "ix_product_types_active" ON "public"."product_types"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "ix_material_product_types_ptype" ON "public"."material_product_types"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_material_product_types_template" ON "public"."material_product_types"("spec_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_material_product_types" ON "public"."material_product_types"("material_id", "product_type_id");

-- CreateIndex
CREATE INDEX "ix_material_aliases_material" ON "public"."material_aliases"("material_id");

-- CreateIndex
CREATE INDEX "ix_material_aliases_verification" ON "public"."material_aliases"("verification", "is_retired");

-- CreateIndex
CREATE UNIQUE INDEX "uq_material_aliases_normalised" ON "public"."material_aliases"("normalised_alias", "language");

-- CreateIndex
CREATE INDEX "ix_alias_verifications_alias" ON "public"."material_alias_verifications"("alias_id", "decided_at");

-- CreateIndex
CREATE UNIQUE INDEX "spec_templates_code_key" ON "public"."spec_templates"("code");

-- CreateIndex
CREATE INDEX "ix_spec_templates_ptype" ON "public"."spec_templates"("product_type_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "spec_attributes_code_key" ON "public"."spec_attributes"("code");

-- CreateIndex
CREATE INDEX "ix_spec_attributes_sort" ON "public"."spec_attributes"("sort_order");

-- CreateIndex
CREATE INDEX "ix_spec_template_attributes_attribute" ON "public"."spec_template_attributes"("attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_spec_template_attributes" ON "public"."spec_template_attributes"("template_id", "attribute_id");

-- CreateIndex
CREATE INDEX "ix_search_intents_type" ON "public"."search_intent_mappings"("intent_type");

-- CreateIndex
CREATE INDEX "ix_search_intents_material" ON "public"."search_intent_mappings"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_search_intent_phrases" ON "public"."search_intent_mappings"("normalised_phrase", "language");

-- CreateIndex
CREATE INDEX "ix_scrap_grades_material" ON "public"."scrap_grades"("material_id");

-- AddForeignKey
ALTER TABLE "public"."scrap_grades" ADD CONSTRAINT "scrap_grades_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_families" ADD CONSTRAINT "material_families_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_grades" ADD CONSTRAINT "material_grades_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."material_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."materials" ADD CONSTRAINT "materials_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "public"."material_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_product_types" ADD CONSTRAINT "material_product_types_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_product_types" ADD CONSTRAINT "material_product_types_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_product_types" ADD CONSTRAINT "material_product_types_spec_template_id_fkey" FOREIGN KEY ("spec_template_id") REFERENCES "public"."spec_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_aliases" ADD CONSTRAINT "material_aliases_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_aliases" ADD CONSTRAINT "material_aliases_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_alias_verifications" ADD CONSTRAINT "material_alias_verifications_alias_id_fkey" FOREIGN KEY ("alias_id") REFERENCES "public"."material_aliases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_alias_verifications" ADD CONSTRAINT "material_alias_verifications_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."material_alias_verifications" ADD CONSTRAINT "material_alias_verifications_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."spec_templates" ADD CONSTRAINT "spec_templates_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."spec_template_attributes" ADD CONSTRAINT "spec_template_attributes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."spec_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."spec_template_attributes" ADD CONSTRAINT "spec_template_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "public"."spec_attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."search_intent_mappings" ADD CONSTRAINT "search_intent_mappings_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."search_intent_mappings" ADD CONSTRAINT "search_intent_mappings_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

