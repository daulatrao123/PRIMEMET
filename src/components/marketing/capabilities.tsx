import Link from "next/link";
import { Section, SectionHeading } from "@/components/ui/section";

const SERVICES = [
  {
    title: "Scrap sourcing programmes",
    body: "Grade-by-grade supply agreements backed by a qualified supplier panel, with tolerances agreed before the first load ships.",
    points: ["Grade specification", "Supplier qualification", "Load planning"],
    icon: (
      <path d="M4 6h16M4 12h10M4 18h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    ),
  },
  {
    title: "Spare-parts procurement",
    body: "Obsolescence, long lead times and single-source risk handled by a desk that reads drawings, not just part numbers.",
    points: ["OEM & equivalent sourcing", "Reverse engineering", "Expediting"],
    icon: (
      <path
        d="M12 3.5l2.2 3.1 3.7.5-2.6 2.8.6 3.8-3.4-1.8-3.4 1.8.6-3.8-2.6-2.8 3.7-.5L12 3.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Inspection & quality",
    body: "Every batch has a record: radiation and contamination screening, visual grading, and photographic condition reports.",
    points: ["Batch photography", "Grade verification", "Non-conformance log"],
    icon: (
      <path
        d="M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM15.4 15.4L20 20"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    ),
  },
  {
    title: "Logistics & documentation",
    body: "Incoterms, export licensing and weighbridge reconciliation coordinated so goods and paperwork arrive together.",
    points: ["Freight coordination", "Weighbridge records", "Export paperwork"],
    icon: (
      <path
        d="M3.5 7.5h9v8h-9v-8zM12.5 10.5h4l3 3v2h-7v-5zM7 19a1.8 1.8 0 100-3.6A1.8 1.8 0 007 19zM17 19a1.8 1.8 0 100-3.6A1.8 1.8 0 0017 19z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    ),
  },
];

export function Capabilities() {
  return (
    <Section id="capabilities" tone="light">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading
          eyebrow="What we run"
          title="Four desks, one accountable programme"
          description="Most buyers manage scrap and spares across separate suppliers, forwarders and inspectors. PRIMEMET consolidates that into a single managed programme with one point of contact and one record of truth."
        />
        <Link
          href="/#process"
          className="group inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-navy-900 hover:text-green-700"
        >
          See how a brief moves
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 transition-transform group-hover:translate-x-0.5" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>

      <ul className="mt-14 grid gap-px overflow-hidden rounded-card bg-steel-200 sm:grid-cols-2 lg:grid-cols-4">
        {SERVICES.map((service, index) => (
          <li key={service.title} className="group bg-white p-7 transition-colors hover:bg-steel-50">
            <div className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-md bg-green-600 text-white">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none">
                  {service.icon}
                </svg>
              </span>
              <span className="font-mono text-xs text-steel-500">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="mt-6 text-base font-semibold text-navy-950">{service.title}</h3>
            <p className="mt-3 text-sm leading-6 text-steel-600">{service.body}</p>
            <ul className="mt-5 space-y-2 border-t border-steel-200 pt-4">
              {service.points.map((point) => (
                <li key={point} className="flex items-center gap-2 text-xs text-steel-500">
                  <span className="size-1 rounded-full bg-green-500" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}