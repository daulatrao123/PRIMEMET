import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Long-form legal/editorial text. Deliberately narrow measure for readability. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "max-w-3xl text-sm leading-7 text-steel-600",
        "[&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-navy-950",
        "[&_h3]:mt-7 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-navy-900",
        "[&_p]:mt-4 [&_p]:leading-7",
        "[&_ul]:mt-4 [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:marker:text-green-600",
        "[&_a]:font-medium [&_a]:text-green-700 [&_a]:underline [&_a]:underline-offset-2",
        "[&_strong]:font-semibold [&_strong]:text-navy-900",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="mt-8 rounded-card border border-steel-200 bg-steel-50 px-5 py-4 text-sm leading-6 text-steel-600">
      {children}
    </div>
  );
}
