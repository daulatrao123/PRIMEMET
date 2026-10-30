import type { ComponentProps, ReactNode } from "react";
import { STATUS_LABEL, type FieldStatus } from "@/lib/content/enquiry-fields";
import { cx } from "@/lib/cx";

const control =
  "w-full rounded-md border border-steel-300 bg-white px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-steel-500 transition-colors focus:border-green-600 focus:outline-none disabled:cursor-not-allowed disabled:bg-steel-50 disabled:text-steel-500";

const STATUS_TONE: Record<FieldStatus, string> = {
  REQUIRED: "text-green-700",
  SCRAP: "text-steel-600",
  PRODUCT: "text-steel-600",
  DELIVERY: "text-steel-600",
  OPTIONAL: "text-steel-500",
  LATER: "text-steel-500",
};

/**
 * The catalogue status (required / conditional / optional / later), rendered beside a label.
 * The label text comes from the field catalogue so the marker can never contradict it.
 */
export function FieldStatusMark({ status }: { status: FieldStatus }) {
  return (
    <span className={cx("ml-2 text-[0.65rem] font-medium normal-case tracking-normal", STATUS_TONE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Label + control + hint. The optional `status` comes from the enquiry field catalogue, so a
 * required field is visibly distinguished from a conditional or optional one.
 */
export function Field({
  label,
  htmlFor,
  hint,
  status,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  status?: FieldStatus;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
        {label}
        {status ? <FieldStatusMark status={status} /> : null}
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
