# PRIMEMET — Task A unique-index audit and Task B business architecture mapping

Prepared 2026-11-01. Read-only analysis plus three new verification scripts. No database was initialized,
no live write occurred, no Atlas resource was created, `v001` was not modified, nothing was committed or
pushed.

---

## 1. Complete unique-index audit table

All **39 unique indexes** across the 45 collection definitions were enumerated programmatically
(`npm run audit:unique-indexes`), not by eye. Field requiredness is read from the validator each index's
collection actually ships, so the table cannot drift from the definitions.

| Collection | Index | Key fields | Optional key field(s) | Partial filter | Null/absent collision possible? | Verdict |
|---|---|---|---|---|---|---|
| users | ix_users_email_u | email | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| sessions | ix_sessions_tokenHash_u | tokenHash | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| portal_invitations | ix_portal_invitations_tokenHash_u | tokenHash | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| admin_profiles | ix_admin_profiles_userId_u | userId | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| admin_profiles | ix_admin_profiles_staffCode_u | staffCode | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| organisations | ix_organisations_gstin_u_p | gstin | gstin | `{gstin:{$type:"string"}}` | excluded | **SAFE_PARTIAL_ON_OPTIONAL_KEY** |
| organisations | ix_organisations_pan_u_p | pan | pan | `{pan:{$type:"string"}}` | excluded | **SAFE_PARTIAL_ON_OPTIONAL_KEY** |
| organisations | ix_organisations_orgType_u_p | orgType | — | `{orgType:"PRIMEMET",deletedAt:null}` | no | SAFE_ALL_KEYS_REQUIRED |
| supplier_profiles | ix_supplier_profiles_userId_u_p | userId | userId | `{userId:{$type:"string"}}` | excluded | **SAFE_PARTIAL_ON_OPTIONAL_KEY** |
| buyer_profiles | ix_buyer_profiles_userId_u_p | userId | userId | `{userId:{$type:"string"}}` | excluded | **SAFE_PARTIAL_ON_OPTIONAL_KEY** |
| reference_sequences | ix_reference_sequences_prefix_year_u | prefix, year | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| location_states | ix_location_states_code_u | code | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| pricing_rule_sets | ix_pricing_rule_sets_key_u_p | key | — | `{status:"ACTIVE"}` | no | SAFE_ALL_KEYS_REQUIRED |
| pricing_rule_sets | ix_pricing_rule_sets_key_version_u | key, version | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| tax_rules | ix_tax_rules_…_u_p | componentCode, transactionModel, invoiceRole, jurisdictionStateId, effectiveFrom | transactionModel, jurisdictionStateId | `{status:"ACTIVE"}` | **yes — intended** | **SAFE_INTENTIONAL_WILDCARD_COLLISION** |
| tax_treatments | (its unique index) | code, … | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| tax_components_ref | natural-key `_id` | _id | — | — | n/a (primary key) | SAFE |
| documents | ix_documents_storageKey_u | storageKey | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| categories | ix_categories_slug_u | slug | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| product_families | ix_product_families_slug_u | slug | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| products | ix_products_slug_u | slug | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| scrap_grades | ix_scrap_grades_slug_u | slug | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| scrap_grades | ix_scrap_grades_code_u | code | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| composition_attribute_defs | ix_composition_attribute_defs_symbol_u | symbol | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| grade_composition_attributes | ix_…_gradeId_attributeId_u | gradeId, attributeId | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| material_families | ix_material_families_slug_u / _code_u | slug / code | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| material_grades | ix_…_familyId_code_u / _slug_u | familyId+code / slug | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| materials | ix_materials_gradeId_u / _slug_u | gradeId / slug | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| product_types | ix_product_types_code_u | code | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| material_product_types | ix_…_materialId_productTypeId_u | both | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| material_product_types | ix_…_materialId_u_p | materialId | — | `{isPrimary:true}` | no | SAFE_ALL_KEYS_REQUIRED |
| material_aliases | ix_…_normalisedAlias_language_u | normalisedAlias, language | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| spec_templates | ix_spec_templates_code_u | code | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| spec_attributes | ix_spec_attributes_code_u | code | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| spec_template_attributes | ix_…_templateId_attributeId_u | both | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| search_intent_mappings | ix_…_normalisedPhrase_language_u | both | — | — | no | SAFE_ALL_KEYS_REQUIRED |
| inspection_method_refs | ix_inspection_method_refs_key_u | key | — | — | no | SAFE_ALL_KEYS_REQUIRED |

