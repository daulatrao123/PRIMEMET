import { randomUUID } from "node:crypto";
import { Decimal128 } from "mongodb";

import type { AppDb } from "@/lib/db";

import { writeAuditLog } from "@/lib/auth/audit";
import { requireAdminActor, requireSellerProfile } from "./authorise";
import { getDb } from "@/lib/db";
import { dataOr } from "./db-safe";
import type { AuthUser } from "@/lib/auth/session";

/**
 * Seller listings.
 *
 * The approval gate is the point of this module. A seller submission is always written with
 * `reviewStatus: "PENDING"` and `status: "DRAFT"` — the write function takes no decision parameter, so
 * there is no code path by which a seller can create an approved listing. Approval lives in
 * `decideListing`, which is reachable only from the ADMIN-guarded route and refuses a listing that is not
 * already PENDING (so a rejection cannot be replayed as an approval).
 */

export interface SellerListing {
  id: string;
  title: string;
  categoryLabel: string | null;
  productId: string | null;
  productTitle: string | null;
  quantityKg: string | null;
  notes: string | null;
  manufacturer: string | null;
  description: string | null;
  specification: string | null;
  supportingInfo: string | null;
  images: string[];
  status: string;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
  supplierOrganisationId?: string;
  supplierName?: string | null;
}

