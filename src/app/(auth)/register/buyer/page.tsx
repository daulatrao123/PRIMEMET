import type { Metadata } from "next";
import Link from "next/link";
import { AuthNotice } from "@/components/auth/auth-notice";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Register as a buyer",
  description: "Open a PRIMEMET buyer account to enquire about industrial scrap and spare parts.",
  robots: { index: false, follow: false },
};


/**
 * Buyer registration.
 *
 * The account is created, activated and signed in by `/api/auth/register`. GSTIN is captured, not
 * verified: the profile records it as PENDING and only an admin decision can move that state.
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
      <form method="post" action="/api/auth/register" className="space-y-5">
        <input type="hidden" name="role" value="BUYER" />
        <AuthNotice />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Company" htmlFor="buyer-company">
            <Input id="buyer-company" name="company" placeholder="Registered business name" autoComplete="organization" required maxLength={240} />
          </Field>
          <Field label="City" htmlFor="buyer-city">
            <Input id="buyer-city" name="city" placeholder="City of operation" autoComplete="address-level2" maxLength={120} />
          </Field>
          <Field label="Contact name" htmlFor="buyer-name">
            <Input id="buyer-name" name="contactName" placeholder="Full name" autoComplete="name" required maxLength={200} />
          </Field>
          <Field label="Work email" htmlFor="buyer-email">
            <Input id="buyer-email" name="email" type="email" placeholder="name@company.com" autoComplete="email" required maxLength={320} />
          </Field>
          <Field label="Telephone" htmlFor="buyer-phone">
            <Input id="buyer-phone" name="phone" type="tel" placeholder="+91 00000 00000" autoComplete="tel" maxLength={40} />
          </Field>
          <Field label="GSTIN" htmlFor="buyer-gstin" hint="Optional. Recorded as pending until the desk verifies it.">
            <Input id="buyer-gstin" name="gstin" placeholder="27ABCDE1234F1Z5" maxLength={15} />
          </Field>
          <Field label="Password" htmlFor="buyer-password" hint="At least 10 characters with a letter and a number.">
            <Input id="buyer-password" name="password" type="password" placeholder="Choose a password" autoComplete="new-password" required minLength={10} maxLength={200} />
          </Field>
          <Field label="Confirm password" htmlFor="buyer-password-confirm">
            <Input
              id="buyer-password-confirm"
              name="passwordConfirm"
              type="password"
              placeholder="Repeat the password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={200}
            />
          </Field>
          <Field label="What do you need sourced?" htmlFor="buyer-notes" className="sm:col-span-2" hint="Optional — helps the desk route your first enquiry">
            <Textarea
              id="buyer-notes"
              name="notes"
              placeholder="Grades or part categories you buy regularly, and the delivery region you operate in."
              maxLength={2000}
            />
          </Field>
        </div>

        <Button type="submit" className="w-full">
          Create buyer account
        </Button>
      </form>
    </AuthShell>
  );
}