**Totals: 39 unique indexes · 0 defects · 0 needing review · 39 safe.**
(34 all-keys-required, 4 partial-over-the-optional-key, 1 intentional wildcard collision.)

The full machine-readable table is produced by `npm run audit:unique-indexes`.

### The four fields the brief asked to recheck

| Field | Required by validator? | BSON type | Unique index containing it | Correct? |
|---|---|---|---|---|
| `scrap_grades.code` | **yes** | `"string"` | `ix_scrap_grades_code_u`, plain unique | **Correct as-is.** A codeless grade is refused by the *validator* (error 121), so the index never receives a NULL. Proven in Q5c below. |
| `products.partNumber` | no | `["string","null"]` | **none** — only non-unique lookup indexes | **Correct as-is.** There is no uniqueness claim to break; many parts legitimately have no part number. |
| `organisations.gstin` | no | `["string","null"]` | `ix_organisations_gstin_u_p` with `$type:"string"` | **Correct as-is.** Already partial. |
| `organisations.pan` | no | `["string","null"]` | `ix_organisations_pan_u_p` with `$type:"string"` | **Correct as-is.** Already partial. |

---

## 2. Verdict on V002 — NOT needed, and deleted

**The proposal was wrong and I removed it** (`db/migrations/v002-partial-unique-indexes.proposed.mjs`).

It declared seven remediations — `scrap_grades.code`, `material_families.code`, `materials.slug`,
`product_types.code`, `spec_templates.code`, `spec_attributes.code`, and the composite
`material_product_types.productTypeId`. Every one of those fields is **required** in its validator, so
the hazard it was written to fix does not exist for them. The cross-check in the earlier audit run made
this explicit: `staleEntries` contained all 7, `missedDefects` named only the `tax_rules` wildcard keys.

Had it been registered, v002 would have added partial filters to indexes that already behave correctly —
changing 7 accepted, working indexes to satisfy a mistaken premise, which is precisely what the brief
forbids ("do not create a migration merely to change already-correct indexes").

**Recommendation:** delete, do not retain as a design note. Its premise is false, and keeping a file
whose own header asserts a defect that measurement disproves invites someone to re-register it later.
The knowledge it encoded now lives where it belongs: this document, §1–§3, plus the two harnesses.

---

## 3. Independent test evidence

Written for this task, from MongoDB's documented rules rather than from any project assertion. Both run
against throwaway in-memory replica sets; no project database is touched and nothing persists.

### `npm run verify:unique-index-semantics` — 17 passed, 0 failed

| Group | What it proves | Result |
|---|---|---|
| Q1 | first document without the key accepted; **second rejected with E11000** | PASS — the hazard is real *in general*, which is why the audit matters |
| Q2 | explicit BSON null collides the same way; a real string still coexists; duplicate strings still rejected | PASS (3 checks) |
| Q3 | `partialFilterExpression {$type:"string"}` lets absent **and** null documents coexist while preserving uniqueness among real strings | PASS (3 checks, count=4 stored) |
| Q4 | tax_rules behaviour, see below | PASS (6 checks) |
| Q5 | `scrap_grades.code` shape: distinct codes accepted, duplicate rejected, **codeless refused by the validator (121)** | PASS (3 checks) |

### `npm run verify:tax-rule-index` — 12 passed, 0 failed

