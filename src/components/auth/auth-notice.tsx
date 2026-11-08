"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

/**
 * Inline feedback for the authentication forms.
 *
 * WHY THIS IS A CLIENT COMPONENT. The message arrives in the query string of a failed POST redirect
 * (`?error=…`, `?field=…`, `?notice=…`). Reading `searchParams` in the page made the whole sign-in screen
 * dynamic, so `next build` emitted no HTML for `/login` — every sign-in page became a 404 to a crawler and
 * to any deployment that served the build without the server. The page is now a static shell and only
 * this small piece reads the query string in the browser.
 *
 * It can only read the three parameters listed here and renders their text as escaped children, so a
 * crafted link cannot inject markup. The flag form (`?registered=1`) is fixed wording chosen here, never
 * returned from the URL.
 *
 * The Suspense wrapper is required, not cosmetic: a component reading the query string during a static
 * render makes the build fail unless it is inside a boundary (Next.js "missing suspense with csr
 * bailout"). With the wrapper the page stays static and the notice fills in after hydration.
 */
const FIELD_LABELS: Record<string, string> = {
  company: "Company name",
  contactName: "Contact name",
  email: "Email address",
  phone: "Phone number",
  gstin: "GSTIN",
  password: "Password",
  passwordConfirm: "Password confirmation",
  role: "Account type",
};

function AuthNoticeInner() {
  const params = useSearchParams();
  const error = params.get("error") ?? undefined;
  const notice = params.get("notice") ?? undefined;
  const field = params.get("field") ?? undefined;
  const registered = params.get("registered");
  const pending = params.get("pending");

  const success = pending
    ? "Your supplier application has been received. An administrator reviews it before the account can sign in."
    : registered
      ? "Your account is ready. Sign in to continue."
      : undefined;

  const message = error ?? notice ?? success;
  if (!message) return null;

  const isError = Boolean(error);
  const label = isError && field && FIELD_LABELS[field] ? FIELD_LABELS[field] : null;
  const classes = isError
    ? "border-red-200 bg-red-50 text-red-800"
    : "border-green-200 bg-green-50 text-green-900";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`rounded-md border px-4 py-3 text-sm leading-6 ${classes}`}
      data-tone={isError ? "error" : "success"}
    >
      {label ? <span className="font-medium">{label}: </span> : null}
      {message}
    </div>
  );
}

/**
 * Preserve a same-site destination across sign-in.
 *
 * The server already refuses anything that is not a rooted path (`safeNextPath`); this repeats the check
 * because the value now travels through the browser, and a hidden field is not a place to trust input.
 */
function NextFieldInner() {
  const value = useSearchParams().get("next") ?? "";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return <input type="hidden" name="next" value={value} />;
}

/** The notice, inside the Suspense boundary a static page needs. */
export function AuthNotice() {
  return (
    <Suspense fallback={null}>
      <AuthNoticeInner />
    </Suspense>
  );
}

/** The destination field, inside the same boundary. */
export function NextField() {
  return (
    <Suspense fallback={null}>
      <NextFieldInner />
    </Suspense>
  );
}
