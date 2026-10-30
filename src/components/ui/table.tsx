import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Scrollable data table. Caption is required: every table in the app is described. */
export function Table({
  caption,
  children,
  className,
}: {
  caption: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("overflow-x-auto rounded-card border border-steel-200 bg-white", className)}>
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-steel-200 bg-steel-50 text-xs uppercase tracking-[0.12em] text-steel-500">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-steel-200">{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cx("align-top transition-colors hover:bg-steel-50/70", className)}>{children}</tr>;
}

export function TH({ children, className, ...props }: ComponentProps<"th">) {
  return (
    <th scope="col" className={cx("px-5 py-3.5 font-semibold", className)} {...props}>
      {children}
    </th>
  );
}

export function THRow({ children }: { children: ReactNode }) {
  return <th scope="row" className="px-5 py-4 font-semibold text-navy-950">{children}</th>;
}

export function TD({ children, className, ...props }: ComponentProps<"td">) {
  return (
    <td className={cx("px-5 py-4 text-steel-600", className)} {...props}>
      {children}
    </td>
  );
}

/** Empty state that spans the table, used wherever records arrive from the database. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center text-sm leading-6 text-steel-500">
        {children}
      </td>
    </tr>
  );
}
