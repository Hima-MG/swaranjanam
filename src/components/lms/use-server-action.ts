"use client";

import { useState, useTransition } from "react";

import type { ActionResult } from "@/lib/lms/types";

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

/**
 * Runs a Server Action inside a transition and tracks pending, error,
 * field-error and success state for the form or button that triggered it.
 */
export function useServerAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

  function reset() {
    setError(null);
    setFieldErrors({});
    setSuccess(null);
  }

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    options: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void } = {},
  ) {
    reset();
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          if (options.success) {
            setSuccess(typeof options.success === "function" ? options.success(result.data) : options.success);
          }
          options.onSuccess?.(result.data);
        } else {
          setError(result.error);
          setFieldErrors(result.fieldErrors ?? {});
        }
      } catch {
        setError(NETWORK_ERROR);
      }
    });
  }

  return { pending, error, fieldErrors, success, run, reset, setError };
}
