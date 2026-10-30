import type { Metadata } from "next";
import Link from "next/link";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Register as a supplier",
  description: "Supplier registration preview for yards, stockists and specialist workshops working with PRIMEMET.",
};

/**
 * Supplier registration preview.
 * No account is created and no documentation is uploaded at this stage.
 *
 * TODO (Stage 2): create the User + SupplierProfile records, store licence references,
 * and queue the applicant for admin qualification. Document uploads are deferred until
 * storage is decided (see PROJECT_SUMMARY.md).
 */
export default function RegisterSellerPage() {
  return (
    <AuthShell
      eyebrow="Supplier registration"
      title="Register as a supplier"
      description="For yards, processors, stockists and specialist workshops that can prepare material or manufacture to a specification."
      footer={
        <p className="text-sm text-steel-600">
          Buying rather than supplying?{" "}
          <Link href="/register/buyer" className="font-medium text-green-700 underline underline-offset-2">
            Register as a buyer
          </Link>
          . Already registered?{" "}
          <Link href="/login" className="font-medium text-green-700 underline underline-offset-2">
            Sign in
          </Link>
          .
        </p>
      }
    >
      <form className="space-y-5">
        <AuthNotice>
          Registration is a layout preview. No supplier record is created, no document is uploaded
          and nothing entered here is submitted or emailed.
        </AuthNotice>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Registered company" htmlFor="seller-company">
            <Input id="seller-company" name="company" placeholder="Registered business name" autoComplete="organization" />
          </Field>
          <Field label="Country" htmlFor="seller-country">
            <Input id="seller-country" name="country" placeholder="Country of operation" autoComplete="country-name" />
          </Field>
          <Field label="Contact name" htmlFor="seller-name">
            <Input id="seller-name" name="name" placeholder="Full name" autoComplete="name" />
          </Field>
          <Field label="Role at company" htmlFor="seller-role">
            <Input id="seller-role" name="jobTitle" placeholder="e.g. Commercial manager" autoComplete="organization-title" />
          </Field>
          <Field label="Work email" htmlFor="seller-email">
            <Input id="seller-email" name="email" type="email" placeholder="name@company.com" autoComplete="email" />
          </Field>
          <Field label="Telephone" htmlFor="seller-phone">
            <Input id="seller-phone" name="phone" type="tel" placeholder="+00 000 000 000" autoComplete="tel" />
          </Field>
          <Field label="Primary supply category" htmlFor="seller-category" className="sm:col-span-2">
            <Select id="seller-category" name="category" defaultValue="">
              <option value="" disabled>
                Select what you supply
              </option>
              <option>Ferrous scrap</option>
              <option>Non-ferrous scrap</option>
              <option>Stainless and alloys</option>
              <option>Industrial spare parts</option>
              <option>Machining and fabrication</option>
              <option>More than one of the above</option>
            </Select>
          </Field>
          <Field label="Preparation capability" htmlFor="seller-prep" className="sm:col-span-2">
            <Textarea
              id="seller-prep"
              name="prep"
              placeholder="Cutting, sorting, baling or screening you can carry out, and any testing you can arrange."
            />
          </Field>
          <Field label="Tax registration reference" htmlFor="seller-gst" className="sm:col-span-2" hint="Recorded in full during onboarding — not requested here">
            <Input id="seller-gst" name="taxReference" placeholder="e.g. GSTIN or VAT number" />
          </Field>
        </div>

        <Checkbox
          id="seller-terms"
          label="I accept the Terms and Conditions and understand that supplier qualification is reviewed by the PRIMEMET desk."
        />

        <Button type="button" disabled className="w-full">
          Create supplier account
          <span className="font-normal opacity-80">(preview)</span>
        </Button>
      </form>
    </AuthShell>
  );
}
