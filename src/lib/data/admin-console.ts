import { getClient, getDb } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/auth/audit";
import { requireAdminActor } from "./authorise";
import { dataOr } from "./db-safe";

/**
 * The administrator's control centre: the numbers on the overview, the registers, the activity feed, and
 * the two privileged account operations (suspend, reactivate).
 *
 * WHY A SEPARATE MODULE. `admin.ts` owns the seller decision and the audit read; `seller-admin.ts` owns
 * the application queue. This module owns everything M5 added: counting, listing with pagination, and
 * changing an account's standing. Keeping the overview's aggregations here means the dashboard has one
 * function to call rather than nine, and the index each one needs is visible next to the query.
 *
 * EVERY READ IS BOUNDED. Each list takes a page and a page size; nothing here calls `.find({})` and
 * renders whatever comes back. The counts are `countDocuments` or a single `$group`, never a full
 * collection read in application memory.
 *
 * PRIVILEGE. `setAccountStatus` and `renameManufacturer` call `requireAdminActor` themselves, so a route
 * that forgot its guard still cannot suspend an account.
 */

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const OPEN_ENQUIRY_STATUSES = [
  "UNDER_REVIEW",
  "MATCHING_SUPPLIERS",
  "QUOTES_REQUESTED",
  "QUOTES_RECEIVED",
  "COMPARING_QUOTES",
  "QUOTE_DRAFTED",
  "QUOTE_SENT",
  "NEGOTIATION",
  "BUYER_SELLER_INTRODUCTION",
];

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface AdminOverview {
  buyers: number;
  sellers: number;
  pendingSellers: number;
  approvedSellers: number;
  suspendedAccounts: number;
  products: number;
  publishedProducts: number;
  pendingListings: number;
  enquiries: number;
  newEnquiries: number;
  inProgressEnquiries: number;
  completedEnquiries: number;
  categories: number;
}

/**
 * Every figure the overview shows, read from MongoDB in five bounded queries.
 *
 * The organisation and enquiry counts are each one `$group`, not one `countDocuments` per status: a
 * dashboard that fires eleven counts is eleven round trips for one screen, and the grouping stays cheap
 * because both are index-supported.
 */
