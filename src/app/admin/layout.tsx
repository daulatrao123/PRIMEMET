import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireAdminPage } from "@/lib/auth/guards";
import { ADMIN_NAV } from "@/lib/content/admin-nav";

/**
 * The admin area is never indexed and never rendered for a non-administrator.
 *
 * TWO GUARDS, DELIBERATELY. `middleware.ts` refuses an anonymous request from the HMAC on the session
 * cookie before any component runs. That is a routing hint, not an identity: it cannot see a revoked
 * session or a suspended account. `requireAdminPage` here re-reads the session row, the user status and
 * the role from MongoDB, so every screen under `/admin` — including the older preview pages that have no
 * data of their own — is behind a real decision. Pages keep their own guard as well: a layout protects
 * what it wraps, and a future route group might not.
 *
 * `dynamic` is forced because the guard reads the request's cookie. A prerendered admin page would be a
 * page built without a session, which is precisely the artefact that must not exist.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage("/admin/dashboard");
  return (
    <PortalShell roleLabel="Administrator" signInHref="/admin/login" nav={ADMIN_NAV}>
      {children}
    </PortalShell>
  );
}
