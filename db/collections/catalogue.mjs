/**
 * PRIMEMET — catalogue, composition and canonical identity collections.
 *
 * These 22 collections carry the rules the business cannot function without, so every one of them is
 * enforced by a MongoDB collection validator or a unique index rather than by convention:
 *
 *   - a grade code is unique WITHIN a family, so aluminium 6061 and 6063 stay distinct identities
 *     (a global unique code would also be wrong: different families reuse codes)
 *   - one canonical Material per MaterialGrade (the Phase 1 identity rule)
 *   - at most one PRIMARY product form per material (partial unique index — Phase 1 rule 4)
 *   - an alias is stored verbatim but matched by its derived normalised form, and the two may not
 *     disagree (Phase 1 rule 1)
 *   - VERIFIED requires a named verifier, a timestamp, a basis AND an approved equivalence decision
 *     for THAT alias (D-1 rule set — four independent gates, see material_aliases below)
 *   - money, rate and weight fields are BSON decimal, never double
 */

import { collection, f, ref, refOpt } from "../define.mjs";
import { ENUMS } from "../enums.mjs";

const PUB = () => f.enumOf("PublicationState", ENUMS);
const ts = { createdAt: f.date(), updatedAt: f.date() };

// ---------------------------------------------------------------------------
// Scrap catalogue (pre-Phase-1 tables, preserved field for field)
// ---------------------------------------------------------------------------

