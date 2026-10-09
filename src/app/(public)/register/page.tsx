import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { FormField } from "@/components/forms/form-field";
import { PlaceholderForm } from "@/components/forms/placeholder-form";

export const metadata: Metadata = {
  title: "Register",
  description: "Create your Swaranjanam student account.",
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Join Swaranjanam and begin your Carnatic music journey."
      footer={{ text: "Already have an account?", linkLabel: "Sign in", href: "/login" }}
    >
      <PlaceholderForm
        submitLabel="Create Account"
        notice="Online registration is coming soon. Please contact the academy to enroll in the meantime."
      >
        <FormField id="name" label="Full name" autoComplete="name" placeholder="Your name" required />
        <FormField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
        <FormField
          id="phone"
          label="Phone / WhatsApp"
          type="tel"
          autoComplete="tel"
          placeholder="+91"
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          minLength={8}
          hint="Use at least 8 characters."
          required
        />
      </PlaceholderForm>
    </AuthShell>
  );
}
