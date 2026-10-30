import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";

/**
 * Focused shell for sign-in and registration previews.
 * Deliberately excludes the marketing header so the form is the only task on screen.
 */
export function AuthShell({
  variant = "account",
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  variant?: "account" | "admin";
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const points =
    variant === "admin"
      ? [
          "Review enquiries and qualify suppliers before they reach a buyer.",
          "Compare supplier quotations on the internal side of the desk.",
          "Prepare buyer-facing quotations without exposing purchase costs.",
        ]
      : [
          "One brief, written down and confirmed before sourcing starts.",
          "Supplier shortlists screened on licences and capability.",
          "Inspection records that travel with the consignment.",
        ];

  return (
    <main id="main" className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="relative hidden overflow-hidden bg-navy-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            maskImage: "radial-gradient(120% 90% at 80% 0%, #000 0%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(120% 90% at 80% 0%, #000 0%, transparent 70%)",
          }}
        />

        <div className="relative">
          <Link href="/" aria-label="PRIMEMET home">
            <Logo />
          </Link>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-2xl font-semibold leading-snug tracking-tight xl:text-3xl">
            Managed industrial sourcing, one accountable desk.
          </h2>
          <ul className="mt-8 space-y-4">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm leading-6 text-navy-200">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="mt-1 size-3.5 shrink-0 text-green-400"
                  fill="none"
                >
                  <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative border-t border-white/10 pt-6 text-xs leading-5 text-steel-400">
          Preview build — accounts and sessions are not enabled. Nothing entered on this page is
          stored or sent.
        </div>
      </div>

      <div className="flex flex-col bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-steel-200 px-5 py-4 sm:px-8">
          <Link href="/" className="lg:hidden" aria-label="PRIMEMET home">
            <span className="text-sm font-semibold tracking-[0.18em] text-navy-950">PRIMEMET</span>
          </Link>
          <div className="flex items-center gap-3 lg:ml-auto">
            <Badge tone="steel">Preview build</Badge>
            <Link
              href="/"
              className="text-xs font-medium text-steel-600 transition-colors hover:text-navy-950"
            >
              Back to site
            </Link>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
          <div className="w-full max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-600">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-navy-950 sm:text-3xl">
              {title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-steel-600">{description}</p>

            <div className="mt-8">{children}</div>

            {footer ? <div className="mt-8 border-t border-steel-200 pt-6">{footer}</div> : null}
          </div>
        </div>
      </div>
    </main>
  );
}

/** Shared inline notice for the auth previews. */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-steel-300 bg-steel-50 px-4 py-3 text-xs leading-5 text-steel-600">
      <span className="font-semibold text-navy-900">Preview only.</span> {children}
    </div>
  );
}
