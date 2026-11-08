import { getClient, getDb } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/auth/audit";
import { requireAdminActor } from "./authorise";
import { dataOr } from "./db-safe";
import { adminOverview } from "./admin-console";

/**
 * Admin reads and the seller-approval decision.
 *
 * Everything here is called from an ADMIN-guarded page or route. The functions still take the actor id
 * where a decision is made, because the audit row is part of the operation, not an afterthought in the
 * route.
 */

export interface PartyRow {
  organisationId: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  city: string | null;
  stateCode: string | null;
  accountStatus: string;
  verificationStatus: string;
  gstinVerification: "PENDING" | "NOT_SUBMITTED" | "VERIFIED" | "REJECTED" | "EXPIRED" | "UNDER_REVIEW" | null;
  createdAt: Date;
  userId: string | null;
  userStatus: string | null;
  enquiryCount?: number;
  listingCount?: number;
}

async function partiesFor(orgType: "BUYER" | "SELLER"): Promise<PartyRow[]> {
  const db = await getDb();
  const organisations = await db
    .collection("organisations")
    .find({ orgType, deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(300)
    .toArray();
  if (organisations.length === 0) return [];

  const organisationIds = organisations.map((org) => org._id as string);
  const contacts = await db
    .collection("organisation_contacts")
    .find({ organisationId: { $in: organisationIds }, isPrimary: true })
    .toArray();
  const profiles = await db
    .collection(orgType === "BUYER" ? "buyer_profiles" : "supplier_profiles")
    .find({ organisationId: { $in: organisationIds } })
    .toArray();
  const userIds = profiles.map((profile) => profile.userId).filter((id): id is string => Boolean(id));
  const users = await db
    .collection("users")
    .find({ _id: { $in: userIds } })
    .project({ _id: 1, status: 1 })
    .toArray();

  const contactByOrg = new Map(contacts.map((contact) => [contact.organisationId as string, contact]));
  const profileByOrg = new Map(profiles.map((profile) => [profile.organisationId as string, profile]));
  const statusByUser = new Map(users.map((user) => [user._id as string, user.status as string]));

  const enquiryCounts = new Map<string, number>();
  if (orgType === "BUYER") {
    const rows = await db
      .collection("enquiries")
      .aggregate<{ _id: string; count: number }>([
        { $match: { buyerOrganisationId: { $in: organisationIds } } },
        { $group: { _id: "$buyerOrganisationId", count: { $sum: 1 } } },
      ])
      .toArray();
    for (const row of rows) enquiryCounts.set(row._id, row.count);
  }

  const listingCounts = new Map<string, number>();
  if (orgType === "SELLER") {
    const supplierIds = profiles.map((profile) => profile._id as string);
    const rows = await db
      .collection("supplier_listings")
      .aggregate<{ _id: string; count: number }>([
        { $match: { supplierId: { $in: supplierIds } } },
        { $group: { _id: "$supplierId", count: { $sum: 1 } } },
      ])
      .toArray();
    const profileToOrg = new Map(profiles.map((profile) => [profile._id as string, profile.organisationId as string]));
    for (const row of rows) {
      const orgId = profileToOrg.get(row._id);
      if (orgId) listingCounts.set(orgId, row.count);
    }
  }

  return organisations.map((organisation) => {
    const contact = contactByOrg.get(organisation._id as string);
    const profile = profileByOrg.get(organisation._id as string);
    const userId = (profile?.userId as string | undefined) ?? null;
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
      verificationStatus: organisation.verificationStatus as string,
      gstinVerification: (profile?.verification as PartyRow["gstinVerification"]) ?? null,
      createdAt: organisation.createdAt as Date,
      userId,
      userStatus: userId ? (statusByUser.get(userId) ?? null) : null,
      enquiryCount: enquiryCounts.get(organisation._id as string) ?? 0,
      listingCount: listingCounts.get(organisation._id as string) ?? 0,
    };
  });
}

export async function listBuyers(): Promise<PartyRow[]> {
  return dataOr([], () => partiesFor("BUYER"));
}

export async function listSellers(): Promise<PartyRow[]> {
  return dataOr([], () => partiesFor("SELLER"));
}

export interface DashboardStats {
  buyers: number;
  sellers: number;
  pendingSellers: number;
  approvedSellers: number;
  suspendedAccounts: number;
  products: number;
  publishedProducts: number;
  categories: number;
  enquiries: number;
  newEnquiries: number;
  inProgressEnquiries: number;
  completedEnquiries: number;
  pendingListings: number;
}

/**
 * The overview figures.
 *
 * Delegates to `admin-console.ts`, which owns the M5 control centre: the counts are two `$group`
 * aggregations over organisations and enquiries rather than a dozen `countDocuments` calls. This entry
 * point stays because the M1 verification group and older callers read it by this name.
 */
export async function dashboardStats(): Promise<DashboardStats> {
  const overview = await adminOverview();
  return {
    buyers: overview.buyers,
    sellers: overview.sellers,
    pendingSellers: overview.pendingSellers,
    approvedSellers: overview.approvedSellers,
    suspendedAccounts: overview.suspendedAccounts,
    products: overview.products,
    publishedProducts: overview.publishedProducts,
    categories: overview.categories,
    enquiries: overview.enquiries,
    newEnquiries: overview.newEnquiries,
    inProgressEnquiries: overview.inProgressEnquiries,
    completedEnquiries: overview.completedEnquiries,
    pendingListings: overview.pendingListings,
  };
}

export interface SellerDecisionResult {
  before: {
    userStatus: string | null;
    accountStatus: string;
    verification: string | null;
  };
}

/**
 * Approve or reject a seller application.
 *
 * Approval activates the ACCOUNT (user status ACTIVE) and the organisation (accountStatus ACTIVE). It
 * deliberately does not touch GST verification: `supplier_profiles.verification` stays PENDING, because
 * opening an account and verifying a tax registration are different decisions with different evidence.
 * The directive is explicit that GST information must never be marked verified automatically.
 */
export async function decideSeller(
  actor: AuthUser,
  organisationId: string,
  decision: "APPROVE" | "REJECT",
  reason?: string,
): Promise<SellerDecisionResult> {
  requireAdminActor(actor);
  const db = await getDb();
  const organisation = await db.collection("organisations").findOne({ _id: organisationId, orgType: "SELLER" });
  if (!organisation) throw new Error("That seller organisation does not exist.");

  const profile = await db.collection("supplier_profiles").findOne({ organisationId });
  if (!profile) throw new Error("That seller has no supplier profile.");

  const userId = profile.userId as string | undefined;
  const user = userId ? await db.collection("users").findOne({ _id: userId }) : null;
  if (user && user.role !== "SELLER") throw new Error("That user is not a seller account.");

  const before = {
    userStatus: (user?.status as string | undefined) ?? null,
    accountStatus: organisation.accountStatus as string,
    verification: (profile.verification as string | undefined) ?? null,
  };

  const now = new Date();
  const approved = decision === "APPROVE";
  const feedback = approved
    ? "Your company has been approved. You can sign in and submit listings for review."
    : (reason ?? "").trim();
  if (!approved && feedback.length < 5) {
    throw new Error("Give a reason for rejecting the application \u2014 the seller reads it.");
  }

  // One transaction: a seller must never end up with an activated user and a still-pending organisation
  // (or the reverse), because the session guard reads the user status while the portal reads the org.
  const client = await getClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      if (userId) {
        await db.collection("users").updateOne(
          { _id: userId },
          { $set: { status: approved ? "ACTIVE" : "DISABLED", updatedAt: now } },
          { session },
        );
      }

      await db.collection("organisations").updateOne(
        { _id: organisationId },
        {
          $set: {
            accountStatus: approved ? "ACTIVE" : "REJECTED",
            // What the seller is allowed to read. internalNotes stays private to the desk.
            reviewFeedback: feedback,
            reviewedAt: now,
            reviewedByUserId: actor.id,
            updatedAt: now,
          },
        },
        { session },
      );

      if (!approved) {
        await db.collection("supplier_profiles").updateOne(
          { _id: profile._id },
          { $set: { verification: "REJECTED", updatedAt: now } },
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
    action: approved ? "seller.application.approved" : "seller.application.rejected",
    entityType: "Organisation",
    entityId: organisationId,
    before,
    after: { userStatus: approved ? "ACTIVE" : "DISABLED", accountStatus: approved ? "ACTIVE" : "REJECTED" },
    severity: "NOTICE",
  });

  return { before };
}

export interface AuditRow {
  id: string;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  severity: string;
}

export async function listAuditLogs(limit = 100): Promise<AuditRow[]> {
  return dataOr([], async (db) => {
    const docs = await db.collection("audit_logs").find({}).sort({ occurredAt: -1 }).limit(limit).toArray();
    const actorIds = [...new Set(docs.map((doc) => doc.actorUserId).filter((id): id is string => Boolean(id)))];
    const users = await db
      .collection("users")
      .find({ _id: { $in: actorIds } })
      .project({ _id: 1, email: 1 })
      .toArray();
    const emailById = new Map(users.map((user) => [user._id as string, user.email as string]));

    return docs.map((doc) => ({
      id: doc._id as string,
      occurredAt: doc.occurredAt as Date,
      action: doc.action as string,
      entityType: doc.entityType as string,
      entityId: (doc.entityId as string | undefined) ?? null,
      actorEmail: doc.actorUserId ? (emailById.get(doc.actorUserId as string) ?? null) : null,
      actorRole: (doc.actorRole as string | undefined) ?? null,
      severity: doc.severity as string,
    }));
  });
}