import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** The single wording used for screens built on illustrative example records. */
export const EXAMPLE_DATA_LABEL =
  "Example layout — illustrative values, not real lots, suppliers, inspections or test results.";

/**
 * Marks a panel whose contents are illustrative structure rather than stored records.
 *
 * This is deliberately separate from `NotConnected`: that component says a database is
 * missing, this one says what is on screen is an example. A screen can need both, and
 * conflating them would let an example value read as a stored record.
 */
export function ExampleData({
  children,
  className,
  compact = false,
}: {
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-card border border-dashed border-amber-300 bg-amber-50",
        compact ? "px-4 py-3" : "px-5 py-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-amber-400 bg-white"
        >
          <span className="size-1.5 rounded-full bg-amber-500" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">{EXAMPLE_DATA_LABEL}</p>
          {children ? (
            <div className="mt-1.5 text-sm leading-6 text-amber-900/85">{children}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Marks a column or block that is internal-only.
 *
 * Used beside purchase rates, margins and other supplier-side commercial data so the
 * interface states its own exposure rule: these values must never appear in a public
 * payload, a printed quotation or a buyer-facing screen.
 */
export function InternalOnly({ children = "Internal only" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-red-700">
      <span aria-hidden="true" className="size-1 rounded-full bg-red-600" />
      {children}
    </span>
  );
}

/** Renders a value that has no record yet, so an empty cell never looks like a zero. */
export function NotRecorded({ label = "Not recorded" }: { label?: string }) {
  return <span className="text-xs italic text-steel-500">{label}</span>;
}
