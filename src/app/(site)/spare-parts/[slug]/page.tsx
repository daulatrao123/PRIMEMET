import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NotConnected } from "@/components/ui/not-connected";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { PARTS, getPart } from "@/lib/content/parts";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return PARTS.map((part) => ({ slug: part.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const part = getPart(slug);

  if (!part) return { title: "Category not found" };

  return { title: part.name, description: part.summary };
}

export default async function PartDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const part = getPart(slug);

  if (!part) notFound();

  return (
    <>
      <PageHero
        eyebrow="Spare parts"
        title={part.name}
        description={part.summary}
        crumbs={[{ label: "Spare parts", href: "/spare-parts" }, { label: part.name }]}
      />

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-navy-950">
              What this category covers
            </h2>
            <div className="mt-5 space-y-4 text-base leading-7 text-steel-600">
              {part.overview.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </div>

            <h3 className="mt-10 text-sm font-semibold uppercase tracking-[0.14em] text-steel-500">
              Typical items
            </h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {part.typicalItems.map((item) => (
                <li key={item} className="flex items-start gap-3 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm text-navy-900">
                  <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-green-600" />
                  {item}
                </li>
              ))}
            </ul>

            <h3 className="mt-10 text-sm font-semibold uppercase tracking-[0.14em] text-steel-500">
              Sourcing routes
            </h3>
            <ol className="mt-4 space-y-3">
              {part.sourcingRoutes.map((route, index) => (
                <li key={route.title} className="rounded-card border border-steel-200 bg-white p-5">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xs tracking-widest text-steel-500">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h4 className="text-sm font-semibold text-navy-950">{route.title}</h4>
                  </div>
                  <p className="mt-2 pl-8 text-sm leading-6 text-steel-600">{route.body}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-6">
            <Card className="overflow-hidden">
              <div className="border-b border-steel-200 bg-steel-50 px-5 py-4">
                <h2 className="text-sm font-semibold text-navy-950">Before we can quote</h2>
              </div>
              <ul className="divide-y divide-steel-200">
                {part.requiredInputs.map((input, index) => (
                  <li key={input} className="flex items-start gap-3 px-5 py-3.5 text-sm leading-6 text-navy-900">
                    <span className="font-mono text-[0.7rem] text-steel-500">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {input}
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-navy-950">Typical applications</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {part.applications.map((application) => (
                  <li
                    key={application}
                    className="rounded-full border border-steel-200 bg-steel-50 px-2.5 py-1 text-[0.7rem] font-medium text-steel-600"
                  >
                    {application}
                  </li>
                ))}
              </ul>
            </Card>

            <NotConnected compact>
              This category page is static copy. Part records, stock position and pricing will be
              read from the platform database in a later stage.
            </NotConnected>
          </div>
        </div>
      </Section>

      <Section tone="navy">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-400">Next step</p>
            <h2 className="mt-4 max-w-xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Send the part detail and the machine it serves
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-navy-300">
              A nameplate photograph is usually enough to start. Where nothing survives, we work
              from measurements taken on the machine.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <ButtonLink href="/request-a-quote" size="lg">
              Request a part
            </ButtonLink>
            <Link
              href="/spare-parts"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/5"
            >
              All categories
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
