"use client";

import { Download, Pencil } from "lucide-react";
import { useState } from "react";

import { installPublishedPlans, updatePaymentMethods, updatePricePlan } from "@/app/(account)/teacher/billing-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/native-select";
import { PAIR_TYPE_LABELS, PAIR_TYPES, PLAN_STATUS_LABELS, PLAN_STATUSES, type PricePlan } from "@/lib/lms/billing";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/lms/types";

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium text-brown">
        {label}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** 160000 → "1600", 249950 → "2499.50" (for editing). */
function rupeesInput(minor: number | null): string {
  if (minor === null) return "";
  return minor % 100 === 0 ? String(minor / 100) : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

export function InstallPlansButton({ missing }: { missing: string[] }) {
  const { pending, error, success, run } = useServerAction();
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-gold/40 bg-gold-soft/40 p-5">
      <p className="text-sm text-brown">
        {missing.length} plan{missing.length === 1 ? " is" : "s are"} not set up yet: {missing.join(", ")}. Set them up from the published fee
        structure. Existing plans are never overwritten.
      </p>
      <Button
        type="button"
        className="self-start"
        disabled={pending}
        onClick={() => run(() => installPublishedPlans(), { success: (d) => `Set up: ${d.created.join(", ") || "nothing new"}.` })}
      >
        {pending ? <Spinner className="size-4 text-cream" /> : <Download data-icon="inline-start" />}
        Set up published fee plans
      </Button>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
    </div>
  );
}

