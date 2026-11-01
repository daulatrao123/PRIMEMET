import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { FAQ_GROUPS } from "@/lib/content/faqs";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "FAQs",
  description: "Questions about PRIMEMET managed sourcing: how briefs are specified, how scrap quality is verified, how spare parts are identified, and what this preview site can do.",
  path: "/faqs",
});

export default function FaqsPage() {
  return (
    <>
      <PageHero
        eyebrow="FAQs"
        title="Questions the desk is asked most often"
        description="Answers about process, quality and how the platform will work. If something is not covered here, the enquiry desk is the right place to ask it."
        crumbs={[{ label: "FAQs" }]}
        actions={
          <ButtonLink href="/contact" size="lg">
            Ask the desk
          </ButtonLink>
        }
      />

      <Section tone="light">
        <div className="grid gap-12 lg:grid-cols-[240px_1fr] lg:gap-16">
          <nav aria-label="FAQ sections" className="hidden lg:block">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-steel-500">
              Sections
            </p>
            <ul className="mt-4 space-y-2.5 border-l border-steel-200">
              {FAQ_GROUPS.map((group, index) => (
                <li key={group.title}>
                  <a
                    href={`#faq-${index}`}
                    className="-ml-px block border-l border-transparent pl-4 text-sm text-steel-600 transition-colors hover:border-green-600 hover:text-navy-950"
                  >
                    {group.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-12">
            {FAQ_GROUPS.map((group, index) => (
              <div key={group.title} id={`faq-${index}`}>
                <h2 className="text-lg font-semibold tracking-tight text-navy-950">{group.title}</h2>
                <div className="mt-4 divide-y divide-steel-200 border-y border-steel-200">
                  {group.items.map((item) => (
                    <details key={item.question} className="group py-4">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-semibold text-navy-900 marker:hidden">
                        {item.question}
                        <span
                          aria-hidden="true"
                          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-steel-300 text-steel-500 transition-transform group-open:rotate-45"
                        >
                          <svg viewBox="0 0 16 16" className="size-2.5" fill="none">
                            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </span>
                      </summary>
                      <p className="mt-3 max-w-2xl pr-9 text-sm leading-6 text-steel-600">
                        {item.answer}
                      </p>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}
