/**
 * PRIMEMET — input validation for the Phase 1 write paths.
 *
 * The rules are here, once, and every route handler parses its input through them. The database has its
 * own validator underneath (and refuses a document that violates it), so this layer is not the last line
 * of defence — it is the one that produces a message a person can act on, before a write is attempted.
 *
 * Two details that are easy to get wrong and are therefore explicit:
 *
 *   - Email is lower-cased here, because `users.email` is unique and the validator refuses a
 *     non-normalised address. "Buyer@Company.com" and "buyer@company.com" must be one account.
 *   - GSTIN is upper-cased and format-checked but NOT verified. Capturing a number is not verifying it;
 *     only an admin decision can move `verificationStatus`, and Phase 1 never does that automatically.
 */

import { z } from "zod";
import { passwordProblem } from "./auth/password";

const email = z
  .string()
  .trim()
  .min(3, "Enter a work email address.")
  .max(320, "That email address is too long.")
  .email("Enter a valid email address.")
  .transform((value) => value.toLowerCase());

const personName = z.string().trim().min(2, "Enter a contact name.").max(200);
const companyName = z.string().trim().min(2, "Enter the registered company name.").max(240);

const phone = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((value) => (value ? value : undefined));

/** Indian GSTIN: 2-digit state, 5 letters, 4 digits, letter, entity, Z, checksum. Format only. */
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine(
    (value) => value === undefined || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value),
    "A GSTIN is 15 characters, for example 27ABCDE1234F1Z5.",
  );

const password = z
  .string()
  .min(1, "Choose a password.")
  .superRefine((value, ctx) => {
    const problem = passwordProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

const passwordPair = { password, passwordConfirm: z.string().min(1, "Repeat the password.") };

function passwordsMatch<T extends { password: string; passwordConfirm: string }>(value: T): boolean {
  return value.password === value.passwordConfirm;
}

const passwordsMatchMessage = {
  message: "The two passwords do not match.",
  path: ["passwordConfirm"],
};

export const buyerRegistrationSchema = z
  .object({
    company: companyName,
    contactName: personName,
    email,
    phone,
    gstin,
    city: z.string().trim().max(120).optional(),
    stateCode: z.string().trim().max(8).optional(),
    notes: z.string().trim().max(2000).optional(),
    ...passwordPair,
  })
  .refine((value) => passwordsMatch(value), passwordsMatchMessage);

export const SELLER_BUSINESS_TYPE_VALUES = [
  "MANUFACTURER",
  "TRADER",
  "STOCKIST",
  "PROCESSOR",
  "RECYCLER",
  "WORKSHOP",
  "OTHER",
] as const;

const businessType = z
  .enum(["", ...SELLER_BUSINESS_TYPE_VALUES], { errorMap: () => ({ message: "Choose a business type." }) })
  .optional();

export const sellerRegistrationSchema = z
  .object({
    company: companyName,
    contactName: personName,
    email,
    phone,
    gstin,
    city: z.string().trim().max(120).optional(),
    stateCode: z.string().trim().max(8).optional(),
    addressLine1: z.string().trim().max(200).optional(),
    postalCode: z.string().trim().max(12).optional(),
    businessType,
    description: z.string().trim().max(2000).optional(),
    materials: z.string().trim().max(2000).optional(),
    ...passwordPair,
  })
  .refine((value) => passwordsMatch(value), passwordsMatchMessage);

export const loginSchema = z.object({
  email: email,
  password: z.string().min(1, "Enter your password.").max(200),
});

const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

export const enquirySchema = z.object({
  productId: z.string().trim().min(1, "Choose a product to enquire about."),
  quantity: z
    .string()
    .trim()
    .min(1, "Enter the quantity you need.")
    .transform((value) => Number(value.replace(/,/g, "")))
    .refine((value) => Number.isFinite(value) && value > 0, "Quantity must be a number greater than zero.")
    .refine((value) => value <= 1_000_000_000, "Quantity is too large."),
  unit: z.enum(["KG", "MT", "PIECES"], { errorMap: () => ({ message: "Choose a unit." }) }),
  requirements: z
    .string()
    .trim()
    .min(20, "Describe the requirement in at least 20 characters so the desk can source it.")
    .max(4000, "Keep the requirement under 4000 characters."),
  deliveryLocation: z.string().trim().max(200).optional(),
  contactName: personName,
  contactEmail: email,
  contactPhone: phone,
});

export const listingSchema = z.object({
  title: z.string().trim().min(3, "Give the listing a title.").max(200),
  categoryLabel: z.string().trim().min(2, "Name the material or part category.").max(160),
  productId: optionalId,
  quantityKg: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? Number(value.replace(/,/g, "")) : undefined))
    .refine(
      (value) => value === undefined || (Number.isFinite(value) && value > 0 && value <= 1_000_000_000),
      "Quantity must be a number greater than zero.",
    ),
  notes: z.string().trim().max(2000, "Keep the notes under 2000 characters.").optional(),
});

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const slug = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value ? slugify(value) : undefined))
  .refine((value) => value === undefined || value.length > 0, "A slug may contain letters, numbers and hyphens.");

const httpsUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine(
    (value) => value === undefined || /^https:\/\/[^\s]+$/i.test(value),
    "Image references must be an https:// URL.",
  )
  .refine((value) => value === undefined || value.length <= 500, "Keep the URL under 500 characters.");

export const productSchema = z.object({
  title: z.string().trim().min(3, "Enter a product title.").max(240),
  slug,
  familyId: z.string().trim().min(1, "Choose a subcategory."),
  partNumber: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  shortDescription: z.string().trim().max(600).optional(),
  technicalSpecification: z.string().trim().max(4000).optional(),
  imageUrl: httpsUrl,
  condition: z.enum(["NEW", "REFURBISHED", "USED", "UNKNOWN"]),
  priceMode: z.enum(["FIXED", "REQUEST", "BULK_TIERED"]),
});

export const productUpdateSchema = productSchema.partial().extend({
  publicationState: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Enter a category name.").max(160),
  slug,
  kind: z.enum(["SCRAP", "SPARE_PARTS"]),
  shortDescription: z.string().trim().max(600).optional(),
});

export const familySchema = z.object({
  categoryId: z.string().trim().min(1, "Choose a parent category."),
  name: z.string().trim().min(2, "Enter a subcategory name.").max(160),
  slug,
});

export const enquiryUpdateSchema = z.object({
  status: z.enum([
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
  ]).optional(),
  internalNotes: z.string().trim().max(4000, "Keep internal notes under 4000 characters.").optional(),
});

export const sellerDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(1000).optional(),
});

/** The admin seller form posts one action: decide, or record an internal note. */
export const sellerAdminActionSchema = z.object({
  action: z.enum(["approve", "reject", "note"], { errorMap: () => ({ message: "Choose an action." }) }),
  reason: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(4000).optional(),
});

/** The seller editing its own company and registered address. The GSTIN is deliberately absent. */
export const sellerCompanySchema = z.object({
  company: z.string().trim().min(2, "Enter the company name.").max(240).optional(),
  tradeName: z.string().trim().max(240).optional(),
  businessType,
  description: z.string().trim().max(2000, "Keep the description under 2000 characters.").optional(),
  website: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  stateCode: z.string().trim().max(8).optional(),
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(12).optional(),
  contactName: personName.optional(),
  phone,
});

const imageLinks = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .transform((value) =>
    !value
      ? []
      : value
          .split(/[\n,]+/)
          .map((entry) => entry.trim())
          .filter(Boolean),
  )
  .refine((list) => list.length <= 8, "Add at most 8 image links.")
  .refine(
    (list) => list.every((url) => /^https:\/\/[^\s]+$/i.test(url) && url.length <= 500),
    "Image links must be https:// URLs.",
  );

/**
 * A seller's product listing submission.
 *
 * The seller supplies the content; it never supplies a decision. There is no review status, status,
 * productId write or publication field in this schema, so a submission cannot arrive pre-approved.
 */
export const listingSubmissionSchema = z.object({
  title: z.string().trim().min(3, "Give the listing a product name.").max(200),
  categoryLabel: z.string().trim().min(2, "Name the category.").max(160),
  manufacturer: z.string().trim().max(160).optional(),
  description: z.string().trim().min(20, "Describe the product in at least 20 characters.").max(4000),
  specification: z.string().trim().max(4000).optional(),
  supportingInfo: z.string().trim().max(2000).optional(),
  images: imageLinks,
  quantityKg: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? Number(value.replace(/,/g, "")) : undefined))
    .refine(
      (value) => value === undefined || (Number.isFinite(value) && value > 0 && value <= 1_000_000_000),
      "Quantity must be a number greater than zero.",
    ),
  notes: z.string().trim().max(2000, "Keep the notes under 2000 characters.").optional(),
});

export const profileSchema = z.object({
  company: z.string().trim().min(2).max(240).optional(),
  gstin,
  phone,
  city: z.string().trim().max(120).optional(),
  stateCode: z.string().trim().max(8).optional(),
  contactName: personName.optional(),
  jobTitle: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  website: z.string().trim().max(300).optional(),
  materials: z.string().trim().max(2000).optional(),
});

/** Turn a zod issue list into one readable line plus the field it belongs to. */
export function firstIssue(error: z.ZodError): { message: string; field?: string } {
  const issue = error.issues[0];
  return {
    message: issue?.message ?? "Check the details and try again.",
    field: issue?.path?.[0] ? String(issue.path[0]) : undefined,
  };
}
/**
 * M5 — an administrator changing an account's standing.
 *
 * The reason is required only for a suspension and is validated again in the data layer, because the
 * suspension note is the only record of why an account was stopped.
 */
export const accountStatusSchema = z
  .object({
    organisationId: z.string().trim().min(10, "Choose the account to act on.").max(64),
    action: z.enum(["suspend", "reactivate"]),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((value) => value.action !== "suspend" || (value.reason ?? "").length >= 5, {
    message: "Give a reason for the suspension — at least 5 characters.",
    path: ["reason"],
  });

/** M5 — renaming a manufacturer across the catalogue. */
export const manufacturerRenameSchema = z.object({
  from: z.string().trim().min(2, "Choose the manufacturer to rename.").max(160),
  to: z.string().trim().min(2, "Write the new manufacturer name.").max(160),
});
