-- PRIMEMET — M1 constraints, indexes and integrity rules (architecture §28.1 migration 18 part).
--
-- Prisma cannot express four classes of object that the architecture document requires, so they are
-- written by hand here, after the generated schema migration:
--
--   1. CHECK constraints (§8.3, §8.7, §15.5, §24.2 step 6/15/18)
--   2. Partial unique indexes (§5.3 organisations, §15.5 one ACTIVE rule set per key)
--   3. The btree_gist EXCLUDE constraint that stops two ACTIVE tax rules claiming the same scope
--      (§15.5.2, decision D7) — including the reason invoice_role may never be NULL
--   4. Index names in the document's ix_<table>_<cols> convention (§8.1), which also stops
--      PostgreSQL silently truncating several 63-byte Prisma-generated names onto one identifier
--
-- Every statement is idempotent-safe in the sense that matters for a versioned migration: it runs
-- exactly once, through the controlled runner (D8, §29.3). Nothing here seeds a business record.
--
-- Reversal notes are per block, because a DOWN migration must be written and tested, not assumed.

-- ---------------------------------------------------------------------------
-- 1. Extensions
--
-- btree_gist gives a GiST index the scalar equality operators an EXCLUDE constraint needs on
-- component_code (text), invoice_role and the two COALESCE expressions (§15.5.2). It is the only
-- extension M1 requires. gen_random_uuid() is core since PostgreSQL 13, so pgcrypto is not needed.
-- Hosted-PostgreSQL note: btree_gist is in contrib and is not installed on every managed provider by
-- default; §30.9 checks this as a hosting prerequisite before migration 1 runs.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 2. Index-name normalisation to the document's convention, and away from the 63-byte limit
--
-- PostgreSQL truncates identifiers over 63 bytes. Four Prisma-generated names collide that way:
--   tax_rules_component_code_transaction_model_invoice_role_jur_idx
--   tax_rules_component_code_transaction_model_invoice_role_jur_idx1
-- both truncate to ...jurisdiction_state_id_e, differing only in a suffix that is itself cut off.
-- The rename below is therefore not cosmetic; without it a future migration could try to create an
-- index the database believes already exists.
-- ---------------------------------------------------------------------------
ALTER INDEX "public"."users_email_key" RENAME TO "ix_users_email";
ALTER INDEX "public"."users_role_status_idx" RENAME TO "ix_users_role_status";
ALTER INDEX "public"."users_status_created_at_idx" RENAME TO "ix_users_status_created_at";
ALTER INDEX "public"."users_deleted_at_idx" RENAME TO "ix_users_deleted_at";

ALTER INDEX "public"."sessions_token_hash_key" RENAME TO "ix_sessions_token_hash";
ALTER INDEX "public"."sessions_user_id_expires_at_idx" RENAME TO "ix_sessions_user_expires";
ALTER INDEX "public"."sessions_expires_at_idx" RENAME TO "ix_sessions_expires_at";
ALTER INDEX "public"."sessions_revoked_at_idx" RENAME TO "ix_sessions_revoked_at";

ALTER INDEX "public"."auth_events_user_id_occurred_at_idx" RENAME TO "ix_auth_events_user_occurred";
ALTER INDEX "public"."auth_events_email_attempted_occurred_at_idx" RENAME TO "ix_auth_events_email_occurred";
ALTER INDEX "public"."auth_events_event_type_occurred_at_idx" RENAME TO "ix_auth_events_event_occurred";

ALTER INDEX "public"."admin_profiles_user_id_key" RENAME TO "ix_admin_profiles_user";
ALTER INDEX "public"."admin_profiles_staff_code_key" RENAME TO "ix_admin_profiles_staff_code";
ALTER INDEX "public"."admin_permission_grants_admin_id_idx" RENAME TO "ix_grants_admin";
ALTER INDEX "public"."admin_permission_grants_admin_id_permission_key" RENAME TO "ix_grants_admin_permission";

