import Link from "next/link";
import { Logo } from "./header";

const COLUMNS = [
  {
    heading: "Materials",
    links: [
      { href: "/scrap-metals", label: "Scrap metal grades" },
      { href: "/scrap-metals/heavy-melting-scrap", label: "Ferrous — HMS" },
      { href: "/scrap-metals/copper-millberry", label: "Copper millberry" },
      { href: "/scrap-metals/stainless-304-316", label: "Stainless 304/316" },
    ],
  },
  {
    heading: "Services",
    links: [
      { href: "/spare-parts", label: "Industrial spare parts" },
      { href: "/sell-scrap", label: "Sell scrap" },
      { href: "/source-scrap", label: "Source scrap" },
      { href: "/become-a-supplier", label: "Become a supplier" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About PRIMEMET" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/trading-models", label: "Trading models" },
      { href: "/quality-assurance", label: "Quality assurance" },
      { href: "/industries", label: "Industries" },
      { href: "/faqs", label: "FAQs" },
    ],
  },
  {
    heading: "Access",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/register/buyer", label: "Register as buyer" },
      { href: "/register/seller", label: "Register as supplier" },
      { href: "/admin/login", label: "Administrator" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-navy-950 text-navy-200">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Logo />
            <p className="mt-6 max-w-sm text-sm leading-6 text-navy-300">
              Managed industrial scrap sourcing and spare-parts procurement. One
              accountable partner for specification, inspection, logistics and
              documentation.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-green-500" aria-hidden="true" />
              <span className="text-xs font-medium text-navy-200">
                Enquiry desk open / Mon to Fri, 08:00 to 18:00 CET
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((column) => (
              <div key={column.heading}>
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-steel-400">
                  {column.heading}
                </h2>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={`${column.heading}-${link.href}`}>
                      <Link
                        href={link.href}
                        className="text-sm text-navy-200 transition-colors hover:text-white"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 text-xs text-steel-400 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <p>© {new Date().getFullYear()} PRIMEMET. All rights reserved.</p>
            <Link href="/privacy" className="transition-colors hover:text-white">
              Privacy policy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-white">
              Terms and conditions
            </Link>
          </div>
          <p className="max-w-md leading-5">
            Preview build — enquiry and registration forms do not submit, and no commercial offer
            is created through this site.
          </p>
        </div>
      </div>
    </footer>
  );
}
