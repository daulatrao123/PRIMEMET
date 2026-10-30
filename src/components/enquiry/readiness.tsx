import { Badge } from "@/components/ui/badge";
import { cx } from "@/lib/cx";
import { evaluateReadiness, type ReadinessState } from "@/lib/content/enquiry-fields";

const TONE: Record<ReadinessState, { badge: "green" | "amber" | "red"; ring: string; label: string }> = {
  QUOTATION_READY: { badge: "green", ring: "border-green-600/30 bg-green-50", label: "Quotation-ready" },
  NEEDS_CLARIFICATION: { badge: "amber", ring: "border-amber-500/30 bg-amber-50", label: "Clarification needed" },
  BLOCKED: { badge: "red", ring: "border-red-500/30 bg-red-50", label: "Not quotation-ready" },
};

/**
 * Quotation-readiness indicator.
 *
 * A lead is never marked quotation-ready while a blocker field is missing. Unknown
 * technical fields (grade, purity, part number) do not block the lead — they raise a
 * clarification task for the desk instead, because a buyer who does not know a grade
 * is still a legitimate buyer.
 *
 * The evaluation itself lives in src/lib/content/enquiry-fields.ts so the rule is stated
 * once and quoted by the architecture document.
 */
export function ReadinessIndicator({
  unknownFields,
  className,
}: {
  unknownFields: readonly string[];
  className?: string;
}) {
  const result = evaluateReadiness(unknownFields);
  const tone = TONE[result.state];

  return (
    <div className={cx("rounded-card border px-5 py-4", tone.ring, className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone.badge}>{result.label}</Badge>
        <p className="text-xs font-medium text-steel-600">{result.detail}</p>
      </div>
      <p className="mt-2 text-xs leading-5 text-steel-600">
        {result.state === "BLOCKED"
          ? "Pricing cannot start until every blocker is answered. Missing fields are listed in the clarification checklist below."
          : result.state === "NEEDS_CLARIFICATION"
            ? "The lead is accepted. Flagged technical fields are for the desk to confirm before a supplier quotation is requested."
            : "Essential information is present. Supplier matching and quotation preparation can proceed."}
      </p>
    </div>
  );
}

/** Compact inline marker for tables and lists. */
export function ReadinessPill({ state }: { state: ReadinessState }) {
  const tone = TONE[state];
  return <Badge tone={tone.badge}>{tone.label}</Badge>;
}