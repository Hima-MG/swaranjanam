"use client";

import Link from "next/link";
import { useState } from "react";

import { AuthDivider, GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { useAuthAction } from "@/components/auth/use-auth-action";
import { FormAlert } from "@/components/forms/form-alert";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { loginWithEmail, loginWithGoogle } from "@/lib/auth/client";

export function LoginForm() {
  const { pending, error, run } = useAuthAction();
  const [method, setMethod] = useState<"email" | "google" | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setMethod("email");
          void run(() => loginWithEmail(String(data.get("email")), String(data.get("password"))));
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-5">
          <FormField
            id="email"
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
          <div className="flex flex-col gap-2">
            <FormField
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              required
            />
            <Link
              href="/forgot-password"
              className="self-end text-xs font-semibold text-maroon hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && method === "email" && <Spinner className="size-4 text-cream" />}
          {pending && method === "email" ? "Signing in…" : "Sign In"}
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
