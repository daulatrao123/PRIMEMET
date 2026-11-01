import Link from "next/link";
import { CATALOGUE_SECTIONS } from "@/lib/content/catalogue-sections";
import { cx } from "@/lib/cx";

/**
 * Shared catalogue navigation.
 *
 * Rendered on /admin/catalogue (as an index) and on every /admin/catalogue/[section] page, so the
 * two can never disagree about which sections exist. Plain links rather than client-side tabs:
 * every section is then independently addressable and linkable from the audit log later.
 */
export function CatalogueNav({ current }: { current?: string }) {
  return (
    <nav aria-label="Catalogue sections" className="border-b border-steel-200 pb-4">
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link
            href="/admin/catalogue"
            aria-current={current === undefined ? "page" : undefined}
            className={cx(
              "inline-flex items-center rounded-sm border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
              current === undefined
                ? "border-navy-900 bg-navy-900 text-white"
                : "border-steel-300 bg-white text-navy-800 hover:border-navy-900",
            )}
          >
            Overview
          </Link>
        </li>
        {CATALOGUE_SECTIONS.map((section) => (
          <li key={section.slug}>
            <Link
              href={`/admin/catalogue/${section.slug}`}
              aria-current={current === section.slug ? "page" : undefined}
              className={cx(
                "inline-flex items-center rounded-sm border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                current === section.slug
                  ? "border-navy-900 bg-navy-900 text-white"
                  : "border-steel-300 bg-white text-navy-800 hover:border-navy-900",
              )}
            >
              {section.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}