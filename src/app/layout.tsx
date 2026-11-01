import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  // Same validated origin as canonicals, sitemap.xml and robots.txt — no independent fallback.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "PRIMEMET — Managed Industrial Scrap Sourcing & Spare-Parts Procurement",
    template: "%s | PRIMEMET",
  },
  description:
    "PRIMEMET runs managed scrap-metal sourcing and spare-parts procurement programmes for industrial buyers and sellers: specification, inspection, logistics and documentation handled end to end.",
  applicationName: "PRIMEMET",
  openGraph: {
    siteName: "PRIMEMET",
    type: "website",
  },
};

/**
 * Root shell only: document, skip link and base typography.
 *
 * Chrome lives in route-group layouts so each audience gets the right frame:
 *   (site)   public marketing pages  → header + footer
 *   (auth)   sign-in / registration  → focused, no marketing nav
 *   (portal) admin, buyer, seller    → dashboard shell with sidebar
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-navy-900 antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-navy-950 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}