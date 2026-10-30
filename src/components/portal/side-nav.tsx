"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";

export type NavGroup = { heading: string; items: { href: string; label: string }[] };

/**
 * Portal navigation.
 * Client-side only to mark the active route. It holds no session or role logic:
 * the role is a server-passed label, not a permission check.
 */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop rail */}
      <nav aria-label="Portal sections" className="hidden lg:block">
        <div className="space-y-7">
          {groups.map((group) => (
            <div key={group.heading}>
              <p className="px-3 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-steel-400">
                {group.heading}
              </p>
              <ul className="mt-2 space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "block rounded-md px-3 py-2 text-sm transition-colors",
                          active
                            ? "bg-white/10 font-semibold text-white"
                            : "text-navy-300 hover:bg-white/5 hover:text-white",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Mobile horizontal rail */}
      <nav aria-label="Portal sections" className="lg:hidden">
        <div className="flex gap-2 overflow-x-auto pr-10 pb-1">
          {groups.flatMap((group) => group.items).map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium transition-colors",
                  active ? "bg-white text-navy-950" : "bg-white/10 text-navy-200 hover:bg-white/20",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
