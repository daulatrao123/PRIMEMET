"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/lib/cx";

/**
 * Multi-step enquiry wizard primitives.
 *
 * Client-side presentation only: state lives in React memory, nothing is persisted,
 * transmitted or stored. The whole wizard is a reviewable layout for the enquiry
 * capture design — the submit button is permanently disabled and says so.
 *
 * TODO (Stage 2): replace with a server action that validates against one shared
 * schema (see src/lib/content/enquiry-fields.ts), writes the Enquiry + EnquiryLine
 * rows for the signed-in buyer and queues the desk notification.
 */

type WizardContextValue = {
  step: number;
  kind: string;
  activeId: string;
  setKind: (kind: string) => void;
};

const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizard() {
  const value = useContext(WizardContext);
  if (!value) throw new Error("Wizard components must be rendered inside <EnquiryWizard>.");
  return value;
}

export type WizardStep = {
  /** Stable slot id; each <Step id> renders only while its slot is active. */
  id: string;
  title: string;
  summary: string;
  /** Which requirement kinds this step is relevant to. Omitted = every kind. */
  only?: readonly string[];
};

export function EnquiryWizard({
  id,
  steps,
  kinds,
  defaultKind = "MATERIAL",
  className,
  children,
}: {
  id: string;
  steps: readonly WizardStep[];
  kinds: readonly { value: string; label: string }[];
  defaultKind?: string;
  className?: string;
  children: ReactNode;
}) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState(defaultKind);

  const visible = useMemo(
    () => steps.filter((s) => !s.only || s.only.includes(kind)),
    [steps, kind],
  );

  const go = useCallback(
    (next: number) => {
      setStep(Math.max(0, Math.min(next, visible.length - 1)));
      // Keep the form's own heading in view when moving between steps.
      document.getElementById(`${id}-top`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [id, visible.length],
  );

  const current = visible[Math.min(step, visible.length - 1)];
  const context = useMemo(
    () => ({ step, kind, activeId: current?.id ?? "", setKind }),
    [step, kind, current],
  );

  return (
    <WizardContext.Provider value={context}>
      <Card id={`${id}-top`} className={cx("overflow-hidden", className)}>
        <div className="border-b border-steel-200 bg-steel-50 px-5 py-5 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-steel-500">
              Step {Math.min(step, visible.length - 1) + 1} of {visible.length}
            </p>
            <p className="rounded-full border border-steel-300 bg-white px-3 py-1 text-[0.68rem] font-semibold text-steel-600">
              Frontend preview — nothing is saved or sent
            </p>
          </div>

          <ol className="mt-4 flex flex-wrap gap-x-2 gap-y-2" aria-label="Enquiry steps">
            {visible.map((item, index) => {
              const state = index === step ? "current" : index < step ? "done" : "todo";
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => go(index)}
                    aria-current={state === "current" ? "step" : undefined}
                    className={cx(
                      "rounded-md border px-2.5 py-1.5 text-left text-[0.7rem] font-medium transition-colors",
                      state === "current" && "border-navy-950 bg-navy-950 text-white",
                      state === "done" && "border-green-600/40 bg-white text-navy-900",
                      state === "todo" && "border-steel-300 bg-white text-steel-600 hover:border-steel-400",
                    )}
                  >
                    <span className="mr-1.5 font-mono text-[0.65rem] opacity-70">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {item.title}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <form className="px-5 py-6 sm:px-7">
          <div className="mb-6 rounded-md border border-dashed border-steel-300 bg-steel-50 px-4 py-3 text-xs leading-5 text-steel-600">
            <span className="font-semibold text-navy-900">Frontend preview.</span> This wizard does
            not send, store or email anything. Validation rules and conditional fields are shown so
            the design can be reviewed before the backend exists.
          </div>

          <WizardKindPicker kinds={kinds} />

          {current ? (
            <section aria-labelledby={`${id}-step-heading`} className="mt-6">
              <h2 id={`${id}-step-heading`} className="text-base font-semibold text-navy-950">
                {current.title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-steel-600">{current.summary}</p>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
            </section>
          ) : null}

          <div className="mt-7 flex flex-col gap-3 border-t border-steel-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => go(step - 1)}
              disabled={step === 0}
              className="rounded-md border border-steel-300 px-3.5 py-2 text-xs font-semibold text-navy-900 transition-colors hover:bg-steel-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="secondary"
                disabled
                title="Submission is not connected in this preview."
              >
                Submit (preview)
              </Button>
              <Button type="button" onClick={() => go(step + 1)} disabled={step >= visible.length - 1}>
                Next step
              </Button>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-steel-500">
            Submit stays disabled in this preview: there is no endpoint, no database and no email
            transport. Use the contact route for a live conversation today.
          </p>
        </form>
      </Card>
    </WizardContext.Provider>
  );
}

/** Requirement-kind switch. Selecting scrap or parts adds/removes whole field groups. */
function WizardKindPicker({ kinds }: { kinds: readonly { value: string; label: string }[] }) {
  const { kind, setKind } = useWizard();
  return (
    <fieldset className="mt-6">
      <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-steel-600">
        What are you asking for?
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {kinds.map((option) => (
          <label
            key={option.value}
            className={cx(
              "cursor-pointer rounded-md border px-3 py-2 text-xs font-semibold transition-colors",
              kind === option.value
                ? "border-green-600 bg-green-50 text-green-700"
                : "border-steel-300 bg-white text-steel-600 hover:border-steel-400",
            )}
          >
            <input
              type="radio"
              name="requirement-kind"
              value={option.value}
              checked={kind === option.value}
              onChange={() => setKind(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Renders its fields only while its step is the active one. */
export function Step({ id, children }: { id: string; children: ReactNode }) {
  const { activeId } = useWizard();
  if (activeId !== id) return null;
  return <>{children}</>;
}

/** Shown only when the selected requirement kind is in `for`. */
export function WhenKind({ for: kinds, children }: { for: readonly string[]; children: ReactNode }) {
  const { kind } = useWizard();
  if (!kinds.includes(kind)) return null;
  return <>{children}</>;
}

/**
 * Disclosure block. Content is not rendered until opened, so a long requirement
 * never lands on the buyer all at once.
 */
export function Advance({
  title,
  hint,
  children,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="sm:col-span-2 rounded-md border border-steel-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-navy-900">
        {title}
        {hint ? <span className="ml-2 font-normal normal-case tracking-normal text-steel-500">{hint}</span> : null}
      </summary>
      <div className="grid gap-5 border-t border-steel-200 px-4 py-4 sm:grid-cols-2">{children}</div>
    </details>
  );
}

/** Required / conditional / optional marker used beside every field label. */
export function StatusNote({ status }: { status: "REQUIRED" | "SCRAP" | "PRODUCT" | "DELIVERY" | "OPTIONAL" | "LATER" }) {
  const map = {
    REQUIRED: { text: "Required", tone: "text-green-700" },
    SCRAP: { text: "Required for scrap", tone: "text-steel-600" },
    PRODUCT: { text: "Required for parts", tone: "text-steel-600" },
    DELIVERY: { text: "Needed for delivered quote", tone: "text-steel-600" },
    OPTIONAL: { text: "Optional", tone: "text-steel-500" },
    LATER: { text: "Collected later", tone: "text-steel-500" },
  } as const;
  const item = map[status];
  return <span className={cx("ml-2 text-[0.65rem] font-medium normal-case tracking-normal", item.tone)}>{item.text}</span>;
}
