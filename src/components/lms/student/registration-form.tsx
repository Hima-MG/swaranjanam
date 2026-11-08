"use client";

import { ArrowRight, Plus, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Textarea } from "@/components/ui/textarea";
import {
  isSharedEnrolment,
  REGISTRATION_LIMITS,
  SHARED_LEARNER_COUNT,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type EnrolmentType,
  type LearnerProfile,
  type RegistrationDetails,
  type TimeRange,
} from "@/lib/lms/registration";
import type { ActionResult } from "@/lib/lms/types";

/** Server Action that saves the registration (signed-in student or guest); the server re-validates everything. */
export type SaveRegistrationAction = (
  slug: string,
  mode: unknown,
  details: Record<string, unknown>,
) => Promise<ActionResult<{ registrationId: string; initialAmountMinor: number }>>;

/** One enrolment type the course offers, with its server-calculated prices (display only). */
export interface EnrolmentOption {
  type: EnrolmentType;
  title: string;
  /** e.g. "₹400 per class" or "₹360 per person · ₹720 per session" — never a total course fee. */
  rate: string;
  /** e.g. "Pay ₹720 now" */
  initial: string;
  detail: string;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

const LEARNER_FIELDS = ["fullName", "dateOfBirth", "age", "guardianName", "guardianRelationship", "guardianPhone", "guardianEmail"] as const;

/** One learner's name, age and (under 18) parent/guardian. `index` 0 or 1; `shared` changes the error keys and headings. */
function LearnerFields({
  index,
  shared,
  learner,
  disabled,
  err,
}: {
  index: number;
  shared: boolean;
  learner: LearnerProfile | undefined;
  disabled: boolean;
  err: (field: string) => string | undefined;
}) {
  const id = (f: string) => `l${index}-${f}`;
  const name = (f: string) => `l${index}.${f}`;
  const invalid = (f: string) => (err(f) ? { "aria-invalid": true as const, "aria-describedby": `${id(f)}-error` } : {});
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4 rounded-2xl border border-border p-4">
      <legend className="px-1 font-heading text-base font-semibold text-brown">{shared ? `Learner ${index + 1}` : "Learner"}</legend>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id("fullName")}>Full name</Label>
        <Input id={id("fullName")} name={name("fullName")} autoComplete={index === 0 ? "name" : "off"} maxLength={REGISTRATION_LIMITS.name} defaultValue={learner?.fullName} required {...invalid("fullName")} />
        <FieldError id={`${id("fullName")}-error`} message={err("fullName")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={id("dateOfBirth")}>Date of birth</Label>
          <Input id={id("dateOfBirth")} name={name("dateOfBirth")} type="date" defaultValue={learner?.dateOfBirth ?? ""} {...invalid("dateOfBirth")} />
          <FieldError id={`${id("dateOfBirth")}-error`} message={err("dateOfBirth")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={id("age")}>or age (years)</Label>
          <Input id={id("age")} name={name("age")} type="number" inputMode="numeric" min={3} max={100} defaultValue={learner && !learner.dateOfBirth ? learner.age : ""} {...invalid("age")} />
          <FieldError id={`${id("age")}-error`} message={err("age")} />
        </div>
      </div>
      <details open={Boolean(learner?.guardian)} className="rounded-xl bg-cream-deep/40 p-3">
        <summary className="cursor-pointer text-sm font-medium text-brown">Parent or guardian (required if under 18)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={id("guardianName")}>Name</Label>
            <Input id={id("guardianName")} name={name("guardianName")} maxLength={REGISTRATION_LIMITS.name} defaultValue={learner?.guardian?.name} {...invalid("guardianName")} />
            <FieldError id={`${id("guardianName")}-error`} message={err("guardianName")} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={id("guardianRelationship")}>Relationship</Label>
            <Input
              id={id("guardianRelationship")}
              name={name("guardianRelationship")}
              maxLength={REGISTRATION_LIMITS.relationship}
              placeholder="e.g. Mother"
              defaultValue={learner?.guardian?.relationship}
              {...invalid("guardianRelationship")}
            />
            <FieldError id={`${id("guardianRelationship")}-error`} message={err("guardianRelationship")} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={id("guardianPhone")}>Phone</Label>
            <Input id={id("guardianPhone")} name={name("guardianPhone")} type="tel" maxLength={REGISTRATION_LIMITS.phone} defaultValue={learner?.guardian?.phone} {...invalid("guardianPhone")} />
            <FieldError id={`${id("guardianPhone")}-error`} message={err("guardianPhone")} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={id("guardianEmail")}>Email (optional)</Label>
            <Input id={id("guardianEmail")} name={name("guardianEmail")} type="email" maxLength={REGISTRATION_LIMITS.email} defaultValue={learner?.guardian?.email ?? ""} {...invalid("guardianEmail")} />
            <FieldError id={`${id("guardianEmail")}-error`} message={err("guardianEmail")} />
          </div>
        </div>
      </details>
    </fieldset>
  );
}

/**
 * Steps 1–3 of enrolment: enrolment type, learner details and preferences.
 * Learn Together: two learners under ONE login (the email and mobile below).
 * The server re-validates everything and calculates the price; nothing is charged here.
 */
export function RegistrationForm({
  slug,
  options,
  initial,
  save,
  reviewPath,
  defaultEmail = "",
  emailLocked = false,
  fixedSchedule = false,
}: {
  slug: string;
  options: EnrolmentOption[];
  initial: { type: EnrolmentType; details: RegistrationDetails } | null;
  save: SaveRegistrationAction;
  /** Where the review step is shown after saving. */
  reviewPath: string;
  defaultEmail?: string;
  /** Signed-in students: the email is their account's email. */
  emailLocked?: boolean;
  /** Special Programme: the sessions are already scheduled (no preferred days/times). */
  fixedSchedule?: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useServerAction();
  const d = initial?.details;
  const [times, setTimes] = useState<TimeRange[]>(d?.preferredTimes.length ? d.preferredTimes : [{ start: "", end: "" }]);
  const [type, setType] = useState<EnrolmentType>(initial?.type && options.some((o) => o.type === initial.type) ? initial.type : (options[0]?.type ?? "batch"));
  const shared = isSharedEnrolment(type);
  const solo = options.filter((o) => !isSharedEnrolment(o.type));
  const together = options.filter((o) => isSharedEnrolment(o.type));

  const err = (name: string) => fieldErrors[name];
  const invalid = (name: string) => (fieldErrors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});
  const learnerErr = (i: number) => (field: string) => (shared ? fieldErrors[`learners.${i}.${field}`] : i === 0 ? fieldErrors[field] : undefined);

  const card =
    "flex cursor-pointer flex-col gap-1 rounded-2xl border border-border bg-card p-4 shadow-soft has-[:checked]:border-maroon has-[:checked]:ring-2 has-[:checked]:ring-maroon/20";

  return (
    <form
      className="flex flex-col gap-8"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = (k: string) => String(data.get(k) ?? "");
        const learner = (i: number) => Object.fromEntries(LEARNER_FIELDS.map((f) => [f, value(`l${i}.${f}`)]));
        run(
          () =>
            save(slug, type, {
              // Individual: the single learner's fields at the top level; Learn Together: exactly two learners.
              ...learner(0),
              ...(shared ? { learners: Array.from({ length: SHARED_LEARNER_COUNT }, (_, i) => learner(i)) } : {}),
              email: emailLocked ? defaultEmail : value("email"),
              mobile: value("mobile"),
              address: value("address"),
              preferredDays: data.getAll("preferredDays").map(String),
              preferredTimes: times,
              notes: value("notes"),
            }),
          {
            onSuccess: () => {
              // Show the review step (the page reads the saved registration).
              router.replace(reviewPath);
              router.refresh();
            },
          },
        );
      }}
    >
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <legend className="mb-3 font-heading text-lg font-semibold text-brown">1. Choose how you will learn</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {solo.map((o) => (
            <label key={o.type} className={card}>
              <span className="flex items-center gap-2 font-semibold text-brown">
                <input type="radio" name="kind" value={o.type} checked={type === o.type} onChange={() => setType(o.type)} className="size-4 accent-maroon" />
                {o.title}
              </span>
              <span className="font-heading text-2xl font-bold text-maroon">{o.rate}</span>
              <span className="text-sm font-medium text-brown">{o.initial}</span>
              <span className="text-sm text-muted-foreground">{o.detail}</span>
            </label>
          ))}
          {together.length > 0 && (
            <label className={card}>
              <span className="flex items-center gap-2 font-semibold text-brown">
                <input type="radio" name="kind" value="together" checked={shared} onChange={() => setType(together[0].type)} className="size-4 accent-maroon" />
                <Users className="size-4" aria-hidden="true" />
                Learn Together (2 people)
              </span>
              <span className="text-sm text-muted-foreground">
                Two learners share one login, one dashboard and one timetable, with one monthly invoice for both.
              </span>
            </label>
          )}
        </div>
        {shared && (
          <div role="radiogroup" aria-label="Learn Together class option" className="grid gap-3 sm:grid-cols-2">
            {together.map((o) => (
              <label key={o.type} className={card}>
                <span className="flex items-center gap-2 font-semibold text-brown">
                  <input type="radio" name="together" value={o.type} checked={type === o.type} onChange={() => setType(o.type)} className="size-4 accent-maroon" />
                  {o.title}
                </span>
                <span className="font-heading text-xl font-bold text-maroon">{o.rate}</span>
                <span className="text-sm font-medium text-brown">{o.initial}</span>
                <span className="text-sm text-muted-foreground">{o.detail}</span>
              </label>
            ))}
          </div>
        )}
        <FieldError id="mode-error" message={err("mode")} />
      </fieldset>

