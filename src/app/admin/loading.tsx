/**
 * The control centre's loading state.
 *
 * Every admin screen is a dynamic server component that reads MongoDB, so a click can take a moment on a
 * cold connection. This renders immediately, keeps the layout's navigation in place, and announces itself
 * to assistive technology, so a slow read looks like work in progress rather than a dead page.
 */
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <div className="h-3 w-24 rounded bg-steel-200" />
      <div className="mt-3 h-7 w-64 max-w-full rounded bg-steel-200" />
      <div className="mt-2 h-4 w-96 max-w-full rounded bg-steel-100" />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-steel-200 bg-white p-5">
            <div className="h-3 w-20 rounded bg-steel-100" />
            <div className="mt-3 h-6 w-16 rounded bg-steel-200" />
            <div className="mt-2 h-3 w-28 rounded bg-steel-100" />
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-steel-200 bg-white p-5">
        <div className="h-4 w-40 rounded bg-steel-200" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-4 w-full rounded bg-steel-100" />
          ))}
        </div>
      </div>

      <p className="sr-only">Loading the control centre.</p>
    </div>
  );
}
