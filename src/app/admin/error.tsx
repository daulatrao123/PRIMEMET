"use client";

import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/button";

/**
 * The control centre's error boundary.
 *
 * A failed read (database unreachable, a corrupt document) must not leave an administrator staring at a
 * blank screen, and it must not show a stack trace: the message here is fixed, the retry is a re-render of
 * the same segment, and the digest is the only detail shown so the owner can quote it in a report.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin area error", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm leading-6 text-red-900"
    >
      <h1 className="text-base font-semibold">This screen could not be loaded</h1>
      <p className="mt-2 max-w-2xl">
        The control centre could not read what it needed. Nothing was changed. Try again; if it keeps
        failing, sign in again or contact the PRIMEMET desk with the reference below.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-red-800">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/admin/dashboard" variant="secondary">
          Back to the dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
