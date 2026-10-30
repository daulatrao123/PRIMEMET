import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";

type CardProps = ComponentProps<"div">;

/**
 * Surface card.
 *
 * Tailwind decides between two `bg-*` (or two `border-*`) utilities by their order in the
 * compiled stylesheet, not by the order they appear in a class string. A caller passing
 * `bg-navy-950` therefore lost to the card's own `bg-white` and rendered white-on-white.
 * Dropping the defaults when the caller supplies a background or border colour makes the
 * caller's intent win without needing `!important` or an extra wrapper element.
 */
const hasBackground = (className?: string) => /(?:^|\s)bg-/.test(className ?? "");
const hasBorderColor = (className?: string) => /(?:^|\s)border-(?!\d)/.test(className ?? "");

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cx(
        "rounded-card border shadow-[0_1px_0_rgba(15,24,38,0.04)]",
        hasBorderColor(className) ? undefined : "border-steel-200",
        hasBackground(className) ? undefined : "bg-white",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("p-6", className)} {...props} />;
}