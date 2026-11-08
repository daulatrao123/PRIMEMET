import type { Metadata } from "next";

import { Panel, PortalPage } from "@/components/portal/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { requirePage } from "@/lib/auth/guards";
import { ACCOUNT_STATUS_LABELS, BUSINESS_TYPE_LABELS, getSellerApplication } from "@/lib/data/seller-portal";

export const metadata: Metadata = { title: "Business profile" };
export const dynamic = "force-dynamic";

/**
 * The seller's company record and registered address.
 *
 * The form posts to `/api/seller/profile`, which resolves the organisation from the session; there is no
 * organisation id in the markup. The GSTIN is read-only here for the same reason it is read-only for a
 * buyer: it is the number the desk reviews, not a field a seller edits after submitting.
 */
export default async function SellerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requirePage(["SELLER"], "/seller/profile");
  const query = await searchParams;
  const application = await getSellerApplication(user);
  const organisation = application.organisation;

  return (
    <PortalPage
      eyebrow="Supplier portal"
      title="Business profile"
      description="Legal identity, registered address and what your business can prepare or manufacture. The desk reviews this before approving the account."
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
            This account is not linked to a supplier organisation yet. Contact the PRIMEMET desk.
          </p>
        </Panel>
      ) : (
        <>
          <Panel
            title={organisation.legalName}
            description="The GSTIN is fixed at submission. Contact the desk if it must change."
            actions={
              <Badge tone={organisation.accountStatus === "ACTIVE" ? "green" : organisation.accountStatus === "REJECTED" ? "red" : "amber"}>
                {ACCOUNT_STATUS_LABELS[organisation.accountStatus] ?? organisation.accountStatus}
              </Badge>
            }
          >
            {organisation.reviewFeedback ? (
              <p className="mb-4 rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm leading-6 text-navy-900">
                <span className="font-medium">Desk decision: </span>
                {organisation.reviewFeedback}
              </p>
            ) : null}

            <form method="post" action="/api/seller/profile" className="grid gap-4 sm:grid-cols-2">
              <Field label="Company legal name" htmlFor="seller-company">
                <Input id="seller-company" name="company" defaultValue={organisation.legalName} maxLength={240} required />
              </Field>
              <Field label="Trading name" htmlFor="seller-trade" hint="Optional">
                <Input id="seller-trade" name="tradeName" defaultValue={organisation.tradeName ?? ""} maxLength={240} />
              </Field>
              <Field label="GSTIN" htmlFor="seller-gstin" hint="Recorded at registration — not editable here.">
                <Input id="seller-gstin" value={organisation.gstin ?? "Not provided"} readOnly disabled />
              </Field>
              <Field label="Business type" htmlFor="seller-business-type">
                <Select id="seller-business-type" name="businessType" defaultValue={organisation.businessType ?? ""}>
                  <option value="">Not specified</option>
                  {Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="City" htmlFor="seller-city">
                <Input id="seller-city" name="city" defaultValue={organisation.city ?? ""} maxLength={120} />
              </Field>
              <Field label="State code" htmlFor="seller-state">
                <Input id="seller-state" name="stateCode" defaultValue={organisation.stateCode ?? ""} maxLength={8} placeholder="MH" />
              </Field>
              <Field label="Registered address" htmlFor="seller-line1" className="sm:col-span-2">
                <Input id="seller-line1" name="line1" defaultValue={application.address?.line1 ?? ""} maxLength={200} />
              </Field>
              <Field label="Address line 2" htmlFor="seller-line2">
                <Input id="seller-line2" name="line2" defaultValue={application.address?.line2 ?? ""} maxLength={200} />
              </Field>
              <Field label="PIN code" htmlFor="seller-postal">
                <Input id="seller-postal" name="postalCode" defaultValue={application.address?.postalCode ?? ""} maxLength={12} />
              </Field>
              <Field label="Website" htmlFor="seller-website">
                <Input id="seller-website" name="website" type="url" defaultValue={organisation.website ?? ""} placeholder="https://" />
              </Field>
              <Field label="Your name" htmlFor="seller-contact">
                <Input id="seller-contact" name="contactName" defaultValue={application.contactName} maxLength={200} required />
              </Field>
              <Field label="Work email" htmlFor="seller-email" hint="Changing the sign-in address is a support request.">
                <Input id="seller-email" value={application.email} readOnly disabled />
              </Field>
              <Field label="Telephone" htmlFor="seller-phone">
                <Input id="seller-phone" name="phone" defaultValue={application.phone ?? ""} maxLength={40} />
              </Field>
              <Field
                label="Company description"
                htmlFor="seller-description"
                className="sm:col-span-2"
                hint="What the business does, its plant or yard, and the products it supplies."
              >
                <Textarea id="seller-description" name="description" defaultValue={organisation.description ?? ""} rows={5} maxLength={2000} />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          </Panel>

          <p className="text-xs leading-5 text-steel-500">
            Submission state changes — approval, rejection, suspension — are made only by a PRIMEMET
            administrator and are recorded in the audit log. They are not editable from this page.
          </p>
        </>
      )}
    </PortalPage>
  );
}
