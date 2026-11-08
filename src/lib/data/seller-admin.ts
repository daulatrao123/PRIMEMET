import { writeAuditLog } from "@/lib/auth/audit";
import type { AuthUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { requireAdminActor } from "./authorise";
import { dataOr } from "./db-safe";

/**
 * The administrator's view of seller applications.
 *
 * WHY A SEPARATE MODULE. `admin.ts` answers "how is the platform doing?"; this answers "what is waiting
 * for a decision?". Both are admin-only, but this one is a work queue with filters, and keeping it apart
 * keeps the queue's query shape (and its indexes) legible.
 *
 * Every read here returns what the desk needs to decide and nothing from another seller: the query is
 * keyed by the organisation selected in the URL, and the page that calls it is ADMIN-guarded.
 */

export type SellerQueueStatus = "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "REJECTED";

export interface SellerQueueFilter {
  status?: SellerQueueStatus | "";
  q?: string;
  /** 1-based page. Omitted keeps the historical bounded 300-row queue read. */
  page?: number;
  pageSize?: number;
}

export interface SellerQueueRow {
  organisationId: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  city: string | null;
  stateCode: string | null;
  businessType: string | null;
  accountStatus: string;
  verification: string | null;
  userStatus: string | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  createdAt: Date;
  listings: number;
  pendingListings: number;
}

/** Escape a search term so it is matched literally, never executed as a regular expression. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * MongoDB filter for the seller queue.
 *
 * Search is pushed into the query (company fields directly, contact fields through a bounded pre-query of
 * matching contacts) so a page of results is a page of the registers, not "read everything and filter in
 * Node". The two reads — page and count — share this builder, so they cannot disagree.
 */
async function sellerFilterQuery(
  db: Awaited<ReturnType<typeof getDb>>,
  filter: SellerQueueFilter,
): Promise<Record<string, unknown>> {
  const query: Record<string, unknown> = { orgType: "SELLER", deletedAt: null };
  if (filter.status) query.accountStatus = filter.status;

  const term = filter.q?.trim();
  if (term) {
    const pattern = new RegExp(escapeRegex(term), "i");
    const contacts = await db
      .collection("organisation_contacts")
      .find({ $or: [{ fullName: pattern }, { email: pattern }, { phone: pattern }] })
      .project({ organisationId: 1 })
      .limit(500)
      .toArray();
    const organisationIds = [...new Set(contacts.map((contact) => contact.organisationId as string))];
    query.$or = [
      { legalName: pattern },
      { tradeName: pattern },
      { gstin: pattern },
      { city: pattern },
      { businessType: pattern },
      { _id: { $in: organisationIds } },
    ];
  }

  return query;
}

/** Total applications matching the queue filter, for pagination. */
export async function countSellerApplications(filter: SellerQueueFilter = {}): Promise<number> {
  return dataOr(0, async (db) =>
    db.collection("organisations").countDocuments(await sellerFilterQuery(db, filter)),
  );
}

export async function listSellerApplications(filter: SellerQueueFilter = {}): Promise<SellerQueueRow[]> {
  return dataOr([], async (db) => {
    const query = await sellerFilterQuery(db, filter);
    const page = filter.page && filter.page > 0 ? Math.floor(filter.page) : 0;
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));

    // Pending first, then suspended, then rejected, then approved — the desk's working order. The rank is
    // computed in MongoDB so it survives pagination; sorting the page in Node would only rank one page.
    const orderedIds = await db
      .collection("organisations")
      .aggregate<{ _id: string }>([
        { $match: query },
        {
          $addFields: {
            reviewRank: {
              $switch: {
                branches: [
                  { case: { $eq: ["$accountStatus", "PENDING_APPROVAL"] }, then: 0 },
                  { case: { $eq: ["$accountStatus", "SUSPENDED"] }, then: 1 },
                  { case: { $eq: ["$accountStatus", "REJECTED"] }, then: 2 },
                ],
                default: 3,
              },
            },
          },
        },
        { $sort: { reviewRank: 1, createdAt: -1 } },
        ...(page ? [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }] : [{ $limit: 300 }]),
        { $project: { _id: 1 } },
      ])
      .toArray();
    if (orderedIds.length === 0) return [];

    const found = await db
      .collection("organisations")
      .find({ _id: { $in: orderedIds.map((row) => row._id) } })
      .toArray();
    const byId = new Map(found.map((organisation) => [organisation._id as string, organisation]));
    const organisations = orderedIds.map((row) => byId.get(row._id)).filter((doc): doc is NonNullable<typeof doc> => Boolean(doc));
    if (organisations.length === 0) return [];

    const organisationIds = organisations.map((organisation) => organisation._id as string);
    const [contacts, profiles] = await Promise.all([
      db
        .collection("organisation_contacts")
        .find({ organisationId: { $in: organisationIds }, isPrimary: true })
        .toArray(),
      db.collection("supplier_profiles").find({ organisationId: { $in: organisationIds } }).toArray(),
    ]);

    const userIds = profiles.map((profile) => profile.userId).filter((id): id is string => Boolean(id));
    const users = await db
      .collection("users")
      .find({ _id: { $in: userIds } })
      .project({ _id: 1, status: 1 })
      .toArray();

    const supplierIds = profiles.map((profile) => profile._id as string);
    const listingRows = await db
      .collection("supplier_listings")
      .aggregate<{ _id: { supplierId: string; reviewStatus: string }; count: number }>([
        { $match: { supplierId: { $in: supplierIds } } },
        { $group: { _id: { supplierId: "$supplierId", reviewStatus: "$reviewStatus" }, count: { $sum: 1 } } },
      ])
      .toArray();

    const contactByOrg = new Map(contacts.map((contact) => [contact.organisationId as string, contact]));
    const profileByOrg = new Map(profiles.map((profile) => [profile.organisationId as string, profile]));
    const statusByUser = new Map(users.map((user) => [user._id as string, user.status as string]));
    const countsBySupplier = new Map<string, { total: number; pending: number }>();
    for (const row of listingRows) {
      const key = row._id.supplierId;
      const current = countsBySupplier.get(key) ?? { total: 0, pending: 0 };
      current.total += row.count;
      if (row._id.reviewStatus === "PENDING") current.pending += row.count;
      countsBySupplier.set(key, current);
    }

    const rows = organisations.map((organisation) => {
      const contact = contactByOrg.get(organisation._id as string);
      const profile = profileByOrg.get(organisation._id as string);
      const counts = countsBySupplier.get((profile?._id as string | undefined) ?? "") ?? { total: 0, pending: 0 };
      return {
        organisationId: organisation._id as string,
        name: organisation.legalName as string,
        contactName: (contact?.fullName as string | undefined) ?? null,
        email: (contact?.email as string | undefined) ?? null,
        phone: (contact?.phone as string | undefined) ?? null,
        gstin: (organisation.gstin as string | undefined) ?? null,
        city: (organisation.city as string | undefined) ?? null,
        stateCode: (organisation.stateCode as string | undefined) ?? null,
        businessType: (organisation.businessType as string | undefined) ?? null,
        accountStatus: organisation.accountStatus as string,
        verification: (profile?.verification as string | undefined) ?? null,
        userStatus: profile?.userId ? (statusByUser.get(profile.userId as string) ?? null) : null,
        suspendedAt: (organisation.suspendedAt as Date | undefined) ?? null,
        suspensionReason: (organisation.suspensionReason as string | undefined) ?? null,
        createdAt: organisation.createdAt as Date,
        listings: counts.total,
        pendingListings: counts.pending,
      };
    });

    return sortQueue(rows);
  });
}

