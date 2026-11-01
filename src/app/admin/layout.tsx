import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/portal-shell";
import type { NavGroup } from "@/components/portal/side-nav";

const NAV: NavGroup[] = [
  { heading: "Overview", items: [{ href: "/admin/dashboard", label: "Dashboard" }] },
  {
    heading: "Desk",
    items: [
      { href: "/admin/enquiries", label: "Enquiries" },
      { href: "/admin/suppliers", label: "Suppliers" },
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

/**
 * The admin portal must never be indexed.
 *
 * Every screen here is an example layout waiting for Stage 2 authentication. Indexing them would
 * publish empty administrative pages. `robots.ts` disallows `/admin`, but `Disallow` stops crawling,
 * not indexing — a linked, disallowed URL can still appear in results. This `noindex` is the part
 * that actually keeps it out, so the two policies work together.
 *
 * TODO (Stage 2): replace with a guard that requires an ADMIN session. Removing `noindex` is only
 * correct once this area holds real, authenticated content.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Admin shell.
 * No guard is applied: the area is open in Stage 1 so the interface can be reviewed.
 *
 * TODO (Stage 2): require an ADMIN session here (middleware.ts marks the same point)
 * and redirect unauthenticated visitors to /admin/login.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <PortalShell roleLabel="Administrator" signInHref="/admin/login" nav={NAV}>
      {children}
    </PortalShell>
  );
}
