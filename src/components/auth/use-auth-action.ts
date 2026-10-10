"use client";

import { useState } from "react";

import { authErrorMessage, isUserCancellation } from "@/lib/auth/errors";

/**
 * Runs a sign-in flow that resolves to a redirect URL, tracking pending and
 * error state. On success it does a full page navigation so every server
 * component (navbar included) re-renders with the new session cookie.
 */
export function useAuthAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<string>) {
    setPending(true);
    setError(null);
    try {
      const redirectTo = await action();
      window.location.assign(redirectTo);
      // Stay pending while the browser navigates away.
    } catch (err) {
      if (!isUserCancellation(err)) setError(authErrorMessage(err));
      setPending(false);
    }
  }

  return { pending, error, setError, run };
}
