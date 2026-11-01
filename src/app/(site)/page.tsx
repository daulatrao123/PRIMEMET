import type { Metadata } from "next";
import { About } from "@/components/marketing/about";
import { Capabilities } from "@/components/marketing/capabilities";
import { CtaBand } from "@/components/marketing/cta-band";
import { Enquiry } from "@/components/marketing/enquiry";
import { Hero } from "@/components/marketing/hero";
import { MaterialsOverview } from "@/components/marketing/materials-overview";
import { Process } from "@/components/marketing/process";
import { QualityBand } from "@/components/marketing/quality-band";
import { pageMetadata } from "@/lib/seo";

import { JsonLd } from "@/components/seo/json-ld";
import { organizationSchema, websiteSchema } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Managed Industrial Scrap Sourcing & Spare-Parts Procurement",
  description: "PRIMEMET manages industrial scrap sourcing and spare-parts procurement programmes: specification, supplier qualification, inspection, logistics and documentation in one accountable process.",
  path: "/",
  type: "website",
});

export default function HomePage() {
  return (
    <>
      {/* Site-level entities live on the home page only; other pages reference them by @id. */}
      <JsonLd data={organizationSchema()} />
      <JsonLd data={websiteSchema()} />
      <Hero />
      <Capabilities />
      <MaterialsOverview />
      <Process />
      <QualityBand />
      <About />
      <CtaBand />
      <Enquiry />
    </>
  );
}