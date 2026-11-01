import type { Metadata } from "next";
import { Callout, Prose } from "@/components/ui/prose";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";
import { pageMetadata } from "@/lib/seo";


export const metadata: Metadata = pageMetadata({
  title: "Privacy policy",
  description: "How PRIMEMET handles personal and business information submitted through this site.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Privacy policy"
        description="What this site collects, what it does not collect yet, and how enquiry information will be handled once the platform is live."
        crumbs={[{ label: "Privacy policy" }]}
      />

      <Section tone="light">
        <Callout>
          <strong className="font-semibold text-navy-900">Draft for review.</strong> This policy is
          a working draft for the Stage 1 preview site. It does not yet describe a live service and
          must be reviewed by PRIMEMET&apos;s legal adviser before publication.
        </Callout>

        <Prose className="mt-10">
          <h2>Current status of this website</h2>
          <p>
            This site is a frontend preview. The enquiry, contact and registration forms are layout
            demonstrations: they do not transmit, store or email any information you enter. No
            account can currently be created and no enquiry can currently be submitted.
          </p>
          <p>
            Because no form on this site submits data, no personal data is collected by PRIMEMET
            through it at this stage. The only data processing that may occur is the technical
            logging carried out by the hosting provider, described below.
          </p>

          <h2>Information we expect to collect once the platform is live</h2>
          <p>When enquiry submission and accounts are enabled, PRIMEMET will collect:</p>
          <ul>
            <li>Contact details you provide — name, business email, company and telephone.</li>
            <li>Business information — registered name, country of operation, tax registration.</li>
            <li>Enquiry content — material grades, part references, volumes and delivery requirements.</li>
            <li>Supplier documentation submitted during onboarding, such as licence references.</li>
            <li>Records of enquiries, quotations and consignments generated during a programme.</li>
          </ul>

          <h2>Why that information is needed</h2>
          <p>
            To assess an enquiry, prepare a specification and quotation, qualify suppliers, arrange
            inspection and logistics, and keep the consignment records that both sides rely on. It
            is not used for advertising, and it is not sold.
          </p>

          <h2>Separation of buyer and supplier information</h2>
          <p>
            Supplier identity and commercial terms, including purchase cost, margin and internal
            notes, are kept on the internal side of the platform. Buyer-facing screens show the
            material or part, the specification and the price offered to the buyer. Private contact
            details are not published publicly.
          </p>

          <h2>Retention</h2>
          <p>
            Enquiry and consignment records will be retained for as long as required to support an
            active programme and to meet record-keeping obligations. Specific retention periods
            will be confirmed before the platform goes live.
          </p>

          <h2>Hosting and technical logs</h2>
          <p>
            The site is served as a standard web application. The hosting provider may record
            technical information such as request paths, timestamps and coarse location for
            security and reliability purposes. No third-party analytics, advertising or tracking
            script is included in this build.
          </p>

          <h2>Your choices</h2>
          <p>
            Once the service is live you will be able to request access to, correction of, or
            deletion of the information you have submitted, subject to records PRIMEMET must retain
            for legal or contractual reasons. A dedicated contact route for these requests will be
            published with the live service.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            This draft will be replaced by a reviewed policy before launch. Material changes will be
            reflected on this page with a revised date.
          </p>
        </Prose>
      </Section>
    </>
  );
}
