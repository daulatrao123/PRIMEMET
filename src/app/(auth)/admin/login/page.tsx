import type { Metadata } from "next";
import Link from "next/link";
import { AuthNotice, NextField } from "@/components/auth/auth-notice";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Administrator sign in",
  description: "PRIMEMET staff sign-in.",
  robots: { index: false, follow: false, nocache: true },
};


/**
 * Staff sign-in.
 *
 * Lives outside `/admin` so the admin layout (and its session guard) does not wrap it. The role check is
 * still enforced twice: middleware treats this path as public, and the login route refuses a non-ADMIN
 * account with the "staff only" message.
 */
export default function AdminLoginPage() {

  return (
    <AuthShell
      variant="admin"
      eyebrow="Administrator"
      title="PRIMEMET admin sign-in"
      description="Internal desk access for enquiry review, supplier qualification and catalogue maintenance."
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
            Every admin action is recorded in the audit trail against your account.
          </p>
        </div>
      }
    >
      <form method="post" action="/api/auth/login" className="space-y-5">
        <input type="hidden" name="area" value="admin" />
        <AuthNotice />
        <NextField />

        <Field label="Work email" htmlFor="admin-email">
          <Input
            id="admin-email"
            name="email"
            type="email"
            placeholder="name@company.com"
            autoComplete="username"
            required
            maxLength={320}
          />
        </Field>

        <Field label="Password" htmlFor="admin-password">
          <Input
            id="admin-password"
            name="password"
            type="password"
            placeholder="Your password"
            autoComplete="current-password"
            required
            maxLength={200}
          />
        </Field>

        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}