export const category = collection({
  name: "categories",
  model: "Category",
  notes:
    "Public scrap category. Unchanged from PostgreSQL except for _id and validator enforcement.",
  fields: {
    _id: f.uuid(),
    slug: f.str({ maxLength: 120 }),
    name: f.str({ maxLength: 160 }),
    kind: f.enumOf("CategoryKind", ENUMS),
    shortDescription: f.strOpt(),
    longDescription: f.strOpt(),
    heroDocumentId: refOpt("documents"),
    publishedAt: f.dateOpt(),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [{ keys: { slug: 1 }, unique: true }, { keys: { sortOrder: 1 } }],
  invariants: [{ rule: "slug is a URL segment", query: { slug: { $regex: "^[a-z0-9]+(-[a-z0-9]+)*$" } } }],
});

export const productFamily = collection({
  name: "product_families",
  model: "ProductFamily",
  fields: {
    _id: f.uuid(),
    categoryId: ref("categories"),
    slug: f.str({ maxLength: 120 }),
    name: f.str({ maxLength: 160 }),
    description: f.strOpt(),
    publicationState: PUB(),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [{ keys: { slug: 1 }, unique: true }, { keys: { categoryId: 1, sortOrder: 1 } }],
});

export const product = collection({
  name: "products",
  model: "Product",
  notes: "Spare-part product. publish requires published_at; a draft may omit it.",
  fields: {
    _id: f.uuid(),
    familyId: ref("product_families"),
    slug: f.str({ maxLength: 160 }),
    partNumber: f.strOpt(),
    alternateNumbers: f.strArray(),
    brand: f.strOpt(),
    manufacturer: f.strOpt(),
    title: f.str({ maxLength: 240 }),
    shortDescription: f.strOpt(),
    technicalSpecification: f.strOpt(),
    condition: f.enumOf("ProductCondition", ENUMS),
    priceMode: f.enumOf("PriceMode", ENUMS),
    // v006: an https image reference shown on the public catalogue and product detail page. Stored as
    // a URL rather than a file id because Phase 1 has no object storage; the admin form validates the
    // scheme and the public page refuses anything that is not https.
    imageUrl: f.strOpt({ maxLength: 500 }),
    // v007: an ordered gallery. Optional so a document written before v007 still validates; the
    // migration backfills [] so the editor never distinguishes "absent" from "empty". Each entry is a
    // plain https URL plus its alt text — no object store exists in Phase 1.
    images: {
      bsonType: "array",
      maxItems: 8,
      optional: true,
      items: f.object({
        url: f.str({ maxLength: 500 }),
        alt: f.strOpt({ maxLength: 200 }),
        sortOrder: f.int(),
      }),
    },
    publicationState: PUB(),
    publishedAt: f.dateOpt(),
    deletedAt: f.dateOpt(),
    ...ts,
  },
  indexes: [
    { keys: { slug: 1 }, unique: true },
    { keys: { familyId: 1, partNumber: 1 } },
    { keys: { partNumber: 1 } },
    // v007: the public listing sorts published products newest-first and filters by subcategory; the
    // admin list sorts by state. Both are the exact query shape the pages run.
    { keys: { publicationState: 1, publishedAt: -1 } },
    { keys: { familyId: 1, publicationState: 1 } },
  ],
});

export const productSpecification = collection({
  name: "product_specifications",
  model: "ProductSpecification",
  fields: {
    _id: f.uuid(),
    productId: ref("products"),
    attribute: f.str({ maxLength: 160 }),
    valueText: f.str({ maxLength: 500 }),
    unit: f.strOpt({ maxLength: 40 }),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [{ keys: { productId: 1, sortOrder: 1 } }],
});

export const productCompatibility = collection({
  name: "product_compatibility",
  model: "ProductCompatibility",
  notes: "A fitment claim. verifiedAt records that it was corroborated; unverified claims stay null.",
  fields: {
    _id: f.uuid(),
    productId: ref("products"),
    equipmentMake: f.str({ maxLength: 120 }),
    equipmentModel: f.str({ maxLength: 120 }),
    fitmentType: f.str({ maxLength: 80 }),
    sourceNote: f.strOpt(),
    verifiedAt: f.dateOpt(),
    ...ts,
  },
  indexes: [{ keys: { productId: 1, equipmentMake: 1, equipmentModel: 1 } }],
});

export const scrapGrade = collection({
  name: "scrap_grades",
  model: "ScrapGrade",
  notes:
    "Backward compatibility target: every pre-Phase-1 field is preserved with its original meaning. " +
    "material_id is the only addition, it is optional, and no row is backfilled — a legacy grade " +
    "keeps material_id absent until someone maps it deliberately.",
  fields: {
    _id: f.uuid(),
    categoryId: ref("categories"),
    slug: f.str({ maxLength: 120 }),
    code: f.str({ maxLength: 40 }),
    name: f.str({ maxLength: 160 }),
    shortDescription: f.strOpt(),
    tradeDescription: f.strOpt(),
    typicalOrigin: f.strOpt(),
    hazardClass: f.strOpt(),
    defaultPriceMode: f.enumOf("PriceMode", ENUMS),
    publicationState: PUB(),
    publishedAt: f.dateOpt(),
    materialId: refOpt("materials"),
    deletedAt: f.dateOpt(),
    ...ts,
  },
  indexes: [
    { keys: { slug: 1 }, unique: true },
    { keys: { code: 1 }, unique: true },
    { keys: { categoryId: 1 } },
    { keys: { materialId: 1 } },
    { keys: { publicationState: 1, publishedAt: 1 } },
  ],
  invariants: [
    { rule: "code is an identifier, not free text", query: { code: { $not: { $regex: "^\\s*$" } } } },
  ],
});

export const compositionAttributeDef = collection({
  name: "composition_attribute_defs",
  model: "CompositionAttributeDef",
  notes: "A declared-versus-tested element definition (e.g. Cr, Ni). Reference data only.",
  fields: {
    _id: f.uuid(),
    symbol: f.str({ maxLength: 12 }),
    name: f.str({ maxLength: 80 }),
    isElemental: f.bool(),
    canonicalUnit: f.enumOf("CompositionUnit", ENUMS),
    description: f.strOpt(),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [{ keys: { symbol: 1 }, unique: true }],
});

export const gradeCompositionAttribute = collection({
  name: "grade_composition_attributes",
  model: "GradeCompositionAttribute",
  notes:
    "Reference limits for a grade. These are LIMITS, not measurements: a measured value belongs to " +
    "an inspection record, which this milestone does not create.",
  fields: {
    _id: f.uuid(),
    gradeId: ref("scrap_grades"),
    attributeId: ref("composition_attribute_defs"),
    referenceMin: f.decimalOpt(),
    referenceMax: f.decimalOpt(),
    referenceTarget: f.decimalOpt(),
    basis: f.enumOf("CompositionBasis", ENUMS),
    unit: f.enumOf("CompositionUnit", ENUMS),
    verification: f.enumOf("VerificationStatus", ENUMS),
    isCritical: f.bool(),
    tolerancePct: f.decimalOpt(),
    sourceNote: f.strOpt(),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [
    { keys: { gradeId: 1, attributeId: 1 }, unique: true },
    { keys: { attributeId: 1 } },
  ],
  invariants: [
    {
      rule: "reference_min must not exceed reference_max",
      query: {
        $expr: {
          $or: [
            { $eq: [{ $type: "$referenceMin" }, "missing"] },
            { $eq: [{ $type: "$referenceMax" }, "missing"] },
            { $lte: ["$referenceMin", "$referenceMax"] },
          ],
        },
      },
    },
  ],
});

export const gradeReferenceSource = collection({
  name: "grade_reference_sources",
  model: "GradeReferenceSource",
  fields: {
    _id: f.uuid(),
    gradeId: ref("scrap_grades"),
    sourceType: f.str({ maxLength: 80 }),
    reference: f.strOpt(),
    documentId: refOpt("documents"),
    effectiveFrom: f.dateOpt(),
    effectiveTo: f.dateOpt(),
    ...ts,
  },
  indexes: [{ keys: { gradeId: 1 } }, { keys: { documentId: 1 } }],
});

export const inspectionMethodRef = collection({
  name: "inspection_method_refs",
  model: "InspectionMethodRef",
  notes: "Inspection methods. Names only — no method implies a scheduled inspection exists.",
  fields: {
    _id: f.uuid(),
    key: f.enumOf("InspectionMethod", ENUMS),
    label: f.str({ maxLength: 120 }),
    useNote: f.strOpt(),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [{ keys: { label: 1 }, unique: true }],
});

// ---------------------------------------------------------------------------
// Phase 1 — canonical identity: family → grade → material
// ---------------------------------------------------------------------------

export const materialFamily = collection({
  name: "material_families",
  model: "MaterialFamily",
  notes: "Aluminium, Stainless Steel, Copper … The family is the scope a grade code is unique within.",
  fields: {
    _id: f.uuid(),
    categoryId: refOpt("categories"),
    slug: f.str({ maxLength: 120 }),
    code: f.str({ maxLength: 40 }),
    name: f.str({ maxLength: 160 }),
    description: f.strOpt(),
    publicationState: PUB(),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [{ keys: { slug: 1 }, unique: true }, { keys: { code: 1 }, unique: true }],
  invariants: [{ rule: "code not blank", query: { code: { $not: { $regex: "^\\s*$" } } } }],
});

export const materialGrade = collection({
  name: "material_grades",
  model: "MaterialGrade",
  notes:
    "THE canonical grade identity. code is unique WITHIN a family, which is what keeps 6061 and 6063 " +
    "distinct: they are two codes in one family, and neither can be created twice. A cross-family " +
    "duplicate would be a legitimate separate identity (e.g. AISI 304 stainless vs an unrelated 304 " +
    "designation), which is why the uniqueness is scoped rather than global.",
  fields: {
    _id: f.uuid(),
    familyId: ref("material_families"),
    slug: f.str({ maxLength: 140 }),
    code: f.str({ maxLength: 40 }),
    name: f.str({ maxLength: 160 }),
    designation: f.strOpt(),
    unsNumber: f.strOpt(),
    standardBody: f.strOpt(),
    description: f.strOpt(),
    verification: f.enumOf("VerificationStatus", ENUMS),
    publicationState: PUB(),
    sortOrder: f.int(),
    deletedAt: f.dateOpt(),
    ...ts,
  },
  indexes: [
    { keys: { familyId: 1, code: 1 }, unique: true },
    { keys: { slug: 1 }, unique: true },
    { keys: { familyId: 1, sortOrder: 1 } },
    { keys: { verification: 1 } },
  ],
  invariants: [{ rule: "code not blank", query: { code: { $not: { $regex: "^\\s*$" } } } }],
});

export const material = collection({
  name: "materials",
  model: "Material",
  notes:
    "One canonical material per grade (grade_id unique) — the Phase 1 identity rule. A material is " +
    "expanded into product forms through material_product_types; the material itself is never " +
    "duplicated per form.",
  fields: {
    _id: f.uuid(),
    gradeId: ref("material_grades"),
    slug: f.str({ maxLength: 160 }),
    name: f.str({ maxLength: 200 }),
    summary: f.strOpt(),
    internalNote: f.strOpt(),
    publicationState: PUB(),
    sortOrder: f.int(),
    deletedAt: f.dateOpt(),
    ...ts,
  },
  indexes: [
    { keys: { gradeId: 1 }, unique: true },
    { keys: { slug: 1 }, unique: true },
    { keys: { publicationState: 1 } },
  ],
});

export const productType = collection({
  name: "product_types",
  model: "ProductType",
  notes: "Sheet, Plate, Pipe, Coil, Bar, Tube … The physical form a material is supplied in.",
  fields: {
    _id: f.uuid(),
    code: f.str({ maxLength: 40 }),
    name: f.str({ maxLength: 120 }),
    description: f.strOpt(),
    isActive: f.bool(),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [{ keys: { code: 1 }, unique: true }],
});

export const materialProductType = collection({
  name: "material_product_types",
  model: "MaterialProductType",
  notes:
    "A material in a physical form, optionally bound to its own spec template. Five forms of 304 are " +
    "five rows here and ONE material — which is what stops 'stainless 304 pipe' becoming a duplicate " +
    "material. Phase 1 rule 4: at most one PRIMARY form per material, enforced by a partial unique " +
    "index (MongoDB cannot express it inline, so it is declared with partialFilterExpression).",
  fields: {
    _id: f.uuid(),
    materialId: ref("materials"),
    productTypeId: ref("product_types"),
    specTemplateId: refOpt("spec_templates"),
    isPrimary: f.bool(),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [
    { keys: { materialId: 1, productTypeId: 1 }, unique: true },
    { keys: { materialId: 1 }, unique: true, partialFilterExpression: { isPrimary: true } },
    { keys: { productTypeId: 1 } },
  ],
});

// ---------------------------------------------------------------------------
// Aliases, verification history and D-1 equivalence governance
// ---------------------------------------------------------------------------

/**
 * D-1 equivalence governance — what the database can and cannot do.
 *
 * The rule is: a `VERIFIED` alias needs an APPROVED equivalence decision that belongs to THIS alias
 * and whose basis matches. That is a CROSS-DOCUMENT rule, and a MongoDB collection validator cannot
 * express one: `$jsonSchema` ", " and `$expr` only ever see the document being written. There is no
 * `$lookup`, no subquery and no trigger.
 *
 * The previous design tried to bridge that by copying the decision onto the alias as
 * `equivalenceGate { decisionId, aliasId, status, basis }` and validating the copy. The independent
 * audit showed why that fails: the copy is written by whoever writes the alias, so a direct write
 * carrying a self-asserted gate was ACCEPTED while the referenced decision was REJECTED and belonged
 * to a different alias. Nothing ever read the real decision. A copy of an immutable value cannot go
 * stale — but it can be forged, which is the failure that matters.
 *
 * So the copy is GONE. There is no longer a field whose value can be asserted by a writer in place of
 * the decision itself. What remains, stated precisely, is three layers:
 *
 *   1. WRITE PATH — `verifyAlias()` in db/refs.mjs is the only supported route to VERIFIED. It reads
 *      the real decision inside the same transaction and refuses a rejected, pending, borrowed,
 *      cross-basis, evidence-free or reviewer-less approval.
 *   2. DETECTION — `reconcileVerifiedAliases()` in db/verify.mjs compares every stored VERIFIED alias
 *      with its actual decision. `npm run db:verify` and every `db:init` run execute it, so a write
 *      that bypassed layer 1 is reported as a failure rather than living on as trusted data.
 *   3. PRIVILEGES — the runtime role cannot write history collections and is not the owner role; owner
 *      credentials are never deployed (db/roles.mjs, .env.example).
 *
 * What this collection's validator DOES enforce, at the server, on every write: shape, types, enum
 * membership, derived normalisation, retirement timestamps, and the same-document precondition that a
 * VERIFIED alias carries a verifier, a timestamp, a basis and a decision id. Those are necessary; none
 * of them is sufficient, and this comment is the honest statement of which layer supplies the rest.
 */
export const materialAlias = collection({
  name: "material_aliases",
  model: "MaterialAlias",
  notes:
    "Alias phrase → canonical material. Stored verbatim, matched by normalised_alias, which the " +
    "database pins to lower(trim(alias)). Retirement is timestamped and never deletes the phrase.",
  fields: {
    _id: f.uuid(),
    materialId: ref("materials"),
    alias: f.str({ maxLength: 200 }),
    normalisedAlias: f.str({ maxLength: 200 }),
    language: f.str({ maxLength: 12 }),
    source: f.strOpt(),
    verification: f.enumOf("VerificationStatus", ENUMS),
    verifiedById: refOpt("users"),
    verifiedAt: f.dateOpt(),
    equivalenceBasis: f.enumOpt("EquivalenceBasis", ENUMS),
    equivalenceDecisionId: refOpt("material_alias_equivalence_decisions"),
    isRetired: f.bool(),
    retiredAt: f.dateOpt(),
    retiredReason: f.strOpt(),
    ...ts,
  },
  indexes: [
    // One phrase maps to one material per language (Phase 1 rule 5).
    { keys: { normalisedAlias: 1, language: 1 }, unique: true },
    { keys: { materialId: 1 } },
    { keys: { equivalenceDecisionId: 1 } },
    { keys: { verification: 1, isRetired: 1 } },
  ],
  invariants: [
    {
      rule: "normalised_alias is derived: normalised_alias = lower(trim(alias))",
      query: {
        $expr: { $eq: ["$normalisedAlias", { $toLower: { $trim: { input: "$alias" } } }] },
      },
    },
    { rule: "alias is not blank", query: { alias: { $not: { $regex: "^\\s*$" } } } },
    {
      rule: "retired requires retired_at",
      query: {
        // A retirement must carry a real timestamp. Testing only for "not missing" accepted an
        // explicit null, which is the same as having no timestamp at all.
        $expr: {
          $or: [{ $eq: ["$isRetired", false] }, { $eq: [{ $type: "$retiredAt" }, "date"] }],
        },
      },
    },
    {
      rule: "VERIFIED requires a named verifier and a verification timestamp",
      query: {
        $or: [
          { verification: { $ne: "VERIFIED" } },
          { $and: [{ verifiedById: { $type: "string" } }, { verifiedAt: { $type: "date" } }] },
        ],
      },
    },
    {
      rule: "VERIFIED requires an equivalence basis and an equivalence decision",
      query: {
        $or: [
          { verification: { $ne: "VERIFIED" } },
          {
            $and: [
              { equivalenceBasis: { $type: "string" } },
              { equivalenceDecisionId: { $type: "string" } },
            ],
          },
        ],
      },
    },
  ],
});

export const materialAliasVerification = collection({
  name: "material_alias_verifications",
  model: "MaterialAliasVerification",
  immutable: true,
  notes:
    "Append-only verification history (D-2). The DAO exposes insert and find only, and the deployment " +
    "provisions the application role without update/delete on this collection " +
    "(db/provision-roles.mjs). No before-update trigger exists in MongoDB, so privilege separation " +
    "is the control that replaces the PostgreSQL trigger.",
  fields: {
    _id: f.uuid(),
    aliasId: ref("material_aliases"),
    decision: f.enumOf("AliasDecision", ENUMS),
    previousVerification: f.enumOpt("VerificationStatus", ENUMS),
    newVerification: f.enumOf("VerificationStatus", ENUMS),
    decidedById: refOpt("users"),
    decidedAt: f.date(),
    note: f.strOpt(),
    evidenceDocumentId: refOpt("documents"),
    createdAt: f.date(),
  },
  indexes: [{ keys: { aliasId: 1, decidedAt: -1 } }, { keys: { decidedById: 1 } }],
  invariants: [
    {
      rule: "a VERIFIED history entry requires the decider who made it",
      query: {
        $or: [
          { newVerification: { $ne: "VERIFIED" } },
          { decidedById: { $type: "string" } },
        ],
      },
    },
  ],
});

export const materialAliasEquivalenceDecision = collection({
  name: "material_alias_equivalence_decisions",
  model: "MaterialAliasEquivalenceDecision",
  immutable: true,
  notes:
    "D-1. The review behind an equivalence claim, kept append-only so a superseded or rejected review " +
    "survives as evidence. APPROVED requires a technical reference or an evidence document, which is " +
    "what makes 'missing evidence stays PENDING' a database rule rather than a promise.",
  fields: {
    _id: f.uuid(),
    aliasId: ref("material_aliases"),
    basis: f.enumOf("EquivalenceBasis", ENUMS),
    status: f.enumOf("EquivalenceDecisionStatus", ENUMS),
    technicalReference: f.strOpt(),
    evidenceDocumentId: refOpt("documents"),
    reviewedById: refOpt("users"),
    reviewedAt: f.dateOpt(),
    notes: f.strOpt(),
    supersedesDecisionId: refOpt("material_alias_equivalence_decisions"),
    createdAt: f.date(),
  },
  indexes: [
    { keys: { aliasId: 1, createdAt: -1 } },
    { keys: { status: 1 } },
    { keys: { supersedesDecisionId: 1 } },
  ],
  invariants: [
    {
      rule: "a decided review (APPROVED or REJECTED) requires reviewer, date and a non-blank note",
      query: {
        $or: [
          { status: "PENDING" },
          {
            $and: [
              { reviewedById: { $type: "string" } },
              { reviewedAt: { $type: "date" } },
              { notes: { $regex: "\\S" } },
            ],
          },
        ],
      },
    },
    {
      rule: "APPROVED requires a technical reference or an evidence document",
      query: {
        $or: [
          { status: { $ne: "APPROVED" } },
          {
            $or: [
              { technicalReference: { $regex: "\\S" } },
              { evidenceDocumentId: { $type: "string" } },
            ],
          },
        ],
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Specification templates, attributes and search-intent mapping
// ---------------------------------------------------------------------------

export const specTemplate = collection({
  name: "spec_templates",
  model: "SpecTemplate",
  notes: "A spec template belongs to a product form, so 304 sheet and 304 pipe can ask for different data.",
  fields: {
    _id: f.uuid(),
    code: f.str({ maxLength: 60 }),
    name: f.str({ maxLength: 160 }),
    description: f.strOpt(),
    productTypeId: refOpt("product_types"),
    isActive: f.bool(),
    ...ts,
  },
  indexes: [{ keys: { code: 1 }, unique: true }, { keys: { productTypeId: 1 } }],
});

export const specAttribute = collection({
  name: "spec_attributes",
  model: "SpecAttribute",
  fields: {
    _id: f.uuid(),
    code: f.str({ maxLength: 60 }),
    label: f.str({ maxLength: 160 }),
    dataType: f.enumOf("SpecAttributeDataType", ENUMS),
    canonicalUnit: f.strOpt({ maxLength: 40 }),
    description: f.strOpt(),
    sortOrder: f.int(),
    ...ts,
  },
  indexes: [{ keys: { code: 1 }, unique: true }],
});

export const specTemplateAttribute = collection({
  name: "spec_template_attributes",
  model: "SpecTemplateAttribute",
  fields: {
    _id: f.uuid(),
    templateId: ref("spec_templates"),
    attributeId: ref("spec_attributes"),
    isRequired: f.bool(),
    sortOrder: f.int(),
    allowedValues: f.strArray(),
    defaultValue: f.strOpt(),
    ...ts,
  },
  indexes: [{ keys: { templateId: 1, attributeId: 1 }, unique: true }],
});

export const searchIntentMapping = collection({
  name: "search_intent_mappings",
  model: "SearchIntentMapping",
  notes:
    "Phrase → material/product form, for the Phase 2 programme. It maps an intent; it does not create " +
    "a page, and nothing here publishes anything.",
  fields: {
    _id: f.uuid(),
    phrase: f.str({ maxLength: 200 }),
    normalisedPhrase: f.str({ maxLength: 200 }),
    language: f.str({ maxLength: 12 }),
    intentType: f.enumOf("SearchIntentType", ENUMS),
    verification: f.enumOf("VerificationStatus", ENUMS),
    materialId: refOpt("materials"),
    productTypeId: refOpt("product_types"),
    notes: f.strOpt(),
    ...ts,
  },
  indexes: [
    { keys: { normalisedPhrase: 1, language: 1 }, unique: true },
    { keys: { materialId: 1 } },
  ],
  invariants: [
    { rule: "phrase not blank", query: { phrase: { $not: { $regex: "^\\s*$" } } } },
    {
      rule: "normalised_phrase is derived: lower(trim(phrase))",
      query: {
        $expr: { $eq: ["$normalisedPhrase", { $toLower: { $trim: { input: "$phrase" } } }] },
      },
    },
  ],
});

export const CATALOGUE_COLLECTIONS = [
  category,
  productFamily,
  product,
  productSpecification,
  productCompatibility,
  scrapGrade,
  compositionAttributeDef,
  gradeCompositionAttribute,
  gradeReferenceSource,
  inspectionMethodRef,
  materialFamily,
  materialGrade,
  material,
  productType,
  materialProductType,
  materialAlias,
  materialAliasVerification,
  materialAliasEquivalenceDecision,
  specTemplate,
  specAttribute,
  specTemplateAttribute,
  searchIntentMapping,
];