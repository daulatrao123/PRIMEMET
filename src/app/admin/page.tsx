import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PortalPage } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { ADMIN_NAV } from "@/lib/content/admin-nav";

export const metadata: Metadata = { title: "Admin console" };

/**
 * Admin landing page.
 *
 * Why this file exists: `src/app/admin/` held only a layout and child folders, so `/admin` produced
 * no route of its own and fell through to `not-found`. Every nested screen worked; only the bare
 * path 404'd, which reads as "the admin area is broken".
 *
 * It is a directory, not a dashboard: it duplicates no figures and reads nothing. The section list is
 * imported from the layout so the two cannot disagree about what exists.
 *
 * TODO (Stage 2): this route must sit behind the same ADMIN session guard as the rest of /admin. It
 * deliberately does not redirect today, because there is no session to redirect from — a redirect to
 * a sign-in page that cannot sign anyone in would be a fake gate.
 */
export default function AdminIndexPage() {
  return (
    <PortalPage
      eyebrow="Administration"
      title="Admin console"
      description="Every administrative area in one place. This page is a directory of sections, not a summary of activity."
    >
      <NotConnected>
        <strong className="font-semibold text-navy-900">Preview only.</strong> No sign-in is
        enforced yet, no session exists, and nothing on this page is read from, counted from or
        written to a database. The screens it links to hold example layouts and empty tables, never
        records. Authentication and role checks arrive in Stage 2.
      </NotConnected>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {ADMIN_NAV.map((group) => (
          <Panel key={group.heading} title={group.heading}>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-3 rounded-md border border-steel-200 px-3.5 py-2.5 text-sm font-medium text-navy-900 transition-colors hover:border-navy-300 hover:bg-steel-50"
                  >
                    <span className="min-w-0">{item.label}</span>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className="size-3.5 shrink-0 text-steel-400"
                      fill="none"
                    >
                      <path
                        d="M3 8h10M9 4l4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <Panel title="What is not here yet" description="Stated so this page is never mistaken for a working console.">
        <ul className="space-y-2.5 text-sm leading-6 text-steel-600">
          {[
            "No authentication, session or role check. Every /admin screen is publicly reachable until Stage 2.",
            "No persisted records. Counts, queues and activity tables are empty by design rather than showing zero.",
            "No write actions. Buttons carry a (preview) marker and are disabled.",
            "No audit trail. The audit log screen documents the intended shape and is not yet written to.",
          ].map((line) => (
            <li key={line} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
              {line}
            </li>
          ))}
        </ul>
      </Panel>
    </PortalPage>
  );
}
