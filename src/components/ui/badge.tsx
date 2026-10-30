import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

const tones = {
  green: "bg-green-50 text-green-700 ring-green-100",
  navy: "bg-navy-900 text-white ring-white/10",
  steel: "bg-steel-100 text-steel-600 ring-steel-200",
  outline: "bg-transparent text-navy-700 ring-navy-200",
  /* Semantic states used by enquiry readiness and verification status. */
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
} as const;

export function Badge({
  children,
  tone = "steel",
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}