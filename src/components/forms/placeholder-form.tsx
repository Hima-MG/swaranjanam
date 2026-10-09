"use client";

import { Info } from "lucide-react";
import { useState } from "react";

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
 * Form shell for the public UI phase. Submission is intercepted client-side and
 * nothing is sent anywhere; replace with real handlers (Firebase Auth, contact
 * API) in later phases.
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
      {submitted && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-gold/40 bg-gold-soft/60 p-3 text-sm text-brown"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
          {notice}
        </p>
      )}
    </form>
  );
}
