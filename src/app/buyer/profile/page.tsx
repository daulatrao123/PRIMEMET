import type { Metadata } from "next";

import { Panel, PortalPage } from "@/components/portal/blocks";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { requirePage } from "@/lib/auth/guards";
import { getBuyerProfile } from "@/lib/data/buyer-portal";

export const metadata: Metadata = { title: "Company profile" };
export const dynamic = "force-dynamic";

const VERIFICATION_LABELS: Record<string, string> = {
  NOT_SUBMITTED: "Not submitted",
  PENDING: "Pending review",
  UNDER_REVIEW: "Under review",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

/**
 * The buyer's company and contact details.
 *
 * The GSTIN is shown and not editable: it is the identity the organisation was verified against. The
 * form posts to `/api/buyer/profile`, which resolves the organisation from the session — the form carries
 * no organisation id, so it cannot be retargeted.
 */
export default async function BuyerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requirePage(["BUYER"], "/buyer/profile");
  const query = await searchParams;
  const profile = await getBuyerProfile(user);
  const organisation = profile.organisation;

  return (
    <PortalPage
      eyebrow="Buyer portal"
      title="Company profile"
      description="Your legal entity, contact details and verification status. The PRIMEMET desk matches supplier offers against these details."
    >
      {query.ok ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{query.ok}</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error}
        </p>
      ) : null}

      {!organisation ? (
        <Panel title="Organisation">
          <p className="text-sm text-steel-600">
            This account is not linked to an organisation yet. Contact the PRIMEMET desk to be attached to a
            company before raising enquiries.
          </p>
        </Panel>
      ) : (
        <Panel
          title={organisation.legalName}
          description="GSTIN is fixed at verification. Contact the desk if it must change."
          actions={
            <Badge tone={organisation.verificationStatus === "VERIFIED" ? "green" : "amber"}>
              {VERIFICATION_LABELS[organisation.verificationStatus ?? "NOT_SUBMITTED"] ?? organisation.verificationStatus}
            </Badge>
          }
        >
          <form method="post" action="/api/buyer/profile" className="grid gap-4 sm:grid-cols-2">
            <Field label="Company legal name" htmlFor="profile-legal-name">
              <Input id="profile-legal-name" name="company" defaultValue={organisation.legalName} maxLength={240} required />
            </Field>
            <Field label="GSTIN" htmlFor="profile-gstin" hint="Verified identity — not editable here.">
              <Input id="profile-gstin" value={organisation.gstin ?? "Not provided"} readOnly disabled />
            </Field>
            <Field label="City" htmlFor="profile-city">
              <Input id="profile-city" name="city" defaultValue={organisation.city ?? ""} maxLength={120} />
            </Field>
            <Field label="State code" htmlFor="profile-state">
              <Input id="profile-state" name="stateCode" defaultValue={organisation.stateCode ?? ""} maxLength={8} placeholder="MH" />
            </Field>
            <Field label="Website" htmlFor="profile-website">
              <Input id="profile-website" name="website" defaultValue={organisation.website ?? ""} type="url" placeholder="https://" />
            </Field>
            <span />
            <Field label="Your name" htmlFor="profile-name">
              <Input id="profile-name" name="contactName" defaultValue={profile.contactName} maxLength={240} required />
            </Field>
            <Field label="Work email" htmlFor="profile-email" hint="Changing the sign-in address is a support request.">
              <Input id="profile-email" value={profile.email} readOnly disabled />
            </Field>
            <Field label="Phone" htmlFor="profile-phone">
              <Input id="profile-phone" name="phone" defaultValue={profile.phone ?? ""} />
            </Field>
            <Field label="Job title" htmlFor="profile-job">
              <Input id="profile-job" name="jobTitle" defaultValue={profile.jobTitle ?? ""} maxLength={120} />
            </Field>
            <Field label="Department" htmlFor="profile-department">
              <Select id="profile-department" name="department" defaultValue={profile.department ?? ""}>
                <option value="">Not specified</option>
                <option value="Procurement">Procurement</option>
                <option value="Maintenance">Maintenance</option>
                <option value="Operations">Operations</option>
                <option value="Finance">Finance</option>
                <option value="Management">Management</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </Panel>
      )}
    </PortalPage>
  );
}