Reproduces the real `tax_rules` validator and index exactly, then tests whether the optional key columns
cause an *unintended* conflict. They do not:

```
PASS  identical scope + same start date REJECTED (the intended uniqueness)      [11000]
PASS  same scope, later start date ALLOWED (a rate change must be possible)
PASS  specific model alongside the wildcard ALLOWED
PASS  a second specific model ALLOWED
PASS  specific state alongside the wildcard ALLOWED
PASS  different invoice role / different component ALLOWED
PASS  non-ACTIVE rows are excluded from the index entirely
PASS  all permitted rules stored   [count=10 expected=10]
```

Two ACTIVE wildcard rules for the same scope and day collide **by design**: `null` means "ANY", and two
ANY-rules for one period genuinely are ambiguous. This matches PostgreSQL's `COALESCE`-canonicalised
`EXCLUDE` semantics (architecture §15.5.2), so the index is correct and the naive static heuristic that
first flagged it was a **false positive**. `db/tax.mjs`'s transactional overlap check remains the
complement that catches range overlap across different start dates, which no index can express.

### Implementation-authored tests (re-run, reported separately — not independent acceptance)

| Command | Result |
|---|---|
| `npm run check:mongodb` | **81 passed, 0 failed** |
| `npm run check:migrations` | **74 passed, 0 failed** |
| `npm run check:enums` | **24 passed, 0 failed** |
| `npm run db:validate:offline` | **539 passed, 0 failed** |
| `npm run check:schema` (PostgreSQL/PGlite) | **61 passed, 0 failed** |

These were written by the same work they verify. The Q1–Q5 and tax-rule harnesses above are the
independent evidence for this task's conclusions.

---

## 4. Corrected Atlas runbook findings

Three corrections applied to `docs/PRIMEMET_ATLAS_SETUP.md`; everything else in it was confirmed against
the repository and left unchanged.

1. **§3 tier justification softened.** The statement that custom database roles are available *only* on
   dedicated clusters (M10+) could not be established from the cited page during this review. It is now
   recorded as an assumption with an instruction to confirm role availability in the Atlas UI before
   committing to a plan. The recommendation itself is unchanged — a transactional, majority-write workload
   needs a dedicated cluster regardless — only its stated justification was overstated.
2. **§3 table row rewritten** to match, pointing at the correction instead of repeating the claim.
3. **§4 role/user count clarified.** `db/roles.mjs` defines **three** roles (`primemet_app`,
   `primemet_owner`, `primemet_readonly`) and `buildRoleDefinitions()` provisions all three, but only
   **two** need an Atlas user at setup time. `primemet_readonly` stays unbound until a reporting consumer
   exists, because creating a user for it now adds a credential with no owner. Previously the runbook's
   "three roles, two users" split was easy to misread as an inconsistency.

Confirmed accurate and left as written: Mumbai region values, the `Project Settings → Database Users →
Specific Role(s) → Custom Role` binding path (the quick-create list genuinely omits custom roles), the
credential placement table, `MONGODB_DB` defaulting to `primemet` in all three readers, the dry-run
sequence and its expected output strings, and the Vercel egress entry still marked `[unverified]`.

---

## 5. Business architecture coverage matrix

Classified against the **45 collections that exist today**, using their actual fields and references.
"Supported" means data can be stored with integrity; none of these surfaces has a UI or API yet —
authentication is M2 and most screens remain labelled previews.

