"use client";

import { MessageSquareQuote } from "lucide-react";
import { useState } from "react";

import { submitTestimonial, withdrawTestimonial } from "@/app/(account)/dashboard/testimonial-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { useServerAction } from "@/components/lms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format-date";
import {
  NAME_DISPLAY_LABELS,
  NAME_DISPLAYS,
  publicNameFor,
  TESTIMONIAL_LIMITS,
  TESTIMONIAL_STATUS_LABELS,
  type NameDisplay,
  type TestimonialRecord,
} from "@/lib/lms/testimonials";

const STATUS_VARIANT = { pending: "outline", approved: "gold", rejected: "secondary", unpublished: "secondary", withdrawn: "secondary" } as const;

/** "Share your experience": write a testimonial and see the status of your own submissions. */
export function TestimonialPanel({
  accountName,
  courses,
  testimonials,
}: {
  /** The student's own account name (only used to preview how it will appear). */
  accountName: string | null;
  courses: { id: string; title: string }[];
  testimonials: TestimonialRecord[];
}) {
  const [nameDisplay, setNameDisplay] = useState<NameDisplay>("short");
  const [length, setLength] = useState(0);
  const [formKey, setFormKey] = useState(0);
  const { pending, error, fieldErrors: e, success, run } = useServerAction();

  return (
    <div className="flex flex-col gap-6">
      <form
        key={formKey}
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          run(
            () =>
              submitTestimonial({
                text: d.get("text"),
                courseId: d.get("courseId"),
                nameDisplay: d.get("nameDisplay"),
                consent: d.get("consent") === "on",
              }),
            {
              success: "Thank you! Your testimonial has been sent to the academy for review.",
              onSuccess: () => {
                setFormKey((k) => k + 1);
                setLength(0);
              },
            },
          );
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="t-text" className="text-sm font-medium text-brown">
              Your experience
            </Label>
            <Textarea
              id="t-text"
              name="text"
              rows={5}
              maxLength={TESTIMONIAL_LIMITS.maxLength}
              onChange={(ev) => setLength(ev.target.value.length)}
              aria-invalid={e.text ? true : undefined}
              placeholder="What has learning at Swaraanjanam meant to you?"
            />
            <p className={e.text ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {e.text ?? `${length} / ${TESTIMONIAL_LIMITS.maxLength} characters (at least ${TESTIMONIAL_LIMITS.minLength})`}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="t-course" className="text-sm font-medium text-brown">
                Course
              </Label>
              <NativeSelect id="t-course" name="courseId" defaultValue={courses.length === 1 ? courses[0].id : ""}>
                <option value="">The academy in general</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </NativeSelect>
              {e.courseId && <p className="text-xs text-destructive">{e.courseId}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="t-name" className="text-sm font-medium text-brown">
                Show my name as
              </Label>
              <NativeSelect id="t-name" name="nameDisplay" value={nameDisplay} onChange={(ev) => setNameDisplay(ev.target.value as NameDisplay)}>
                {NAME_DISPLAYS.map((m) => (
                  <option key={m} value={m}>
                    {NAME_DISPLAY_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">Appears as: “{publicNameFor(accountName, nameDisplay)}”</p>
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-gold/40 bg-gold-soft/40 p-3">
            <div className="flex items-start gap-3">
              <input id="t-consent" name="consent" type="checkbox" className="mt-0.5 size-4 accent-maroon" aria-invalid={e.consent ? true : undefined} />
              <Label htmlFor="t-consent" className="text-sm leading-snug font-normal text-brown">
                I agree that Swaraanjanam may publish this testimonial on its website with my name shown as selected above. Nothing else about
                me (such as my email or phone number) will be shown. I can withdraw it at any time.
              </Label>
            </div>
            {e.consent && <p className="text-xs text-destructive">{e.consent}</p>}
          </div>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {success && <FormAlert tone="success">{success}</FormAlert>}
        <Button type="submit" className="self-start" disabled={pending}>
          {pending ? <Spinner className="size-4 text-cream" /> : <MessageSquareQuote data-icon="inline-start" />}
          Send for review
        </Button>
        <p className="text-xs text-muted-foreground">The academy reviews every testimonial before anything is published.</p>
      </form>

      {testimonials.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-brown">Your submissions</h3>
          <ul className="flex flex-col gap-3">
            {testimonials.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[t.status]}>{TESTIMONIAL_STATUS_LABELS[t.status]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(t.createdAt)} · {t.courseTitle ?? "The academy in general"} · shown as “{t.publicName}”
                    </span>
                  </span>
                  {t.status !== "withdrawn" && (
                    <ConfirmDialog
                      trigger={
                        <Button type="button" variant="ghost" size="sm" className="text-destructive">
                          Withdraw
                        </Button>
                      }
                      title="Withdraw this testimonial?"
                      description="It will be removed from the website (if published) and your consent to publish it is withdrawn."
                      confirmLabel="Withdraw"
                      action={() => withdrawTestimonial(t.id)}
                    />
                  )}
                </div>
                <p className="text-sm whitespace-pre-line text-brown">{t.text}</p>
                {t.moderationNote && (t.status === "rejected" || t.status === "unpublished") && (
                  <p className="text-xs text-muted-foreground">Note from the academy: {t.moderationNote}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