function sortQueue(rows: SellerQueueRow[]): SellerQueueRow[] {
  const rank: Record<string, number> = { PENDING_APPROVAL: 0, REJECTED: 1, ACTIVE: 2 };
  return rows.sort((a, b) => (rank[a.accountStatus] ?? 3) - (rank[b.accountStatus] ?? 3));
}

export interface SellerApplicationDetail {
  organisation: SellerQueueRow;
  tradeName: string | null;
  description: string | null;
  website: string | null;
  pan: string | null;
  reviewFeedback: string | null;
  reviewedAt: Date | null;
  internalNotes: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    stateCode: string | null;
    postalCode: string | null;
    countryCode: string | null;
  } | null;
  listings: {
    id: string;
    title: string;
    categoryLabel: string | null;
    reviewStatus: string;
    status: string;
    submittedAt: Date;
    rejectionReason: string | null;
  }[];
  verifications: {
    id: string;
    type: string;
    status: string;
    referenceValue: string | null;
    verifiedAt: Date | null;
  }[];
  auditTrail: { id: string; occurredAt: Date; action: string; actorRole: string | null }[];
}

export async function getSellerApplicationDetail(
  organisationId: string,
): Promise<SellerApplicationDetail | null> {
  return dataOr<SellerApplicationDetail | null>(null, async (db) => {
    const organisation = await db
      .collection("organisations")
      .findOne({ _id: organisationId, orgType: "SELLER", deletedAt: null });
    if (!organisation) return null;

    const rows = await listSellerApplications();
    const row = rows.find((candidate) => candidate.organisationId === organisationId);
    if (!row) return null;

    const profile = await db.collection("supplier_profiles").findOne({ organisationId });
    const [address, listings, verifications, audit] = await Promise.all([
      db.collection("organisation_addresses").findOne({ organisationId, kind: "REGISTERED" }),
      db
        .collection("supplier_listings")
        .find({ supplierId: (profile?._id as string | undefined) ?? "" })
        .sort({ submittedAt: -1 })
        .limit(50)
        .toArray(),
      db
        .collection("organisation_verifications")
        .find({ organisationId })
        .sort({ updatedAt: -1 })
        .limit(20)
        .toArray(),
      db
        .collection("audit_logs")
        .find({ entityType: "Organisation", entityId: organisationId })
        .sort({ occurredAt: -1 })
        .limit(20)
        .toArray(),
    ]);

    return {
      organisation: row,
      tradeName: (organisation.tradeName as string | undefined) ?? null,
      description: (organisation.description as string | undefined) ?? null,
      website: (organisation.website as string | undefined) ?? null,
      pan: (organisation.pan as string | undefined) ?? null,
      reviewFeedback: (organisation.reviewFeedback as string | undefined) ?? null,
      reviewedAt: (organisation.reviewedAt as Date | undefined) ?? null,
      internalNotes: (organisation.internalNotes as string | undefined) ?? null,
      address: address
        ? {
            line1: (address.line1 as string | undefined) ?? null,
            line2: (address.line2 as string | undefined) ?? null,
            city: (address.city as string | undefined) ?? null,
            stateCode: (address.stateCode as string | undefined) ?? null,
            postalCode: (address.postalCode as string | undefined) ?? null,
            countryCode: (address.countryCode as string | undefined) ?? null,
          }
        : null,
      listings: listings.map((listing) => ({
        id: listing._id as string,
        title: (listing.title as string | undefined) ?? "Untitled listing",
        categoryLabel: (listing.categoryLabel as string | undefined) ?? null,
        reviewStatus: listing.reviewStatus as string,
        status: listing.status as string,
        submittedAt: listing.submittedAt as Date,
        rejectionReason: (listing.rejectionReason as string | undefined) ?? null,
      })),
      verifications: verifications.map((row) => ({
        id: row._id as string,
        type: row.type as string,
        status: row.status as string,
        referenceValue: (row.referenceValue as string | undefined) ?? null,
        verifiedAt: (row.verifiedAt as Date | undefined) ?? null,
      })),
      auditTrail: audit.map((entry) => ({
        id: entry._id as string,
        occurredAt: entry.occurredAt as Date,
        action: entry.action as string,
        actorRole: (entry.actorRole as string | undefined) ?? null,
      })),
    };
  });
}

