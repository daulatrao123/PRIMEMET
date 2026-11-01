import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Sign-in and registration previews must never be indexed.
 *
 * The pages are reachable so the interface can be reviewed, but they authenticate nothing. A search
 * result offering a "PRIMEMET sign-in" that cannot sign anyone in is worse than no result, and
 * Google explicitly asks for stand-alone sign-in pages to carry `noindex`.
 *
 * `follow: true` is deliberate: the pages link back into the public site, and those links should
 * still be discovered.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}