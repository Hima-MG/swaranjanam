"use client";

import { Send } from "lucide-react";

import { requestEnrolment } from "@/app/(account)/dashboard/enrolment-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Textarea } from "@/components/ui/textarea";

export interface EnrolmentOption {
  mode: "batch" | "individual";
  title: string;
  price: string;
  detail: string;
}

/** Sends an enrolment request. No payment is taken here; the server re-checks the course and the student. */
export function EnrolmentRequestForm({ slug, options }: { slug: string; options: EnrolmentOption[] }) {
  const { pending, error, fieldErrors, run } = useServerAction();
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(() => requestEnrolment(slug, data.get("mode"), data.get("note")));
      }}
    >
      <fieldset disabled={pending} className="flex flex-col gap-5">
        <legend className="mb-3 font-heading text-lg font-semibold text-brown">How would you like to learn?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((o, i) => (
            <label
              key={o.mode}
              className="flex cursor-pointer flex-col gap-1 rounded-2xl border border-border bg-card p-4 shadow-soft has-[:checked]:border-maroon has-[:checked]:ring-2 has-[:checked]:ring-maroon/20"
            >
              <span className="flex items-center gap-2 font-semibold text-brown">
                <input type="radio" name="mode" value={o.mode} defaultChecked={i === 0} required className="size-4 accent-maroon" />
                {o.title}
              </span>
              <span className="font-heading text-2xl font-bold text-maroon">{o.price}</span>
              <span className="text-sm text-muted-foreground">{o.detail}</span>
            </label>
          ))}
        </div>
        {fieldErrors.mode && <p className="text-xs text-destructive">{fieldErrors.mode}</p>}
        <div className="flex flex-col gap-2">
          <Label htmlFor="enrol-note" className="text-sm font-medium text-brown">
            Anything we should know? (optional)
          </Label>
          <Textarea id="enrol-note" name="note" maxLength={300} rows={3} placeholder="e.g. preferred days and times, or the learner's name and age" />
        </div>
        <label className="flex items-start gap-3 text-sm text-brown">
          <input type="checkbox" name="terms" required className="mt-0.5 size-4 accent-maroon" />I have read the fees and how payment works above.
        </label>
      </fieldset>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? <Spinner className="size-4 text-cream" /> : <Send data-icon="inline-start" />}
        Send enrolment request
      </Button>
      <p className="text-xs text-muted-foreground">Nothing is charged now. The academy places you in a batch first; any payment is then made online from this page.</p>
    </form>
  );
}
