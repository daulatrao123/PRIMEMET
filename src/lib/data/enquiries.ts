import { randomUUID } from "node:crypto";
import { Decimal128, Int32, Long, type UpdateFilter } from "mongodb";

import type { AppDb } from "@/lib/db";

import { getDb } from "@/lib/db";
import { requireAdminActor } from "./authorise";
import { dataOr } from "./db-safe";
import type { AuthUser } from "@/lib/auth/session";

/**
 * Buyer enquiries.
 *
 * The isolation rule is structural, not a UI convention: every buyer read takes an organisation id that
 * came from the session and puts it in the query filter. There is no function that accepts "the enquiry
 * id" alone and returns a document — `getEnquiryForOrganisation` requires both, and a mismatch returns
 * `null`, which the page renders as "not found". A buyer therefore cannot distinguish "does not exist"
 * from "belongs to another organisation", which is the correct amount of information to leak: none.
 *
 * `internalNotes` never enters `BuyerEnquiry`. It is projected out in the buyer query rather than hidden
 * by the template, so a future page cannot display it by mistake.
 */

export interface BuyerEnquiry {
  id: string;
  reference: string;
  productId: string | null;
  productTitle: string;
  categoryName: string | null;
  quantity: string;
  unit: string;
  requirements: string;
  deliveryLocation: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminEnquiry extends BuyerEnquiry {
  buyerOrganisationId: string;
  buyerOrganisationName: string | null;
  buyerUserId: string;
  buyerContactEmail: string | null;
  internalNotes: string | null;
}

interface EnquiryDoc {
  _id: string;
  reference: string;
  buyerOrganisationId: string;
  buyerUserId: string;
  productId?: string | null;
  productTitle: string;
  categoryName?: string | null;
  quantity: Decimal128;
  unit: string;
  requirements: string;
  deliveryLocation?: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  status: string;
  internalNotes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ENQUIRY_STATUS_LABELS: Record<string, string> = {
  NEW: "Received",
  UNDER_REVIEW: "Under review",
  MATCHING_SUPPLIERS: "Matching suppliers",
  QUOTES_REQUESTED: "Quotes requested",
  QUOTES_RECEIVED: "Quotes received",
  COMPARING_QUOTES: "Comparing quotes",
  QUOTE_DRAFTED: "Quotation drafted",
  QUOTE_SENT: "Quotation sent",
  NEGOTIATION: "In negotiation",
  BUYER_SELLER_INTRODUCTION: "Introduction made",
  WON: "Won",
  LOST: "Lost",
  CANCELLED: "Cancelled",
};

/** Statuses an admin may set from the Phase 1 desk. A subset: the desk does not draft quotations yet. */
export const ADMIN_SELECTABLE_STATUSES = [
  "NEW",
  "UNDER_REVIEW",
  "MATCHING_SUPPLIERS",
  "QUOTES_REQUESTED",
  "QUOTES_RECEIVED",
  "QUOTE_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
  "CANCELLED",
] as const;

function toBuyerEnquiry(doc: EnquiryDoc): BuyerEnquiry {
  return {
    id: doc._id,
    reference: doc.reference,
    productId: doc.productId ?? null,
    productTitle: doc.productTitle,
    categoryName: doc.categoryName ?? null,
    quantity: doc.quantity?.toString() ?? "0",
    unit: doc.unit,
    requirements: doc.requirements,
    deliveryLocation: doc.deliveryLocation ?? null,
    contactName: doc.contactName,
    contactEmail: doc.contactEmail,
    contactPhone: doc.contactPhone ?? null,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Allocate the next human reference for the year.
 *
 * `reference_sequences._id` is `<PREFIX>:<YEAR>` — a natural key, so the counter is addressed directly
 * and two concurrent allocations cannot both read the same "last value" and increment it. Gaps are
 * possible (a failed insert after allocation) and are acceptable: the reference identifies a request, it
 * is not an audit sequence.
 */
async function nextEnquiryReference(db: AppDb): Promise<string> {
  const year = new Date().getUTCFullYear();

  // The counter is a BSON long and the year a BSON int, because that is what the
  // `reference_sequences` validator declares. The driver's `$inc` typing accepts only a JS number, so
  // the update is asserted to the document shape; writing `1` here instead would be an int32 and the
  // validator would refuse the upsert (which is exactly how this was caught).
  const sequence = await db
    .collection<{ _id: string; lastValue: Long }>("reference_sequences")
    .findOneAndUpdate(
      { _id: `ENQ:${year}` },
      {
        $inc: { lastValue: Long.fromNumber(1) },
        $setOnInsert: { prefix: "ENQ", year: new Int32(year) },
      } as unknown as UpdateFilter<{ _id: string; lastValue: Long }>,
      { upsert: true, returnDocument: "after" },
    );
  const value = Number(sequence?.lastValue?.toString() ?? 1);
  return `ENQ-${year}-${String(value).padStart(6, "0")}`;
}

export interface NewEnquiryInput {
  productId: string;
  quantity: number;
  unit: string;
  requirements: string;
  deliveryLocation?: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
}

/**
 * Persist an enquiry for the session's organisation.
 *
 * The organisation comes from the `AuthUser`; the product is resolved here so an unpublished or deleted
 * product cannot be enquired about through a crafted id, and the title is copied at this moment.
 */
export async function createEnquiry(
  user: AuthUser,
  input: NewEnquiryInput,
): Promise<{ id: string; reference: string }> {
  if (!user.organisationId) {
    throw new Error("This account is not linked to an organisation yet.");
  }

  const db = await getDb();
  const product = await db.collection<{ _id: string; title: string; familyId: string }>("products").findOne(
    { _id: input.productId, publicationState: "PUBLISHED", deletedAt: null },
    { projection: { _id: 1, title: 1, familyId: 1 } },
  );
  if (!product) throw new Error("That product is not available for enquiry.");

  const family = await db
    .collection("product_families")
    .findOne({ _id: product.familyId }, { projection: { categoryId: 1 } });
  const category = family
    ? await db.collection<{ _id: string; name: string }>("categories").findOne({ _id: family.categoryId }, { projection: { name: 1 } })
    : null;

  const now = new Date();
  const id = randomUUID();
  const reference = await nextEnquiryReference(db);

  await db.collection<EnquiryDoc>("enquiries").insertOne({
    _id: id,
    reference,
    buyerOrganisationId: user.organisationId,
    buyerUserId: user.id,
    productId: product._id,
    productTitle: product.title,
    categoryName: category?.name ?? null,
    quantity: Decimal128.fromString(String(input.quantity)),
    unit: input.unit,
    requirements: input.requirements,
    deliveryLocation: input.deliveryLocation?.trim() || null,
    contactName: input.contactName,
    contactEmail: input.contactEmail.toLowerCase(),
    contactPhone: input.contactPhone?.trim() || null,
    status: "NEW",
    internalNotes: null,
    createdAt: now,
    updatedAt: now,
  });

  return { id, reference };
}

export async function listEnquiriesForOrganisation(organisationId: string): Promise<BuyerEnquiry[]> {
  return dataOr([], async (db) => {
    const docs = await db
      .collection<EnquiryDoc>("enquiries")
      .find({ buyerOrganisationId: organisationId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return docs.map(toBuyerEnquiry);
  });
}

/** One enquiry, only if it belongs to this organisation. Any other id is `null`. */
export async function getEnquiryForOrganisation(
  id: string,
  organisationId: string,
): Promise<BuyerEnquiry | null> {
  return dataOr(null, async (db) => {
    const doc = await db
      .collection<EnquiryDoc>("enquiries")
      .findOne({ _id: id, buyerOrganisationId: organisationId });
    return doc ? toBuyerEnquiry(doc) : null;
  });
}

export async function countEnquiriesForOrganisation(organisationId: string): Promise<number> {
  return dataOr(0, async (db) => db.collection<EnquiryDoc>("enquiries").countDocuments({ buyerOrganisationId: organisationId }));
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

interface AdminFilter {
  status?: string;
  q?: string;
  /** 1-based page. Omitted means "the first page of the desk queue", kept for existing callers. */
  page?: number;
  pageSize?: number;
}

/** MongoDB filter for the desk queue, shared by the page read and its count so they cannot diverge. */
function adminFilterQuery(filter: AdminFilter): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.q?.trim()) {
    const pattern = new RegExp(escapeRegex(filter.q.trim()), "i");
    query.$or = [{ reference: pattern }, { productTitle: pattern }, { contactEmail: pattern }, { contactName: pattern }];
  }
  return query;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listEnquiriesForAdmin(filter: AdminFilter = {}): Promise<AdminEnquiry[]> {
  return dataOr([], async (db) => {
    const query = adminFilterQuery(filter);
    // A paged caller gets exactly one page; an unpaged caller (the M2 test, a future report) keeps the
    // historical bounded 200-row read rather than silently becoming unbounded.
    const page = filter.page && filter.page > 0 ? Math.floor(filter.page) : 0;
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));

    const cursor = db
      .collection<EnquiryDoc>("enquiries")
      .find(query)
      .sort({ createdAt: -1 });
    const docs = await (page ? cursor.skip((page - 1) * pageSize).limit(pageSize) : cursor.limit(200)).toArray();

    const organisationIds = [...new Set(docs.map((doc) => doc.buyerOrganisationId))];
    const organisations = await db
      .collection("organisations")
      .find({ _id: { $in: organisationIds } })
      .project({ _id: 1, legalName: 1 })
      .toArray();
    const nameById = new Map(organisations.map((org) => [org._id as string, org.legalName as string]));

    return docs.map((doc) => ({
      ...toBuyerEnquiry(doc),
      buyerOrganisationId: doc.buyerOrganisationId,
      buyerOrganisationName: nameById.get(doc.buyerOrganisationId) ?? null,
      buyerUserId: doc.buyerUserId,
      buyerContactEmail: doc.contactEmail,
      internalNotes: doc.internalNotes ?? null,
    }));
  });
}

export async function getEnquiryForAdmin(id: string): Promise<AdminEnquiry | null> {
  return dataOr(null, async (db) => {
    const doc = await db.collection<EnquiryDoc>("enquiries").findOne({ _id: id });
    if (!doc) return null;
    const organisation = await db
      .collection("organisations")
      .findOne({ _id: doc.buyerOrganisationId }, { projection: { legalName: 1 } });
    return {
      ...toBuyerEnquiry(doc),
      buyerOrganisationId: doc.buyerOrganisationId,
      buyerOrganisationName: organisation?.legalName ?? null,
      buyerUserId: doc.buyerUserId,
      buyerContactEmail: doc.contactEmail,
      internalNotes: doc.internalNotes ?? null,
    };
  });
}

export async function updateEnquiryForAdmin(
  actor: AuthUser,
  id: string,
  patch: { status?: string; internalNotes?: string },
): Promise<{ before: EnquiryDoc | null }> {
  requireAdminActor(actor);
  const db = await getDb();
  const before = await db.collection<EnquiryDoc>("enquiries").findOne({ _id: id });
  if (!before) throw new Error("That enquiry does not exist.");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.internalNotes !== undefined) set.internalNotes = patch.internalNotes;

  await db.collection<EnquiryDoc>("enquiries").updateOne({ _id: id }, { $set: set });
  return { before };
}

/** Total rows matching the desk filter, for pagination. Same filter builder as the page read. */
export async function countEnquiriesForAdmin(filter: AdminFilter = {}): Promise<number> {
  return dataOr(0, async (db) => db.collection<EnquiryDoc>("enquiries").countDocuments(adminFilterQuery(filter)));
}

export async function countEnquiriesByStatus(): Promise<Record<string, number>> {
  return dataOr({}, async (db) => {
    const rows = await db
      .collection("enquiries")
      .aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      .toArray();
    return Object.fromEntries(rows.map((row) => [row._id, row.count]));
  });
}