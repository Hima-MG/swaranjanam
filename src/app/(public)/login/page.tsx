import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { FormField } from "@/components/forms/form-field";
import { PlaceholderForm } from "@/components/forms/placeholder-form";

export const metadata: Metadata = {
  title: "Login",
  description: "Sign in to your Swaranjanam student account.",
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to continue your lessons and practice."
      footer={{ text: "New to Swaranjanam?", linkLabel: "Create an account", href: "/register" }}
    >
      <PlaceholderForm
        submitLabel="Sign In"
        notice="Student sign-in is coming soon. Please contact the academy for access in the meantime."
      >
        <FormField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          required
        />
      </PlaceholderForm>
    </AuthShell>
  );
}
