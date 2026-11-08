/**
 * PRIMEMET — Phase 1 commerce collections: buyer enquiries.
 *
 * Why a new collection rather than a field group on `products` or `organisations`: an enquiry is a
 * commercial request from one buyer organisation about one product, with its own lifecycle, its own
 * reference number and its own access rule. It has an owner (the buyer organisation), a counterparty
 * workflow (the admin desk) and a status that must survive independently of the product being
 * published or archived. Storing it anywhere else would make "a buyer may only read their own
 * enquiry" unenforceable by a single indexed filter.
 *
 * The enquiry references the product by `_id` AND keeps `productTitle` as a denormalised copy. That
 * copy is deliberate: an enquiry is a historical record of what was asked for, so renaming or
 * unpublishing a product must not rewrite what the buyer asked about. The validator cannot check the
 * reference (MongoDB has no foreign keys), so the write path resolves the product inside the same
 * request and refuses an unknown id; `db/refs.mjs` documents the residual risk for every collection.
 */

import { collection, f, ref, refOpt } from "../define.mjs";
import { ENUMS } from "../enums.mjs";

const ts = { createdAt: f.date(), updatedAt: f.date() };

export const enquiry = collection({
  name: "enquiries",
  model: "Enquiry",
  notes:
    "reference is unique and human-readable (ENQ-YYYY-NNNNNN). buyerOrganisationId is the isolation " +
    "key: every buyer read path filters on it, and the index exists so that filter is cheap.",
  fields: {
    _id: f.uuid(),
    reference: f.str({ maxLength: 40 }),
    buyerOrganisationId: ref("organisations"),
    buyerUserId: ref("users"),
    productId: refOpt("products"),
    productTitle: f.str({ maxLength: 240 }),
    categoryName: f.strOpt({ maxLength: 160 }),
    quantity: f.decimal(),
    unit: f.str({ maxLength: 24 }),
    requirements: f.str({ maxLength: 4000 }),
    deliveryLocation: f.strOpt({ maxLength: 200 }),
    contactName: f.str({ maxLength: 200 }),
    contactEmail: f.str({ maxLength: 320 }),
    contactPhone: f.strOpt({ maxLength: 40 }),
    status: f.enumOf("EnquiryStatus", ENUMS),
    // Admin-side only. The buyer read path never projects this field; see src/lib/data/enquiries.ts.
    internalNotes: f.strOpt({ maxLength: 4000 }),
    ...ts,
  },
  indexes: [
    { keys: { reference: 1 }, unique: true },
    { keys: { buyerOrganisationId: 1, createdAt: -1 } },
    { keys: { buyerUserId: 1, createdAt: -1 } },
    { keys: { status: 1, createdAt: -1 } },
    // v009: the admin enquiry register lists all statuses newest first, and the overview counts
    // today's enquiries. Without this the unfiltered sort is an in-memory sort of the whole collection.
    { keys: { createdAt: -1 } },
  ],
  invariants: [
    {
      rule: "reference is an ENQ-YYYY-NNNNNN number",
      query: { reference: { $regex: "^ENQ-[0-9]{4}-[0-9]{6}$" } },
    },
    {
      rule: "a quantity must be positive",
      query: { $expr: { $gt: ["$quantity", 0] } },
    },
    {
      rule: "contact email is stored lower-case",
      query: { $expr: { $eq: ["$contactEmail", { $toLower: "$contactEmail" }] } },
    },
  ],
});

export const COMMERCE_COLLECTIONS = [enquiry];
