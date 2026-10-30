import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/lib/cx";

/**
 * Shared shell for every enquiry-style form in Stage 1.
 *
 * The form is a layout preview: it has no action, its submit button is disabled,
 * and the notice states plainly that nothing is sent, stored or emailed.
 *
 * TODO (Stage 2): post to a server action / route handler, validate on the server,
 * persist the enquiry to PostgreSQL and queue a notification email.
 */
export function PreviewForm({
  id,
  title,
  description,
  submitLabel = "Submit enquiry",
  footnote,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  submitLabel?: string;
  footnote?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const noticeId = `${id}-notice`;

  return (
    <Card className={cx("overflow-hidden", className)}>
      <div className="border-b border-steel-200 px-6 py-5 sm:px-7">
        <h2 className="text-base font-semibold text-navy-950">{title}</h2>
        {description ? <p className="mt-1.5 text-sm leading-6 text-steel-600">{description}</p> : null}
      </div>

      <form className="px-6 py-6 sm:px-7">
        <div
          id={noticeId}
          className="mb-6 rounded-md border border-dashed border-steel-300 bg-steel-50 px-4 py-3 text-xs leading-5 text-steel-600"
        >
          <span className="font-semibold text-navy-900">Frontend preview.</span> This form does
          not send, store or email anything yet. The enquiry workflow is switched on when the
          platform is connected in a later stage.
        </div>

        <fieldset className="grid gap-5 sm:grid-cols-2">{children}</fieldset>

        <div className="mt-7 flex flex-col gap-3 border-t border-steel-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-sm text-xs leading-5 text-steel-500">
            {footnote ?? "Fields are shown so the layout and wording can be reviewed."}
          </p>
          <Button type="button" disabled aria-describedby={noticeId} className="shrink-0">
            {submitLabel}
            <span className="font-normal opacity-80">(preview)</span>
          </Button>
        </div>
      </form>
    </Card>
  );
}
