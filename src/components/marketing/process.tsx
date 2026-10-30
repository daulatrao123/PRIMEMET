import { Section, SectionHeading } from "@/components/ui/section";

const STEPS = [
  {
    step: "01",
    title: "Brief",
    body: "You send the grade, volume, delivery window and any inspection standard. We confirm the specification back in writing before sourcing begins.",
  },
  {
    step: "02",
    title: "Qualify",
    body: "Suppliers are screened on licences, capacity, past batches and references. Only qualified yards and stockists enter the shortlist.",
  },
  {
    step: "03",
    title: "Inspect",
    body: "Batches are screened and graded before dispatch, with photographs and a condition record attached to the load.",
  },
  {
    step: "04",
    title: "Deliver",
    body: "Freight, weighbridge reconciliation and export documentation are coordinated, and the delivered lot is reconciled against the brief.",
  },
];

export function Process() {
  return (
    <Section id="process" tone="navy">
      <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading
          tone="dark"
          eyebrow="How it works"
          title="A brief moves through four checkpoints"
          description="No enquiry disappears into a broker's inbox. Each checkpoint has an owner, a decision and a record you can audit later."
        />
        <p className="max-w-xs text-sm leading-6 text-navy-300">
          Timelines are agreed per programme when the brief is confirmed. Complex
          spare-parts recoveries with drawing review are quoted with their own
          lead time.
        </p>
      </div>

      <ol className="mt-14 grid gap-px overflow-hidden rounded-card bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((item, index) => (
          <li key={item.step} className="relative bg-navy-950 p-7">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs tracking-widest text-green-400">{item.step}</span>
              {index < STEPS.length - 1 ? (
                <span aria-hidden="true" className="h-px flex-1 self-center bg-white/10" />
              ) : null}
            </div>
            <h3 className="mt-6 text-lg font-semibold text-white">{item.title}</h3>
            <p className="mt-3 text-sm leading-6 text-navy-300">{item.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}