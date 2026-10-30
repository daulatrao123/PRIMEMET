import type { Metadata } from "next";
import { BuyerEnquiryWizard, FieldStatusLegend } from "@/components/enquiry/enquiry-form";
import { PortalPage } from "@/components/portal/blocks";
import { Card } from "@/components/ui/card";
import { NotConnected } from "@/components/ui/not-connected";

export const metadata: Metadata = { title: "Submit enquiry" };

/**
 * Buyer enquiry form preview.
 *
 * The wizard captures every field the desk needs to obtain supplier quotations and price
 * a buyer quotation without calling the buyer back: groups A–F from the quotation-ready
 * lead spec, with scrap and spare-part requirements as separate conditional branches.
 *
 * TODO (Stage 2): replace the client-only wizard with a server action that validates
 * against src/lib/content/enquiry-fields.ts, writes Enquiry + EnquiryLine rows scoped to
 * the signed-in buyer's organisation, assigns the ENQ reference and queues the desk
 * notification. Persist before notifying, so a mail failure never loses the lead.
 */
export default function BuyerEnquiryPage() {
  return (
    <PortalPage
      eyebrow="Sourcing"
      title="Submit an enquiry"
      description="One brief per requirement. The desk confirms the specification back to you before any supplier is contacted."
    >
      <NotConnected>
        Enquiry submission is not connected. The wizard below is a layout preview: it does not
        send, store or email anything.
      </NotConnected>

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <BuyerEnquiryWizard id="buyer-enquiry" idPrefix="bq" />

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-navy-950">Give the desk enough to price</h2>
            <p className="mt-2 text-xs leading-5 text-steel-600">
              A complete brief is the difference between a priced quotation and another round of
              questions. These items change the price the most:
            </p>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-steel-600">
              {[
                "Size and contamination limits, not just a grade name.",
                "The inspection standard you must meet.",
                "Whether a documented equivalent is acceptable for parts.",
                "The real delivery window, including site restrictions.",
                "Whether the requirement repeats, and at what monthly volume.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-green-600" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-navy-950">Field markers</h2>
            <div className="mt-2">
              <FieldStatusLegend />
            </div>
          </Card>

          <Card className="border-steel-200 bg-steel-50 p-5">
            <h2 className="text-sm font-semibold text-navy-950">What happens next</h2>
            <p className="mt-2 text-xs leading-5 text-steel-600">
              The desk reviews the brief, confirms the specification in writing and returns a
              quotation against a chosen sourcing route. Nothing is ordered without your approval.
            </p>
          </Card>

          <Card className="border-navy-800 bg-navy-950 p-5 text-white">
            <h2 className="text-sm font-semibold">Kept confidential</h2>
            <p className="mt-2 text-xs leading-5 text-navy-300">
              Your target price and contact details stay private. Suppliers see a redacted brief
              only, and no supplier cost is ever shown to you.
            </p>
          </Card>
        </aside>
      </div>
    </PortalPage>
  );
}