| # | Business requirement | Classification | Evidence in the 45 collections | What is missing |
|---|---|---|---|---|
| 1 | Scrap materials catalogue | **Already supported** | `categories` → `scrap_grades` (+ `code` unique, `publicationState`), `composition_attribute_defs`, `grade_composition_attributes` (min/max/target, basis, verification, isCritical, tolerancePct), `grade_reference_sources` | none structural |
| 2 | Industrial products catalogue | **Already supported** | `product_families` → `products` (partNumber, brand, condition, priceMode, publicationState), `product_specifications`, `product_compatibility` (with `verifiedAt` for fitment claims) | none structural |
| 3 | Canonical material identity across forms | **Already supported** | `material_families` → `material_grades` → `materials` (one per grade, unique `gradeId`), `product_types`, `material_product_types` (composite unique + one PRIMARY per material), `spec_templates`, `spec_attributes`, `spec_template_attributes` | none structural |
| 4 | Alias / designation resolution | **Already supported** | `material_aliases` (verbatim + derived normalised form, language, retirement), `material_alias_verifications` (append-only), `material_alias_equivalence_decisions` (append-only, supersedes chain) | D-1 approval link is application-enforced, not database-enforced (documented limitation) |
| 5 | Sellers / suppliers | **Already supported** | `organisations` (orgType, verificationStatus, isListable, gstin/pan partial-unique), `supplier_profiles` (capabilities, materialsHandled, geographicReach, monthlyCapacityKg, hasWeighbridge, hasTestingFacility, paymentTermsDays, creditTermsDays, ratingInternal) | no write path until M2 |
| 6 | Buyers | **Already supported** | `buyer_profiles` (industries, preferredGrades, typicalMonthlyKg, deliveryStates, creditLimit, approvalLimit) | no write path until M2 |
| 7 | Private supplier identities | **Already supported** | `organisation_contacts`, `organisation_addresses`, `documents` (visibility, sensitivity, scanStatus, legalHold, retentionUntil), `document_access_logs` (append-only), `audit_logs` | contact-sharing *approval* records are absent — see gap G-4 |
| 8 | Aggregate public supply counts | **Partially supported** | `supplier_listings` holds `quantityKg`, `gradeId`, `productId`, `locationCityId`, `availableFrom/To`, `status` — enough to compute counts | no published aggregate view, no cache/materialisation strategy, no privacy threshold (a count over one supplier can identify them). Needs a **design decision**, not a new collection |
| 9 | Buyer requirements / enquiries / sourcing cases | **Missing** | nothing — no `enquiries`, `enquiry_lines`, `clarifications`, `service_line` | requires future migration (architecture §5.5–5.9 already specifies it) |
| 10 | Supplier matching | **Missing** | `supplier_profiles.geographicReach`/`materialsHandled` and `buyer_profiles.deliveryStates`/`preferredGrades` are the inputs, but there is no match record | requires future migration; reuse existing profile fields rather than duplicating them |
| 11 | Commercial offers (supplier quotations) | **Missing** | no `supplier_quotes`, `supplier_quote_charges`, `supplier_quote_taxes` | requires future migration (§5.5–5.9) |
| 12 | Buyer-facing quotations + versions | **Missing** | no `buyer_quotes`, `buyer_quote_versions`, `buyer_quote_lines`; `pricing_rule_sets` and `tax_rules`/`tax_treatments` exist as the *inputs* | requires future migration; snapshots must freeze the rule ids |
| 13 | Orders and fulfilment | **Missing** | no `orders`, `order_cost_lines`, `invoices`, `payments`, `settlements`, lots, inspections, dispatch authorisation | requires future migration (§8.6) |
| 14 | Three public journeys ending in the private admin workflow | **Requires a design decision** | public pages and the enquiry wizard exist in the frontend; `users.role` carries BUYER/SELLER/ADMIN; `portal_invitations` supports seller/buyer onboarding | the journeys converge on a store that does not exist yet (row 9). Decision: do all three share one `enquiries` table with a `journey` discriminator, or separate tables? §5.5 currently assumes one |
| 15 | Centralized Admin Panel | **Already supported (data layer)** | `admin_profiles` (tier, mfaRequired, approvalLimit, isActive), `admin_permission_grants` (append-only GRANT/DENY with expiry), `audit_logs` | routes exist but are unguarded until M2 |
| 16 | Audit history | **Already supported** | `audit_logs`, `audit_log_failures` (a failed audit write is itself recorded), `auth_events`, `document_access_logs`, alias decision history — all append-only, protected by privilege | none structural |
| 17 | Privacy-safe public APIs | **Requires a design decision** | `documents.visibility`/`sensitivity` and the DTO allow-list discipline described in §6.2/§18 exist as policy | no public read API exists; internal cost/margin fields must never enter a public projection. Decision needed on which endpoints are public vs authenticated |
| 18 | Nationwide location coverage | **Partially supported** | `location_states` (code, countryCode, taxRegionCode, **isServiced**) | cities, districts and industrial areas are absent; `supplier_listings.locationCityId` is a free-form string with **no city table to reference** — a genuine referential gap |
| 19 | Destination-based sourcing | **Partially supported** | `buyer_profiles.deliveryStates`, `supplier_profiles.geographicReach`, `supplier_listings.locationCityId` | no coverage model linking a destination to candidate suppliers; depends on row 18 |
| 20 | SEO for city/district/state/country | **Missing** | Phase 3 technical SEO exists in the frontend (sitemap, robots, canonicals, JSON-LD); no `seo_pages`, aliases, publication lifecycle or geo hierarchy in the database | requires future migration (§19–§21 specify it) |
| 21 | Admin-controlled buyer/seller ratings | **Partially supported** | `supplier_profiles.ratingInternal` (single decimal, internal only) | no rating records, no admin approval workflow, no visibility control, no aggregation. Ratings are one scalar today — needs a design decision on model before migrating |
| 22 | Lead prioritization | **Missing** | nothing | requires future migration; depends on row 9 (an enquiry must exist before it can be scored) |
| 23 | Agency / principal / managed-supply transactions | **Already supported (reference layer)** | `TransactionModel` enum (PRINCIPAL, AGENCY, MANAGED_SUPPLY) is used by `tax_rules`, `tax_treatments` and `pricing_rule_sets`; INTERMEDIARY mapped to AGENCY per D4 | no order/enquiry rows carry the model yet — the enum is ready, the transaction tables are not (row 13) |
| 24 | Tax configuration per transaction | **Already supported** | `tax_components_ref` (names only, no rates seeded), `tax_rules` (effective-dated, scoped, ACTIVE-uniqueness), `tax_treatments` (requiresAdminReview) | rates await CA confirmation (O-15.5), not schema |

