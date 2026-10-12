"use client";

import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

// Error state for every teacher dashboard page (e.g. Firestore unavailable).
// Shows no internal details; the server log has the cause.
export default function TeacherError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-8">
      <CircleAlert className="size-7 text-destructive" aria-hidden="true" />
      <div>
        <h2 className="type-h3">This page could not be loaded</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The academy records could not be read just now. Please try again in a moment.
        </p>
      </div>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
