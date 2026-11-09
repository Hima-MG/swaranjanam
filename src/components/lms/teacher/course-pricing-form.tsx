"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { changeEnrolledStudentsRate, updateCoursePricing, updateCourseScheduleInfo } from "@/app/(account)/teacher/course-pricing-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_BATCH_CAPACITY, MAX_BATCH_CAPACITY_SETTING, type CoursePricing, type CourseScheduleInfo } from "@/lib/lms/course-pricing";
import { WEEKDAY_LABELS, WEEKDAYS, type TimeRange } from "@/lib/lms/registration";

const rupees = (minor: number | null) => (minor === null ? "" : String(minor / 100));

function Err({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

/** Class types, capacity and course-specific prices (apply to NEW students). */
export function CoursePricingForm({ courseId, pricing, saved }: { courseId: string; pricing: CoursePricing; saved: boolean }) {
  const { pending, error, fieldErrors: e, success, run } = useServerAction();
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(
          () =>
            updateCoursePricing(courseId, {
              batchEnabled: data.get("batchEnabled") === "on",
              batchPrice: String(data.get("batchPrice") ?? ""),
              batchCapacity: String(data.get("batchCapacity") ?? ""),
              individualEnabled: data.get("individualEnabled") === "on",
              individualPrice: String(data.get("individualPrice") ?? ""),
              sharedBatchPrice: String(data.get("sharedBatchPrice") ?? ""),
              sharedIndividualPrice: String(data.get("sharedIndividualPrice") ?? ""),
            }),
          { success: "Pricing saved. It applies to students who enrol from now on." },
        );
      }}
    >
      {!saved && (
        <FormAlert tone="info">
          This course has no prices of its own yet, so it uses the academy&apos;s confirmed rates shown below. Saving makes them this course&apos;s prices.
        </FormAlert>
      )}
      <fieldset disabled={pending} className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <label className="flex items-center gap-2 font-semibold text-brown">
            <input type="checkbox" name="batchEnabled" defaultChecked={pricing.batchEnabled} className="size-4 accent-maroon" />
            Batch classes
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batchPrice">Price per class, per student (₹)</Label>
            <Input id="batchPrice" name="batchPrice" inputMode="decimal" defaultValue={rupees(pricing.batchMinor)} aria-invalid={!!e.batchPrice} />
            <Err message={e.batchPrice} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sharedBatchPrice">Learn Together batch: price per person, per class (₹)</Label>
            <Input id="sharedBatchPrice" name="sharedBatchPrice" inputMode="decimal" defaultValue={rupees(pricing.sharedBatchMinor)} aria-invalid={!!e.sharedBatchPrice} />
            <Err message={e.sharedBatchPrice} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batchCapacity">Maximum batch capacity</Label>
            <Input
              id="batchCapacity"
              name="batchCapacity"
              type="number"
              min={1}
              max={MAX_BATCH_CAPACITY_SETTING}
              defaultValue={pricing.batchCapacity || DEFAULT_BATCH_CAPACITY}
              aria-invalid={!!e.batchCapacity}
            />
            <Err message={e.batchCapacity} />
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <label className="flex items-center gap-2 font-semibold text-brown">
            <input type="checkbox" name="individualEnabled" defaultChecked={pricing.individualEnabled} className="size-4 accent-maroon" />
            Individual classes
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="individualPrice">Price per session (₹)</Label>
            <Input id="individualPrice" name="individualPrice" inputMode="decimal" defaultValue={rupees(pricing.individualMinor)} aria-invalid={!!e.individualPrice} />
            <Err message={e.individualPrice} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sharedIndividualPrice">Learn Together one-to-one: price per person, per session (₹)</Label>
            <Input
              id="sharedIndividualPrice"
              name="sharedIndividualPrice"
              inputMode="decimal"
              defaultValue={rupees(pricing.sharedIndividualMinor)}
              aria-invalid={!!e.sharedIndividualPrice}
            />
            <Err message={e.sharedIndividualPrice} />
          </div>
        </div>
      </fieldset>
      <Err message={e.classTypes} />
      <p className="text-xs text-muted-foreground">
        Currency INR. The initial payment at enrolment is one class/session at this price. Changing a price affects new students only: enrolled students
        keep their agreed rate, and invoices already issued never change.
      </p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" disabled={pending} className="self-end">
        {pending && <Spinner className="size-4 text-cream" />}
        Save classes &amp; pricing
      </Button>
    </form>
  );
}