export async function adminOverview(): Promise<AdminOverview> {
  const empty: AdminOverview = {
    buyers: 0,
    sellers: 0,
    pendingSellers: 0,
    approvedSellers: 0,
    suspendedAccounts: 0,
    products: 0,
    publishedProducts: 0,
    pendingListings: 0,
    enquiries: 0,
    newEnquiries: 0,
    inProgressEnquiries: 0,
    completedEnquiries: 0,
    categories: 0,
  };

  return dataOr(empty, async (db) => {
    const [organisationRows, productRows, pendingListings, enquiryRows, categories] = await Promise.all([
      db
        .collection("organisations")
        .aggregate<{ _id: { orgType: string; accountStatus: string }; count: number }>([
          { $match: { deletedAt: null, orgType: { $in: ["BUYER", "SELLER"] } } },
          { $group: { _id: { orgType: "$orgType", accountStatus: "$accountStatus" }, count: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection("products")
        .aggregate<{ _id: string; count: number }>([
          { $match: { deletedAt: null } },
          { $group: { _id: "$publicationState", count: { $sum: 1 } } },
        ])
        .toArray(),
      db.collection("supplier_listings").countDocuments({ reviewStatus: "PENDING" }),
      db
        .collection("enquiries")
        .aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }])
        .toArray(),
      db.collection("categories").countDocuments({}),
    ]);

    const org = { buyers: 0, sellers: 0, pendingSellers: 0, approvedSellers: 0, suspended: 0 };
    for (const row of organisationRows) {
      if (row._id.orgType === "BUYER") org.buyers += row.count;
      if (row._id.orgType === "SELLER") {
        org.sellers += row.count;
        if (row._id.accountStatus === "PENDING_APPROVAL") org.pendingSellers += row.count;
        if (row._id.accountStatus === "ACTIVE") org.approvedSellers += row.count;
      }
      if (row._id.accountStatus === "SUSPENDED") org.suspended += row.count;
    }

    const products = productRows.reduce((sum, row) => sum + row.count, 0);
    const publishedProducts = productRows.find((row) => row._id === "PUBLISHED")?.count ?? 0;

    const statusCount = new Map(enquiryRows.map((row) => [row._id, row.count]));
    const enquiries = enquiryRows.reduce((sum, row) => sum + row.count, 0);
    const newEnquiries = statusCount.get("NEW") ?? 0;
    const inProgressEnquiries = OPEN_ENQUIRY_STATUSES.reduce((sum, status) => sum + (statusCount.get(status) ?? 0), 0);
    const completedEnquiries = statusCount.get("WON") ?? 0;

    return {
      buyers: org.buyers,
      sellers: org.sellers,
      pendingSellers: org.pendingSellers,
      approvedSellers: org.approvedSellers,
      suspendedAccounts: org.suspended,
      products,
      publishedProducts,
      pendingListings,
      enquiries,
      newEnquiries,
      inProgressEnquiries,
      completedEnquiries,
      categories,
    };
  });
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export interface ActivityFeed {
  registrations: { id: string; name: string; orgType: string; accountStatus: string; occurredAt: Date; href: string }[];
  enquiries: { id: string; reference: string; productTitle: string; buyerName: string | null; status: string; occurredAt: Date }[];
  approvals: { id: string; action: string; entityName: string | null; actorRole: string | null; occurredAt: Date }[];
  publications: { id: string; action: string; productTitle: string | null; actorRole: string | null; occurredAt: Date }[];
}

/** Approval and account events that the desk cares about, in one place so the filter cannot drift. */
const ACCOUNT_ACTIONS = [
  "seller.application.approved",
  "seller.application.rejected",
  "account.suspended",
  "account.reactivated",
];

const PRODUCT_ACTIONS = [
  "catalogue.product.created",
  "catalogue.product.updated",
  "catalogue.product.published",
  "catalogue.product.unpublished",
  "catalogue.product.archived",
];

/**
 * Recent persisted activity: registrations, enquiries, account decisions and product publication.
 *
 * Every item comes from a stored document or an append-only audit row. Nothing here is derived from the
 * session, a counter or a fixture, which is what "real persisted records" in the M5 brief requires.
 */
export async function recentActivity(limit = 5): Promise<ActivityFeed> {
  const take = Math.min(20, Math.max(1, limit));
  return dataOr({ registrations: [], enquiries: [], approvals: [], publications: [] }, async (db) => {
    const [organisations, enquiries, accountRows, productRows] = await Promise.all([
      db
        .collection("organisations")
        .find({ deletedAt: null, orgType: { $in: ["BUYER", "SELLER"] } })
        .sort({ createdAt: -1 })
        .limit(take)
        .project({ _id: 1, legalName: 1, orgType: 1, accountStatus: 1, createdAt: 1 })
        .toArray(),
      db
        .collection("enquiries")
        .find({})
        .sort({ createdAt: -1 })
        .limit(take)
        .project({ _id: 1, reference: 1, productTitle: 1, buyerOrganisationId: 1, status: 1, createdAt: 1 })
        .toArray(),
      db
        .collection("audit_logs")
        .find({ action: { $in: ACCOUNT_ACTIONS } })
        .sort({ occurredAt: -1 })
        .limit(take)
        .toArray(),
      db
        .collection("audit_logs")
        .find({ action: { $in: PRODUCT_ACTIONS } })
        .sort({ occurredAt: -1 })
        .limit(take)
        .toArray(),
    ]);

    const enquiryOrgIds = [...new Set(enquiries.map((doc) => doc.buyerOrganisationId as string))];
    const approvalOrgIds = [...new Set([...accountRows, ...productRows].map((doc) => doc.entityId as string).filter(Boolean))];

    const [enquiryOrgs, approvalEntities, products] = await Promise.all([
      enquiryOrgIds.length
        ? db.collection("organisations").find({ _id: { $in: enquiryOrgIds } }).project({ _id: 1, legalName: 1 }).toArray()
        : Promise.resolve([]),
      approvalOrgIds.length
        ? db.collection("organisations").find({ _id: { $in: approvalOrgIds } }).project({ _id: 1, legalName: 1 }).toArray()
        : Promise.resolve([]),
      approvalOrgIds.length
        ? db.collection("products").find({ _id: { $in: approvalOrgIds } }).project({ _id: 1, title: 1 }).toArray()
        : Promise.resolve([]),
    ]);

    const orgName = new Map(enquiryOrgs.map((doc) => [doc._id as string, doc.legalName as string]));
    const entityName = new Map(approvalEntities.map((doc) => [doc._id as string, doc.legalName as string]));
    const productTitle = new Map(products.map((doc) => [doc._id as string, doc.title as string]));

    return {
      registrations: organisations.map((doc) => ({
        id: doc._id as string,
        name: doc.legalName as string,
        orgType: doc.orgType as string,
        accountStatus: doc.accountStatus as string,
        occurredAt: doc.createdAt as Date,
        href: doc.orgType === "SELLER" ? `/admin/suppliers/${doc._id as string}` : `/admin/buyers/${doc._id as string}`,
      })),
      enquiries: enquiries.map((doc) => ({
        id: doc._id as string,
        reference: doc.reference as string,
        productTitle: doc.productTitle as string,
        buyerName: orgName.get(doc.buyerOrganisationId as string) ?? null,
        status: doc.status as string,
        occurredAt: doc.createdAt as Date,
      })),
      approvals: accountRows.map((doc) => ({
        id: doc._id as string,
        action: doc.action as string,
        entityName: doc.entityId ? (entityName.get(doc.entityId as string) ?? null) : null,
        actorRole: (doc.actorRole as string | undefined) ?? null,
        occurredAt: doc.occurredAt as Date,
      })),
      publications: productRows.map((doc) => ({
        id: doc._id as string,
        action: doc.action as string,
        productTitle: doc.entityId ? (productTitle.get(doc.entityId as string) ?? null) : null,
        actorRole: (doc.actorRole as string | undefined) ?? null,
        occurredAt: doc.occurredAt as Date,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Buyer register and detail
// ---------------------------------------------------------------------------

export interface BuyerRow {
  organisationId: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  city: string | null;
  stateCode: string | null;
  accountStatus: string;
  verification: string | null;
  createdAt: Date;
  enquiries: number;
  lastEnquiryAt: Date | null;
}

export interface BuyerPage {
  items: BuyerRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
}

export interface BuyerQuery {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

const BUYER_STATUSES = ["ACTIVE", "PENDING_APPROVAL", "SUSPENDED", "REJECTED"];

/**
 * One page of the buyer register.
 *
 * Search matches the company fields in the query and the contact fields through a bounded pre-query of
 * matching contacts, so a page of buyers is still one page of buyers rather than "read every buyer and
 * filter in Node", which is the failure mode the brief's performance section names.
 */
export async function listBuyersPage(query: BuyerQuery = {}): Promise<BuyerPage> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

  return dataOr<BuyerPage>({ items: [], total: 0, page, pageSize, counts: {} }, async (db) => {
    const filter: Record<string, unknown> = { orgType: "BUYER", deletedAt: null };
    if (query.status && BUYER_STATUSES.includes(query.status)) filter.accountStatus = query.status;

    const term = query.q?.trim();
    if (term) {
      const pattern = new RegExp(escapeRegex(term), "i");
      const contacts = await db
        .collection("organisation_contacts")
        .find({ $or: [{ fullName: pattern }, { email: pattern }, { phone: pattern }] })
        .project({ organisationId: 1 })
        .limit(500)
        .toArray();
      const organisationIds = [...new Set(contacts.map((contact) => contact.organisationId as string))];
      filter.$or = [
        { legalName: pattern },
        { tradeName: pattern },
        { gstin: pattern },
        { city: pattern },
        { _id: { $in: organisationIds } },
      ];
    }

    const organisationsCollection = db.collection("organisations");
    const [total, organisations, statusRows] = await Promise.all([
      organisationsCollection.countDocuments(filter),
      organisationsCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      organisationsCollection
        .aggregate<{ _id: string; count: number }>([
          { $match: { orgType: "BUYER", deletedAt: null } },
          { $group: { _id: "$accountStatus", count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const counts: Record<string, number> = {};
    for (const row of statusRows) counts[row._id] = row.count;

    if (organisations.length === 0) return { items: [], total, page, pageSize, counts };

    const organisationIds = organisations.map((organisation) => organisation._id as string);
    const [contacts, profiles, enquiryRows] = await Promise.all([
      db
        .collection("organisation_contacts")
        .find({ organisationId: { $in: organisationIds }, isPrimary: true })
        .toArray(),
      db.collection("buyer_profiles").find({ organisationId: { $in: organisationIds } }).toArray(),
      db
        .collection("enquiries")
        .aggregate<{ _id: string; count: number; last: Date }>([
          { $match: { buyerOrganisationId: { $in: organisationIds } } },
          { $group: { _id: "$buyerOrganisationId", count: { $sum: 1 }, last: { $max: "$createdAt" } } },
        ])
        .toArray(),
    ]);

    const contactByOrg = new Map(contacts.map((contact) => [contact.organisationId as string, contact]));
    const profileByOrg = new Map(profiles.map((profile) => [profile.organisationId as string, profile]));
    const enquiryByOrg = new Map(enquiryRows.map((row) => [row._id, row]));

    const items = organisations.map((organisation) => {
      const contact = contactByOrg.get(organisation._id as string);
      const profile = profileByOrg.get(organisation._id as string);
      const enquiry = enquiryByOrg.get(organisation._id as string);
      return {
        organisationId: organisation._id as string,
        name: organisation.legalName as string,
        contactName: (contact?.fullName as string | undefined) ?? null,
        email: (contact?.email as string | undefined) ?? null,
        phone: (contact?.phone as string | undefined) ?? null,
        gstin: (organisation.gstin as string | undefined) ?? null,
        city: (organisation.city as string | undefined) ?? null,
        stateCode: (organisation.stateCode as string | undefined) ?? null,
        accountStatus: organisation.accountStatus as string,
        verification: (profile?.verification as string | undefined) ?? null,
        createdAt: organisation.createdAt as Date,
        enquiries: enquiry?.count ?? 0,
        lastEnquiryAt: enquiry?.last ?? null,
      };
    });

    return { items, total, page, pageSize, counts };
  });
}

export interface BuyerDetail {
  organisation: BuyerRow & {
    tradeName: string | null;
    pan: string | null;
    iec: string | null;
    website: string | null;
    countryCode: string | null;
    verificationStatus: string;
    suspendedAt: Date | null;
    suspensionReason: string | null;
    internalNotes: string | null;
  };
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    stateCode: string | null;
    postalCode: string | null;
    countryCode: string | null;
  } | null;
  contacts: { id: string; fullName: string; roleLabel: string | null; email: string | null; phone: string | null; isPrimary: boolean }[];
  enquiryHistory: {
    id: string;
    reference: string;
    productTitle: string;
    quantity: string;
    unit: string;
    status: string;
    internalNotes: string | null;
    createdAt: Date;
  }[];
  auditTrail: { id: string; occurredAt: Date; action: string; actorRole: string | null }[];
}

/** One buyer organisation, its contacts, its enquiry history and the desk's own notes. */
export async function getBuyerDetail(organisationId: string): Promise<BuyerDetail | null> {
  return dataOr<BuyerDetail | null>(null, async (db) => {
    // The register page is searched by name, not id; a direct lookup is the bounded path for a detail view.
    const organisation = await db
      .collection("organisations")
      .findOne({ _id: organisationId, orgType: "BUYER", deletedAt: null });
    if (!organisation) return null;

    const [profile, contacts, address, enquiries, audit] = await Promise.all([
      db.collection("buyer_profiles").findOne({ organisationId }),
      db.collection("organisation_contacts").find({ organisationId }).sort({ isPrimary: -1 }).limit(20).toArray(),
      db.collection("organisation_addresses").findOne({ organisationId, kind: "REGISTERED" }),
      db
        .collection("enquiries")
        .find({ buyerOrganisationId: organisationId })
        .sort({ createdAt: -1 })
        .limit(25)
        .toArray(),
      db
        .collection("audit_logs")
        .find({ entityType: "Organisation", entityId: organisationId })
        .sort({ occurredAt: -1 })
        .limit(20)
        .toArray(),
    ]);

    const resolvedRow: BuyerRow = {
      organisationId,
      name: organisation.legalName as string,
      contactName: null,
      email: null,
      phone: null,
      gstin: (organisation.gstin as string | undefined) ?? null,
      city: (organisation.city as string | undefined) ?? null,
      stateCode: (organisation.stateCode as string | undefined) ?? null,
      accountStatus: organisation.accountStatus as string,
      verification: (profile?.verification as string | undefined) ?? null,
      createdAt: organisation.createdAt as Date,
      enquiries: enquiries.length,
      lastEnquiryAt: (enquiries[0]?.createdAt as Date | undefined) ?? null,
    };

    return {
      organisation: {
        ...resolvedRow,
        tradeName: (organisation.tradeName as string | undefined) ?? null,
        pan: (organisation.pan as string | undefined) ?? null,
        iec: (organisation.iec as string | undefined) ?? null,
        website: (organisation.website as string | undefined) ?? null,
        countryCode: (organisation.countryCode as string | undefined) ?? null,
        verificationStatus: organisation.verificationStatus as string,
        suspendedAt: (organisation.suspendedAt as Date | undefined) ?? null,
        suspensionReason: (organisation.suspensionReason as string | undefined) ?? null,
        internalNotes: (organisation.internalNotes as string | undefined) ?? null,
      },
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
      contacts: contacts.map((contact) => ({
        id: contact._id as string,
        fullName: (contact.fullName as string | undefined) ?? "—",
        roleLabel: (contact.roleLabel as string | undefined) ?? null,
        email: (contact.email as string | undefined) ?? null,
        phone: (contact.phone as string | undefined) ?? null,
        isPrimary: Boolean(contact.isPrimary),
      })),
      enquiryHistory: enquiries.map((enquiry) => ({
        id: enquiry._id as string,
        reference: enquiry.reference as string,
        productTitle: enquiry.productTitle as string,
        quantity: enquiry.quantity?.toString() ?? "0",
        unit: enquiry.unit as string,
        status: enquiry.status as string,
        internalNotes: (enquiry.internalNotes as string | undefined) ?? null,
        createdAt: enquiry.createdAt as Date,
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

// ---------------------------------------------------------------------------
// Suspension
// ---------------------------------------------------------------------------

export interface AccountStatusResult {
  before: { accountStatus: string; userStatus: string | null };
  after: { accountStatus: string; userStatus: string | null };
}

/**
 * Suspend or reactivate a buyer or seller account.
 *
 * Both the organisation and its login move in ONE transaction: a suspended company whose user can still
 * sign in is a suspension that does not work, and an active company whose user cannot sign in is an
 * outage. The seller decision in `admin.ts` uses the same pattern for the same reason.
 *
 * Only an ACTIVE account can be suspended and only a SUSPENDED one reactivated — the function refuses a
 * no-op, so the audit trail never contains "suspended" twice for one event. Reactivation restores
 * ACTIVE because a suspension is only ever applied to an account that was active; a rejected
 * application is not a suspension and is not reachable here.
 */
export async function setAccountStatus(
  actor: AuthUser,
  organisationId: string,
  action: "SUSPEND" | "REACTIVATE",
  reason?: string,
): Promise<AccountStatusResult> {
  requireAdminActor(actor);
  const db = await getDb();
  const organisation = await db
    .collection("organisations")
    .findOne({ _id: organisationId, deletedAt: null });
  if (!organisation) throw new Error("That organisation does not exist.");
  if (organisation.orgType !== "BUYER" && organisation.orgType !== "SELLER") {
    throw new Error("Only buyer and seller accounts can be suspended from this screen.");
  }

  const suspend = action === "SUSPEND";
  const note = (reason ?? "").trim();
  if (suspend && note.length < 5) throw new Error("Give a reason for the suspension — it is recorded internally.");
  if (suspend && organisation.accountStatus !== "ACTIVE") {
    throw new Error("Only an active account can be suspended.");
  }
  if (!suspend && organisation.accountStatus !== "SUSPENDED") {
    throw new Error("That account is not suspended.");
  }

  const profileCollection = organisation.orgType === "SELLER" ? "supplier_profiles" : "buyer_profiles";
  const profile = await db.collection(profileCollection).findOne({ organisationId });
  const userId = profile?.userId as string | undefined;
  const user = userId ? await db.collection("users").findOne({ _id: userId }) : null;
  if (user && (user.role === "ADMIN" || user.role === "SUPER_ADMIN")) {
    throw new Error("A staff account cannot be suspended from the account register.");
  }

  const before = {
    accountStatus: organisation.accountStatus as string,
    userStatus: (user?.status as string | undefined) ?? null,
  };
  const nextStatus = suspend ? "SUSPENDED" : "ACTIVE";
  const now = new Date();

  const client = await getClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const set: Record<string, unknown> = { accountStatus: nextStatus, updatedAt: now };
      const unset: Record<string, ""> = {};
      if (suspend) {
        set.suspendedAt = now;
        set.suspensionReason = note;
      } else {
        unset.suspendedAt = "";
        unset.suspensionReason = "";
      }
      const update = Object.keys(unset).length > 0 ? { $set: set, $unset: unset } : { $set: set };
      await db.collection("organisations").updateOne({ _id: organisationId }, update, { session });

      if (userId) {
        await db
          .collection("users")
          .updateOne(
            { _id: userId },
            { $set: { status: suspend ? "SUSPENDED" : "ACTIVE", updatedAt: now } },
            { session },
          );
      }
    });
  } finally {
    await session.endSession();
  }

  await writeAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: suspend ? "account.suspended" : "account.reactivated",
    entityType: "Organisation",
    entityId: organisationId,
    before,
    after: { accountStatus: nextStatus, userStatus: userId ? nextStatus : null, reason: suspend ? note : null },
    severity: "WARNING",
  });

  return { before, after: { accountStatus: nextStatus, userStatus: userId ? nextStatus : null } };
}

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

export interface ManufacturerRow {
  name: string;
  products: number;
  published: number;
}

/** Every manufacturer named on a live product, with usage counts. Bounded by the catalogue, not the estate. */
export async function listManufacturers(): Promise<ManufacturerRow[]> {
  return dataOr([], async (db) => {
    const rows = await db
      .collection("products")
      .aggregate<{ _id: string; products: number; published: number }>([
        { $match: { deletedAt: null, manufacturer: { $type: "string", $ne: "" } } },
        {
          $group: {
            _id: "$manufacturer",
            products: { $sum: 1 },
            published: { $sum: { $cond: [{ $eq: ["$publicationState", "PUBLISHED"] }, 1, 0] } },
          },
        },
        { $sort: { products: -1, _id: 1 } },
        { $limit: 200 },
      ])
      .toArray();
    return rows.map((row) => ({ name: row._id, products: row.products, published: row.published }));
  });
}

/**
 * Rename a manufacturer across every product that carries it.
 *
 * Products reference the manufacturer by name, not by id, so a rename is one bounded updateMany over the
 * matching products plus an audit row that records both names and the number of documents changed.
 * Slugs are untouched: the M5 brief requires existing product URLs to be preserved.
 */
export async function renameManufacturer(
  actor: AuthUser,
  from: string,
  to: string,
): Promise<{ updated: number }> {
  requireAdminActor(actor);
  const previous = from.trim();
  const next = to.trim();
  if (previous.length < 2) throw new Error("Choose the manufacturer to rename.");
  if (next.length < 2) throw new Error("Write the new manufacturer name.");
  if (next.length > 160) throw new Error("The manufacturer name is too long.");
  if (previous === next) throw new Error("The new name is the same as the old one.");

  const db = await getDb();
  const result = await db
    .collection("products")
    .updateMany({ deletedAt: null, manufacturer: previous }, { $set: { manufacturer: next, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new Error("No live product carries that manufacturer.");

  await writeAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "catalogue.manufacturer.renamed",
    entityType: "Product",
    entityId: null,
    before: { manufacturer: previous },
    after: { manufacturer: next, products: result.modifiedCount },
    severity: "NOTICE",
  });

  return { updated: result.modifiedCount };
}

// ---------------------------------------------------------------------------
// Enquiry history
// ---------------------------------------------------------------------------

/** The audit trail for one enquiry: status changes and note writes, newest first. */
export async function getEnquiryAuditTrail(
  enquiryId: string,
): Promise<{ id: string; occurredAt: Date; action: string; actorRole: string | null; after: unknown }[]> {
  return dataOr([], async (db) => {
    const rows = await db
      .collection("audit_logs")
      .find({ entityType: "Enquiry", entityId: enquiryId })
      .sort({ occurredAt: -1 })
      .limit(20)
      .toArray();
    return rows.map((row) => ({
      id: row._id as string,
      occurredAt: row.occurredAt as Date,
      action: row.action as string,
      actorRole: (row.actorRole as string | undefined) ?? null,
      after: row.afterState ?? null,
    }));
  });
}

// ---------------------------------------------------------------------------
// Audit history
// ---------------------------------------------------------------------------

export interface AuditPageRow {
  id: string;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  severity: string;
}

export interface AuditPage {
  items: AuditPageRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One page of the append-only audit log.
 *
 * The search term matches the action or the entity type, which are the two things an operator knows when
 * looking for an event. Actor email is resolved for the page only, not for every row in the collection.
 */
export async function listAuditPage(query: { q?: string; page?: number; pageSize?: number } = {}): Promise<AuditPage> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

  return dataOr<AuditPage>({ items: [], total: 0, page, pageSize }, async (db) => {
    const filter: Record<string, unknown> = {};
    const term = query.q?.trim();
    if (term) {
      const pattern = new RegExp(escapeRegex(term), "i");
      filter.$or = [{ action: pattern }, { entityType: pattern }];
    }

    const collection = db.collection("audit_logs");
    const [total, docs] = await Promise.all([
      collection.countDocuments(filter),
      collection
        .find(filter)
        .sort({ occurredAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);

    const actorIds = [...new Set(docs.map((doc) => doc.actorUserId as string | undefined).filter((id): id is string => Boolean(id)))];
    const users = actorIds.length
      ? await db.collection("users").find({ _id: { $in: actorIds } }).project({ _id: 1, email: 1 }).toArray()
      : [];
    const emailById = new Map(users.map((user) => [user._id as string, user.email as string]));

    return {
      items: docs.map((doc) => ({
        id: doc._id as string,
        occurredAt: doc.occurredAt as Date,
        action: doc.action as string,
        entityType: doc.entityType as string,
        entityId: (doc.entityId as string | undefined) ?? null,
        actorEmail: doc.actorUserId ? (emailById.get(doc.actorUserId as string) ?? null) : null,
        actorRole: (doc.actorRole as string | undefined) ?? null,
        severity: doc.severity as string,
      })),
      total,
      page,
      pageSize,
    };
  });
}