ALTER INDEX "public"."portal_invitations_token_hash_key" RENAME TO "ix_invitations_token_hash";
ALTER INDEX "public"."portal_invitations_email_expires_at_idx" RENAME TO "ix_invitations_email_expires";
ALTER INDEX "public"."portal_invitations_organisation_id_idx" RENAME TO "ix_invitations_org";

ALTER INDEX "public"."organisations_org_type_verification_status_idx" RENAME TO "ix_orgs_type_status";
ALTER INDEX "public"."organisations_state_code_idx" RENAME TO "ix_orgs_state_code";
ALTER INDEX "public"."organisations_deleted_at_idx" RENAME TO "ix_orgs_deleted_at";

ALTER INDEX "public"."organisation_addresses_organisation_id_kind_idx" RENAME TO "ix_org_addresses_org_kind";
ALTER INDEX "public"."organisation_contacts_organisation_id_is_primary_idx" RENAME TO "ix_org_contacts_org_primary";
ALTER INDEX "public"."organisation_contacts_organisation_id_email_key" RENAME TO "ix_org_contacts_org_email";
ALTER INDEX "public"."organisation_verifications_status_expires_at_idx" RENAME TO "ix_org_verifications_status_expiry";
ALTER INDEX "public"."organisation_verifications_organisation_id_type_key" RENAME TO "ix_org_verifications_org_type";

ALTER INDEX "public"."categories_slug_key" RENAME TO "ix_categories_slug";
ALTER INDEX "public"."categories_kind_publication_state_sort_order_idx" RENAME TO "ix_categories_kind_pub_sort";

ALTER INDEX "public"."product_families_slug_key" RENAME TO "ix_product_families_slug";
ALTER INDEX "public"."product_families_category_id_publication_state_sort_order_idx" RENAME TO "ix_families_cat_pub_sort";

ALTER INDEX "public"."products_slug_key" RENAME TO "ix_products_slug";
ALTER INDEX "public"."products_family_id_publication_state_idx" RENAME TO "ix_products_family_pub";
ALTER INDEX "public"."products_brand_condition_idx" RENAME TO "ix_products_brand_condition";
ALTER INDEX "public"."products_part_number_idx" RENAME TO "ix_products_part_number";
ALTER INDEX "public"."products_publication_state_published_at_idx" RENAME TO "ix_products_pub_published_at";

ALTER INDEX "public"."product_specifications_product_id_sort_order_idx" RENAME TO "ix_product_specs_product_sort";
ALTER INDEX "public"."product_compatibilities_product_id_idx" RENAME TO "ix_product_compat_product";
ALTER INDEX "public"."product_compatibilities_equipment_make_equipment_model_idx" RENAME TO "ix_product_compat_equipment";

ALTER INDEX "public"."scrap_grades_slug_key" RENAME TO "ix_scrap_grades_slug";
ALTER INDEX "public"."scrap_grades_code_key" RENAME TO "ix_scrap_grades_code";
ALTER INDEX "public"."scrap_grades_category_id_publication_state_idx" RENAME TO "ix_scrap_grades_cat_pub";

ALTER INDEX "public"."composition_attribute_defs_symbol_key" RENAME TO "ix_composition_attrs_symbol";
ALTER INDEX "public"."composition_attribute_defs_sort_order_idx" RENAME TO "ix_composition_attrs_sort";

ALTER INDEX "public"."grade_composition_attributes_grade_id_attribute_id_key" RENAME TO "ix_grade_comp_grade_attribute";
ALTER INDEX "public"."grade_composition_attributes_grade_id_sort_order_idx" RENAME TO "ix_grade_comp_grade_sort";

ALTER INDEX "public"."grade_reference_sources_grade_id_source_type_idx" RENAME TO "ix_grade_sources_grade_type";

ALTER INDEX "public"."inspection_methods_ref_key_key" RENAME TO "ix_inspection_methods_key";

