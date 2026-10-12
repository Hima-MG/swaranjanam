"use client";

import { Star } from "lucide-react";
import { useState } from "react";

import { submitReview } from "@/app/(account)/dashboard/practice-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewRecord } from "@/lib/lms/types";
import { cn } from "@/lib/utils";

const STATUS_TEXT = {
  pending: "Waiting for approval by the academy.",
  approved: "Approved.",
  hidden: "Not shown publicly.",
} as const;

/** The student's own course review: 1–5 stars (radio group) and a comment. */
export function ReviewForm({ courseId, existing }: { courseId: string; existing: ReviewRecord | null }) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const { pending, error, fieldErrors, success, run } = useServerAction();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const comment = new FormData(event.currentTarget).get("comment");
        run(() => submitReview(courseId, rating, comment), {
          success: "Thank you! Your review will appear after the academy approves it.",
        });
      }}
    >
      {existing && (
        <p className="text-xs text-muted-foreground">
          Your review · {STATUS_TEXT[existing.status]} Editing it sends it for approval again.
        </p>
      )}
      <fieldset className="flex flex-col gap-2" disabled={pending}>
        <legend className="mb-2 text-sm font-medium text-brown">Your rating</legend>
        <div role="radiogroup" aria-label="Rating out of 5" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="peer sr-only"
              />
              <span className="sr-only">{value} {value === 1 ? "star" : "stars"}</span>
              <Star
                aria-hidden="true"
                className={cn(
                  "size-7 rounded transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                  value <= rating ? "fill-gold text-gold" : "text-brown-muted",
                )}
              />
            </label>
          ))}
        </div>
        {fieldErrors.rating && <p className="text-xs text-destructive">{fieldErrors.rating}</p>}
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor="review-comment" className="text-sm font-medium text-brown">Your review</Label>
        <Textarea id="review-comment" name="comment" defaultValue={existing?.comment ?? ""} maxLength={1000} rows={4} disabled={pending} />
        {fieldErrors.comment && <p className="text-xs text-destructive">{fieldErrors.comment}</p>}
      </div>
      {error && !fieldErrors.rating && !fieldErrors.comment && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending && <Spinner className="size-4 text-cream" />}
        {existing ? "Update review" : "Submit review"}
      </Button>
    </form>
  );
}
