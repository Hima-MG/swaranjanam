import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Register",
  description: "Create your Swaraanjanam student account.",
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Join Swaraanjanam and begin your Carnatic music journey."
      footer={{ text: "Already have an account?", linkLabel: "Sign in", href: "/login" }}
    >
      <RegisterForm />
    </AuthShell>
  );
}