### Reuse opportunities — concepts that should NOT get their own collection

- **Journeys (row 14):** one `enquiries` table with a discriminator, not three. The catalogue already
  proves the pattern — `material_product_types` expands one material into five forms instead of five
  materials.
- **Supply counts (row 8):** computed from `supplier_listings`; a cached aggregate is a performance
  choice, not a new domain entity.
- **Matching (row 10):** `supplier_profiles.materialsHandled/geographicReach` × `buyer_profiles.
  preferredGrades/deliveryStates` are the join inputs; a `supplier_matches` record stores the *decision*,
  not a copy of the profile.
- **Ratings (row 21):** `ratingInternal` should become a derived summary over rating records rather than
  remaining a hand-edited scalar, and the records attach to existing `organisations`.
- **Location (row 18):** `location_states` already exists and is referenced by tax rules; cities and
  districts extend that hierarchy instead of introducing a parallel geography.

### Missing relationships worth naming now

1. `supplier_listings.locationCityId` → no target collection (dangling by design until row 18 lands).
2. `buyer_profiles` is referenced by **nothing**; `supplier_profiles` only by `supplier_listings`. Neither
   participates in a transaction relationship yet.
3. No FK-shaped reference from any pricing/tax object to a quotation or order — correct today (those
   tables don't exist), but snapshot freezing must be designed when they do.

---

## 6. Prioritized gaps and recommended implementation sequence

Ordered by dependency, not ambition. Nothing here starts until approved.

| Priority | Gap | Depends on | Milestone |
|---|---|---|---|
| P-1 | Enquiry / RFQ persistence (rows 9, 14, 22) — one table, journey discriminator, service line | M2 authentication | next |
| P-2 | Location hierarchy: `location_cities`, `location_districts`, `location_industrial_areas`, coverage status; then repoint `supplier_listings.locationCityId` | O-27.8 (which cities are genuinely serviced) | after P-1 |
| P-3 | Supplier matching + commercial offers (rows 10, 11) | P-1 | after P-2 |
| P-4 | Quotation versioning with frozen pricing/tax rule ids (row 12) | P-3, O-15.4a-P/O-15.5 CA answers | later |
| P-5 | Orders, invoices, payments, settlement (row 13) | P-4 | later |
| P-6 | Rating records + admin approval (row 21) | design decision first | later |
| P-7 | Contact-sharing approval records (row 7 completion) | design decision O-27.1 | later |
| P-8 | SEO page storage and publication lifecycle (row 20) | P-2 | Phase 2 of the SEO plan |
| P-9 | Public read APIs with DTO allow-lists (row 17) | P-1…P-5 | last |

---

## 7. Files changed and validation results

### Changed

| File | Change | Why |
|---|---|---|
| `scripts/audit-unique-indexes.mjs` | **new** | complete unique-index audit, generated from the definitions |
| `scripts/verify-unique-index-semantics.mjs` | **new** | independent proof of MongoDB null/partial behaviour (Q1–Q5) |
| `scripts/verify-tax-rule-index.mjs` | **new** | independent proof that `tax_rules` uniqueness is intended, not a defect |
| `package.json` | +3 scripts | make the three above runnable and discoverable |
| `docs/PRIMEMET_ATLAS_SETUP.md` | 3 targeted edits | the corrections in §4 above |
| `db/migrations/v002-partial-unique-indexes.proposed.mjs` | **created then deleted** | see §2 — the proposal was invalid; leaving it would invite re-registration |

No collection definition, validator, index, role, ledger, `v001` or application source file was modified.

### Validation

| Check | Result |
|---|---|
| `npm run audit:unique-indexes` | exit 0 — 45 collections, 39 unique indexes, **0 defects** |
| `npm run verify:unique-index-semantics` | exit 0 — **17 passed, 0 failed** |
| `npm run verify:tax-rule-index` | exit 0 — **12 passed, 0 failed** |
| `npm run typecheck` | exit 0 — 0 errors |
| `npm run lint` | exit 0 — 0 problems |
| `npm run build` | exit 0 — compiled, 81/81 pages |
| `npm run check:mongodb` | exit 0 — 81/0 |
| `npm run db:validate:offline` | exit 0 — 539/0 |

### Git and restrictions

Branch `main`, HEAD **`aec0f1b77879b9145d4197032c27bd1729a79e97`** — unchanged. Staged: **0**. Changed
paths: **104** (33 modified, 71 untracked), up from 100 at turn start by the three new scripts and this
report; the deleted proposal file left no trace because it was never committed.

No Atlas project or cluster was created. No database was initialized and no live database was written —
both harnesses ran on throwaway in-memory replica sets that were stopped. No credentials or secrets were
added anywhere. No business feature was implemented. `v001` is byte-identical. Nothing was committed,
pushed or deployed. All pre-existing uncommitted work is preserved.

### Remaining limitations

- The audit is a **static + behavioural** analysis of definitions. It cannot prove how indexes behave on
  a specific Atlas MongoDB version; the suites ran on `mongod` 7.0.14.
- Task B's classifications describe the data layer. With no authentication (M2) and no enquiry/order
  tables, most journeys remain frontend previews.
- Rows 8, 14, 17 and 21 are marked "requires a design decision" deliberately: inventing a schema for them
  now would contradict the brief's instruction not to assume every concept needs a collection.
- Vercel egress specifics in the runbook remain `[unverified]` from the previous phase.