      <div className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-semibold text-brown">2. {shared ? "The two learners" : "Learner's details"}</h2>
        {err("learners") && <FormAlert tone="error">{err("learners")}</FormAlert>}
        <LearnerFields index={0} shared={shared} learner={d?.learners[0]} disabled={pending} err={learnerErr(0)} />
        {shared && <LearnerFields index={1} shared learner={d?.learners[1]} disabled={pending} err={learnerErr(1)} />}

        <fieldset disabled={pending} className="flex flex-col gap-4">
          <legend className="mb-1 text-base font-semibold text-brown">{shared ? "Shared login and contact" : "Login and contact"}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{shared ? "Shared login email" : "Email address"}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={REGISTRATION_LIMITS.email}
                defaultValue={d?.email || defaultEmail}
                readOnly={emailLocked}
                required
                {...invalid("email")}
              />
              <FieldError id="email-error" message={err("email")} />
              {!emailLocked && (
                <p className="text-xs text-muted-foreground">
                  {shared ? "One student login is created for both learners" : "Your student login is created"} for this email after your payment is verified.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mobile">Mobile number (with country code)</Label>
              <Input id="mobile" name="mobile" type="tel" autoComplete="tel" placeholder="+91 98470 00000" maxLength={20} defaultValue={d?.mobile} required {...invalid("mobile")} />
              <FieldError id="mobile-error" message={err("mobile")} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" name="address" rows={3} autoComplete="street-address" maxLength={REGISTRATION_LIMITS.address} defaultValue={d?.address} {...invalid("address")} />
            <FieldError id="address-error" message={err("address")} />
          </div>
        </fieldset>
      </div>

      {fixedSchedule ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea id="notes" name="notes" rows={3} maxLength={REGISTRATION_LIMITS.notes} defaultValue={d?.notes} placeholder="e.g. previous music training" />
        </div>
      ) : (
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <legend className="mb-1 font-heading text-lg font-semibold text-brown">3. Preferred days and times</legend>
        <FormAlert tone="info">These are your preferences, not a confirmed class schedule. Your teacher will confirm the final schedule.</FormAlert>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-brown">Days (choose one or more)</span>
          <div className="flex flex-wrap gap-2" {...invalid("preferredDays")}>
            {WEEKDAYS.map((day) => (
              <label key={day} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-brown has-[:checked]:border-maroon">
                <input type="checkbox" name="preferredDays" value={day} defaultChecked={d?.preferredDays.includes(day)} className="size-4 accent-maroon" />
                {WEEKDAY_LABELS[day]}
              </label>
            ))}
          </div>
          <FieldError id="preferredDays-error" message={err("preferredDays")} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-brown">Time slots (IST)</span>
          <ul className="flex flex-col gap-2">
            {times.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  type="time"
                  aria-label={`Time slot ${i + 1} start`}
                  value={t.start}
                  onChange={(e) => setTimes((all) => all.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                  className="w-36"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  aria-label={`Time slot ${i + 1} end`}
                  value={t.end}
                  onChange={(e) => setTimes((all) => all.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                  className="w-36"
                />
                {times.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setTimes((all) => all.filter((_, j) => j !== i))} aria-label={`Remove time slot ${i + 1}`}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {times.length < REGISTRATION_LIMITS.maxTimes && (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setTimes((all) => [...all, { start: "", end: "" }])}>
              <Plus data-icon="inline-start" />
              Add another time slot
            </Button>
          )}
          <FieldError id="preferredTimes-error" message={err("preferredTimes")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea id="notes" name="notes" rows={3} maxLength={REGISTRATION_LIMITS.notes} defaultValue={d?.notes} placeholder="e.g. previous music training" />
        </div>
      </fieldset>
      )}

      {error && <FormAlert tone="error">{error}</FormAlert>}
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? <Spinner className="size-4 text-cream" /> : <ArrowRight data-icon="inline-start" />}
        Continue to review
      </Button>
      <p className="text-xs text-muted-foreground">Nothing is charged at this step. You review the amount before paying.</p>
    </form>
  );
}