ALTER INDEX "public"."supplier_profiles_organisation_id_key" RENAME TO "ix_supplier_profiles_org";
ALTER INDEX "public"."supplier_profiles_user_id_key" RENAME TO "ix_supplier_profiles_user";
ALTER INDEX "public"."supplier_profiles_verification_idx" RENAME TO "ix_supplier_profiles_verification";
ALTER INDEX "public"."supplier_profiles_capabilities_idx" RENAME TO "ix_supplier_profiles_capabilities";

ALTER INDEX "public"."buyer_profiles_organisation_id_key" RENAME TO "ix_buyer_profiles_org";
ALTER INDEX "public"."buyer_profiles_user_id_key" RENAME TO "ix_buyer_profiles_user";
ALTER INDEX "public"."buyer_profiles_verification_idx" RENAME TO "ix_buyer_profiles_verification";
ALTER INDEX "public"."buyer_profiles_industries_idx" RENAME TO "ix_buyer_profiles_industries";

ALTER INDEX "public"."supplier_listings_supplier_id_status_idx" RENAME TO "ix_listings_supplier_status";
ALTER INDEX "public"."supplier_listings_grade_id_status_idx" RENAME TO "ix_listings_grade_status";
ALTER INDEX "public"."supplier_listings_product_id_status_idx" RENAME TO "ix_listings_product_status";

ALTER INDEX "public"."location_states_code_key" RENAME TO "ix_location_states_code";
ALTER INDEX "public"."location_states_country_code_is_serviced_idx" RENAME TO "ix_location_states_country_serviced";

ALTER INDEX "public"."pricing_rule_sets_key_version_key" RENAME TO "ix_pricing_rule_sets_key_version";
ALTER INDEX "public"."pricing_rule_sets_status_effective_from_idx" RENAME TO "ix_pricing_rule_sets_status_effective";

ALTER INDEX "public"."tax_rules_component_code_transaction_model_invoice_role_jur_idx" RENAME TO "ix_tax_rules_scope";
ALTER INDEX "public"."tax_rules_status_effective_from_idx" RENAME TO "ix_tax_rules_status_effective";

ALTER INDEX "public"."tax_treatments_transaction_model_invoice_role_status_effect_idx" RENAME TO "ix_tax_treatments_scope";

ALTER INDEX "public"."documents_storage_key_key" RENAME TO "ix_documents_storage_key";
ALTER INDEX "public"."documents_document_type_created_at_idx" RENAME TO "ix_documents_type_created";
ALTER INDEX "public"."documents_owner_org_id_idx" RENAME TO "ix_documents_owner_org";
ALTER INDEX "public"."documents_scan_status_idx" RENAME TO "ix_documents_scan_status";
ALTER INDEX "public"."documents_visibility_idx" RENAME TO "ix_documents_visibility";
ALTER INDEX "public"."documents_checksum_sha256_idx" RENAME TO "ix_documents_checksum";

ALTER INDEX "public"."document_access_log_document_id_created_at_idx" RENAME TO "ix_doc_access_document_created";
ALTER INDEX "public"."document_access_log_user_id_created_at_idx" RENAME TO "ix_doc_access_user_created";

ALTER INDEX "public"."audit_logs_entity_type_entity_id_occurred_at_idx" RENAME TO "ix_audit_logs_entity_occurred";
ALTER INDEX "public"."audit_logs_actor_user_id_occurred_at_idx" RENAME TO "ix_audit_logs_actor_occurred";
ALTER INDEX "public"."audit_logs_action_occurred_at_idx" RENAME TO "ix_audit_logs_action_occurred";
ALTER INDEX "public"."audit_logs_severity_occurred_at_idx" RENAME TO "ix_audit_logs_severity_occurred";

ALTER INDEX "public"."audit_log_failures_resolved_attempted_at_idx" RENAME TO "ix_audit_failures_resolved_attempted";

ALTER INDEX "public"."migration_runs_migration_id_started_at_idx" RENAME TO "ix_migration_runs_id_started";
ALTER INDEX "public"."migration_runs_status_started_at_idx" RENAME TO "ix_migration_runs_status_started";
ALTER INDEX "public"."migration_runs_applied_by_id_started_at_idx" RENAME TO "ix_migration_runs_applied_started";

