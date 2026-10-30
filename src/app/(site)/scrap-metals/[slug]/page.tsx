import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NotConnected } from "@/components/ui/not-connected";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { MATERIALS, getMaterial } from "@/lib/content/materials";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return MATERIALS.map((material) => ({ slug: material.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const material = getMaterial(slug);

  if (!material) return { title: "Grade not found" };

  return {
    title: material.name,
    description: material.summary,
  };
}

export default async function MaterialDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const material = getMaterial(slug);

  if (!material) notFound();

  return (
    <>
      <PageHero
        eyebrow={material.group}
        title={material.name}
        description={material.summary}
        crumbs={[{ label: "Scrap metals", href: "/scrap-metals" }, { label: material.name }]}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {material.applications.slice(0, 4).map((application) => (
              <Badge key={application} tone="navy" className="border border-white/15 bg-white/5 text-navy-200 ring-0">
                {application}
              </Badge>
            ))}
          </div>
        }
      />

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-navy-950">
              How this grade is specified
            </h2>
            <div className="mt-5 space-y-4 text-base leading-7 text-steel-600">
              {material.overview.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </div>

            <h3 className="mt-10 text-sm font-semibold uppercase tracking-[0.14em] text-steel-500">
              Inspection and records
            </h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {material.qualityChecks.map((check) => (
                <li key={check} className="flex items-start gap-3 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm text-navy-900">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-green-600 text-white"
                  >
                    <svg viewBox="0 0 16 16" className="size-3" fill="none">
                      <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {check}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-6">
            <Card className="overflow-hidden">
              <div className="border-b border-steel-200 bg-steel-50 px-5 py-4">
                <h2 className="text-sm font-semibold text-navy-950">Typical acceptance basis</h2>
                <p className="mt-1 text-xs text-steel-500">
                  A starting point for the brief — agreed per programme, not a published spec.
                </p>
              </div>
              <dl className="divide-y divide-steel-200">
                {material.acceptance.map((row) => (
                  <div key={row.label} className="flex flex-col gap-1 px-5 py-3.5">
                    <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-steel-500">
                      {row.label}
                    </dt>
                    <dd className="text-sm leading-6 text-navy-900">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            <NotConnected compact>
              This grade page is static copy. Grade records, pricing and availability will be read
              from the platform database in a later stage.
            </NotConnected>
          </div>
        </div>
      </Section>

      <Section tone="navy">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-400">Next step</p>
            <h2 className="mt-4 max-w-xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Brief {material.name.toLowerCase()} against your furnace or line
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-navy-300">
              Send the sizing, contamination limits and delivery window. You get a specification
              review and an indicative sourcing route back.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <ButtonLink href="/request-a-quote" size="lg">
              Request a quote
            </ButtonLink>
            <Link
              href="/scrap-metals"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/5"
            >
              All grades
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
