import type { Metadata } from "next";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main id="main" className="flex-1 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-28 text-center sm:px-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-green-600">Error 404</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-navy-950 sm:text-4xl">
            This page is not part of the PRIMEMET site
          </h1>
          <p className="mt-4 text-base leading-7 text-steel-600">
            The address may be mistyped, or the section has not been published yet.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink href="/">Back to the home page</ButtonLink>
            <ButtonLink href="/contact" variant="secondary">
              Contact the desk
            </ButtonLink>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}