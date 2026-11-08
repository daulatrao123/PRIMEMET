import { randomUUID } from "node:crypto";

import { getClient, getDb } from "@/lib/db";

export interface UserDocument {
  _id: string;
  email: string;
  passwordHash?: string | null;
  fullName: string;
  phone?: string | null;
  role: "ADMIN" | "BUYER" | "SELLER";
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED" | "ARCHIVED";
  failedLoginCount?: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;
}

export async function findUserByEmail(email: string): Promise<UserDocument | null> {
  const db = await getDb();
  return db.collection<UserDocument>("users").findOne({ email: email.toLowerCase() });
}

export class RegistrationConflictError extends Error {
  constructor(message = "An account with this email already exists. Sign in instead.") {
    super(message);
    this.name = "RegistrationConflictError";
  }
}

/**
 * The only roles a public registration may grant. Exported so the route, the tests and any future caller
 * read one list instead of restating it.
 */
export const REGISTRABLE_ROLES = ["BUYER", "SELLER"] as const;
export type RegistrableRole = (typeof REGISTRABLE_ROLES)[number];

export class RegistrationRoleError extends Error {
  constructor(message = "Choose whether you are registering as a buyer or a supplier.") {
    super(message);
    this.name = "RegistrationRoleError";
  }
}

/**
 * WHY THIS EXISTS. `"BUYER" | "SELLER"` is a compile-time type; it does not exist once the code runs. A
 * route that forwards a request body, a script, or any caller from plain JavaScript reaches
 * registerAccount() with whatever string it likes. That matters here more than almost anywhere else,
 * because this is the one function in the application that creates a user from unauthenticated input.
 *
 * The database validators reject an out-of-enum role too, but they are a second line of defence and not
 * a substitute: they are a property of the collection, not of the application, and they were the only
 * thing standing between a direct call and an ADMIN row. The allowlist denies before any handle is
 * opened, any session started or any document built, so a refused call cannot leave a partial record
 * for a transaction to roll back.
 */
function requireRegistrableRole(role: unknown): RegistrableRole {
  if (typeof role === "string" && (REGISTRABLE_ROLES as readonly string[]).includes(role)) {
    return role as RegistrableRole;
  }
  throw new RegistrationRoleError();
}

export interface RegistrationInput {
  company: string;
  contactName: string;
  email: string;
  phone?: string;
  gstin?: string;
  city?: string;
  stateCode?: string;
  addressLine1?: string;
  postalCode?: string;
  businessType?: string;
  description?: string;
  notes?: string;
  materials?: string;
  passwordHash: string;
  role: "BUYER" | "SELLER";
}

export interface RegistrationResult {
  userId: string;
  organisationId: string;
  /** `false` for a seller: the account exists but cannot sign in until an admin approves it. */
  active: boolean;
}

function verificationFor(gstin?: string): "PENDING" | "NOT_SUBMITTED" {
  // Capturing a GSTIN is not verifying it. The highest state a registration may set is PENDING.
  return gstin ? "PENDING" : "NOT_SUBMITTED";
}

/**
 * Create the user, organisation and profile in one transaction.
 *
 * WHY A TRANSACTION. A user row without its organisation is an account that can sign in and then see
 * nothing — and, worse, one whose isolation key is missing. The three documents either all exist or
 * none do. A duplicate email is caught by the unique index inside the transaction and reported as a
 * conflict, so two simultaneous registrations cannot both succeed.
 */
