import { Badge } from "@/components/ui/badge";
import { Section, SectionHeading } from "@/components/ui/section";

const GROUPS = [
  {
    name: "Ferrous",
    summary: "Heavy melt, shredded and plate grades for mills and foundries.",
    grades: ["HMS 1&2", "Shredded", "P&S 5/8", "Plate & structural"],
  },
  {
    name: "Non-ferrous",
    summary: "Copper, aluminium and alloy grades with documented composition.",
    grades: ["Copper millberry", "Aluminium taint/tabor", "Brass solids", "Mixed alloy"],
  },
  {
    name: "Alloys & specials",
    summary: "Stainless and high-value alloys handled with full traceability.",
    grades: ["304 / 316 stainless", "Inconel & nickel", "Turnings", "Catalyst-bearing"],
  },
  {
    name: "Spare parts",
    summary: "Rotating equipment, wear parts and obsolete OEM components.",
    grades: ["Bearings & seals", "Pumps & valves", "Gearbox assemblies", "Obsolete OEM"],
  },
];

export function MaterialsOverview() {
  return (
    <Section id="materials" tone="grey">
      <SectionHeading
        eyebrow="Materials"
        title="Grades specified the way your mill, furnace or line needs them"
        description="Every category below is sourced against a written specification — grade, contamination limits, sizing and packaging agreed up front so the delivered lot matches the brief."
      />

      <div className="mt-14 overflow-hidden rounded-card border border-steel-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Material categories and representative grades</caption>
          <thead>
            <tr className="border-b border-steel-200 bg-steel-50 text-xs uppercase tracking-[0.12em] text-steel-500">
              <th scope="col" className="px-6 py-4 font-semibold">Category</th>
              <th scope="col" className="hidden px-6 py-4 font-semibold md:table-cell">Scope</th>
              <th scope="col" className="px-6 py-4 font-semibold">Representative grades</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-200">
            {GROUPS.map((group) => (
              <tr key={group.name} className="align-top transition-colors hover:bg-steel-50/70">
                <th scope="row" className="whitespace-nowrap px-6 py-5 text-sm font-semibold text-navy-950">
                  {group.name}
                </th>
                <td className="hidden px-6 py-5 text-sm leading-6 text-steel-600 md:table-cell">
                  {group.summary}
                </td>
                <td className="px-6 py-5">
                  <div className="flex flex-wrap gap-1.5">
                    {group.grades.map((grade) => (
                      <Badge key={grade} tone="outline">
                        {grade}
                      </Badge>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs leading-5 text-steel-500">
        Grade list shown for demonstration. Live availability, tonnage and pricing
        are published once the platform is connected to its database.
      </p>
    </Section>
  );
}