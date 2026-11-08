import type { NavGroup } from "@/components/portal/side-nav";

/**
 * Admin navigation, in one place.
 *
 * Why not in `src/app/admin/layout.tsx`: a Next.js layout file may only export a fixed set of
 * names (`default`, `metadata`, `config`, …). Adding any other export fails the generated route
 * type check with "Property … is incompatible with index signature". The landing page `/admin`
 * and the layout therefore share this module instead of the layout exporting its own constant.
 */
export const ADMIN_NAV: NavGroup[] = [
  { heading: "Overview", items: [{ href: "/admin/dashboard", label: "Dashboard" }] },
  {
    heading: "Desk",
    items: [
      { href: "/admin/enquiries", label: "Enquiries" },
      { href: "/admin/suppliers", label: "Suppliers" },
      { href: "/admin/listing-submissions", label: "Listing submissions" },
      { href: "/admin/buyers", label: "Buyers" },
    ],
  },
  {
    heading: "Catalogues",
    items: [
      { href: "/admin/materials", label: "Materials" },
      { href: "/admin/products", label: "Products" },
      { href: "/admin/pricing", label: "Pricing & formulas" },
    ],
  },
  {
    heading: "Catalogue & QA",
    items: [
      { href: "/admin/products", label: "Product management" },
      { href: "/admin/catalogue/categories", label: "Categories & subcategories" },
      { href: "/admin/catalogue/manufacturers", label: "Manufacturers" },
      { href: "/admin/catalogue", label: "Categories & grades" },
      { href: "/admin/catalogue/materials", label: "Material catalogue" },
      { href: "/admin/composition", label: "Composition specs" },
      { href: "/admin/lots", label: "Scrap lots" },
      { href: "/admin/inspections", label: "Quality & inspection" },
      { href: "/admin/rejections", label: "Rejections" },
    ],
  },
  {
    heading: "Quotations",
    items: [
      { href: "/admin/supplier-quotations", label: "Supplier quotations" },
      { href: "/admin/quotations", label: "Customer quotations" },
    ],
  },
  {
    heading: "Oversight",
    items: [
      { href: "/admin/reports", label: "Reports" },
      { href: "/admin/audit-log", label: "Audit log" },
    ],
  },
];
