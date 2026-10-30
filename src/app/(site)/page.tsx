import type { Metadata } from "next";
import { About } from "@/components/marketing/about";
import { Capabilities } from "@/components/marketing/capabilities";
import { CtaBand } from "@/components/marketing/cta-band";
import { Enquiry } from "@/components/marketing/enquiry";
import { Hero } from "@/components/marketing/hero";
import { MaterialsOverview } from "@/components/marketing/materials-overview";
import { Process } from "@/components/marketing/process";

export const metadata: Metadata = {
  title: "Managed Industrial Scrap Sourcing & Spare-Parts Procurement",
  description:
    "PRIMEMET manages industrial scrap sourcing and spare-parts procurement programmes: specification, supplier qualification, inspection, logistics and documentation in one accountable process.",
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <Capabilities />
      <MaterialsOverview />
      <Process />
      <About />
      <CtaBand />
      <Enquiry />
    </>
  );
}