import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/portal-shell";
import type { NavGroup } from "@/components/portal/side-nav";

const NAV: NavGroup[] = [
  { heading: "Overview", items: [{ href: "/seller/dashboard", label: "Dashboard" }] },
  {
    heading: "Account",
    items: [
      { href: "/seller/profile", label: "Business profile" },
      { href: "/seller/tax", label: "Tax & GST" },
    ],
  },
  {
    heading: "Listings",
    items: [
      { href: "/seller/materials", label: "Material listings" },
      { href: "/seller/products", label: "Product listings" },
    ],
  },
  {
    heading: "Commercial",
    items: [
      { href: "/seller/quotations", label: "Quotation submissions" },
      { href: "/seller/enquiries", label: "Enquiries" },
      { href: "/seller/orders", label: "Orders" },
    ],
  },
];

/**
 * Seller shell. Open in Stage 1 so the interface can be reviewed; there is no session.
 *
 * TODO (Stage 2): require a SELLER session, scope listings and quotations to the
 * signed-in supplier, and redirect unauthenticated visitors to /login.
 */
export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <PortalShell roleLabel="Seller / Supplier" signInHref="/login" nav={NAV}>
      {children}
    </PortalShell>
  );
}
