"use client";

import Link from "next/link";
import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { useHydrated } from "@/components/forms/use-hydrated";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { requestPasswordReset } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/errors";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Codes that would reveal whether (or in what state) an account exists. They
 * get the same neutral confirmation as a successful request. Disabled
 * accounts are included: telling a stranger "this account is disabled"
 * confirms that it exists.
 */
const NEUTRAL_CODES = new Set(["auth/user-not-found", "auth/invalid-credential", "auth/user-disabled"]);

export function ForgotPasswordForm() {
  const [status, setStatus] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-5">
        <FormAlert tone="success">
          If an account exists for that email, a password reset link is on its way. Check your inbox (and spam
          folder). The link expires after a while, so use it soon.
        </FormAlert>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="self-center text-sm font-semibold text-maroon hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form
      method="post"
      noValidate
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
        if (!EMAIL_PATTERN.test(email)) {
          setError("Please enter a valid email address.");
          return;
        }
        setStatus("pending");
        setError(null);
        try {
          await requestPasswordReset(email);
          setStatus("sent");
        } catch (err) {
          const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
          if (NEUTRAL_CODES.has(code)) {
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
          aria-invalid={error ? true : undefined}
          required
        />
      </fieldset>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <Button type="submit" size="lg" className="w-full" disabled={!hydrated || status === "pending"}>
        {status === "pending" && <Spinner className="size-4 text-cream" />}
        {status === "pending" ? "Sending…" : "Send Reset Link"}
      </Button>
    </form>
  );
}
