import { ButtonLink } from "@/components/ui/button";

export function CtaBand() {
  return (
    <section className="border-y border-steel-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-600">Next step</p>
          <h2 className="mt-4 max-w-xl text-3xl font-semibold tracking-tight text-navy-950">
            Send one brief and see how the programme runs.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-steel-600">
            Start with a single grade or a single part number. You get a
            specification review and an indicative sourcing route: no obligation
            and no retainer to look at the numbers.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
          <ButtonLink href="/#enquiry" size="lg">
            Contact the enquiry desk
          </ButtonLink>
          <ButtonLink href="/#process" variant="secondary" size="lg">
            Review the process
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}