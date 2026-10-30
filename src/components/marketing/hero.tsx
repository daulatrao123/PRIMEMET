import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";

const HERO_STATS = [
  { value: "04", label: "Material categories sourced" },
  { value: "04", label: "Checkpoints per sourcing brief" },
  { value: "01", label: "Accountable point of contact" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-navy-950 text-white">
      {/* Structural grid: reads as an engineering drawing, not decoration */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(120% 90% at 78% 12%, #000 0%, transparent 72%)",
          WebkitMaskImage: "radial-gradient(120% 90% at 78% 12%, #000 0%, transparent 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute -right-24 top-24 hidden h-[420px] w-[420px] rounded-full bg-green-600/10 blur-3xl lg:block"
      />

      <div className="relative mx-auto grid max-w-7xl gap-16 px-5 pb-20 pt-20 sm:px-8 sm:pb-24 sm:pt-24 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12 lg:pb-28">
        <div>
          <Badge tone="navy" className="border border-green-500/40 bg-green-600/10 text-green-100 ring-0">
            <span className="size-1.5 rounded-full bg-green-500" aria-hidden="true" />
            Managed industrial sourcing
          </Badge>

          <h1 className="mt-7 max-w-2xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            Industrial scrap and spare parts,
            <span className="text-green-500"> sourced to specification.</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-7 text-navy-200 sm:text-lg sm:leading-8">
            PRIMEMET runs sourcing programmes for plants, mills and maintenance
            teams. You define the grade, tolerance and delivery window — we handle
            supplier qualification, inspection, logistics and the paperwork that
            follows the metal.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/#enquiry" size="lg">
              Start a sourcing brief
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </ButtonLink>
            <Link
              href="/#materials"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/5"
            >
              Review material grades
            </Link>
          </div>

          <dl className="mt-14 grid max-w-xl grid-cols-3 gap-6 border-t border-white/10 pt-8">
            {HERO_STATS.map((stat) => (
              <div key={stat.label}>
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="block text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    {stat.value}
                  </span>
                  <span className="mt-1.5 block text-xs leading-5 text-navy-300">{stat.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Example brief panel — explicitly illustrative */}
        <div className="relative lg:pl-4">
          <div className="relative rounded-card border border-white/12 bg-white/[0.04] backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-steel-400">
                  Sourcing brief
                </p>
                <p className="mt-1 text-sm font-medium text-white">Specification received</p>
              </div>
              <span className="rounded-full border border-green-500/40 bg-green-600/15 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-green-100">
                Illustrative
              </span>
            </div>

            <dl className="divide-y divide-white/8 px-6">
              {[
                ["Material", "HMS 1&2 — 80:20"],
                ["Volume", "1,200 t / quarter"],
                ["Delivery", "Ex-works, EU inland"],
                ["Requirement", "ISRI spec, mill scale report"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-6 py-3.5">
                  <dt className="text-xs uppercase tracking-wider text-steel-400">{label}</dt>
                  <dd className="text-right text-sm font-medium text-white">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="border-t border-white/10 px-6 py-4">
              <div className="flex items-center gap-2 text-xs text-navy-300">
                <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0 text-green-400" fill="none">
                  <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Supplier shortlist, inspection plan and landed cost pack
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs leading-5 text-steel-400">
            Example layout only. Live briefs, pricing and supplier data arrive with
            the PRIMEMET platform in a later stage.
          </p>
        </div>
      </div>

      {/* Capability strip */}
      <div className="relative border-t border-white/10 bg-navy-900/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-10 gap-y-3 px-5 py-5 text-xs font-medium uppercase tracking-[0.16em] text-steel-400 sm:px-8">
          <span className="text-green-400">Programmes for</span>
          <span>Steel mills</span>
          <span>Foundries</span>
          <span>Fabricators</span>
          <span>Maintenance & repair</span>
          <span>Recycling yards</span>
        </div>
      </div>
    </section>
  );
}