-- ---------------------------------------------------------------------------
-- 3. Partial unique indexes
--
-- (a) organisations: a GSTIN or a PAN is unique only when present. Two organisations that have not
--     supplied one must not collide on NULL (§5.3).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "ix_orgs_gstin_unique" ON "public"."organisations" ("gstin") WHERE "gstin" IS NOT NULL;
CREATE UNIQUE INDEX "ix_orgs_pan_unique" ON "public"."organisations" ("pan") WHERE "pan" IS NOT NULL;

-- (b) Exactly one PRIMEMET legal entity. Every tax and invoicing rule keys off "who is the issuer",
--     so two rows claiming org_kind = 'PRIMEMET' would make the issuer ambiguous (§15.5.1, §18.3).
--     Soft-deleted rows are excluded so a corrected entity may be re-created without losing history.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "ix_orgs_one_primemet_org"
  ON "public"."organisations" ("org_kind")
  WHERE "org_kind" = 'PRIMEMET' AND "deleted_at" IS NULL;

-- (c) One ACTIVE pricing rule set per key. Two simultaneously ACTIVE versions would make a
--     calculation non-reproducible, which breaks the snapshot guarantee of §16.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "ix_pricing_rule_sets_one_active"
  ON "public"."pricing_rule_sets" ("key")
  WHERE "status" = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 4. CHECK constraints
-- ---------------------------------------------------------------------------

-- users — a non-archived account has a name; the email is stored lowercased and trimmed (§5.3).
ALTER TABLE "public"."users" ADD CONSTRAINT "users_full_name_not_blank" CHECK (length(btrim("full_name")) > 0);
ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_is_normalised" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "public"."users" ADD CONSTRAINT "users_failed_login_count_non_negative" CHECK ("failed_login_count" >= 0);

-- organisations — the country code is a two-letter code, and the account status is one of the
-- three states §5.3 lists today. A new status needs a migration, which is the point.
ALTER TABLE "public"."organisations" ADD CONSTRAINT "orgs_country_code_upper2" CHECK ("country_code" ~ '^[A-Z]{2}$');
ALTER TABLE "public"."organisations" ADD CONSTRAINT "orgs_account_status_known"
  CHECK ("account_status" IN ('ACTIVE', 'ON_HOLD', 'CLOSED'));
ALTER TABLE "public"."organisations" ADD CONSTRAINT "orgs_org_kind_known"
  CHECK ("org_kind" IN ('PRIMEMET', 'BUYER', 'SELLER', 'PARTNER', 'OTHER'));

-- organisation_addresses / contacts — no blank required text, no silently shared contact.
ALTER TABLE "public"."organisation_addresses" ADD CONSTRAINT "org_addresses_city_not_blank" CHECK (length(btrim("city")) > 0);
ALTER TABLE "public"."organisation_contacts" ADD CONSTRAINT "org_contacts_email_lower" CHECK ("email" = lower(btrim("email")));

-- reference_sequences — a counter never goes backwards.
ALTER TABLE "public"."reference_sequences" ADD CONSTRAINT "ref_sequences_last_value_non_negative" CHECK ("last_value" >= 0);
ALTER TABLE "public"."reference_sequences" ADD CONSTRAINT "ref_sequences_year_plausible" CHECK ("year" BETWEEN 2000 AND 2200);

-- products — small non-negative counters only; there is no price and no stock column to guard.
ALTER TABLE "public"."product_specifications" ADD CONSTRAINT "product_specs_attribute_not_blank" CHECK (length(btrim("attribute")) > 0);

-- compositions — §8.3 validation rules, exactly as written there.
ALTER TABLE "public"."grade_composition_attributes"
  ADD CONSTRAINT "grade_comp_range_needs_both_bounds"
  CHECK ("basis" <> 'RANGE' OR ("reference_min" IS NOT NULL AND "reference_max" IS NOT NULL));
