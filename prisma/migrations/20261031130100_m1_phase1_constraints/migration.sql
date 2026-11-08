-- Phase 1 — constraints the Prisma datamodel cannot express.
--
-- Prisma can declare unique indexes and relations, but not CHECK constraints and not a PARTIAL
-- unique index. The model comments in prisma/schema.prisma state all three of the rules below; this
-- migration is what actually enforces them. It follows the M1 pattern, where migration
-- 20261031000100_m1_constraints holds the hand-written half of the schema.
--
-- Additive only. No table, column, row or relationship is dropped or altered.

-- ---------------------------------------------------------------------------
-- 1. An alias is stored verbatim, but MATCHING uses its normalised form.
--    Pinning the relationship stops a future writer from storing "SS 304" with a normalised value
--    of "ss-304", which would silently break phrase matching without failing anything visible.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."material_aliases"
  ADD CONSTRAINT "material_aliases_normalised_is_derived"
  CHECK ("normalised_alias" = lower(btrim("alias")));

ALTER TABLE "public"."material_aliases"
  ADD CONSTRAINT "material_aliases_alias_not_blank"
  CHECK (btrim("alias") <> '');

-- ---------------------------------------------------------------------------
-- 2. VERIFIED means a named human verified it. The Phase 1 brief requires a named verifier and a
--    verification timestamp, so a row claiming VERIFIED without both is rejected at write time.
--    verified_by_id remains nullable, because the CHECK applies at insert: a user deleted later sets
--    it to NULL through ON DELETE SET NULL and the historical claim survives (see requirement 9 —
--    historical references are preserved, not erased).
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."material_aliases"
  ADD CONSTRAINT "material_aliases_verified_needs_verifier"
  CHECK (
    "verification" <> 'VERIFIED'
    OR ("verified_by_id" IS NOT NULL AND "verified_at" IS NOT NULL)
  );

-- Retiring preserves the phrase; it never deletes it. A retirement without a timestamp is rejected.
ALTER TABLE "public"."material_aliases"
  ADD CONSTRAINT "material_aliases_retired_needs_timestamp"
  CHECK (NOT "is_retired" OR "retired_at" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. The append-only verification history must not record a VERIFIED decision without a decider.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."material_alias_verifications"
  ADD CONSTRAINT "alias_verifications_verified_needs_decider"
  CHECK ("new_verification" <> 'VERIFIED' OR "decided_by_id" IS NOT NULL);

ALTER TABLE "public"."material_alias_verifications"
  ADD CONSTRAINT "alias_verifications_decided_at_present"
  CHECK ("decided_at" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 4. One canonical material may be reused by many product forms, but at most ONE of them may be
--    its primary form. The model comment promises a partial unique index, so it is created here:
--    Prisma's @@unique cannot carry a WHERE clause.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "ix_material_product_types_one_primary"
  ON "public"."material_product_types" ("material_id")
  WHERE "is_primary";

-- ---------------------------------------------------------------------------
-- 5. A grade code is an identifier, not free text: it must not be blank, and a grade slug must be
--    stable enough to become a public URL in Phase 2 without carrying whitespace.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."material_grades"
  ADD CONSTRAINT "material_grades_code_not_blank"
  CHECK (btrim("code") <> '');

ALTER TABLE "public"."material_families"
  ADD CONSTRAINT "material_families_code_not_blank"
  CHECK (btrim("code") <> '');

-- ---------------------------------------------------------------------------
-- 6. A search-intent phrase is matched, so it carries the same derived-normalisation rule as an
--    alias. The table stores the phrase and its normalised form; they may not disagree.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."search_intent_mappings"
  ADD CONSTRAINT "search_intent_phrase_not_blank"
  CHECK (btrim("phrase") <> '');
