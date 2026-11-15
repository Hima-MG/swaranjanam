"use client";

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Error state for every teacher dashboard page. In production Next.js hides
// the error message from the browser; the reference (digest) shown here is
// the same id written next to the full error in the server logs
// (Vercel → Project → Logs), so the cause can be found quickly.
export default function TeacherError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[teacher] page failed", error.digest ?? error.message);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-8">
      <CircleAlert className="size-7 text-destructive" aria-hidden="true" />
      <div>
        <h2 className="type-h3">This page could not be loaded</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The academy records could not be read just now. Please try again in a moment. If this keeps happening, look up the reference below in
          the Vercel runtime logs.
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      </div>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
