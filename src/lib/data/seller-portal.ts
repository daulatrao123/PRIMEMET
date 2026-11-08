import { randomUUID } from "node:crypto";

import { writeAuditLog } from "@/lib/auth/audit";
import type { AuthUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { requireSellerProfile } from "./authorise";
import { dataOr } from "./db-safe";
import type { SellerListing } from "./listings";
import { listListingsForSupplier } from "./listings";

/**
 * The seller portal's own data.
 *
 * THE RULE, IN ONE PLACE. Every function takes the `AuthUser` and derives the organisation and supplier
 * profile from it. There is no variant that accepts an organisation id from a form, a query string or a
 * hidden field, so "edit my company" and "my listings" cannot be retargeted at another company by
 * editing the request. The buyer portal uses the same shape (`buyer-portal.ts`).
 *
 * WHAT A SELLER MAY NOT WRITE. `accountStatus`, `verificationStatus`, `reviewFeedback`, `reviewedAt` and
 * every listing's `reviewStatus` are outside the allow-list of `updateSellerProfile`. A seller can
 * correct its own name, address and description; it cannot approve itself or edit the desk's decision.
 */

export const SELLER_BUSINESS_TYPES = [
  "MANUFACTURER",
  "TRADER",
  "STOCKIST",
  "PROCESSOR",
  "RECYCLER",
  "WORKSHOP",
  "OTHER",
] as const;

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  MANUFACTURER: "Manufacturer",
  TRADER: "Trader",
  STOCKIST: "Stockist / distributor",
  PROCESSOR: "Processor",
  RECYCLER: "Recycler",
  WORKSHOP: "Specialist workshop",
  OTHER: "Other",
};

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting PRIMEMET approval",
  ACTIVE: "Approved",
  REJECTED: "Not approved",
  SUSPENDED: "Suspended",
  DISABLED: "Disabled",
};

export interface SellerAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  countryCode: string | null;
}

export interface SellerApplicationView {
  contactName: string;
  email: string;
  phone: string | null;
  organisation: {
    id: string;
    legalName: string;
    tradeName: string | null;
    gstin: string | null;
    pan: string | null;
    website: string | null;
    businessType: string | null;
    description: string | null;
    city: string | null;
    stateCode: string | null;
    accountStatus: string;
    verificationStatus: string | null;
    reviewFeedback: string | null;
    reviewedAt: Date | null;
    createdAt: Date | null;
  } | null;
  address: SellerAddress | null;
  verification: string | null;
  canSubmitListings: boolean;
}

interface OrganisationDoc {
  _id: string;
  legalName: string;
  tradeName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  website?: string | null;
  businessType?: string | null;
  description?: string | null;
  city?: string | null;
  stateCode?: string | null;
  accountStatus: string;
  verificationStatus?: string | null;
  reviewFeedback?: string | null;
  reviewedAt?: Date | null;
  createdAt?: Date;
}

interface AddressDoc {
  _id: string;
  organisationId: string;
  kind: string;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  stateCode?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
}

interface SellerProfileDoc {
  _id: string;
  organisationId: string;
  userId?: string | null;
  verification?: string | null;
  canSubmitQuotes?: boolean;
}

