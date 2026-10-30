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
