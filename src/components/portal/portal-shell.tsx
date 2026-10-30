import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { SideNav, type NavGroup } from "./side-nav";

/**
 * Dashboard frame shared by /admin, /buyer and /seller.
 *
 * Each audience has its own layout and its own nav groups, but the chrome is one
 * component so the three portals stay visually consistent without duplicating markup.
 *
 * Preview rule: the top bar always carries the "Preview build" badge and the frame
 * never renders an account name, organisation or role from a session — none exists yet.
 *
 * TODO (Stage 2): read the authenticated user and role from the session, render the
 * real organisation name, and redirect unauthenticated requests to the role login.
 */
export function PortalShell({
  roleLabel,
  signInHref,
  nav,
  children,
}: {
  roleLabel: string;
  signInHref: string;
  nav: NavGroup[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-steel-50">
      <header className="border-b border-white/10 bg-navy-950 text-white">
        <div className="flex h-16 items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/" aria-label="PRIMEMET home" className="shrink-0">
              <Logo />
            </Link>
            <span aria-hidden="true" className="hidden h-6 w-px bg-white/15 sm:block" />
            <span className="hidden truncate text-xs font-semibold uppercase tracking-[0.16em] text-green-400 sm:block">
              {roleLabel}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Wrapped rather than display-overridden: Tailwind's utilities are ordered in the
                stylesheet, so a `hidden` class on the Badge itself loses to its own `inline-flex`. */}
            <span className="hidden sm:block">
              <Badge tone="navy" className="border border-white/15 bg-white/5 text-navy-200 ring-0">
                Preview build
              </Badge>
            </span>
            <Link
              href={signInHref}
              className="whitespace-nowrap rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
            >
              Sign-in preview
            </Link>
            <Link
              href="/"
              className="hidden whitespace-nowrap text-xs font-medium text-navy-300 transition-colors hover:text-white sm:block"
            >
              Public site
            </Link>
          </div>
        </div>

        <div className="border-t border-white/10 py-2 pl-5 sm:pl-8 lg:hidden">
          <div className="relative">
            <SideNav groups={nav} />
            {/* Edge fade signals that the rail scrolls rather than clipping its last item */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-navy-950 to-transparent"
            />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[100rem] gap-8 px-5 py-8 sm:px-8 sm:py-10">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-6 rounded-card bg-navy-950 p-4">
            <SideNav groups={nav} />
            <div className="mt-6 border-t border-white/10 pt-4 text-[0.68rem] leading-5 text-steel-400">
              No session is active. Navigation is open so the interface can be reviewed.
            </div>
          </div>
        </aside>

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
