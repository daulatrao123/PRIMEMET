/**
 * Phase 1 — the read-only catalogue sections.
 *
 * One list, in one place, so the shared catalogue navigation, the page titles and the route
 * parameter check cannot drift apart. Adding a section is a single entry here.
 *
 * Scope note: every section is READ-ONLY. Phase 1 has no authentication or role-based
 * authorisation (that is M2), so exposing create/update/delete would publish an unauthenticated
 * write surface for catalogue data. Each section therefore describes the future record shape and
 * states plainly that nothing is stored yet.
 *
 * Sensitive-data rule: these sections describe the catalogue only. They never contain supplier
 * cost, margin, or inspection documents, and they must not, because the same data model is shared
 * with public pages.
 */

export interface CatalogueSection {
  /** URL segment under /admin/catalogue/ — stable, lowercase, hyphenated. */
  slug: string;
  /** Page and navigation label. */
  title: string;
  /** One-line purpose, used on the section page and in the index. */
  summary: string;
  /** The database table(s) this section will be backed by when persistence lands. */
  tables: string[];
  /** What the stored record will hold, in reading order. */
  fields: { name: string; type: string; note?: string }[];
  /** Rules the stored version must enforce, stated so they are not rediscovered at M2. */
  rules: string[];
}

export const CATALOGUE_SECTIONS: CatalogueSection[] = [
  {
    slug: "materials",
    title: "Materials",
    summary: "The canonical commercial material — one row per grade, reused by every product form.",
    tables: ["materials", "material_grades", "material_families"],
    fields: [
      { name: "slug", type: "text, unique", note: "Becomes the public URL in Phase 2." },
      { name: "name", type: "text" },
      { name: "grade_id", type: "uuid → material_grades", note: "Unique: one material per grade." },
      { name: "summary", type: "text?" },
      { name: "internal_note", type: "text?", note: "Staff only. Never rendered as a technical claim." },
      { name: "publication_state", type: "PUBLISHED | DRAFT | ARCHIVED" },
    ],
    rules: [
      "One canonical material per grade — the database enforces it with a unique grade_id.",
      "Product form is a relationship, never a duplicate material.",
      "No price, stock or availability column: availability changes independently of identity.",
    ],
  },
  {
    slug: "families",
    title: "Material families",
    summary: "The metallurgical grouping above grades — stainless steel, aluminium, copper alloys.",
    tables: ["material_families"],
    fields: [
      { name: "slug / code", type: "text, both unique" },
      { name: "name", type: "text" },
      { name: "category_id", type: "uuid? → categories", note: "Optional link to the existing public taxonomy." },
      { name: "publication_state", type: "PUBLISHED | DRAFT | ARCHIVED" },
      { name: "sort_order", type: "integer" },
    ],
    rules: [
      "No second taxonomy: a family may reference the existing public category.",
      "Codes are identifiers — blank is rejected by a CHECK constraint.",
    ],
  },
  {
    slug: "grades",
    title: "Grades",
    summary: "General material grades (304, 6061, C36000) — distinct from ScrapGrade.",
    tables: ["material_grades", "scrap_grades"],
    fields: [
      { name: "family_id", type: "uuid → material_families" },
      { name: "code", type: "text", note: "Family-local: 304, 6061, C36000." },
      { name: "designation", type: "text?" },
      { name: "uns_number", type: "text?" },
      { name: "standard_body", type: "text?", note: "AISI, ASTM, EN, IS, AA." },
      { name: "verification", type: "VerificationStatus" },
    ],
    rules: [
      "A general grade is a reference identity; a ScrapGrade is a tradable catalogue entry.",
      "scrap_grades.material_id links a tradable grade to its general grade — nullable, never required.",
      "Deleting a material sets the link to NULL; it never deletes a ScrapGrade.",
    ],
  },
  {
    slug: "product-types",
    title: "Product types",
    summary: "The form a material is traded in: sheet, plate, pipe, coil, bar, forging stock.",
    tables: ["product_types", "material_product_types"],
    fields: [
      { name: "code", type: "text, unique", note: "SHEET, PLATE, PIPE, COIL, BAR." },
      { name: "name", type: "text" },
      { name: "is_active", type: "boolean", note: "False hides the form from new quotations." },
      { name: "material_product_types.spec_template_id", type: "uuid? → spec_templates" },
    ],
    rules: [
      "A reference list, not an enum, so a new form needs no migration.",
      "At most one primary form per material — enforced by a partial unique index.",
      "The same (material, form) pair cannot repeat.",
    ],
  },
  {
    slug: "aliases",
    title: "Aliases",
    summary: "How the market writes a material's name, and whether that phrase has been verified.",
    tables: ["material_aliases", "material_alias_verifications"],
    fields: [
      { name: "alias", type: "text", note: "Stored verbatim, as written by the source." },
      { name: "normalised_alias", type: "text", note: "lower(btrim(alias)); a CHECK pins the derivation." },
      { name: "language", type: "text, default 'en'" },
      { name: "verification", type: "NOT_SUBMITTED | PENDING | UNDER_REVIEW | VERIFIED | REJECTED | EXPIRED" },
      { name: "verified_by_id / verified_at", type: "uuid? / timestamptz?" },
      { name: "is_retired / retired_at / retired_reason", type: "boolean / timestamptz? / text?" },
    ],
    rules: [
      "VERIFIED requires a named verifier AND a timestamp — a CHECK rejects the claim otherwise.",
      "Uniqueness is (normalised_alias, language): one phrase, one language, one material.",
      "Aliases are retired, never deleted, so an old quotation stays readable.",
      "Only VERIFIED, non-retired aliases may appear in published content.",
      "Every decision is appended to material_alias_verifications with its decider.",
    ],
  },
  {
    slug: "spec-templates",
    title: "Specification templates",
    summary: "The ordered attribute set that applies to one material and product form.",
    tables: ["spec_templates", "spec_template_attributes"],
    fields: [
      { name: "code", type: "text, unique" },
      { name: "product_type_id", type: "uuid? → product_types" },
      { name: "attributes", type: "via spec_template_attributes", note: "Ordered, each attribute once." },
    ],
    rules: [
      "A template belongs to a product form, so sheet and pipe specifications differ structurally.",
      "The same attribute cannot appear twice in one template.",
    ],
  },
  {
    slug: "attributes",
    title: "Attributes",
    summary: "The individual measurable fields a specification can contain.",
    tables: ["spec_attributes"],
    fields: [
      { name: "code", type: "text, unique" },
      { name: "name", type: "text" },
      { name: "unit", type: "text?" },
      { name: "data_type", type: "text" },
    ],
    rules: [
      "An attribute is defined once and reused across templates.",
      "Values are never stored on the attribute definition itself.",
    ],
  },
  {
    slug: "search-intents",
    title: "Search intents",
    summary: "The phrasing buyers actually use, mapped to a material, a form or a specification.",
    tables: ["search_intent_mappings"],
    fields: [
      { name: "phrase / normalised_phrase", type: "text", note: "Unique with language." },
      { name: "intent_type", type: "MATERIAL | PRODUCT_TYPE | SPECIFICATION | PROCESS | LOCATION | TRANSACTIONAL | NAVIGATIONAL" },
      { name: "material_id / product_type_id", type: "uuid? — at least one target" },
    ],
    rules: [
      "A phrase maps to one language-specific intent; blank phrases are rejected.",
      "An unverified alias must not be used as the basis of a published intent.",
    ],
  },
  {
    slug: "seo-content",
    title: "SEO content",
    summary: "Nothing is stored yet — Phase 2 owns page generation and publication.",
    tables: [],
    fields: [
      { name: "—", type: "—", note: "No SEO page table exists. Phase 2 defines it." },
    ],
    rules: [
      "Phase 1 implements no programmatic page generation and no AI content.",
      "Canonicals, sitemap and robots are handled by Phase 3 and must not be duplicated here.",
    ],
  },
];

export function findSection(slug: string): CatalogueSection | undefined {
  return CATALOGUE_SECTIONS.find((section) => section.slug === slug);
}