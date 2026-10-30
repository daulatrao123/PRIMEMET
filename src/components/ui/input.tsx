import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";

const control =
  "w-full rounded-md border border-steel-300 bg-white px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-steel-500 transition-colors focus:border-green-600 focus:outline-none disabled:cursor-not-allowed disabled:bg-steel-50 disabled:text-steel-500";

/** Label + control + hint. Never renders validation state — Stage 1 has no forms backend. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs leading-5 text-steel-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(control, className)} {...props} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cx(control, "resize-y leading-6", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cx(control, "appearance-none bg-[length:0] pr-9", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  id,
  ...props
}: ComponentProps<"input"> & { label: string; id: string }) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded-sm border-steel-300 text-green-600 accent-green-600"
        {...props}
      />
      <label htmlFor={id} className="text-sm leading-6 text-steel-600">
        {label}
      </label>
    </div>
  );
}
