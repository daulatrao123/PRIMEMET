import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/portal-shell";
import type { NavGroup } from "@/components/portal/side-nav";

/** Seller portal preview — never indexed while it holds example layouts only. See `admin/layout.tsx`. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

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
 * Seller shell.
 *
 * The shell itself is presentation; every page inside it calls `requirePage(["SELLER"], path)`, which
 * resolves the session from the database and redirects an anonymous or non-seller visitor before any
 * data is read. A seller page never takes an organisation id from the URL.
 */
export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <PortalShell roleLabel="Seller / Supplier" signInHref="/login" nav={NAV}>
      {children}
    </PortalShell>
  );
}
