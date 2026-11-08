import type { Metadata } from "next";
import Link from "next/link";
import { AuthNotice } from "@/components/auth/auth-notice";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Register as a supplier",
  description: "Register a yard, processor, stockist or specialist workshop with PRIMEMET.",
  robots: { index: false, follow: false },
};


/**
 * Supplier registration.
 *
 * The account is created INVITED and cannot sign in until an admin approves the application. That is
 * enforced server-side by the login route; this page's copy says so plainly so the wait is expected rather
 * than reported as a broken password.
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
      <form method="post" action="/api/auth/register" className="space-y-5">
        <input type="hidden" name="role" value="SELLER" />
        <AuthNotice />

        <p className="rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-xs leading-5 text-steel-600">
          Supplier accounts are reviewed by the PRIMEMET desk before activation. You will be able to sign
          in once your application is approved; GSTIN details are recorded as pending, never auto-verified.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Company" htmlFor="seller-company">
            <Input id="seller-company" name="company" placeholder="Registered business name" autoComplete="organization" required maxLength={240} />
          </Field>
          <Field label="Business type" htmlFor="seller-business-type">
            <Select id="seller-business-type" name="businessType" defaultValue="">
              <option value="">Choose one</option>
              <option value="MANUFACTURER">Manufacturer</option>
              <option value="TRADER">Trader</option>
              <option value="STOCKIST">Stockist / distributor</option>
              <option value="PROCESSOR">Processor</option>
              <option value="RECYCLER">Recycler</option>
              <option value="WORKSHOP">Specialist workshop</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="City" htmlFor="seller-city">
            <Input id="seller-city" name="city" placeholder="City of operation" autoComplete="address-level2" maxLength={120} />
          </Field>
          <Field label="Registered address" htmlFor="seller-address" className="sm:col-span-2" hint="Street, building and area of the registered office.">
            <Input id="seller-address" name="addressLine1" placeholder="Plot / street / area" autoComplete="address-line1" maxLength={200} />
          </Field>
          <Field label="PIN code" htmlFor="seller-postal">
            <Input id="seller-postal" name="postalCode" placeholder="400001" autoComplete="postal-code" maxLength={12} />
          </Field>
          <Field label="State code" htmlFor="seller-state">
            <Input id="seller-state" name="stateCode" placeholder="MH" maxLength={8} />
          </Field>
          <Field label="Contact name" htmlFor="seller-name">
            <Input id="seller-name" name="contactName" placeholder="Full name" autoComplete="name" required maxLength={200} />
          </Field>
          <Field label="Work email" htmlFor="seller-email">
            <Input id="seller-email" name="email" type="email" placeholder="name@company.com" autoComplete="email" required maxLength={320} />
          </Field>
          <Field label="Telephone" htmlFor="seller-phone">
            <Input id="seller-phone" name="phone" type="tel" placeholder="+91 00000 00000" autoComplete="tel" maxLength={40} />
          </Field>
          <Field label="GSTIN" htmlFor="seller-gstin" hint="Recorded as pending until the desk verifies it.">
            <Input id="seller-gstin" name="gstin" placeholder="27ABCDE1234F1Z5" maxLength={15} />
          </Field>
          <Field label="Password" htmlFor="seller-password" hint="At least 10 characters with a letter and a number.">
            <Input id="seller-password" name="password" type="password" placeholder="Choose a password" autoComplete="new-password" required minLength={10} maxLength={200} />
          </Field>
          <Field label="Confirm password" htmlFor="seller-password-confirm">
            <Input
              id="seller-password-confirm"
              name="passwordConfirm"
              type="password"
              placeholder="Repeat the password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={200}
            />
          </Field>
          <Field
            label="Company description"
            htmlFor="seller-description"
            className="sm:col-span-2"
            hint="What the business does, its plant or yard, and the products it is set up to supply."
          >
            <Textarea
              id="seller-description"
              name="description"
              placeholder="e.g. Aluminium extrusion scrap processor with a 2-acre yard in Pune; sorting, baling and weighbridge on site."
              maxLength={2000}
            />
          </Field>
          <Field
            label="What can you supply?"
            htmlFor="seller-materials"
            className="sm:col-span-2"
            hint="Grades, part categories, monthly capacity and the region you can serve."
          >
            <Textarea
              id="seller-materials"
              name="materials"
              placeholder="e.g. Aluminium 6061 turnings, 20 t/month, Gujarat and Maharashtra."
              maxLength={2000}
            />
          </Field>
        </div>

        <Button type="submit" className="w-full">
          Submit supplier application
        </Button>
      </form>
    </AuthShell>
  );
}