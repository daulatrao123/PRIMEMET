import Link from "next/link";

const NAV_LINKS = [
  { href: "/scrap-metals", label: "Scrap metals" },
  { href: "/spare-parts", label: "Spare parts" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/trading-models", label: "Trading models" },
  { href: "/industries", label: "Industries" },
  { href: "/about", label: "About" },
];

/** Secondary routes, kept in the compact menu and the footer. */
export const SECONDARY_LINKS = [
  { href: "/sell-scrap", label: "Sell scrap" },
  { href: "/source-scrap", label: "Source scrap" },
  { href: "/become-a-supplier", label: "Become a supplier" },
  { href: "/faqs", label: "FAQs" },
  { href: "/contact", label: "Contact" },
];

/** Wordmark: etched-block mark + PRIMEMET lockup. */
export function Logo({ tone = "light" }: { tone?: "light" | "dark" }) {
  const primary = tone === "light" ? "text-white" : "text-navy-950";
  const secondary = tone === "light" ? "text-navy-300" : "text-steel-500";

  return (
    <span className="inline-flex items-center gap-3">
      <span
        aria-hidden="true"
        className="relative grid size-9 shrink-0 place-items-center rounded-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
      >
        <span className="block size-3.5 rounded-[2px] border-2 border-white/90" />
        <span className="absolute bottom-1.5 left-1.5 h-px w-2 bg-white/70" />
        <span className="absolute right-1.5 top-1.5 h-px w-2 bg-white/70" />
      </span>
      <span className="flex flex-col leading-none">
        <span className={`text-[1.05rem] font-semibold tracking-[0.18em] whitespace-nowrap ${primary}`}>
          PRIMEMET
        </span>
        <span className={`mt-1 text-[0.6rem] font-medium uppercase tracking-[0.22em] whitespace-nowrap ${secondary}`}>
          Industrial sourcing
        </span>
      </span>
    </span>
  );
}

/**
 * Site header.
 * The compact menu is a <details> element, so navigation works without JavaScript and
 * without a client-side session.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy-950">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" aria-label="PRIMEMET home" className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm font-medium text-navy-200 transition-colors hover:text-white"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-navy-200 transition-colors hover:text-white sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/request-a-quote"
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-green-700 sm:px-4 sm:text-sm"
          >
            <span className="hidden sm:inline">Request a quote</span>
            <span className="sm:hidden">Quote</span>
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>

          <details className="group relative lg:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 [&::-webkit-details-marker]:hidden">
              Menu
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3" fill="none">
                <path d="M4 6.5L8 10l4-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>

            <div className="absolute right-0 top-[calc(100%+0.6rem)] w-64 rounded-card border border-white/10 bg-navy-950 p-2 shadow-xl">
              <ul className="space-y-0.5">
                {[...NAV_LINKS, ...SECONDARY_LINKS].map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="block rounded-md px-3 py-2 text-sm text-navy-200 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-2 border-t border-white/10 pt-2">
                <Link
                  href="/login"
                  className="block rounded-md px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </details>
        </div>
      </div>

      {/* Compact mobile strip: the three tasks most visitors arrive for */}
      <nav aria-label="Primary mobile" className="border-t border-white/10 lg:hidden">
        <ul className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-2.5 sm:px-8">
          {[
            { href: "/scrap-metals", label: "Metals" },
            { href: "/spare-parts", label: "Spares" },
            { href: "/how-it-works", label: "Process" },
            { href: "/contact", label: "Contact" },
          ].map((link) => (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                className="text-[0.7rem] font-medium uppercase tracking-wider text-navy-200 hover:text-white"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
