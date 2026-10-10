import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Reset the password for your Swaraanjanam account.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email you registered with and we will send you a reset link."
      footer={{ text: "Remembered it?", linkLabel: "Back to sign in", href: "/login" }}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
