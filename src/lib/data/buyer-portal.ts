import { writeAuditLog } from "@/lib/auth/audit";
import type { AuthUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { requireBuyerOrganisation } from "./authorise";
import { dataOr } from "./db-safe";
import type { BuyerEnquiry } from "./enquiries";
import { listEnquiriesForOrganisation } from "./enquiries";

/**
 * The buyer portal's own data.
 *
 * EVERY function here takes the `AuthUser` and derives the organisation from it. There is no variant that
 * accepts an organisation id from a form, a query string or a hidden field, so an "edit my company"
 * request cannot be pointed at another company by editing the request. The rule lives here, once, rather
 * than in each page.
 */

export interface BuyerOrganisation {
  id: string;
  legalName: string;
  tradeName: string | null;
  gstin: string | null;
  pan: string | null;
  city: string | null;
  stateCode: string | null;
  website: string | null;
  accountStatus: string;
  verificationStatus: string | null;
}

export interface BuyerProfileView {
  contactName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  organisation: BuyerOrganisation | null;
}

interface OrganisationDoc {
  _id: string;
  legalName: string;
  tradeName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  city?: string | null;
  stateCode?: string | null;
  website?: string | null;
  accountStatus: string;
  verificationStatus?: string | null;
}

interface ProfileDoc {
  _id: string;
  organisationId: string;
  userId?: string | null;
  jobTitle?: string | null;
  department?: string | null;
}

/** The signed-in buyer's company and contact details, or nulls when the account has no organisation. */
export async function getBuyerProfile(user: AuthUser): Promise<BuyerProfileView> {
  const empty: BuyerProfileView = {
    contactName: user.fullName,
    email: user.email,
    phone: null,
    jobTitle: null,
    department: null,
    organisation: null,
  };

  return dataOr(empty, async (db) => {
    const organisationId = user.organisationId;
    if (!organisationId) return empty;

    const [organisation, profile, userDoc] = await Promise.all([
      db.collection<OrganisationDoc>("organisations").findOne({ _id: organisationId, deletedAt: null }),
      db.collection<ProfileDoc>("buyer_profiles").findOne({ organisationId }),
      db.collection<{ _id: string; phone?: string | null }>("users").findOne({ _id: user.id }),
    ]);

    return {
      contactName: user.fullName,
      email: user.email,
      phone: userDoc?.phone ?? null,
      jobTitle: profile?.jobTitle ?? null,
      department: profile?.department ?? null,
      organisation: organisation
        ? {
            id: organisation._id,
            legalName: organisation.legalName,
            tradeName: organisation.tradeName ?? null,
            gstin: organisation.gstin ?? null,
            pan: organisation.pan ?? null,
            city: organisation.city ?? null,
            stateCode: organisation.stateCode ?? null,
            website: organisation.website ?? null,
            accountStatus: organisation.accountStatus,
            verificationStatus: organisation.verificationStatus ?? null,
          }
        : null,
    };
  });
}

export interface BuyerProfileInput {
  contactName?: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  company?: string;
  city?: string;
  stateCode?: string;
  website?: string;
}

/**
 * Update the buyer's own details.
 *
 * A GSTIN is deliberately NOT editable here. It is the identity the organisation was verified against: if
 * a buyer could retype it, the verified badge would describe a number nobody checked. Changing it is an
 * administrative act with evidence, so it stays out of a self-service form.
 */
export async function updateBuyerProfile(user: AuthUser, input: BuyerProfileInput): Promise<void> {
  const organisationId = requireBuyerOrganisation(user);
  const db = await getDb();
  const now = new Date();

  const userSet: Record<string, unknown> = { updatedAt: now };
  if (input.contactName?.trim()) userSet.fullName = input.contactName.trim().slice(0, 240);
  if (input.phone !== undefined) userSet.phone = input.phone.trim() || null;
  await db.collection("users").updateOne({ _id: user.id }, { $set: userSet });

  const profileSet: Record<string, unknown> = { updatedAt: now };
  if (input.jobTitle !== undefined) profileSet.jobTitle = input.jobTitle.trim() || null;
  if (input.department !== undefined) profileSet.department = input.department.trim() || null;
  await db
    .collection("buyer_profiles")
    .updateOne({ organisationId }, { $set: profileSet });

  const organisationSet: Record<string, unknown> = { updatedAt: now };
  if (input.company?.trim()) organisationSet.legalName = input.company.trim().slice(0, 240);
  if (input.city !== undefined) organisationSet.city = input.city.trim() || null;
  if (input.stateCode !== undefined) organisationSet.stateCode = input.stateCode.trim() || null;
  if (input.website !== undefined) organisationSet.website = input.website.trim() || null;

  // Guarded by the organisation id, not by a document id from the request.
  const result = await db
    .collection("organisations")
    .updateOne({ _id: organisationId }, { $set: organisationSet });

  await writeAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: "buyer.profile.updated",
    entityType: "Organisation",
    entityId: organisationId,
    before: null,
    after: { fields: Object.keys({ ...userSet, ...profileSet, ...organisationSet }).filter((key) => key !== "updatedAt") },
    severity: "NOTICE",
  });

  if (result.matchedCount !== 1) throw new Error("Your organisation could not be found.");
}

export interface BuyerDashboard {
  total: number;
  open: number;
  won: number;
  lost: number;
  byStatus: Record<string, number>;
  recent: BuyerEnquiry[];
}

const OPEN_STATUSES = [
  "NEW",
  "UNDER_REVIEW",
  "MATCHING_SUPPLIERS",
  "QUOTES_REQUESTED",
  "QUOTES_RECEIVED",
  "QUOTE_SENT",
  "NEGOTIATION",
];

/** Counts and the latest enquiries for one organisation, aggregated in the database. */
export async function buyerDashboard(user: AuthUser): Promise<BuyerDashboard> {
  const empty: BuyerDashboard = { total: 0, open: 0, won: 0, lost: 0, byStatus: {}, recent: [] };
  if (!user.organisationId) return empty;

  return dataOr(empty, async (db) => {
    const organisationId = requireBuyerOrganisation(user);
    const [rows, recent] = await Promise.all([
      db
        .collection("enquiries")
        .aggregate<{ _id: string; count: number }>([
          { $match: { buyerOrganisationId: organisationId } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
        .toArray(),
      listEnquiriesForOrganisation(organisationId),
    ]);

    const byStatus = Object.fromEntries(rows.map((row) => [row._id, row.count]));
    const total = rows.reduce((sum, row) => sum + row.count, 0);

    return {
      total,
      open: OPEN_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0),
      won: byStatus.WON ?? 0,
      lost: byStatus.LOST ?? 0,
      byStatus,
      recent: recent.slice(0, 5),
    };
  });
}