export function PlanEditDialog({ plan, courses }: { plan: PricePlan; courses: { id: string; title: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pairOn, setPairOn] = useState(plan.pairEligible);
  const { pending, error, fieldErrors: e, run, reset } = useServerAction();
  const id = (key: string) => `plan-${plan.id}-${key}`;
  const regular = plan.kind === "regular";

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          reset();
          setPairOn(plan.pairEligible);
        }
        setOpen(next);
      }}
      className="sm:max-w-2xl"
      trigger={
        <Button type="button" variant="outline" size="sm">
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      }
      title={`Edit ${plan.title}`}
      description="Changes apply to packages assigned from now on. Existing packages, payments and receipts keep the price they were created with."
    >
      <form
        className="-mx-1 flex max-h-[72vh] flex-col gap-4 overflow-y-auto px-1 pb-1"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          const input: Record<string, unknown> = Object.fromEntries(d.entries());
          input.pairEligible = d.get("pairEligible") === "on";
          run(() => updatePricePlan(plan.id, input), { onSuccess: () => setOpen(false) });
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={id("title")} label="Name" error={e.title}>
              <Input id={id("title")} name="title" defaultValue={plan.title} maxLength={120} required />
            </Field>
            <Field id={id("status")} label="Availability" error={e.status} hint="Coming soon and inactive plans cannot be assigned.">
              <NativeSelect id={id("status")} name="status" defaultValue={plan.status}>
                {PLAN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PLAN_STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={id("level")} label="Level">
              <Input id={id("level")} name="level" defaultValue={plan.level} maxLength={60} />
            </Field>
            <Field id={id("audience")} label="For (ages)">
              <Input id={id("audience")} name="audience" defaultValue={plan.audience} maxLength={60} />
            </Field>
          </div>

          {regular ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={id("adult")} label="Adult fee (16+), ₹ per package" error={e.adultPrice} hint="Leave empty if not offered to adults.">
                <Input id={id("adult")} name="adultPrice" inputMode="decimal" defaultValue={rupeesInput(plan.adultPriceMinor)} />
              </Field>
              <Field id={id("student")} label="Student fee (15 and below), ₹ per package" error={e.studentPrice} hint="Leave empty if not offered to students.">
                <Input id={id("student")} name="studentPrice" inputMode="decimal" defaultValue={rupeesInput(plan.studentPriceMinor)} />
              </Field>
            </div>
          ) : (
            <Field id={id("flat")} label="Program fee, ₹ (one-time, all ages)" error={e.flatPrice}>
              <Input id={id("flat")} name="flatPrice" inputMode="decimal" defaultValue={rupeesInput(plan.flatPriceMinor)} />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-4">
            <Field id={id("sessions")} label="Sessions included" error={e.sessionsIncluded}>
              <Input id={id("sessions")} name="sessionsIncluded" inputMode="numeric" defaultValue={plan.sessionsIncluded} />
            </Field>
            <Field id={id("minutes")} label="Minutes each" error={e.sessionMinutes}>
              <Input id={id("minutes")} name="sessionMinutes" inputMode="numeric" defaultValue={plan.sessionMinutes} />
            </Field>
            <Field id={id("perweek")} label="Per week" error={e.sessionsPerWeek}>
              <Input id={id("perweek")} name="sessionsPerWeek" inputMode="numeric" defaultValue={plan.sessionsPerWeek} />
            </Field>
            <Field id={id("weeks")} label="Weeks" error={e.durationWeeks} hint={regular ? "Optional" : undefined}>
              <Input id={id("weeks")} name="durationWeeks" inputMode="numeric" defaultValue={plan.durationWeeks ?? ""} />
            </Field>
          </div>

          {regular && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-cream-deep/40 p-4">
              <div className="flex items-center gap-3">
                <input
                  id={id("pair")}
                  name="pairEligible"
                  type="checkbox"
                  checked={pairOn}
                  onChange={(ev) => setPairOn(ev.target.checked)}
                  className="size-4 accent-maroon"
                />
                <Label htmlFor={id("pair")} className="text-sm font-medium text-brown">
                  Pair plan available (two learners enrol and pay together)
                </Label>
              </div>
              {pairOn && (
                <div className="grid gap-4 sm:grid-cols-3">
                  {PAIR_TYPES.map((t) => (
                    <Field key={t} id={id(t)} label={`${PAIR_TYPE_LABELS[t]}, ₹`} error={e[`pair_${t}`]}>
                      <Input id={id(t)} name={`pair_${t}`} inputMode="decimal" defaultValue={rupeesInput(plan.pairPricesMinor[t])} />
                    </Field>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Enter the exact published fees for both learners together. They are used as entered and never recalculated.
              </p>
            </div>
          )}

          <Field id={id("course")} label="Course content (optional)" error={e.courseId} hint="Learners on a new package get access to this course's lessons. Access never depends on payment.">
            <NativeSelect id={id("course")} name="courseId" defaultValue={plan.courseId ?? ""}>
              <option value="">No linked course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            Save plan
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function PaymentMethodsForm({ methods, confirmed }: { methods: PaymentMethod[]; confirmed: boolean }) {
  const { pending, error, fieldErrors, success, run } = useServerAction();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const d = new FormData(event.currentTarget);
        run(() => updatePaymentMethods(d.getAll("methods")), { success: "Accepted payment methods saved." });
      }}
    >
      {!confirmed && (
        <FormAlert tone="info">
          The academy&apos;s accepted payment methods have not been confirmed yet, so every method is currently allowed. Untick any method the
          academy does not accept and save.
        </FormAlert>
      )}
      <fieldset disabled={pending} className="grid gap-2 sm:grid-cols-3">
        <legend className="sr-only">Accepted payment methods</legend>
        {PAYMENT_METHODS.map((m) => (
          <label key={m} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-brown">
            <input type="checkbox" name="methods" value={m} defaultChecked={methods.includes(m)} className="size-4 accent-maroon" />
            {PAYMENT_METHOD_LABELS[m]}
          </label>
        ))}
      </fieldset>
      {fieldErrors.methods && <p className="text-xs text-destructive">{fieldErrors.methods}</p>}
      <p className="text-xs text-muted-foreground">Payments already recorded keep their method, even if it is turned off here.</p>
      {error && !fieldErrors.methods && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending && <Spinner className="size-4 text-cream" />}
        Save methods
      </Button>
    </form>
  );
}
