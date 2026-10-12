"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { giveSubmissionFeedback, moderateReview } from "@/app/(account)/teacher/feedback-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewStatus } from "@/lib/lms/types";

export function SubmissionFeedbackForm({ submissionId }: { submissionId: string }) {
  const { pending, error, fieldErrors, success, run } = useServerAction();
  const [decision, setDecision] = useState<"reviewed" | "needs_revision">("reviewed");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const text = new FormData(form).get("text");
        run(() => giveSubmissionFeedback(submissionId, decision, text), {
          success: decision === "reviewed" ? "Feedback sent. Marked as reviewed." : "Feedback sent. The student was asked to revise.",
          onSuccess: () => form.reset(),
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="feedback-text" className="text-sm font-medium text-brown">Feedback for the student</Label>
        <Textarea id="feedback-text" name="text" rows={5} maxLength={2000} disabled={pending} aria-invalid={fieldErrors.text ? true : undefined} />
        {fieldErrors.text && <p className="text-xs text-destructive">{fieldErrors.text}</p>}
      </div>
      <fieldset className="flex flex-wrap gap-4" disabled={pending}>
        <legend className="mb-2 text-sm font-medium text-brown">Outcome</legend>
        {(
          [
            ["reviewed", "Reviewed — well done"],
            ["needs_revision", "Needs revision — please record again"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm text-brown">
            <input type="radio" name="decision" value={value} checked={decision === value} onChange={() => setDecision(value)} className="size-4 accent-maroon" />
            {label}
          </label>
        ))}
      </fieldset>
      {error && !fieldErrors.text && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending && <Spinner className="size-4 text-cream" />}
        Send feedback
      </Button>
    </form>
  );
}

export function ReviewModeration({ reviewId, status }: { reviewId: string; status: ReviewStatus }) {
  const [target, setTarget] = useState<"approved" | "hidden" | null>(null);
  const { pending, error, run, reset } = useServerAction();
  const open = (next: "approved" | "hidden") => {
    reset();
    setTarget(next);
  };
  return (
    <>
      <div className="flex flex-wrap justify-end gap-1">
        {status !== "approved" && (
          <Button type="button" size="sm" variant="outline" onClick={() => open("approved")}>
            <Eye data-icon="inline-start" />
            Approve
          </Button>
        )}
        {status !== "hidden" && (
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => open("hidden")}>
            <EyeOff data-icon="inline-start" />
            Hide
          </Button>
        )}
      </div>
      <Modal
        open={target !== null}
        onOpenChange={(next) => {
          if (!next && !pending) setTarget(null);
        }}
        className="sm:max-w-md"
        title={target === "approved" ? "Approve this review?" : "Hide this review?"}
        description="Your name and the time are recorded with the decision."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const note = new FormData(event.currentTarget).get("note");
            run(() => moderateReview(reviewId, target, note), { onSuccess: () => setTarget(null) });
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`mod-note-${reviewId}`} className="text-sm font-medium text-brown">Note (optional, teachers only)</Label>
            <Input id={`mod-note-${reviewId}`} name="note" maxLength={300} />
          </div>
          {error && <FormAlert tone="error">{error}</FormAlert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={target === "hidden" ? "destructive" : "default"} disabled={pending}>
              {pending && <Spinner className="size-4 text-current" />}
              Confirm
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
