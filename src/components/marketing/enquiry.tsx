import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section, SectionHeading } from "@/components/ui/section";

const BRIEF_FIELDS = [
  "Material category or part number",
  "Volume and delivery cadence",
  "Destination and delivery window",
  "Inspection standard or certificate required",
];

/**
 * Demo enquiry section.
 * TODO (Stage 2+): replace the mailto with a real enquiry form that posts to an
 * API route and persists to PostgreSQL. This page must not claim an enquiry was
 * sent, stored or acknowledged by the platform.
 */
export function Enquiry() {
  const email = `enquiries${"@"}primemet.com`;

  return (
    <Section id="enquiry" tone="grey">
      <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div>
          <SectionHeading
            eyebrow="Enquiries"
            title="Start with a brief"
            description="Tell us the material or part, the volume, the destination and the standard it must meet. A specification review is the first thing you receive back."
          />

          <ul className="mt-8 space-y-3">
            {BRIEF_FIELDS.map((field) => (
              <li key={field} className="flex items-start gap-3 text-sm text-steel-600">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-green-600"
                />
                {field}
              </li>
            ))}
          </ul>
        </div>

        <Card className="p-7 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-steel-500">
                Enquiry desk
              </p>
              <p className="mt-2 text-sm text-steel-600">Weekdays, 08:00 to 18:00 CET</p>
            </div>
            <Badge tone="green">Pre-launch</Badge>
          </div>

          <div className="mt-7 rounded-md border border-steel-200 bg-steel-50 p-5">
            <p className="text-sm font-semibold text-navy-950">Online form not yet available</p>
            <p className="mt-2 text-sm leading-6 text-steel-600">
              This site is an early preview. The enquiry form will open once the
              PRIMEMET platform is live. For now, please send your brief by email
              and a member of the desk will respond directly.
            </p>
          </div>

          <ButtonLink href={`mailto:${email}`} size="lg" className="mt-6 w-full">
            Email the enquiry desk
          </ButtonLink>

          <p className="mt-4 text-center text-xs text-steel-500">
            {email} <span className="italic">(placeholder address)</span>
          </p>

          <div className="mt-6 border-t border-steel-200 pt-5">
            <Link
              href="/#process"
              className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-700 hover:text-green-700"
            >
              Review the working process
            </Link>
          </div>
        </Card>
      </div>
    </Section>
  );
}