/** The signed-in seller's company, address and decision state. */
export async function getSellerApplication(user: AuthUser): Promise<SellerApplicationView> {
  const empty: SellerApplicationView = {
    contactName: user.fullName,
    email: user.email,
    phone: null,
    organisation: null,
    address: null,
    verification: null,
    canSubmitListings: false,
  };

  return dataOr(empty, async (db) => {
    const organisationId = user.organisationId;
    if (!organisationId) return empty;

    const [organisation, profile, address, userDoc, contact] = await Promise.all([
      db.collection<OrganisationDoc>("organisations").findOne({ _id: organisationId, deletedAt: null }),
      db.collection<SellerProfileDoc>("supplier_profiles").findOne({ organisationId }),
      db
        .collection<AddressDoc>("organisation_addresses")
        .findOne({ organisationId, kind: "REGISTERED" }),
      db.collection<{ _id: string; phone?: string | null }>("users").findOne({ _id: user.id }),
      db
        .collection<{ organisationId: string; fullName?: string | null; email?: string | null; phone?: string | null }>(
          "organisation_contacts",
        )
        .findOne({ organisationId, isPrimary: true }),
    ]);

    return {
      contactName: contact?.fullName ?? user.fullName,
      email: contact?.email ?? user.email,
      phone: contact?.phone ?? userDoc?.phone ?? null,
      organisation: organisation
        ? {
            id: organisation._id,
            legalName: organisation.legalName,
            tradeName: organisation.tradeName ?? null,
            gstin: organisation.gstin ?? null,
            pan: organisation.pan ?? null,
            website: organisation.website ?? null,
            businessType: organisation.businessType ?? null,
            description: organisation.description ?? null,
            city: organisation.city ?? null,
            stateCode: organisation.stateCode ?? null,
            accountStatus: organisation.accountStatus,
            verificationStatus: organisation.verificationStatus ?? null,
            reviewFeedback: organisation.reviewFeedback ?? null,
            reviewedAt: organisation.reviewedAt ?? null,
            createdAt: organisation.createdAt ?? null,
          }
        : null,
      address: address
        ? {
            line1: address.line1 ?? null,
            line2: address.line2 ?? null,
            city: address.city ?? null,
            stateCode: address.stateCode ?? null,
            postalCode: address.postalCode ?? null,
            countryCode: address.countryCode ?? null,
          }
        : null,
      verification: profile?.verification ?? organisation?.verificationStatus ?? null,
      // A pending application may still prepare its profile and submit listings; nothing it writes
      // reaches the public catalogue, because publication is an admin act. A rejected or suspended
      // organisation is refused at the listing route.
      canSubmitListings: Boolean(organisation && !["REJECTED", "SUSPENDED"].includes(organisation.accountStatus)),
    };
  });
}

export interface SellerProfileInput {
  company?: string;
  tradeName?: string;
  businessType?: string;
  description?: string;
  website?: string;
  city?: string;
  stateCode?: string;
  line1?: string;
  line2?: string;
  postalCode?: string;
  contactName?: string;
  phone?: string;
}

/**
 * Update the seller's own application and company details.
 *
 * THE GSTIN IS NOT EDITABLE HERE. It is the number the application is reviewed against; if a seller could
 * retype it after submitting, the desk's decision would describe a different company. Changing it is an
 * administrative act with evidence, so it is not in the allow-list below.
 *
 * THE ACCOUNT STATUS IS NOT WRITABLE HERE EITHER. `accountStatus`, `verificationStatus` and
 * `reviewFeedback` are simply absent from the `$set` this function builds: there is no code path in the
 * seller portal that can approve an application or erase a rejection note.
 */
