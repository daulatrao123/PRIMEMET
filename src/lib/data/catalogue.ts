import { randomUUID } from "node:crypto";
import type { AppDb } from "@/lib/db";

import { writeAuditLog } from "@/lib/auth/audit";
import type { AuthUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { slugify } from "@/lib/validation";
import { requireAdminActor } from "./authorise";
import { dataOr } from "./db-safe";

/**
 * Catalogue reads and writes.
 *
 * The public read path and the admin read path are separate functions on purpose. A buyer-facing query
 * projects only published products and only the fields that may be shown; there is no `internalNotes`
 * or cost field in `PublicProduct` at all, so a future template change cannot print one by accident.
 */

export type PublicationState = "DRAFT" | "PUBLISHED" | "ARCHIVED";

/** One gallery image. A plain https reference plus alt text — Phase 1 has no object store. */
export interface ProductImage {
  url: string;
  alt: string | null;
  sortOrder: number;
}

/** One row of the technical specification table, ordered as the admin arranged it. */
export interface ProductSpecificationRow {
  attribute: string;
  value: string;
  unit: string | null;
  sortOrder: number;
}

/** A refusal the admin UI can show verbatim: a rule of the catalogue, not a crash. */
export class CatalogueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogueError";
  }
}

const MAX_IMAGES = 8;

export interface PublicProduct {
  id: string;
  slug: string;
  title: string;
  partNumber: string | null;
  brand: string | null;
  manufacturer: string | null;
  shortDescription: string | null;
  technicalSpecification: string | null;
  imageUrl: string | null;
  images: ProductImage[];
  condition: string;
  priceMode: string;
  publishedAt: Date | null;
  categoryName: string | null;
  categorySlug: string | null;
  familyName: string | null;
}

interface ProductDoc {
  _id: string;
  familyId: string;
  slug: string;
  partNumber?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  title: string;
  shortDescription?: string | null;
  technicalSpecification?: string | null;
  imageUrl?: string | null;
  images?: ProductImage[] | null;
  condition: string;
  priceMode: string;
  publicationState: PublicationState;
  publishedAt?: Date | null;
  deletedAt?: Date | null;
  createdAt: Date;
}

interface FamilyDoc {
  _id: string;
  categoryId: string;
  slug: string;
  name: string;
  publicationState: string;
  sortOrder: number;
}

interface CategoryDoc {
  _id: string;
  slug: string;
  name: string;
  kind: string;
  shortDescription?: string | null;
  publishedAt?: Date | null;
  sortOrder: number;
}

export interface CategoryWithFamilies {
  id: string;
  slug: string;
  name: string;
  kind: string;
  shortDescription: string | null;
  families: Array<{ id: string; slug: string; name: string }>;
}

export const PUBLICATION_LABELS: Record<PublicationState, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

/**
 * A stored gallery, made safe to render.
 *
 * Only an https URL survives: a stored `javascript:` or `data:` reference would otherwise reach an
 * `<img src>`, which is the one place a stored value becomes executable. The order is the stored
 * sortOrder, and the result is dense so the first entry is always the hero image.
 */
function normaliseImages(images: ProductImage[] | null | undefined): ProductImage[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image): image is ProductImage => typeof image?.url === "string" && /^https:\/\/[^\s]+$/i.test(image.url))
    .slice(0, MAX_IMAGES)
    .map((image, index) => ({ url: image.url, alt: image.alt ?? null, sortOrder: index }));
}

/** The hero image: the gallery's first entry, or the single v006 image reference. */
function primaryImage(images: ProductImage[] | null | undefined): ProductImage | null {
  const normalised = normaliseImages(images);
  return normalised[0] ?? null;
}

/** The gallery an admin submitted, validated and renumbered. Throws rather than storing a bad URL. */
function toStoredImages(input: Array<{ url: string; alt?: string | null }> | undefined): ProductImage[] {
  if (input === undefined) return [];
  if (input.length > MAX_IMAGES) throw new CatalogueError(`A product can carry at most ${MAX_IMAGES} images.`);
  return input.map((image, index) => {
    const url = image.url?.trim() ?? "";
    if (!/^https:\/\/[^\s]+$/i.test(url)) throw new CatalogueError("Image references must be an https:// URL.");
    const alt = image.alt?.trim();
    return { url, alt: alt ? alt.slice(0, 200) : null, sortOrder: index };
  });
}

