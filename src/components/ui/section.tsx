import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export function Section({
  children,
  className,
  id,
  tone = "light",
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  tone?: "light" | "grey" | "navy";
}) {
  const tones = {
    light: "bg-white text-navy-900",
    grey: "bg-steel-50 text-navy-900",
    navy: "bg-navy-950 text-white",
  } as const;

  return (
    <section id={id} className={cx("py-20 sm:py-24", tones[tone], className)}>
      <div className="mx-auto max-w-7xl px-5 sm:px-8">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  tone = "light",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  tone?: "light" | "dark";
}) {
  return (
    <div className={cx("max-w-2xl", align === "center" && "mx-auto text-center")}>
      <p
        className={cx(
          "text-xs font-semibold uppercase tracking-[0.2em]",
          tone === "dark" ? "text-green-400" : "text-green-600",
        )}
      >
        {eyebrow}
      </p>
      <h2
        className={cx(
          "mt-4 text-3xl font-semibold tracking-tight sm:text-[2.35rem] sm:leading-[1.15]",
          tone === "dark" ? "text-white" : "text-navy-950",
        )}
      >
        {title}
      </h2>
      {description ? (
        <p
          className={cx(
            "mt-5 text-base leading-7",
            tone === "dark" ? "text-navy-300" : "text-steel-600",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
