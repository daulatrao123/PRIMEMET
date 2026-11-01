import Link from "next/link";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema } from "@/lib/seo";

export type Crumb = { label: string; href?: string };

/**
 * Interior-page masthead. Same navy plate as the homepage hero so every route
 * reads as one site rather than a set of templates.
 */
export function PageHero({
  eyebrow,
  title,
  description,
  crumbs = [],
  actions,
  meta,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-white/10 bg-navy-950 text-white">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(110% 90% at 82% 0%, #000 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(110% 90% at 82% 0%, #000 0%, transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pb-20 sm:pt-16">
        {crumbs.length > 0 ? (
          <>
            {/* Generated from the same array as the visible trail, so the two cannot diverge. */}
            <JsonLd data={breadcrumbSchema(crumbs)} />
            <nav aria-label="Breadcrumb" className="mb-8">
            <ol className="flex flex-wrap items-center gap-2 text-xs text-steel-400">
              <li>
                <Link href="/" className="transition-colors hover:text-white">
                  Home
                </Link>
              </li>
              {crumbs.map((crumb) => (
                <li key={crumb.label} className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-steel-400">
                    /
                  </span>
                  {crumb.href ? (
                    <Link href={crumb.href} className="transition-colors hover:text-white">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-navy-200">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          </>
        ) : null}

        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-400">{eyebrow}</p>
        <h1 className="mt-4 max-w-3xl text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl lg:text-[2.9rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-5 max-w-2xl text-base leading-7 text-navy-200">{description}</p>
        ) : null}
        {actions ? <div className="mt-9 flex flex-col gap-3 sm:flex-row">{actions}</div> : null}
        {meta ? <div className="mt-10 border-t border-white/10 pt-6">{meta}</div> : null}
      </div>
    </section>
  );
}
