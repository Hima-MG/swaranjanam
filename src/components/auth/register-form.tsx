"use client";

import { useState } from "react";

import { AuthDivider, GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { useAuthAction } from "@/components/auth/use-auth-action";
import { FormAlert } from "@/components/forms/form-alert";
import { useHydrated } from "@/components/forms/use-hydrated";
import { FormField } from "@/components/forms/form-field";
import { PasswordField } from "@/components/forms/password-field";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { loginWithGoogle, registerWithEmail } from "@/lib/auth/client";

const MIN_PASSWORD_LENGTH = 8;

// Registration never offers a role choice: the server always creates students.
export function RegisterForm() {
  const { pending, error, setError, run } = useAuthAction();
  const hydrated = useHydrated();
  const [method, setMethod] = useState<"email" | "google" | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <form
        method="post"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const password = String(data.get("password"));
          if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`Please use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
            return;
          }
          setMethod("email");
          void run(() =>
            registerWithEmail({
              name: String(data.get("name")),
              email: String(data.get("email")),
              phone: String(data.get("phone") ?? ""),
              password,
            }),
          );
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-5">
          <FormField id="name" label="Full name" autoComplete="name" placeholder="Your name" maxLength={100} required />
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
            maxLength={20}
          />
          <PasswordField
            id="password"
            label="Password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            minLength={MIN_PASSWORD_LENGTH}
            hint="Use at least 8 characters."
            required
          />
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <Button type="submit" size="lg" className="w-full" disabled={!hydrated || pending}>
          {pending && method === "email" && <Spinner className="size-4 text-cream" />}
          {pending && method === "email" ? "Creating account…" : "Create Account"}
        </Button>
      </form>
      <AuthDivider />
      <GoogleSignInButton
        pending={pending && method === "google"}
        disabled={pending}
        onClick={() => {
          setMethod("google");
          void run(loginWithGoogle);
        }}
      />
    </div>
  );
}
