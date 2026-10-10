import { BookOpen, CircleAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Shown when no courses are published yet. */
export function CatalogEmpty({ message = "New courses are being prepared. Please check back soon, or contact us to join the next batch." }: { message?: string }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-cream-deep/50 p-10 text-center">
      <BookOpen className="size-7 text-maroon" aria-hidden="true" />
      <p className="text-muted-foreground">{message}</p>
      <Button asChild variant="outline">
        <Link href="/contact">Contact the academy</Link>
      </Button>
    </div>
  );
}

/** Shown when the catalogue could not be loaded (it is retried within a minute). */
export function CatalogError() {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-10 text-center"
    >
      <CircleAlert className="size-7 text-destructive" aria-hidden="true" />
      <p className="text-brown">Courses could not be loaded right now. Please refresh the page in a minute.</p>
    </div>
  );
}
