import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/portal-shell";
import type { NavGroup } from "@/components/portal/side-nav";

const NAV: NavGroup[] = [
  { heading: "Overview", items: [{ href: "/buyer/dashboard", label: "Dashboard" }] },
  {
    heading: "Sourcing",
    items: [
      { href: "/buyer/enquiries/new", label: "Submit enquiry" },
      { href: "/buyer/scrap-sourcing", label: "Scrap sourcing" },
      { href: "/buyer/spare-parts", label: "Spare parts" },
    ],
  },
  {
    heading: "Commercial",
    items: [
      { href: "/buyer/quotations", label: "Quotations" },
      { href: "/buyer/orders", label: "Order history" },
    ],
  },
  { heading: "Account", items: [{ href: "/buyer/profile", label: "Profile" }] },
];

/**
 * Buyer shell. Open in Stage 1 so the interface can be reviewed; there is no session.
 *
 * TODO (Stage 2): require a BUYER session, scope every query to the buyer's own records
 * and redirect unauthenticated visitors to /login.
 */
export default function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <PortalShell roleLabel="Buyer" signInHref="/login" nav={NAV}>
      {children}
    </PortalShell>
  );
}