async function decorate(db: AppDb, products: ProductDoc[]): Promise<PublicProduct[]> {
  if (products.length === 0) return [];
  const familyIds = [...new Set(products.map((p) => p.familyId))];
  const families = await db
    .collection<FamilyDoc>("product_families")
    .find({ _id: { $in: familyIds } })
    .toArray();
  const categoryIds = [...new Set(families.map((f) => f.categoryId))];
  const categories = await db
    .collection<CategoryDoc>("categories")
    .find({ _id: { $in: categoryIds } })
    .toArray();

  const familyById = new Map(families.map((f) => [f._id, f]));
  const categoryById = new Map(categories.map((c) => [c._id, c]));

  return products.map((product) => {
    const family = familyById.get(product.familyId);
    const category = family ? categoryById.get(family.categoryId) : undefined;
    return {
      id: product._id,
      slug: product.slug,
      title: product.title,
      partNumber: product.partNumber ?? null,
      brand: product.brand ?? null,
      manufacturer: product.manufacturer ?? null,
      shortDescription: product.shortDescription ?? null,
      technicalSpecification: product.technicalSpecification ?? null,
      imageUrl: product.imageUrl ?? primaryImage(product.images)?.url ?? null,
      images: normaliseImages(product.images),
      condition: product.condition,
      priceMode: product.priceMode,
      publishedAt: product.publishedAt ?? null,
      categoryName: category?.name ?? null,
      categorySlug: category?.slug ?? null,
      familyName: family?.name ?? null,
    };
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type ProductSort = "newest" | "title";

export interface ProductQuery {
  q?: string;
  /** Category slug (the parent of a product family). */
  category?: string;
  /** Product-family slug — the subcategory a product actually belongs to. */
  family?: string;
  /** One of ProductCondition; anything else is ignored rather than trusted. */
  condition?: string;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
}

export const PRODUCT_CONDITIONS = ["NEW", "REFURBISHED", "USED", "UNKNOWN"] as const;

/** Published products only, newest first. The public catalogue cannot see a draft by construction. */
export async function listPublishedProducts(query: ProductQuery = {}): Promise<{
  items: PublicProduct[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, query.pageSize ?? 12));

  return dataOr({ items: [], total: 0, page, pageSize }, async (db) => {
    const filter: Record<string, unknown> = { publicationState: "PUBLISHED", deletedAt: null };

    if (query.q?.trim()) {
      const pattern = new RegExp(escapeRegex(query.q.trim()), "i");
      filter.$or = [{ title: pattern }, { partNumber: pattern }, { brand: pattern }, { manufacturer: pattern }];
    }

    if (query.family?.trim()) {
      const family = await db
        .collection<FamilyDoc>("product_families")
        .findOne({ slug: query.family.trim() }, { projection: { _id: 1 } });
      if (!family) return { items: [], total: 0, page, pageSize };
      filter.familyId = family._id;
    }

    if (query.condition?.trim() && (PRODUCT_CONDITIONS as readonly string[]).includes(query.condition.trim())) {
      filter.condition = query.condition.trim();
    }

    if (query.category?.trim()) {
      const category = await db
        .collection<CategoryDoc>("categories")
        .findOne({ slug: query.category.trim() }, { projection: { _id: 1 } });
      if (!category) return { items: [], total: 0, page, pageSize };
      const families = await db
        .collection<FamilyDoc>("product_families")
        .find({ categoryId: category._id }, { projection: { _id: 1 } })
        .toArray();
      filter.familyId = { $in: families.map((f) => f._id) };
    }

    const collection = db.collection<ProductDoc>("products");
    const total = await collection.countDocuments(filter);
    const order: Record<string, 1 | -1> =
      query.sort === "title" ? { title: 1 } : { publishedAt: -1, createdAt: -1 };
    const products = await collection
      .find(filter)
      .sort(order)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    return { items: await decorate(db, products), total, page, pageSize };
  });
}

export interface PublicProductDetail extends PublicProduct {
  specifications: ProductSpecificationRow[];
}

/** A published product and its specification table. A draft is not readable by slug at all. */
export async function getPublishedProductBySlug(slug: string): Promise<PublicProductDetail | null> {
  return dataOr(null, async (db) => {
    const product = await db
      .collection<ProductDoc>("products")
      .findOne({ slug, publicationState: "PUBLISHED", deletedAt: null });
    if (!product) return null;
    const [decorated] = await decorate(db, [product]);
    if (!decorated) return null;
    return { ...decorated, specifications: await readSpecifications(db, product._id) };
  });
}

interface SpecificationDoc {
  _id: string;
  productId: string;
  attribute: string;
  valueText: string;
  unit?: string | null;
  sortOrder: number;
}

async function readSpecifications(db: AppDb, productId: string): Promise<ProductSpecificationRow[]> {
  const rows = await db
    .collection<SpecificationDoc>("product_specifications")
    .find({ productId })
    .sort({ sortOrder: 1, attribute: 1 })
    .toArray();
  return rows.map((row) => ({
    attribute: row.attribute,
    value: row.valueText,
    unit: row.unit ?? null,
    sortOrder: row.sortOrder,
  }));
}

/** The specification table of any product, for the admin editor. */
export async function listProductSpecifications(productId: string): Promise<ProductSpecificationRow[]> {
  return dataOr([], async (db) => readSpecifications(db, productId));
}

/**
 * Facets for the public catalogue filters.
 *
 * Counted from published products only, in the database, so a facet can never advertise a subcategory
 * whose products are all drafts. A category with zero published products is omitted rather than shown
 * as a filter that returns nothing.
 */
export interface CatalogueFacets {
  categories: Array<{ slug: string; name: string; count: number }>;
  families: Array<{ slug: string; name: string; categorySlug: string | null; count: number }>;
  manufacturers: Array<{ name: string; count: number }>;
  conditions: Array<{ value: string; count: number }>;
}

export async function catalogueFacets(): Promise<CatalogueFacets> {
  return dataOr({ categories: [], families: [], manufacturers: [], conditions: [] }, async (db) => {
    const [byFamily, byManufacturer, byCondition] = await Promise.all([
      db
        .collection<ProductDoc>("products")
        .aggregate<{ _id: string; count: number }>([
          { $match: { publicationState: "PUBLISHED", deletedAt: null } },
          { $group: { _id: "$familyId", count: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection<ProductDoc>("products")
        .aggregate<{ _id: string; count: number }>([
          { $match: { publicationState: "PUBLISHED", deletedAt: null, manufacturer: { $nin: [null, ""] } } },
          { $group: { _id: "$manufacturer", count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      db
        .collection<ProductDoc>("products")
        .aggregate<{ _id: string; count: number }>([
          { $match: { publicationState: "PUBLISHED", deletedAt: null } },
          { $group: { _id: "$condition", count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const tree = await listCatalogueTree();
    const families: CatalogueFacets["families"] = [];
    const categories: CatalogueFacets["categories"] = [];
    for (const category of tree) {
      let categoryCount = 0;
      for (const family of category.families) {
        const count = byFamily.find((row) => row._id === family.id)?.count ?? 0;
        if (count === 0) continue;
        categoryCount += count;
        families.push({ slug: family.slug, name: family.name, categorySlug: category.slug, count });
      }
      if (categoryCount > 0) categories.push({ slug: category.slug, name: category.name, count: categoryCount });
    }

    return {
      categories: categories.sort((a, b) => a.name.localeCompare(b.name)),
      families: families.sort((a, b) => a.name.localeCompare(b.name)),
      manufacturers: byManufacturer.map((row) => ({ name: row._id, count: row.count })),
      conditions: byCondition
        .filter((row) => (PRODUCT_CONDITIONS as readonly string[]).includes(row._id))
        .map((row) => ({ value: row._id, count: row.count })),
    };
  });
}

/** Categories and their published subcategories, for the catalogue filter and the admin form. */
export async function listCatalogueTree(): Promise<CategoryWithFamilies[]> {
  return dataOr([], async (db) => {
    const categories = await db
      .collection<CategoryDoc>("categories")
      .find({})
      .sort({ sortOrder: 1, name: 1 })
      .toArray();
    const families = await db
      .collection<FamilyDoc>("product_families")
      .find({})
      .sort({ sortOrder: 1, name: 1 })
      .toArray();

    return categories.map((category) => ({
      id: category._id,
      slug: category.slug,
      name: category.name,
      kind: category.kind,
      shortDescription: category.shortDescription ?? null,
      families: families
        .filter((family) => family.categoryId === category._id)
        .map((family) => ({ id: family._id, slug: family.slug, name: family.name })),
    }));
  });
}

/**
 * Approved supply, aggregated per product and stripped of every supplier attribute.
 *
 * This is the only place a seller listing reaches a buyer-facing page. It returns a total quantity and
 * a count of approved listings — never a supplier id, name, price or margin. The aggregation is done in
 * the database so the raw listing documents never enter the process that renders a public page.
 */
export async function approvedAvailabilityByProduct(
  productIds: string[],
): Promise<Map<string, { listings: number; quantityKg: number }>> {
  if (productIds.length === 0) return new Map();
  return dataOr(new Map(), async (db) => {
    const rows = await db
      .collection("supplier_listings")
      .aggregate<{ _id: string; listings: number; quantityKg: number }>([
        {
          $match: {
            productId: { $in: productIds },
            reviewStatus: "APPROVED",
            status: "ACTIVE",
          },
        },
        {
          $group: {
            _id: "$productId",
            listings: { $sum: 1 },
            quantityKg: {
              $sum: { $cond: [{ $eq: [{ $type: "$quantityKg" }, "decimal"] }, "$quantityKg", 0] },
            },
          },
        },
      ])
      .toArray();

    return new Map(
      rows.map((row) => [row._id, { listings: row.listings, quantityKg: Number(row.quantityKg ?? 0) }]),
    );
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminProductRow extends PublicProduct {
  publicationState: PublicationState;
  familyId: string;
  createdAt: Date;
}

export async function listAllProducts(limit = 200): Promise<AdminProductRow[]> {
  return dataOr([], async (db) => {
    const products = await db
      .collection<ProductDoc>("products")
      .find({ deletedAt: null })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    const decorated = await decorate(db, products);
    return decorated.map((product, index) => ({
      ...product,
      publicationState: products[index].publicationState,
      familyId: products[index].familyId,
      createdAt: products[index].createdAt,
    }));
  });
}

export async function getProductById(id: string): Promise<AdminProductRow | null> {
  return dataOr(null, async (db) => {
    const product = await db.collection<ProductDoc>("products").findOne({ _id: id, deletedAt: null });
    if (!product) return null;
    const [decorated] = await decorate(db, [product]);
    if (!decorated) return null;
    return {
      ...decorated,
      publicationState: product.publicationState,
      familyId: product.familyId,
      createdAt: product.createdAt,
    };
  });
}

export async function createCategory(input: {
  name: string;
  slug: string;
  kind: string;
  shortDescription?: string;
}): Promise<{ id: string; slug: string }> {
  const db = await getDb();
  const slug = await uniqueSlug(db, "categories", input.slug);
  const id = randomUUID();
  const now = new Date();
  const count = await db.collection("categories").countDocuments({});
  await db.collection("categories").insertOne({
    _id: id,
    slug,
    name: input.name,
    kind: input.kind,
    shortDescription: input.shortDescription ?? null,
    longDescription: null,
    heroDocumentId: null,
    publishedAt: now,
    sortOrder: count,
    createdAt: now,
    updatedAt: now,
  });
  return { id, slug };
}

export async function createFamily(input: {
  categoryId: string;
  name: string;
  slug: string;
}): Promise<{ id: string; slug: string }> {
  const db = await getDb();
  const category = await db.collection("categories").findOne({ _id: input.categoryId });
  if (!category) throw new Error("That parent category does not exist.");
  const slug = await uniqueSlug(db, "product_families", input.slug);
  const id = randomUUID();
  const now = new Date();
  const count = await db.collection("product_families").countDocuments({ categoryId: input.categoryId });
  await db.collection("product_families").insertOne({
    _id: id,
    categoryId: input.categoryId,
    slug,
    name: input.name,
    description: null,
    publicationState: "PUBLISHED",
    sortOrder: count,
    createdAt: now,
    updatedAt: now,
  });
  return { id, slug };
}

async function uniqueSlug(db: AppDb, collection: "categories" | "product_families" | "products", base: string): Promise<string> {
  let candidate = base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const exists = await db.collection(collection).findOne({ slug: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
    candidate = `${base}-${suffix}`;
  }
  throw new Error("Could not allocate a unique slug; choose a more specific name.");
}

export interface ProductWrite {
  title: string;
  slug?: string;
  familyId: string;
  partNumber?: string;
  brand?: string;
  manufacturer?: string;
  shortDescription?: string;
  technicalSpecification?: string;
  imageUrl?: string;
  images?: Array<{ url: string; alt?: string | null }>;
  specifications?: ProductSpecificationRow[];
  condition: string;
  priceMode: string;
  publicationState?: PublicationState;
}

export async function createProduct(input: ProductWrite): Promise<{ id: string; slug: string }> {
  const db = await getDb();
  const family = await db.collection("product_families").findOne({ _id: input.familyId });
  if (!family) throw new Error("Choose an existing subcategory.");

  const base = input.slug ?? slugify(input.title);
  const slug = await uniqueSlug(db, "products", base);
  const id = randomUUID();
  const now = new Date();
  const state = input.publicationState ?? "DRAFT";

  await db.collection("products").insertOne({
    _id: id,
    familyId: input.familyId,
    slug,
    partNumber: input.partNumber?.trim() || null,
    alternateNumbers: [],
    brand: input.brand?.trim() || null,
    manufacturer: input.manufacturer?.trim() || null,
    title: input.title,
    shortDescription: input.shortDescription?.trim() || null,
    technicalSpecification: input.technicalSpecification?.trim() || null,
    imageUrl: input.imageUrl?.trim() || null,
    images: toStoredImages(input.images),
    condition: input.condition,
    priceMode: input.priceMode,
    publicationState: state,
    publishedAt: state === "PUBLISHED" ? now : null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  if (input.specifications) await writeSpecifications(db, id, input.specifications);

  return { id, slug };
}

export async function updateProduct(
  id: string,
  input: Partial<ProductWrite> & { publicationState?: PublicationState },
): Promise<void> {
  const db = await getDb();
  const existing = await db.collection<ProductDoc>("products").findOne({ _id: id, deletedAt: null });
  if (!existing) throw new Error("That product does not exist.");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const assign = (key: string, value: string | undefined) => {
    if (value !== undefined) set[key] = value.trim() === "" ? null : value.trim();
  };

  if (input.title !== undefined) set.title = input.title;
  if (input.familyId !== undefined) set.familyId = input.familyId;
  assign("partNumber", input.partNumber);
  assign("brand", input.brand);
  assign("manufacturer", input.manufacturer);
  assign("shortDescription", input.shortDescription);
  assign("technicalSpecification", input.technicalSpecification);
  assign("imageUrl", input.imageUrl);
  if (input.images !== undefined) {
    // A new gallery renumbers from zero, so the first submitted image is always the hero image.
    set.images = toStoredImages(input.images);
  }
  if (input.condition !== undefined) set.condition = input.condition;
  if (input.priceMode !== undefined) set.priceMode = input.priceMode;

  if (input.publicationState !== undefined) {
    set.publicationState = input.publicationState;
    // Publishing always stamps a publication date; unpublishing keeps the historical one.
    if (input.publicationState === "PUBLISHED" && !existing.publishedAt) {
      set.publishedAt = new Date();
    }
  }

  await db.collection("products").updateOne({ _id: id }, { $set: set });
  if (input.specifications !== undefined) await writeSpecifications(db, id, input.specifications);
}

/** Replace a product's specification rows wholesale, in one ordered pass. */
async function writeSpecifications(
  db: AppDb,
  productId: string,
  rows: ProductSpecificationRow[],
): Promise<void> {
  const now = new Date();
  const cleaned = rows
    .map((row) => ({
      attribute: row.attribute.trim(),
      value: row.value.trim(),
      unit: row.unit?.trim() || null,
    }))
    .filter((row) => row.attribute !== "" && row.value !== "")
    .slice(0, 40)
    .map((row, index) => ({ ...row, sortOrder: index }));

  await db.collection("product_specifications").deleteMany({ productId });
  if (cleaned.length === 0) return;
  await db.collection("product_specifications").insertMany(
    cleaned.map((row) => ({
      _id: randomUUID(),
      productId,
      attribute: row.attribute.slice(0, 160),
      valueText: row.value.slice(0, 500),
      unit: row.unit ? row.unit.slice(0, 40) : null,
      sortOrder: row.sortOrder,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

// ---------------------------------------------------------------------------
// Admin — every function here requires an administrator and writes an audit row
// ---------------------------------------------------------------------------

export interface AdminProductQuery {
  q?: string;
  state?: PublicationState | "ALL";
  category?: string;
  page?: number;
  pageSize?: number;
}

/** The admin product list: every state, paged, searchable. Drafts are visible here and nowhere else. */
export async function adminListProducts(query: AdminProductQuery = {}): Promise<{
  items: AdminProductRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

  return dataOr({ items: [], total: 0, page, pageSize }, async (db) => {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.state && query.state !== "ALL") filter.publicationState = query.state;
    if (query.q?.trim()) {
      const pattern = new RegExp(escapeRegex(query.q.trim()), "i");
      filter.$or = [
        { title: pattern },
        { partNumber: pattern },
        { brand: pattern },
        { manufacturer: pattern },
        { slug: pattern },
      ];
    }
    if (query.category?.trim()) {
      const category = await db
        .collection<CategoryDoc>("categories")
        .findOne({ slug: query.category.trim() }, { projection: { _id: 1 } });
      if (!category) return { items: [], total: 0, page, pageSize };
      const families = await db
        .collection<FamilyDoc>("product_families")
        .find({ categoryId: category._id }, { projection: { _id: 1 } })
        .toArray();
      filter.familyId = { $in: families.map((f) => f._id) };
    }

    const collection = db.collection<ProductDoc>("products");
    const total = await collection.countDocuments(filter);
    const products = await collection
      .find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();
    const decorated = await decorate(db, products);

    return {
      items: decorated.map((product, index) => ({
        ...product,
        publicationState: products[index].publicationState,
        familyId: products[index].familyId,
        createdAt: products[index].createdAt,
      })),
      total,
      page,
      pageSize,
    };
  });
}

async function audit(
  actor: AuthUser,
  action: string,
  entityType: string,
  entityId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  await writeAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action,
    entityType,
    entityId,
    before,
    after,
    severity: "NOTICE",
  });
}

/** Create a product. Administrator only; the route guard is repeated here deliberately. */
export async function adminCreateProduct(
  actor: AuthUser,
  input: ProductWrite,
): Promise<{ id: string; slug: string }> {
  requireAdminActor(actor);
  const created = await createProduct(input);
  await audit(actor, "catalogue.product.created", "Product", created.id, null, {
    slug: created.slug,
    title: input.title,
    publicationState: input.publicationState ?? "DRAFT",
  });
  return created;
}

export async function adminUpdateProduct(
  actor: AuthUser,
  id: string,
  input: Partial<ProductWrite> & { publicationState?: PublicationState },
): Promise<void> {
  requireAdminActor(actor);
  const before = await getProductById(id);
  if (!before) throw new CatalogueError("That product does not exist.");
  await updateProduct(id, input);
  await audit(actor, "catalogue.product.updated", "Product", id, { title: before.title }, {
    title: input.title ?? before.title,
    publicationState: input.publicationState ?? before.publicationState,
  });
}

/**
 * Publish, unpublish or archive.
 *
 * A product may be published without an image or a description: the public page has an honest empty
 * state, and a hard content rule here would refuse the first real catalogue entry.
 */
export async function adminSetPublication(
  actor: AuthUser,
  id: string,
  state: PublicationState,
): Promise<void> {
  requireAdminActor(actor);
  const before = await getProductById(id);
  if (!before) throw new CatalogueError("That product does not exist.");
  if (before.publicationState === state) return;
  await updateProduct(id, { publicationState: state });
  const action =
    state === "PUBLISHED"
      ? "catalogue.product.published"
      : state === "DRAFT"
        ? "catalogue.product.unpublished"
        : "catalogue.product.archived";
  await audit(actor, action, "Product", id, { publicationState: before.publicationState }, { publicationState: state });
}

/** Archive: soft-delete. Nothing is removed, so an enquiry that names the product stays readable. */
export async function adminArchiveProduct(actor: AuthUser, id: string): Promise<void> {
  requireAdminActor(actor);
  const before = await getProductById(id);
  if (!before) throw new CatalogueError("That product does not exist.");
  const db = await getDb();
  const now = new Date();
  await db
    .collection("products")
    .updateOne({ _id: id }, { $set: { publicationState: "ARCHIVED", deletedAt: now, updatedAt: now } });
  await audit(
    actor,
    "catalogue.product.archived",
    "Product",
    id,
    { publicationState: before.publicationState },
    { publicationState: "ARCHIVED" },
  );
}

export async function adminReplaceSpecifications(
  actor: AuthUser,
  productId: string,
  rows: ProductSpecificationRow[],
): Promise<void> {
  requireAdminActor(actor);
  const product = await getProductById(productId);
  if (!product) throw new CatalogueError("That product does not exist.");
  const db = await getDb();
  await writeSpecifications(db, productId, rows);
  await audit(actor, "catalogue.product.specifications_replaced", "Product", productId, null, {
    rows: rows.length,
  });
}

export async function adminCreateCategory(
  actor: AuthUser,
  input: { name: string; slug: string; kind: string; shortDescription?: string },
): Promise<{ id: string; slug: string }> {
  requireAdminActor(actor);
  const created = await createCategory(input);
  await audit(actor, "catalogue.category.created", "Category", created.id, null, { name: input.name });
  return created;
}

export async function adminUpdateCategory(
  actor: AuthUser,
  id: string,
  input: { name?: string; shortDescription?: string; sortOrder?: number; published?: boolean },
): Promise<void> {
  requireAdminActor(actor);
  const db = await getDb();
  const before = await db.collection<CategoryDoc>("categories").findOne({ _id: id });
  if (!before) throw new CatalogueError("That category does not exist.");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name.trim().slice(0, 160);
  if (input.shortDescription !== undefined) set.shortDescription = input.shortDescription.trim() || null;
  if (input.sortOrder !== undefined) set.sortOrder = Math.trunc(input.sortOrder);
  if (input.published !== undefined) {
    set.publishedAt = input.published ? (before.publishedAt ?? new Date()) : null;
  }
  await db.collection("categories").updateOne({ _id: id }, { $set: set });
  await audit(actor, "catalogue.category.updated", "Category", id, { name: before.name }, {
    name: input.name ?? before.name,
  });
}

/**
 * Delete a category — only when nothing hangs off it.
 *
 * A category with subcategories is a structural change, not a button: deleting it would orphan every
 * product beneath it, and the products would disappear from the catalogue with no record of why.
 */
export async function adminDeleteCategory(actor: AuthUser, id: string): Promise<void> {
  requireAdminActor(actor);
  const db = await getDb();
  const before = await db.collection<CategoryDoc>("categories").findOne({ _id: id });
  if (!before) throw new CatalogueError("That category does not exist.");
  const families = await db.collection("product_families").countDocuments({ categoryId: id });
  if (families > 0) {
    throw new CatalogueError(
      "This category still has " + families + " subcategory(ies). Move or delete them first.",
    );
  }
  await db.collection("categories").deleteOne({ _id: id });
  await audit(actor, "catalogue.category.deleted", "Category", id, { name: before.name, slug: before.slug }, null);
}

export async function adminCreateFamily(
  actor: AuthUser,
  input: { categoryId: string; name: string; slug: string },
): Promise<{ id: string; slug: string }> {
  requireAdminActor(actor);
  const created = await createFamily(input);
  await audit(actor, "catalogue.family.created", "ProductFamily", created.id, null, {
    name: input.name,
    categoryId: input.categoryId,
  });
  return created;
}

export async function adminUpdateFamily(
  actor: AuthUser,
  id: string,
  input: { name?: string; description?: string; publicationState?: PublicationState; sortOrder?: number },
): Promise<void> {
  requireAdminActor(actor);
  const db = await getDb();
  const before = await db.collection<FamilyDoc>("product_families").findOne({ _id: id });
  if (!before) throw new CatalogueError("That subcategory does not exist.");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name.trim().slice(0, 160);
  if (input.description !== undefined) set.description = input.description.trim() || null;
  if (input.publicationState !== undefined) set.publicationState = input.publicationState;
  if (input.sortOrder !== undefined) set.sortOrder = Math.trunc(input.sortOrder);
  await db.collection("product_families").updateOne({ _id: id }, { $set: set });
  await audit(actor, "catalogue.family.updated", "ProductFamily", id, { name: before.name }, {
    name: input.name ?? before.name,
  });
}

/** Delete a subcategory — only when it holds no products, in any state. */
export async function adminDeleteFamily(actor: AuthUser, id: string): Promise<void> {
  requireAdminActor(actor);
  const db = await getDb();
  const before = await db.collection<FamilyDoc>("product_families").findOne({ _id: id });
  if (!before) throw new CatalogueError("That subcategory does not exist.");
  const products = await db.collection("products").countDocuments({ familyId: id, deletedAt: null });
  if (products > 0) {
    throw new CatalogueError(
      "This subcategory still has " + products + " product(s). Archive or move them first.",
    );
  }
  await db.collection("product_families").deleteOne({ _id: id });
  await audit(actor, "catalogue.family.deleted", "ProductFamily", id, { name: before.name, slug: before.slug }, null);
}