/**
 * Append an internal note to a seller's record.
 *
 * Notes never leave the desk: no seller-facing projection in `seller-portal.ts` reads
 * `organisations.internalNotes`. The function refuses a non-admin actor even if the route guard were
 * bypassed, because a note is internal intelligence about a counterparty.
 */
export async function addSellerInternalNote(
  actor: AuthUser,
  organisationId: string,
  note: string,
): Promise<void> {
  requireAdminActor(actor);
  const trimmed = note.trim();
  if (trimmed.length < 2) throw new Error("Write the note before saving it.");

  const db = await getDb();
  const now = new Date();
  const organisation = await db
    .collection("organisations")
    .findOne({ _id: organisationId, orgType: "SELLER" });
  if (!organisation) throw new Error("That seller organisation does not exist.");

  const stamp = now.toISOString().slice(0, 16).replace("T", " ") + " — " + actor.email;
  const previous = (organisation.internalNotes as string | undefined) ?? "";
  const next = ((previous ? previous + "\n" : "") + "[" + stamp + "] " + trimmed).slice(0, 8000);

  await db
    .collection("organisations")
    .updateOne({ _id: organisationId }, { $set: { internalNotes: next, updatedAt: now } });

  await writeAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "seller.note_added",
    entityType: "Organisation",
    entityId: organisationId,
    before: { internalNotesLength: previous.length },
    after: { internalNotesLength: next.length },
    severity: "NOTICE",
  });
}