export async function registerAccount(input: RegistrationInput): Promise<RegistrationResult> {
  // Enforced first, before getDb() hands out a handle: an ADMIN is created by an administrator, never by
  // an applicant, and a refusal must not reach the database at all.
  const role = requireRegistrableRole(input.role);

  const db = await getDb();
  const client = await getClient();
  const now = new Date();

  const userId = randomUUID();
  const organisationId = randomUUID();
  const isBuyer = role === "BUYER";
  const verification = verificationFor(input.gstin);

  const user = {
    _id: userId,
    email: input.email,
    emailVerifiedAt: null,
    passwordHash: input.passwordHash,
    passwordChangedAt: now,
    fullName: input.contactName,
    phone: input.phone ?? null,
    locale: "en-IN",
    role,
    // A seller is INVITED until an admin approves: the row exists so the application can be reviewed,
    // and the login path refuses any status other than ACTIVE.
    status: isBuyer ? "ACTIVE" : "INVITED",
    mfaEnabled: false,
    mfaSecretCiphertext: null,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const organisation = {
    _id: organisationId,
    legalName: input.company,
    tradeName: null,
    registrationNumber: null,
    gstin: input.gstin ?? null,
    pan: null,
    iec: null,
    countryCode: "IN",
    stateCode: input.stateCode?.trim() || null,
    city: input.city?.trim() || null,
    website: null,
    accountStatus: isBuyer ? "ACTIVE" : "PENDING_APPROVAL",
    isListable: false,
    internalNotes: null,
    orgType: role,
    orgKind: role,
    verificationStatus: verification,
    // v008: the seller's declaration, reviewed by the desk. A buyer's registration leaves both empty.
    businessType: isBuyer ? null : input.businessType?.trim() || null,
    description: isBuyer ? null : input.description?.trim() || null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const contact = {
    _id: randomUUID(),
    organisationId,
    userId,
    fullName: input.contactName,
    roleLabel: isBuyer ? null : "Primary contact",
    email: input.email,
    phone: input.phone ?? null,
    isPrimary: true,
    shareable: false,
    createdAt: now,
    updatedAt: now,
  };

  const profile = isBuyer
    ? {
        _id: randomUUID(),
        organisationId,
        userId,
        verification,
        jobTitle: null,
        department: null,
        preferredCurrency: "INR",
        industries: [],
        preferredGrades: [],
        typicalMonthlyKg: null,
        deliveryStates: input.stateCode ? [input.stateCode] : [],
        creditTermsDays: null,
        creditLimit: null,
        notesInternal: input.notes?.trim() ? input.notes.trim() : null,
        createdAt: now,
        updatedAt: now,
      }
    : {
        _id: randomUUID(),
        organisationId,
        userId,
        verification,
        contactRole: "Primary contact",
        isPrimaryContact: true,
        canSubmitQuotes: false,
        capabilities: input.materials?.trim() ? [input.materials.trim()] : [],
        materialsHandled: [],
        geographicReach: input.stateCode ? [input.stateCode] : [],
        monthlyCapacityKg: null,
        notesInternal: input.notes?.trim() ? input.notes.trim() : null,
        createdAt: now,
        updatedAt: now,
      };

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const exists = await db.collection("users").findOne({ email: input.email }, { session });
      if (exists) throw new RegistrationConflictError();

      await db.collection("users").insertOne(user, { session });
      await db.collection("organisations").insertOne(organisation, { session });
      await db.collection("organisation_contacts").insertOne(contact, { session });
      await db
        .collection(isBuyer ? "buyer_profiles" : "supplier_profiles")
        .insertOne(profile, { session });

      // The registered address is a party fact, not a login fact: it lives in its own collection so a
      // company can hold a registered office, a works address and a despatch point.
      if (!isBuyer) {
        await db.collection("organisation_addresses").insertOne(
          {
            _id: randomUUID(),
            organisationId,
            kind: "REGISTERED",
            label: "Registered office",
            line1: input.addressLine1?.trim() || null,
            line2: null,
            city: input.city?.trim() || "",
            stateCode: input.stateCode?.trim() || "",
            postalCode: input.postalCode?.trim() || null,
            countryCode: "IN",
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          },
          { session },
        );
      }
    });
  } catch (error) {
    if (error instanceof RegistrationConflictError) throw error;
    // A duplicate key from the unique email index is the same conflict, reported the same way.
    if (error && typeof error === "object" && "code" in error && (error as { code?: number }).code === 11000) {
      throw new RegistrationConflictError();
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return { userId, organisationId, active: isBuyer };
}

export interface SellerApplicationNotice {
  accountStatus: string;
  reviewFeedback: string | null;
}

/**
 * The seller-facing state behind a refused sign-in.
 *
 * WHY THIS IS SAFE. The caller has already proved knowledge of the account's password, so revealing the
 * desk's seller-facing note to it is not an enumeration oracle: an attacker without the password gets the
 * generic failure before this is called. The note itself is `organisations.reviewFeedback`, which is
 * written for the seller to read — `internalNotes` is never read here.
 */
export async function sellerApplicationNotice(userId: string): Promise<SellerApplicationNotice | null> {
  const db = await getDb();
  const profile = await db.collection("supplier_profiles").findOne({ userId });
  if (!profile?.organisationId) return null;
  const organisation = await db
    .collection("organisations")
    .findOne({ _id: profile.organisationId }, { projection: { accountStatus: 1, reviewFeedback: 1 } });
  if (!organisation) return null;
  return {
    accountStatus: organisation.accountStatus as string,
    reviewFeedback: (organisation.reviewFeedback as string | undefined) ?? null,
  };
}

/** Record a failed password attempt. Locks the account for 15 minutes after 8 consecutive failures. */
export async function recordLoginFailure(userId: string): Promise<void> {
  const db = await getDb();
  const result = await db
    .collection<UserDocument>("users")
    .findOneAndUpdate(
      { _id: userId },
      { $inc: { failedLoginCount: 1 }, $set: { updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  const count = result?.failedLoginCount ?? 0;
  if (count >= 8) {
    await db
      .collection("users")
      .updateOne(
        { _id: userId },
        { $set: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000), failedLoginCount: 0 } },
      );
  }
}

/** Record a successful login and clear the failure counter. */
export async function recordLoginSuccess(userId: string): Promise<void> {
  const db = await getDb();
  await db.collection("users").updateOne(
    { _id: userId },
    { $set: { failedLoginCount: 0, lastLoginAt: new Date(), lockedUntil: null } },
  );
}