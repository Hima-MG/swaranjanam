"use client";

import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { requestPasswordReset } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/errors";

// Codes that would reveal whether an account exists; treated as success.
const SILENT_CODES = new Set(["auth/user-not-found", "auth/invalid-credential"]);

export function ForgotPasswordForm() {
  const [status, setStatus] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (status === "sent") {
    return (
      <FormAlert tone="success">
        If an account exists for that email, a password reset link is on its way. Check your inbox
        (and spam folder).
      </FormAlert>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const email = String(new FormData(event.currentTarget).get("email"));
        setStatus("pending");
        setError(null);
        try {
          await requestPasswordReset(email);
          setStatus("sent");
        } catch (err) {
          const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
          if (SILENT_CODES.has(code)) {
            setStatus("sent");
          } else {
            setError(authErrorMessage(err));
            setStatus("idle");
          }
        }
      }}
    >
      <fieldset disabled={status === "pending"}>
        <FormField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </fieldset>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <Button type="submit" size="lg" className="w-full" disabled={status === "pending"}>
        {status === "pending" && <Spinner className="size-4 text-cream" />}
        {status === "pending" ? "Sending…" : "Send Reset Link"}
      </Button>
    </form>
  );
}
