"use client";

import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PlaceholderFormProps {
  submitLabel: string;
  /** Message shown after submit while the backend is not yet wired up. */
  notice: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Form shell for forms whose backend is not built yet (currently Contact).
 * Submission is intercepted client-side and nothing is sent anywhere.
 */
export function PlaceholderForm({ submitLabel, notice, className, children }: PlaceholderFormProps) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      className={cn("flex flex-col gap-5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      {children}
      <Button type="submit" size="lg" className="mt-1 w-full">
        {submitLabel}
      </Button>
      {submitted && <FormAlert>{notice}</FormAlert>}
    </form>
  );
}
