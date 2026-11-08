import type { Metadata } from "next";

import { Panel, PortalPage } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { requirePage } from "@/lib/auth/guards";
import { getSellerApplication } from "@/lib/data/seller-portal";

export const metadata: Metadata = { title: "Tax and GST" };
export const dynamic = "force-dynamic";

const VERIFICATION_LABELS: Record<string, string> = {
  NOT_SUBMITTED: "Not submitted",
  PENDING: "Recorded — awaiting verification",
  UNDER_REVIEW: "Under review",
  VERIFIED: "Verified",
  REJECTED: "Not accepted",
  EXPIRED: "Expired",
};

/**
 * The seller's tax identity, as recorded.
 *
 * Read-only by design. Capturing a GSTIN is not verifying it: the state shown is `PENDING` until the
 * desk records evidence, and editing the number is a support request, not a self-service field.
 */
export default async function SellerTaxPage() {
  const user = await requirePage(["SELLER"], "/seller/tax");
  const application = await getSellerApplication(user);
  const organisation = application.organisation;
  const state = application.verification ?? "NOT_SUBMITTED";

  return (
    <PortalPage
      eyebrow="Account"
      title="Tax and GST"
      description="The tax identity the desk reviews. A number recorded here is not a verified number."
    >
      <Panel
        title="GST registration"
        description="Provided at registration. Only the PRIMEMET desk can change the number or record verification."
        actions={
          <Badge tone={state === "VERIFIED" ? "green" : state === "REJECTED" ? "red" : "amber"}>
            {VERIFICATION_LABELS[state] ?? state}
          </Badge>
        }
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-steel-500">GSTIN</dt>
            <dd className="mt-1 font-mono text-sm text-navy-900">{organisation?.gstin ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-steel-500">PAN</dt>
            <dd className="mt-1 font-mono text-sm text-navy-900">{organisation?.pan ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-steel-500">Registered state</dt>
            <dd className="mt-1 text-sm text-navy-900">{organisation?.stateCode ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-steel-500">Verification</dt>
            <dd className="mt-1 text-sm text-navy-900">{VERIFICATION_LABELS[state] ?? state}</dd>
          </div>
        </dl>
        <p className="mt-5 text-xs leading-5 text-steel-500">
          Nothing on this page is auto-verified: a GSTIN is checked against evidence by a person, and the
          result is recorded with an audit entry. Invoice and tax treatment are confirmed by the desk
          before any order is placed.
        </p>
      </Panel>
    </PortalPage>
  );
}