/** General teaching availability (not confirmed student schedules). */
export function CourseScheduleInfoForm({ courseId, info }: { courseId: string; info: CourseScheduleInfo }) {
  const { pending, error, fieldErrors: e, success, run } = useServerAction();
  const [slots, setSlots] = useState<TimeRange[]>(info.timeSlots.length ? info.timeSlots : [{ start: "", end: "" }]);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(
          () =>
            updateCourseScheduleInfo(courseId, {
              days: data.getAll("days").map(String),
              timeSlots: slots,
              frequency: String(data.get("frequency") ?? ""),
              notes: String(data.get("notes") ?? ""),
            }),
          { success: "Schedule information saved." },
        );
      }}
    >
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-brown">Available teaching days</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <label key={d} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-brown has-[:checked]:border-maroon">
                <input type="checkbox" name="days" value={d} defaultChecked={info.days.includes(d)} className="size-4 accent-maroon" />
                {WEEKDAY_LABELS[d]}
              </label>
            ))}
          </div>
          <Err message={e.days} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-brown">Available time slots (IST)</span>
          <ul className="flex flex-col gap-2">
            {slots.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Input type="time" aria-label={`Slot ${i + 1} start`} value={t.start} className="w-36" onChange={(ev) => setSlots((all) => all.map((x, j) => (j === i ? { ...x, start: ev.target.value } : x)))} />
                <span className="text-sm text-muted-foreground">to</span>
                <Input type="time" aria-label={`Slot ${i + 1} end`} value={t.end} className="w-36" onChange={(ev) => setSlots((all) => all.map((x, j) => (j === i ? { ...x, end: ev.target.value } : x)))} />
                {slots.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove slot ${i + 1}`} onClick={() => setSlots((all) => all.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {slots.length < 12 && (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setSlots((all) => [...all, { start: "", end: "" }])}>
              <Plus data-icon="inline-start" />
              Add a time slot
            </Button>
          )}
          <Err message={e.timeSlots} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="frequency">Expected class frequency</Label>
            <Input id="frequency" name="frequency" maxLength={120} placeholder="e.g. One 1-hour class per week" defaultValue={info.frequency} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-notes">Schedule notes</Label>
            <Textarea id="schedule-notes" name="notes" maxLength={500} rows={2} defaultValue={info.notes} />
          </div>
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">General availability only — not confirmed student schedules. Batch timings are set under Manage batches.</p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" disabled={pending} className="self-end">
        {pending && <Spinner className="size-4 text-cream" />}
        Save schedule information
      </Button>
    </form>
  );
}

/** Approved rate change for students who are already enrolled (from a future month). */
export function EnrolledRateChangeForm({ courseId, months, enrolled }: { courseId: string; months: { value: string; label: string }[]; enrolled: { batch: number; individual: number } }) {
  const { pending, error, fieldErrors: e, success, run } = useServerAction();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const mode = String(data.get("mode") ?? "");
        const count = mode === "individual" ? enrolled.individual : enrolled.batch;
        if (!window.confirm(`Change the agreed ${mode} rate of ${count} enrolled student(s)? Classes already held and issued invoices will not change.`)) return;
        run(
          () =>
            changeEnrolledStudentsRate(courseId, {
              mode,
              rate: String(data.get("rate") ?? ""),
              effectiveFrom: String(data.get("effectiveFrom") ?? ""),
              reason: String(data.get("reason") ?? ""),
              confirm: data.get("confirm") === "on",
            }),
          { success: (r) => `Agreed rate changed for ${r.accounts} student(s).` },
        );
      }}
    >
      <fieldset disabled={pending} className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rc-mode">Class type</Label>
          <NativeSelect id="rc-mode" name="mode" defaultValue="batch">
            <option value="batch">Batch ({enrolled.batch} enrolled)</option>
            <option value="individual">Individual ({enrolled.individual} enrolled)</option>
          </NativeSelect>
          <Err message={e.mode} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rc-rate">New rate (₹)</Label>
          <Input id="rc-rate" name="rate" inputMode="decimal" aria-invalid={!!e.rate} />
          <Err message={e.rate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rc-from">From (month)</Label>
          <NativeSelect id="rc-from" name="effectiveFrom" defaultValue={months[0]?.value}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
          <Err message={e.effectiveFrom} />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-3">
          <Label htmlFor="rc-reason">Reason (recorded)</Label>
          <Input id="rc-reason" name="reason" maxLength={300} aria-invalid={!!e.reason} />
          <Err message={e.reason} />
        </div>
        <label className="flex items-start gap-2 text-sm text-brown md:col-span-3">
          <input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-maroon" />I approve this rate change for students who are already enrolled.
        </label>
        <div className="md:col-span-3">
          <Err message={e.confirm} />
        </div>
      </fieldset>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" variant="outline" disabled={pending} className="self-end">
        {pending && <Spinner className="size-4" />}
        Approve rate change
      </Button>
    </form>
  );
}
