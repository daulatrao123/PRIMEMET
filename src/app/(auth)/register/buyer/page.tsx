import type { Metadata } from "next";
import Link from "next/link";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Register as a buyer",
  description: "Buyer registration preview for PRIMEMET industrial scrap sourcing and spare-parts procurement.",
};

/**
 * Buyer registration preview.
 * No account is created: the form has no action and the submit button is disabled.
 *
 * TODO (Stage 2): create the User + BuyerProfile records in a transaction, send email
 * verification, then hand the applicant to admin review before activating the account.
 */
export default function RegisterBuyerPage() {
  return (
    <AuthShell
      eyebrow="Buyer registration"
      title="Open a buyer account"
      description="For plants, mills, foundries, fabricators and maintenance teams sourcing scrap metal or industrial spare parts."
      footer={
        <p className="text-sm text-steel-600">
          Supplying material instead?{" "}
          <Link href="/register/seller" className="font-medium text-green-700 underline underline-offset-2">
            Register as a supplier
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
          Registration is a layout preview. No account record is created and nothing entered here
          is submitted, stored or emailed.
        </AuthNotice>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Company" htmlFor="buyer-company">
            <Input id="buyer-company" name="company" placeholder="Registered business name" autoComplete="organization" />
          </Field>
          <Field label="Country" htmlFor="buyer-country">
            <Input id="buyer-country" name="country" placeholder="Country of operation" autoComplete="country-name" />
          </Field>
          <Field label="Contact name" htmlFor="buyer-name">
            <Input id="buyer-name" name="name" placeholder="Full name" autoComplete="name" />
          </Field>
          <Field label="Role at company" htmlFor="buyer-role">
            <Input id="buyer-role" name="jobTitle" placeholder="e.g. Procurement manager" autoComplete="organization-title" />
          </Field>
          <Field label="Work email" htmlFor="buyer-email">
            <Input id="buyer-email" name="email" type="email" placeholder="name@company.com" autoComplete="email" />
          </Field>
          <Field label="Telephone" htmlFor="buyer-phone">
            <Input id="buyer-phone" name="phone" type="tel" placeholder="+00 000 000 000" autoComplete="tel" />
          </Field>
          <Field label="Primary interest" htmlFor="buyer-interest" className="sm:col-span-2">
            <Select id="buyer-interest" name="interest" defaultValue="">
              <option value="" disabled>
                Select what you source most often
              </option>
              <option>Ferrous scrap</option>
              <option>Non-ferrous scrap</option>
              <option>Stainless and alloys</option>
              <option>Industrial spare parts</option>
              <option>A mix of the above</option>
            </Select>
          </Field>
          <Field label="Password" htmlFor="buyer-password">
            <Input id="buyer-password" name="password" type="password" placeholder="Choose a password" autoComplete="new-password" />
          </Field>
          <Field label="Confirm password" htmlFor="buyer-password-confirm">
            <Input
              id="buyer-password-confirm"
              name="passwordConfirm"
              type="password"
              placeholder="Repeat the password"
              autoComplete="new-password"
            />
          </Field>
          <Field label="What do you need sourced?" htmlFor="buyer-notes" className="sm:col-span-2" hint="Optional — helps the desk route your first enquiry">
            <Textarea
              id="buyer-notes"
              name="notes"
              placeholder="Grades or part categories you buy regularly, and the delivery region you operate in."
            />
          </Field>
        </div>

        <Checkbox
          id="buyer-terms"
          label="I accept the Terms and Conditions and understand that account activation is subject to PRIMEMET review."
        />

        <Button type="button" disabled className="w-full">
          Create buyer account
          <span className="font-normal opacity-80">(preview)</span>
        </Button>
      </form>
    </AuthShell>
  );
}
