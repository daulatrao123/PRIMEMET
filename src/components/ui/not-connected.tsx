import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** The single wording used everywhere the app is waiting for its database. */
export const DB_PREVIEW_LABEL =
  "Preview — database connection will be configured on the production server.";

/**
 * Marks a screen or section whose data will come from PostgreSQL in a later stage.
 * It must never imply that data is present: no counts, no records, no status.
 */
export function NotConnected({
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
        "rounded-card border border-dashed border-steel-300 bg-steel-50",
        compact ? "px-4 py-3" : "px-5 py-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-steel-300 bg-white"
        >
          <span className="size-1.5 rounded-full bg-steel-400" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy-900">{DB_PREVIEW_LABEL}</p>
          {children ? (
            <div className="mt-1.5 text-sm leading-6 text-steel-600">{children}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
