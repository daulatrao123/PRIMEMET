import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";

type CardProps = ComponentProps<"div">;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cx(
        "rounded-card border border-steel-200 bg-white shadow-[0_1px_0_rgba(15,24,38,0.04)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("p-6", className)} {...props} />;
}