export async function updateSellerProfile(user: AuthUser, input: SellerProfileInput): Promise<void> {
  const { organisationId } = requireSellerProfile(user);
  const db = await getDb();
  const now = new Date();

  const userSet: Record<string, unknown> = { updatedAt: now };
  if (input.contactName?.trim()) userSet.fullName = input.contactName.trim().slice(0, 200);
  if (input.phone !== undefined) userSet.phone = input.phone.trim() || null;
  await db.collection("users").updateOne({ _id: user.id }, { $set: userSet });

  const contactSet: Record<string, unknown> = { updatedAt: now };
  if (input.contactName?.trim()) contactSet.fullName = input.contactName.trim().slice(0, 200);
  if (input.phone !== undefined) contactSet.phone = input.phone.trim() || null;
  await db
    .collection("organisation_contacts")
    .updateOne({ organisationId, isPrimary: true }, { $set: contactSet });

  const organisationSet: Record<string, unknown> = { updatedAt: now };
  if (input.company?.trim()) organisationSet.legalName = input.company.trim().slice(0, 240);
  if (input.tradeName !== undefined) organisationSet.tradeName = input.tradeName.trim() || null;
  if (input.businessType !== undefined) organisationSet.businessType = input.businessType.trim() || null;
  if (input.description !== undefined) organisationSet.description = input.description.trim().slice(0, 2000) || null;
  if (input.website !== undefined) organisationSet.website = input.website.trim() || null;
  if (input.city !== undefined) organisationSet.city = input.city.trim() || null;
  if (input.stateCode !== undefined) organisationSet.stateCode = input.stateCode.trim() || null;

  const result = await db
    .collection("organisations")
    .updateOne({ _id: organisationId }, { $set: organisationSet });

  // The registered address lives in its own collection (one organisation may have several addresses).
  // Upsert keyed by the session's organisation id and the fixed kind — never by a document id.
  const addressSet: Record<string, unknown> = { updatedAt: now };
  if (input.line1 !== undefined) addressSet.line1 = input.line1.trim() || null;
  if (input.line2 !== undefined) addressSet.line2 = input.line2.trim() || null;
  if (input.city !== undefined) addressSet.city = input.city.trim();
  if (input.stateCode !== undefined) addressSet.stateCode = input.stateCode.trim();
  if (input.postalCode !== undefined) addressSet.postalCode = input.postalCode.trim() || null;

  if (Object.keys(addressSet).length > 1) {
    // The validator requires city, stateCode and countryCode, so an insert carries the organisation's
    // current values when the request did not repeat them. Without this, a caller that saves only a
    // street line would turn a partial update into a document-validation error.
    const current = await db
      .collection<OrganisationDoc>("organisations")
      .findOne({ _id: organisationId }, { projection: { city: 1, stateCode: 1 } });
    await db.collection("organisation_addresses").updateOne(
      { organisationId, kind: "REGISTERED" },
      {
        $set: addressSet,
        // A path may appear in $set or $setOnInsert, never both, so a field the request already set is
        // left out of the insert defaults.
        $setOnInsert: {
          _id: randomUUID(),
          organisationId,
          kind: "REGISTERED",
          label: "Registered office",
          countryCode: "IN",
          isDefault: true,
          createdAt: now,
          ...(addressSet.city === undefined ? { city: current?.city ?? "" } : {}),
          ...(addressSet.stateCode === undefined ? { stateCode: current?.stateCode ?? "" } : {}),
        },
      },
      { upsert: true },
    );
  }

  await writeAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: "seller.profile.updated",
    entityType: "Organisation",
    entityId: organisationId,
    before: null,
    after: {
      fields: [
        ...Object.keys(userSet),
        ...Object.keys(contactSet),
        ...Object.keys(organisationSet),
        ...Object.keys(addressSet),
      ].filter((key) => key !== "updatedAt"),
    },
    severity: "NOTICE",
  });

  if (result.matchedCount !== 1) throw new Error("Your organisation could not be found.");
}

export interface SellerDashboard {
  legalName: string | null;
  accountStatus: string;
  reviewFeedback: string | null;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  recent: SellerListing[];
}

/** Counts and the latest submissions for one seller, aggregated in the database. */
export async function sellerDashboard(user: AuthUser): Promise<SellerDashboard> {
  const { organisationId, supplierProfileId } = requireSellerProfile(user);
  const empty: SellerDashboard = {
    legalName: null,
    accountStatus: "UNKNOWN",
    reviewFeedback: null,
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    recent: [],
  };

  return dataOr(empty, async (db) => {
    const [organisation, rows, recent] = await Promise.all([
      db.collection("organisations").findOne({ _id: organisationId, deletedAt: null }),
      db
        .collection("supplier_listings")
        .aggregate<{ _id: string; count: number }>([
          { $match: { supplierId: supplierProfileId } },
          { $group: { _id: "$reviewStatus", count: { $sum: 1 } } },
        ])
        .toArray(),
      listListingsForSupplier(supplierProfileId),
    ]);

    const byStatus = Object.fromEntries(rows.map((row) => [row._id, row.count]));
    const total = rows.reduce((sum, row) => sum + row.count, 0);

    return {
      legalName: (organisation?.legalName as string | undefined) ?? null,
      accountStatus: (organisation?.accountStatus as string | undefined) ?? "UNKNOWN",
      reviewFeedback: (organisation?.reviewFeedback as string | undefined) ?? null,
      total,
      pending: byStatus.PENDING ?? 0,
      approved: byStatus.APPROVED ?? 0,
      rejected: byStatus.REJECTED ?? 0,
      recent: recent.slice(0, 5),
    };
  });
}