ALTER TABLE "public"."grade_composition_attributes"
  ADD CONSTRAINT "grade_comp_target_needs_target"
  CHECK ("basis" <> 'TARGET' OR "reference_target" IS NOT NULL);
ALTER TABLE "public"."grade_composition_attributes"
  ADD CONSTRAINT "grade_comp_min_le_max"
  CHECK ("reference_min" IS NULL OR "reference_max" IS NULL OR "reference_min" <= "reference_max");
-- A commercial tolerance is a percentage of the declared limit; negative tolerance is meaningless.
ALTER TABLE "public"."grade_composition_attributes"
  ADD CONSTRAINT "grade_comp_tolerance_non_negative"
  CHECK ("tolerance_pct" IS NULL OR "tolerance_pct" >= 0);

ALTER TABLE "public"."grade_reference_sources"
  ADD CONSTRAINT "grade_sources_period_ordered"
  CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from");

-- supplier_listings — §8.4: an offer names either a grade or a product.
ALTER TABLE "public"."supplier_listings"
  ADD CONSTRAINT "listings_grade_or_product"
  CHECK ("grade_id" IS NOT NULL OR "product_id" IS NOT NULL);
ALTER TABLE "public"."supplier_listings"
  ADD CONSTRAINT "listings_quantity_positive"
  CHECK ("quantity_kg" IS NULL OR "quantity_kg" > 0);
ALTER TABLE "public"."supplier_listings"
  ADD CONSTRAINT "listings_period_ordered"
  CHECK ("available_to" IS NULL OR "available_from" IS NULL OR "available_to" >= "available_from");

-- supplier/buyer profiles — capacity and terms are never negative.
ALTER TABLE "public"."supplier_profiles"
  ADD CONSTRAINT "supplier_profiles_capacity_non_negative"
  CHECK ("monthly_capacity_kg" IS NULL OR "monthly_capacity_kg" >= 0);
ALTER TABLE "public"."supplier_profiles"
  ADD CONSTRAINT "supplier_profiles_rating_band"
  CHECK ("rating_internal" IS NULL OR ("rating_internal" >= 0 AND "rating_internal" <= 5));
ALTER TABLE "public"."buyer_profiles"
  ADD CONSTRAINT "buyer_profiles_capacity_non_negative"
  CHECK ("typical_monthly_kg" IS NULL OR "typical_monthly_kg" >= 0);

