import type { Metadata } from "next";
import Link from "next/link";
import { AuthNotice, NextField } from "@/components/auth/auth-notice";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your PRIMEMET buyer or supplier account.",
  robots: { index: false, follow: false },
};


/**
 * Sign-in.
 *
 * A plain HTML form posting to `/api/auth/login`. It works without JavaScript, and there is no client
 * state to disagree with the server: the outcome is a 303 to the role's dashboard or back here with a
 * message. The `next` parameter is preserved so a buyer who opened a product page first lands back on it.
 */
export default function LoginPage() {

  return (
    <AuthShell
      eyebrow="Account"
      title="Sign in to PRIMEMET"
      description="Buyer and supplier accounts share one sign-in. Your role is attached to the account, not chosen here."
      footer={
        <div className="space-y-3 text-sm text-steel-600">
          <p>
            New to PRIMEMET?{" "}
            <Link href="/register/buyer" className="font-medium text-green-700 underline underline-offset-2">
              Register as a buyer
            </Link>{" "}
            or{" "}
            <Link href="/register/seller" className="font-medium text-green-700 underline underline-offset-2">
              as a supplier
            </Link>
            .
          </p>
          <p>
            PRIMEMET staff sign in through the{" "}
            <Link href="/admin/login" className="font-medium text-green-700 underline underline-offset-2">
              administrator route
            </Link>
            .
          </p>
        </div>
      }
    >
      <form method="post" action="/api/auth/login" className="space-y-5">
        <AuthNotice />
        <NextField />

        <Field label="Work email" htmlFor="login-email">
          <Input
            id="login-email"
            name="email"
            type="email"
            placeholder="name@company.com"
            autoComplete="username"
            required
            maxLength={320}
          />
        </Field>

        <Field label="Password" htmlFor="login-password">
          <Input
            id="login-password"
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