interface ListingDoc {
  _id: string;
  supplierId: string;
  status: string;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  title?: string;
  categoryLabel?: string | null;
  gradeId?: string | null;
  locationCityId?: string | null;
  availableFrom?: Date | null;
  availableTo?: Date | null;
  productId?: string | null;
  quantityKg?: Decimal128 | null;
  notes?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  specification?: string | null;
  supportingInfo?: string | null;
  images?: string[];
  rejectionReason?: string | null;
  submittedAt: Date;
  reviewedAt?: Date | null;
  reviewedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductRefDoc {
  _id: string;
  title: string;
}

interface SupplierRefDoc {
  _id: string;
  organisationId: string;
}

interface OrganisationRefDoc {
  _id: string;
  legalName: string;
}

export const REVIEW_LABELS: Record<SellerListing["reviewStatus"], string> = {
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

function toListing(doc: ListingDoc, productTitle: string | null): SellerListing {
  return {
    id: doc._id,
    title: doc.title ?? "Untitled listing",
    categoryLabel: doc.categoryLabel ?? null,
    productId: doc.productId ?? null,
    productTitle,
    quantityKg: doc.quantityKg ? String(Number(doc.quantityKg.toString())) : null,
    notes: doc.notes ?? null,
    manufacturer: doc.manufacturer ?? null,
    description: doc.description ?? null,
    specification: doc.specification ?? null,
    supportingInfo: doc.supportingInfo ?? null,
    images: doc.images ?? [],
    status: doc.status,
    reviewStatus: doc.reviewStatus,
    rejectionReason: doc.rejectionReason ?? null,
    submittedAt: doc.submittedAt,
    reviewedAt: doc.reviewedAt ?? null,
    createdAt: doc.createdAt,
  };
}

async function productTitles(db: AppDb, docs: ListingDoc[]): Promise<Map<string, string>> {
  const ids = [...new Set(docs.map((doc) => doc.productId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const products = await db
    .collection<ProductRefDoc>("products")
    .find({ _id: { $in: ids } })
    .project<ProductRefDoc>({ _id: 1, title: 1 })
    .toArray();
  return new Map(products.map((product) => [product._id, product.title]));
}

export interface NewListingInput {
  title: string;
  categoryLabel: string;
  manufacturer?: string;
  description?: string;
  specification?: string;
  productId?: string;
  quantityKg?: number;
  notes?: string;
  supportingInfo?: string;
  images?: string[];
}

/** Submit a listing for review. Always PENDING; the seller cannot express an approval. */
export async function createListing(user: AuthUser, input: NewListingInput): Promise<{ id: string }> {
  if (!user.supplierProfileId || !user.organisationId) {
    throw new Error("This seller account has no supplier profile.");
  }

  const db = await getDb();

  if (input.productId) {
    const product = await db
      .collection<ProductRefDoc>("products")
      .findOne({ _id: input.productId }, { projection: { _id: 1, title: 1 } });
    if (!product) throw new Error("That product does not exist in the catalogue.");
  }

  const now = new Date();
  const id = randomUUID();

  await db.collection<ListingDoc>("supplier_listings").insertOne({
    _id: id,
    supplierId: user.supplierProfileId,
    status: "DRAFT",
    reviewStatus: "PENDING",
    title: input.title,
    categoryLabel: input.categoryLabel,
    gradeId: null,
    productId: input.productId ?? null,
    quantityKg: input.quantityKg !== undefined ? Decimal128.fromString(String(input.quantityKg)) : null,
    locationCityId: null,
    availableFrom: null,
    availableTo: null,
    notes: input.notes?.trim() || null,
    manufacturer: input.manufacturer?.trim() || null,
    description: input.description?.trim() || null,
    specification: input.specification?.trim() || null,
    supportingInfo: input.supportingInfo?.trim() || null,
    images: (input.images ?? []).slice(0, 8),
    submittedAt: now,
    reviewedAt: null,
    reviewedByUserId: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
  });

  return { id };
}

export async function listListingsForSupplier(supplierProfileId: string): Promise<SellerListing[]> {
  return dataOr<SellerListing[]>([], async (db) => {
    const docs = await db
      .collection<ListingDoc>("supplier_listings")
      .find({ supplierId: supplierProfileId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const titles = await productTitles(db, docs);
    return docs.map((doc) => toListing(doc, titles.get(doc.productId ?? "") ?? null));
  });
}

export async function listListingsForAdmin(
  filter: { reviewStatus?: "PENDING" | "APPROVED" | "REJECTED" } = {},
): Promise<SellerListing[]> {
  return dataOr<SellerListing[]>([], async (db) => {
    const query: Record<string, unknown> = {};
    if (filter.reviewStatus) query.reviewStatus = filter.reviewStatus;
    const docs = await db
      .collection<ListingDoc>("supplier_listings")
      .find(query)
      .sort({ submittedAt: -1 })
      .limit(200)
      .toArray();

    // Pending first: the page is a work queue, not an archive.
    const rank = { PENDING: 0, REJECTED: 1, APPROVED: 2 } as const;
    docs.sort((a, b) => rank[a.reviewStatus] - rank[b.reviewStatus]);

    const titles = await productTitles(db, docs);
    const supplierIds = [...new Set(docs.map((doc) => doc.supplierId))];
    const profiles = await db
      .collection<SupplierRefDoc>("supplier_profiles")
      .find({ _id: { $in: supplierIds } })
      .project<SupplierRefDoc>({ _id: 1, organisationId: 1 })
      .toArray();
    const organisationIds = [...new Set(profiles.map((profile) => profile.organisationId))];
    const organisations = await db
      .collection<OrganisationRefDoc>("organisations")
      .find({ _id: { $in: organisationIds } })
      .project<OrganisationRefDoc>({ _id: 1, legalName: 1 })
      .toArray();
    const orgNameById = new Map(organisations.map((org) => [org._id, org.legalName]));
    const profileById = new Map(profiles.map((profile) => [profile._id, profile]));

    return docs.map((doc) => {
      const profile = profileById.get(doc.supplierId);
      const listing = toListing(doc, titles.get(doc.productId ?? "") ?? null);
      return {
        ...listing,
        supplierOrganisationId: profile?.organisationId,
        supplierName: profile ? (orgNameById.get(profile.organisationId) ?? null) : null,
      };
    });
  });
}

/**
 * Approve or reject one PENDING listing.
 *
 * The `reviewStatus: "PENDING"` guard in the filter is the concurrency control: two admins deciding at
 * the same time produce one update and one no-op, never an approval overwriting a rejection.
 */
function approvedDecision(decision: "APPROVE" | "REJECT"): boolean {
  return decision === "APPROVE";
}

export async function decideListing(
  actor: AuthUser,
  id: string,
  decision: "APPROVE" | "REJECT",
  reason?: string,
): Promise<{ before: ListingDoc | null }> {
  requireAdminActor(actor);
  const adminUserId = actor.id;
  const db = await getDb();
  const before = await db
    .collection<ListingDoc>("supplier_listings")
    .findOne({ _id: id, reviewStatus: "PENDING" });
  if (!before) throw new Error("That listing is not pending review.");

  const rejection = reason?.trim() || "";
  if (!approvedDecision(decision) && rejection.length < 5) {
    throw new Error("Give a reason for rejecting the listing — the seller reads it.");
  }

  const now = new Date();
  const approved = decision === "APPROVE";
  const result = await db.collection<ListingDoc>("supplier_listings").updateOne(
    { _id: id, reviewStatus: "PENDING" },
    {
      $set: {
        reviewStatus: approved ? "APPROVED" : "REJECTED",
        status: approved ? "ACTIVE" : "DRAFT",
        reviewedAt: now,
        reviewedByUserId: adminUserId,
        rejectionReason: approved ? null : rejection,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount === 0) throw new Error("That listing was already reviewed.");

  await writeAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: approved ? "listing.approved" : "listing.rejected",
    entityType: "SupplierListing",
    entityId: id,
    before: { reviewStatus: before.reviewStatus, status: before.status },
    after: {
      reviewStatus: approved ? "APPROVED" : "REJECTED",
      status: approved ? "ACTIVE" : "DRAFT",
      rejectionReason: approved ? null : rejection,
    },
    severity: "NOTICE",
  });

  return { before };
}

/**
 * The signed-in seller's own submissions.
 *
 * The supplier profile comes from the session, never from a query string, so "my listings" cannot be
 * pointed at another supplier. This is the only path a seller page uses.
 */
export async function listMyListings(user: AuthUser): Promise<SellerListing[]> {
  const { supplierProfileId } = requireSellerProfile(user);
  return listListingsForSupplier(supplierProfileId);
}

/** Submit as the signed-in seller. The supplier id comes from the session, not the request. */
export async function submitMyListing(
  user: AuthUser,
  input: NewListingInput,
): Promise<{ id: string }> {
  requireSellerProfile(user);
  return createListing(user, input);
}

/**
 * One submission, if and only if the signed-in seller owns it.
 *
 * The supplier id comes from the session. A seller passing another seller's listing id gets `null`, so
 * the edit page cannot be used as an existence oracle across organisations.
 */
export async function getMyListing(user: AuthUser, id: string): Promise<SellerListing | null> {
  const { supplierProfileId } = requireSellerProfile(user);
  return dataOr<SellerListing | null>(null, async (db) => {
    const doc = await db
      .collection<ListingDoc>("supplier_listings")
      .findOne({ _id: id, supplierId: supplierProfileId });
    if (!doc) return null;
    const titles = await productTitles(db, [doc]);
    return toListing(doc, titles.get(doc.productId ?? "") ?? null);
  });
}

/**
 * Edit and resubmit a submission the desk has not accepted.
 *
 * Only PENDING and REJECTED listings are editable: an APPROVED listing is availability the desk has
 * already accepted, and rewriting it would change a reviewed fact without review. A resubmission clears
 * the previous decision and returns the listing to PENDING / DRAFT — the seller can respond to the
 * desk's reason, but still cannot approve anything.
 */
export async function updateMyListing(
  user: AuthUser,
  id: string,
  input: NewListingInput,
): Promise<void> {
  const { supplierProfileId } = requireSellerProfile(user);
  const db = await getDb();

  const existing = await db
    .collection<ListingDoc>("supplier_listings")
    .findOne({ _id: id, supplierId: supplierProfileId });
  if (!existing) throw new Error("That listing does not exist on your account.");
  if (!["PENDING", "REJECTED"].includes(existing.reviewStatus)) {
    throw new Error("An approved listing cannot be edited. Submit a new listing instead.");
  }

  if (input.productId) {
    const product = await db
      .collection<ProductRefDoc>("products")
      .findOne({ _id: input.productId }, { projection: { _id: 1, title: 1 } });
    if (!product) throw new Error("That product does not exist in the catalogue.");
  }

  const now = new Date();
  const result = await db.collection<ListingDoc>("supplier_listings").updateOne(
    { _id: id, supplierId: supplierProfileId, reviewStatus: { $in: ["PENDING", "REJECTED"] } },
    {
      $set: {
        title: input.title,
        categoryLabel: input.categoryLabel,
        manufacturer: input.manufacturer?.trim() || null,
        description: input.description?.trim() || null,
        specification: input.specification?.trim() || null,
        supportingInfo: input.supportingInfo?.trim() || null,
        images: (input.images ?? []).slice(0, 8),
        productId: input.productId ?? null,
        quantityKg: input.quantityKg !== undefined ? Decimal128.fromString(String(input.quantityKg)) : null,
        notes: input.notes?.trim() || null,
        reviewStatus: "PENDING",
        status: "DRAFT",
        rejectionReason: null,
        reviewedAt: null,
        reviewedByUserId: null,
        submittedAt: now,
        updatedAt: now,
      },
    },
  );
  if (result.matchedCount === 0) throw new Error("That listing was reviewed while you were editing it.");

  await writeAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: "listing.resubmitted",
    entityType: "SupplierListing",
    entityId: id,
    before: { reviewStatus: existing.reviewStatus, title: existing.title ?? null },
    after: { reviewStatus: "PENDING", title: input.title },
    severity: "NOTICE",
  });
}

export async function countPendingListings(): Promise<number> {
  return dataOr(0, async (db) => db.collection("supplier_listings").countDocuments({ reviewStatus: "PENDING" }));
}