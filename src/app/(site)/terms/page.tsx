import type { Metadata } from "next";
import { Callout, Prose } from "@/components/ui/prose";
import { PageHero } from "@/components/ui/page-hero";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Terms and conditions",
  description: "Terms governing use of the PRIMEMET website and the basis on which sourcing programmes are quoted.",
};

export default function TermsPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Terms and conditions"
        description="The basis on which this website is provided, and how a sourcing programme becomes a contractual engagement."
        crumbs={[{ label: "Terms and conditions" }]}
      />

      <Section tone="light">
        <Callout>
          <strong className="font-semibold text-navy-900">Draft for review.</strong> These terms are
          a working draft for the Stage 1 preview site. They are not a contract and must be reviewed
          by PRIMEMET&apos;s legal adviser before publication.
        </Callout>

        <Prose className="mt-10">
          <h2>1. Status of this website</h2>
          <p>
            This website is a preview of the PRIMEMET platform. Content describes sourcing services
            and how they are delivered. It is not an offer, a quotation, or an invitation to buy any
            particular material, part or service.
          </p>
          <p>
            Nothing on this site constitutes a binding commercial offer. No order, quotation or
            contract is created by browsing the site or by completing a preview form, because no
            preview form submits data.
          </p>

          <h2>2. Catalogue information</h2>
          <p>
            Material and spare-parts pages describe categories and sourcing methods. They do not
            publish tonnage, stock position, availability or pricing. Any specification shown is a
            framing for a conversation and is agreed in writing per brief before sourcing begins.
          </p>

          <h2>3. No professional or engineering advice</h2>
          <p>
            Content on this site is commercial and technical background, not engineering, safety or
            compliance advice for a specific installation. Suitability of a material or replacement
            part for a given application remains the responsibility of the buyer&apos;s engineering
            function.
          </p>

          <h2>4. Enquiries, quotations and engagement</h2>
          <p>
            A sourcing programme begins only when PRIMEMET has confirmed a written specification and
            issued commercial terms that the buyer accepts. Quotation validity, delivery terms, and
            payment terms are stated in that document rather than on this site.
          </p>
          <ul>
            <li>Specifications are confirmed in writing before sourcing starts.</li>
            <li>Substitutions for discontinued parts are proposed with their differences stated.</li>
            <li>Non-conformances are recorded against the consignment and resolved with the supplier.</li>
          </ul>

          <h2>5. Supplier information</h2>
          <p>
            Supplier identity, purchase costs, margins and internal notes are confidential and are
            not disclosed to buyers. Likewise, buyer requirements are not shared publicly. Both
            parties agree to keep commercially sensitive information received through a programme
            confidential.
          </p>

          <h2>6. Acceptable use</h2>
          <p>
            You agree not to attempt to gain unauthorised access to any part of the platform, to
            interfere with its operation, or to submit content that is unlawful or misleading. The
            administrative, buyer and seller areas of this site are previews and contain no
            accessible records.
          </p>

          <h2>7. Intellectual property</h2>
          <p>
            The PRIMEMET name, site design and written content are the property of PRIMEMET.
            Drawings, samples and technical documents you supply remain yours and are used only to
            assess and deliver the brief you sent.
          </p>

          <h2>8. Liability</h2>
          <p>
            The website is provided as-is for evaluation purposes. To the extent permitted by law,
            PRIMEMET accepts no liability for decisions taken on the basis of preview content. Once
            a programme is agreed, liability is governed by the terms of that engagement.
          </p>

          <h2>9. Governing law</h2>
          <p>
            The governing law and jurisdiction for any engagement will be stated in the engagement
            terms. This will be confirmed before the platform is launched.
          </p>

          <h2>10. Changes</h2>
          <p>
            These draft terms will be replaced by reviewed terms before launch. Continued use of
            the site after publication of revised terms constitutes acceptance of them.
          </p>
        </Prose>
      </Section>
    </>
  );
}
