import type { Metadata } from "next";
import Link from "next/link";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Administrator sign in",
  description: "PRIMEMET administrator sign-in preview. Accounts are not enabled yet.",
};

/**
 * Admin sign-in preview.
 * Lives outside the /admin directory on purpose, so the admin dashboard layout does
 * not wrap the sign-in screen.
 *
 * TODO (Stage 2): restrict this route to the ADMIN role, rate-limit attempts and
 * redirect to /admin/dashboard on success. Until then the admin area is reachable
 * directly, which is why every admin screen carries the preview label.
 */
export default function AdminLoginPage() {
  return (
    <AuthShell
      variant="admin"
      eyebrow="Administrator"
      title="PRIMEMET admin sign-in"
      description="Internal desk access for enquiry review, supplier qualification, quotation comparison and catalogue maintenance."
      footer={
        <div className="space-y-3 text-sm text-steel-600">
          <p>
            Not a PRIMEMET staff member?{" "}
            <Link href="/login" className="font-medium text-green-700 underline underline-offset-2">
              Use the account sign-in
            </Link>
            .
          </p>
          <p className="text-xs leading-5 text-steel-500">
            Administrator access will be restricted by role in Stage 2. This page creates no session.
          </p>
        </div>
      }
    >
      <form className="space-y-5">
        <AuthNotice>
          Role-based access control is not implemented. Submitting this form is disabled and no
          session is created.
        </AuthNotice>

        <Field label="Work email" htmlFor="admin-email">
          <Input
            id="admin-email"
            name="email"
            type="email"
            placeholder="name@primemet.com"
            autoComplete="username"
          />
        </Field>

        <Field label="Password" htmlFor="admin-password">
          <Input
            id="admin-password"
            name="password"
            type="password"
            placeholder="Your password"
            autoComplete="current-password"
          />
        </Field>

        <Field label="Desk" htmlFor="admin-desk" hint="Recorded against audit-log entries once Stage 2 is live">
          <Select id="admin-desk" name="desk" defaultValue="">
            <option value="" disabled>
              Select a desk
            </option>
            <option>Sourcing desk</option>
            <option>Supplier desk</option>
            <option>Quotations</option>
            <option>Administration</option>
          </Select>
        </Field>

        <Button type="button" disabled className="w-full">
          Sign in as administrator
          <span className="font-normal opacity-80">(preview)</span>
        </Button>
      </form>
    </AuthShell>
  );
}