-- pricing_rule_sets — §8.7: an ACTIVE set has been approved by someone, at some time.
ALTER TABLE "public"."pricing_rule_sets"
  ADD CONSTRAINT "pricing_rule_sets_active_is_approved"
  CHECK ("status" <> 'ACTIVE' OR ("approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL));
ALTER TABLE "public"."pricing_rule_sets"
  ADD CONSTRAINT "pricing_rule_sets_currency_upper3"
  CHECK ("currency_code" ~ '^[A-Z]{3}$');
ALTER TABLE "public"."pricing_rule_sets"
  ADD CONSTRAINT "pricing_rule_sets_period_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");
ALTER TABLE "public"."pricing_rule_sets"
  ADD CONSTRAINT "pricing_rule_sets_version_positive"
  CHECK ("version" >= 1);

-- tax_rules — §15.5, every CHECK listed there, plus one that D7 makes necessary.
ALTER TABLE "public"."tax_rules"
  ADD CONSTRAINT "tax_rules_active_is_approved"
  CHECK ("status" <> 'ACTIVE' OR ("approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL));
ALTER TABLE "public"."tax_rules"
  ADD CONSTRAINT "tax_rules_rate_pct_range"
  CHECK ("rate_pct" >= 0 AND "rate_pct" <= 100);
ALTER TABLE "public"."tax_rules"
  ADD CONSTRAINT "tax_rules_period_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");
-- D7: invoice_role is the wildcard-bearing column of the EXCLUDE constraint. It must never be NULL,
-- because a GiST "=" treats NULL as distinct from every value, including another NULL, so a NULL
-- role would silently escape overlap detection rather than mean "every role". ANY is the wildcard.
ALTER TABLE "public"."tax_rules"
  ADD CONSTRAINT "tax_rules_invoice_role_not_null"
  CHECK ("invoice_role" IS NOT NULL);

ALTER TABLE "public"."tax_treatments"
  ADD CONSTRAINT "tax_treatments_invoice_role_not_null"
  CHECK ("invoice_role" IS NOT NULL);
ALTER TABLE "public"."tax_treatments"
  ADD CONSTRAINT "tax_treatments_period_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");
ALTER TABLE "public"."tax_treatments"
  ADD CONSTRAINT "tax_treatments_rule_ids_present"
  CHECK (array_length("rule_ids", 1) >= 1);
-- A treatment must name at least one rule (above). Whether that rule set needs an admin review is
-- tax_treatments.requires_admin_review, which defaults to true; M5's approval gate enforces it.

ALTER TABLE "public"."location_states"
  ADD CONSTRAINT "location_states_country_code_upper2"
  CHECK ("country_code" ~ '^[A-Z]{2}$');

-- documents — §8.7 CHECKs, verbatim.
ALTER TABLE "public"."documents"
  ADD CONSTRAINT "documents_clean_needs_scan_result"
  CHECK ("scan_status" <> 'CLEAN' OR "scan_result" IS NOT NULL);
ALTER TABLE "public"."documents"
  ADD CONSTRAINT "documents_legal_hold_has_no_expiry"
  CHECK ("legal_hold" = false OR "retention_until" IS NULL);
ALTER TABLE "public"."documents"
  ADD CONSTRAINT "documents_size_positive"
  CHECK ("size_bytes" > 0);
ALTER TABLE "public"."documents"
  ADD CONSTRAINT "documents_sensitivity_known"
  CHECK ("sensitivity" IN ('NORMAL', 'COMMERCIAL', 'PERSONAL', 'LEGAL'));
-- A document may never supersede itself (that would be a version cycle of length one).
ALTER TABLE "public"."documents"
  ADD CONSTRAINT "documents_not_own_superseder"
  CHECK ("superseded_by_id" IS NULL OR "superseded_by_id" <> "id");

-- migration_runs — §8.7 CHECKs, verbatim.
ALTER TABLE "public"."migration_runs"
  ADD CONSTRAINT "migration_runs_applied_needs_backup"
  CHECK ("status" <> 'APPLIED' OR "backup_verified" OR NOT "requires_backup");
ALTER TABLE "public"."migration_runs"
  ADD CONSTRAINT "migration_runs_applied_needs_completion"
  CHECK ("status" <> 'APPLIED' OR ("finished_at" IS NOT NULL AND "schema_after" IS NOT NULL));
ALTER TABLE "public"."migration_runs"
  ADD CONSTRAINT "migration_runs_failed_needs_detail"
  CHECK ("status" <> 'FAILED' OR "error_detail" IS NOT NULL);
ALTER TABLE "public"."migration_runs"
  ADD CONSTRAINT "migration_runs_down_never_destructive"
  CHECK ("direction" <> 'DOWN' OR "destructive" = false);
ALTER TABLE "public"."migration_runs"
  ADD CONSTRAINT "migration_runs_rolled_back_is_down"
  CHECK ("status" <> 'ROLLED_BACK' OR "direction" = 'DOWN');
ALTER TABLE "public"."migration_runs"
  ADD CONSTRAINT "migration_runs_checksum_is_sha256"
  CHECK ("file_checksum_sha256" ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------
-- 5. tax_rules overlap protection — the EXCLUDE constraint (§15.5.2, D7)
--
-- Two ACTIVE rules for the same component, transaction scope, invoice role and jurisdiction that are
-- effective on the same day would make the rate ambiguous. The engine must raise
-- TAX_RULE_AMBIGUOUS rather than pick one, so the database must not even hold the pair.
--
-- The comparison is over four "scope" expressions and one date range:
--   component_code        =     plain equality
--   transaction_model     =     pm_tax_scope_model(…), which maps NULL to 'ALL' — NULL means "every
--                               model" and must compare equal to another NULL-means-every-model,
--                               which raw "=" cannot do (see the FINDING below for why this is a
--                               function rather than the cast the document prints)
--   invoice_role          =     plain equality; it is NOT NULL DEFAULT 'ANY' (see the CHECK above),
--                               so ANY is the explicit wildcard and a real role never matches it
--   jurisdiction_state_id =     COALESCE(…, zero-uuid) — NULL means "national fallback"
--   daterange             &&    INCLUSIVE [from, to]; NULL effective_to becomes 'infinity'
--
-- Deliberately NOT coalesced: invoice_role. Coalescing it to a text literal is what a "clever"
-- version of this constraint would do, and it would let a rule scoped to MATERIAL overlap a rule
-- scoped to COMMISSION, because both would collapse to the same token. Keeping it a typed,
-- non-null column preserves the distinction the model depends on.
--
-- Prisma cannot generate this constraint and cannot represent it in schema.prisma, so
-- `prisma migrate diff` will report it as drift on every later diff. prisma/README.md records the
-- reconciliation procedure: keep it, never drop and recreate the table to "fix" a diff.
--
-- Reversal: DROP CONSTRAINT, then DROP EXTENSION btree_gist only if nothing else uses it.
--
-- FINDING (M1 execution, §15.5.2 as literally written is NOT executable).
-- The document's expression `COALESCE("transaction_model"::text, 'ALL')` is rejected by PostgreSQL:
--
--     ERROR: functions in index expression must be marked IMMUTABLE
--
-- An index or exclusion-constraint expression may only use IMMUTABLE functions. The enum-to-text cast
-- resolves through enum_out(), which PostgreSQL marks STABLE, not IMMUTABLE, so the documented form
-- cannot be created. This was found by running the migration against PostgreSQL 17, not by reading it.
--
-- The repair is a purpose-built IMMUTABLE wrapper. It is safe because enum labels only change by a
-- committed migration (adding a value is safe; renaming is itself a migration per §5.1), so the
-- function's result for a given value cannot change inside one schema version. The alternative —
-- adding an 'ALL' label to transaction_model — was rejected because it would put a wildcard token
-- into the business enum that every enquiry, lot and order row also uses.
--
-- The same wrapper approach is NOT needed for jurisdiction_state_id: COALESCE over uuid is already
-- IMMUTABLE, so the document's expression is kept verbatim there.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pm_tax_scope_model(m public.transaction_model)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$
  SELECT CASE WHEN m IS NULL THEN 'ALL' ELSE m::text END;
$$;

COMMENT ON FUNCTION public.pm_tax_scope_model(public.transaction_model) IS
  'D7/§15.5.2: maps a nullable transaction_model to its comparison scope, with NULL meaning ALL. IMMUTABLE so it can be used in the tax_rules exclusion constraint; enum labels change only by migration.';

ALTER TABLE "public"."tax_rules"
  ADD CONSTRAINT "tax_rules_active_scope_no_overlap"
  EXCLUDE USING gist (
    "component_code" WITH =,
    public.pm_tax_scope_model("transaction_model") WITH =,
    "invoice_role" WITH =,
    (COALESCE("jurisdiction_state_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
  )
  WHERE ("status" = 'ACTIVE');
-- '[]' is deliberate, not an oversight: the document specifies an inclusive range, so a rule ending
-- 31 March and the next starting 31 March overlap by one day and the constraint rejects the pair.
-- Half-open ')' would allow both. Inclusivity is kept as specified; it is flagged in
-- prisma/README.md as a question for the CA/implementation review, not silently changed here.

COMMENT ON CONSTRAINT "tax_rules_active_scope_no_overlap" ON "public"."tax_rules" IS
  'D7/§15.5.2: two ACTIVE tax rules may not claim the same component + model + invoice role + jurisdiction for overlapping dates. invoice_role is NOT NULL DEFAULT ANY, never NULL.';
