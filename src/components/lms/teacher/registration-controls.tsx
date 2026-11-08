"use client";

import { CalendarCheck, UsersRound } from "lucide-react";

import { assignToBatch, changeSchedule, confirmSchedule } from "@/app/(account)/teacher/registration-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { WEEKDAY_LABELS, WEEKDAYS } from "@/lib/lms/registration";

export interface BatchChoice {
  id: string;
  label: string;
  disabled: boolean;
}

/** Assigns a paid batch registration. Payment, course, capacity and schedule conflicts are re-checked on the server. */
export function AssignBatchForm({ registrationId, batches }: { registrationId: string; batches: BatchChoice[] }) {
  const { pending, error, fieldErrors, success, run } = useServerAction();
  const available = batches.filter((b) => !b.disabled);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const batchId = new FormData(event.currentTarget).get("batchId");
        run(() => assignToBatch(registrationId, batchId), { success: "Student assigned to the batch." });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="batchId">Batch</Label>
        <NativeSelect id="batchId" name="batchId" required disabled={pending || available.length === 0} defaultValue={available[0]?.id ?? ""} aria-invalid={!!fieldErrors.batchId}>
          {batches.map((b) => (
            <option key={b.id} value={b.id} disabled={b.disabled}>
              {b.label}
            </option>
          ))}
        </NativeSelect>
        {fieldErrors.batchId && <p className="text-xs text-destructive">{fieldErrors.batchId}</p>}
      </div>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" disabled={pending || available.length === 0} className="self-start">
        {pending ? <Spinner className="size-4 text-cream" /> : <UsersRound data-icon="inline-start" />}
        Assign to batch
      </Button>
    </form>
  );
}

/**
 * Confirms (or, once confirmed, changes) an individual student's weekly schedule
 * and teacher. Individual students are never put in a batch.
 */
export function ConfirmScheduleForm({
  registrationId,
  defaults,
  teachers = [],
  mode = "confirm",
}: {
  registrationId: string;
  defaults: { days: string[]; start: string; end: string; teacherId?: string };
  teachers?: { uid: string; label: string }[];
  mode?: "confirm" | "update";
}) {
  const { pending, error, fieldErrors, success, run } = useServerAction();
  const action = mode === "update" ? changeSchedule : confirmSchedule;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(
          () =>
            action(registrationId, {
              days: data.getAll("days").map(String),
              start: data.get("start"),
              end: data.get("end"),
              note: data.get("note"),
              teacherId: data.get("teacherId") || undefined,
            }),
          {
            success:
              mode === "update"
                ? "Schedule updated. The change is recorded in the history."
                : "Schedule confirmed. The initial payment covers the first session and is deducted on its monthly invoice.",
          },
        );
      }}
    >
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-brown">Session days</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => (
              <label key={day} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-brown has-[:checked]:border-maroon">
                <input type="checkbox" name="days" value={day} defaultChecked={defaults.days.includes(day)} className="size-4 accent-maroon" />
                {WEEKDAY_LABELS[day]}
              </label>
            ))}
          </div>
          {fieldErrors.days && <p className="text-xs text-destructive">{fieldErrors.days}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="schedule-start">Start time (IST)</Label>
            <Input id="schedule-start" name="start" type="time" required defaultValue={defaults.start} aria-invalid={!!fieldErrors.startTime} />
            {fieldErrors.startTime && <p className="text-xs text-destructive">{fieldErrors.startTime}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="schedule-end">End time (IST)</Label>
            <Input id="schedule-end" name="end" type="time" required defaultValue={defaults.end} aria-invalid={!!fieldErrors.endTime} />
            {fieldErrors.endTime && <p className="text-xs text-destructive">{fieldErrors.endTime}</p>}
          </div>
        </div>
        {teachers.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="schedule-teacher">Teacher</Label>
            <NativeSelect id="schedule-teacher" name="teacherId" defaultValue={defaults.teacherId ?? ""} aria-invalid={!!fieldErrors.teacherId}>
              <option value="">Me</option>
              {teachers.map((t) => (
                <option key={t.uid} value={t.uid}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
            {fieldErrors.teacherId && <p className="text-xs text-destructive">{fieldErrors.teacherId}</p>}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="schedule-note">Note (optional)</Label>
          <Input id="schedule-note" name="note" maxLength={200} />
        </div>
      </fieldset>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? <Spinner className="size-4 text-cream" /> : <CalendarCheck data-icon="inline-start" />}
        {mode === "update" ? "Save schedule change" : "Confirm schedule"}
      </Button>
    </form>
  );
}
