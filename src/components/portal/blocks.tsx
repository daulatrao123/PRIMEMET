import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cx } from "@/lib/cx";

/** Page masthead inside a portal. */
export function PortalPage({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-green-700">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-950 sm:text-[1.7rem]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-steel-600">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>

      <div className="mt-8 space-y-6">{children}</div>
    </div>
  );
}

/**
 * Metric tile. A tile without a value shows an em dash and says why — it never
 * invents a figure, because there is no database behind these screens yet.
 */
export function Stat({
  label,
  hint,
  value,
}: {
  label: string;
  hint?: string;
  value?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-steel-500">{label}</p>
      <p
        className={cx(
          "mt-2 font-semibold tracking-tight",
          value ? "text-3xl text-navy-950" : "text-2xl text-steel-500",
        )}
        aria-label={value ? undefined : "No value available in this preview"}
      >
        {value ?? "—"}
      </p>
      <p className="mt-1 text-xs leading-5 text-steel-500">{hint ?? "In this preview, no count is available."}</p>
    </Card>
  );
}

/** Plain content panel used for every portal section. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cx("overflow-hidden", className)}>
      <div className="flex flex-col gap-3 border-b border-steel-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-navy-950">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-steel-500">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </Card>
  );
}

/** Disabled control used for actions that need the database or a session. */
export function PreviewAction({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      className="cursor-not-allowed rounded-md border border-steel-300 bg-steel-50 px-3 py-1.5 text-xs font-semibold text-steel-500"
    >
      {children}
      <span className="ml-1.5 font-normal">(preview)</span>
    </button>
  );
}
