import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Login",
  description: "Sign in to your Swaraanjanam student account.",
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to continue your lessons and practice."
      footer={{ text: "New to Swaraanjanam?", linkLabel: "Create an account", href: "/register" }}
    >
      <LoginForm />
    </AuthShell>
  );
}
