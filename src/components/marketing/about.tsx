import { Section, SectionHeading } from "@/components/ui/section";

const PRINCIPLES = [
  {
    title: "Specification first",
    body: "A grade named on paper is not a grade delivered. Every brief is written down, agreed and measured against what arrives.",
  },
  {
    title: "Records by default",
    body: "Inspection photographs, weighbridge tickets and non-conformance notes belong to the load, not to someone's inbox.",
  },
  {
    title: "No undisclosed parties",
    body: "You know which yard or stockist a lot came from. Sub-sourcing chains are declared, not hidden behind a margin.",
  },
];

export function About() {
  return (
    <Section id="about" tone="light">
      <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <SectionHeading
            eyebrow="Who we are"
            title="A sourcing desk, not a scrap broker"
            description="PRIMEMET exists for procurement and maintenance teams who cannot afford a delivery that fails the furnace, the line or the audit. We run the sourcing programme and stay accountable for the result."
          />

          <div id="company" className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-steel-200 pt-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Remit</p>
              <p className="mt-2 text-sm text-navy-900">Ferrous, non-ferrous, alloys, spare parts</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Model</p>
              <p className="mt-2 text-sm text-navy-900">Managed sourcing programme</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Reporting</p>
              <p className="mt-2 text-sm text-navy-900">Batch-level documentation</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel-500">Contact</p>
              <p className="mt-2 text-sm text-navy-900">Enquiry desk, weekdays</p>
            </div>
          </div>
        </div>

        <ul className="space-y-px overflow-hidden rounded-card bg-steel-200">
          {PRINCIPLES.map((principle) => (
            <li key={principle.title} className="bg-steel-50 p-7">
              <div className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className="mt-1 grid size-7 shrink-0 place-items-center rounded-sm bg-green-600 text-white"
                >
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
                    <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <h3 className="text-base font-semibold text-navy-950">{principle.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-steel-600">{principle.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}