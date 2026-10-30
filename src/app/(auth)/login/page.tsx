import type { Metadata } from "next";
import Link from "next/link";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Sign in",
  description: "PRIMEMET account sign-in preview. Accounts are not enabled yet.",
};

/**
 * Sign-in preview.
 *
 * There is no authentication in Stage 1: the form has no action, the submit button is
 * disabled and nothing is validated, stored or redirected. No fake session is created
 * and no role is switched by visiting this page.
 *
 * TODO (Stage 2): add the auth provider, POST credentials here, create a real session
 * and redirect by role (ADMIN → /admin/dashboard, BUYER → /buyer/dashboard,
 * SELLER → /seller/dashboard).
 */
export default function LoginPage() {
  return (
    <AuthShell
      eyebrow="Account"
      title="Sign in to PRIMEMET"
      description="Buyer and seller accounts share one sign-in. Your role is assigned to the account, not chosen at sign-in."
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
      <form className="space-y-5">
        <AuthNotice>
          Authentication is not wired up. These fields are a layout preview and nothing you type is
          sent, stored or checked.
        </AuthNotice>

        <Field label="Work email" htmlFor="login-email">
          <Input
            id="login-email"
            name="email"
            type="email"
            placeholder="name@company.com"
            autoComplete="username"
          />
        </Field>

        <Field label="Password" htmlFor="login-password">
          <Input
            id="login-password"
            name="password"
            type="password"
            placeholder="Your password"
            autoComplete="current-password"
          />
        </Field>

        <div className="flex items-center justify-between gap-4">
          <Checkbox id="login-remember" label="Keep me signed in" />
          <span className="text-xs text-steel-500">Password reset arrives with Stage 2</span>
        </div>

        <Button type="button" disabled className="w-full">
          Sign in
          <span className="font-normal opacity-80">(preview)</span>
        </Button>
      </form>
    </AuthShell>
  );
}
