"use client";

import { CalendarPlus, CheckCircle2, Pencil, XCircle } from "lucide-react";
import { useState } from "react";

import { cancelClass, recordClassOutcome, scheduleClass, updateClass } from "@/app/(account)/teacher/class-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export interface EditableClass {
  id: string;
  studentId: string;
  packageId?: string | null;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  meetUrl: string;
  notes: string | null;
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium text-brown">{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function todayInIndia() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export interface SchedulablePackage {
  id: string;
  label: string;
  learnerIds: string[];
}

/**
 * Schedule a new class, or edit/reschedule an existing scheduled class.
 * Optionally bill it to a package: the learners then come from the package
 * (both learners of a pair), and the server checks that a credit is free.
 */
export function ClassFormDialog({
  students,
  existing,
  packages = [],
}: {
  students: { uid: string; label: string }[];
  existing?: EditableClass;
  packages?: SchedulablePackage[];
}) {
  const [open, setOpen] = useState(false);
  const [packageId, setPackageId] = useState("");
  const { pending, error, fieldErrors: e, run, reset } = useServerAction();
  const chosenPackage = packages.find((p) => p.id === packageId) ?? null;
  const lockedStudent = Boolean(existing?.packageId);
  const id = existing?.id ?? "new";
  const invalid = (key: string) => (e[key] ? { "aria-invalid": true as const, "aria-describedby": `c-${key}-${id}-error` } : {});

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          reset();
          setPackageId("");
        }
        setOpen(next);
      }}
      className="sm:max-w-xl"
      trigger={
        existing ? (
          <Button type="button" variant="ghost" size="sm">
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
        ) : (
          <Button type="button" disabled={students.length === 0}>
            <CalendarPlus data-icon="inline-start" />
            Schedule class
          </Button>
        )
      }
      title={existing ? "Edit or reschedule class" : "Schedule a class"}
      description="Times are in India Standard Time (IST). The student sees the class on their dashboard with a Join Class button."
    >
      <form
        className="-mx-1 flex max-h-[72vh] flex-col gap-4 overflow-y-auto px-1 pb-1"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          const input = {
            packageId: existing ? undefined : d.get("packageId") || undefined,
            studentId: chosenPackage ? undefined : d.get("studentId"),
            title: d.get("title"),
            date: d.get("date"),
            startTime: d.get("startTime"),
            endTime: d.get("endTime"),
            meetUrl: d.get("meetUrl"),
            notes: d.get("notes"),
          };
          run(() => (existing ? updateClass(existing.id, input) : scheduleClass(input)), { onSuccess: () => setOpen(false) });
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          {!existing && packages.length > 0 && (
            <Field
              id={`c-packageId-${id}`}
              label="Use a package credit (optional)"
              error={e.packageId}
              hint="Only active packages with free credits are listed. A pair package schedules the class for both learners."
            >
              <NativeSelect id={`c-packageId-${id}`} name="packageId" value={packageId} onChange={(ev) => setPackageId(ev.target.value)}>
                <option value="">No package</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {chosenPackage ? (
            <p className="rounded-xl border border-border bg-cream-deep/40 px-3 py-2 text-sm text-brown">
              Learner{chosenPackage.learnerIds.length > 1 ? "s" : ""}:{" "}
              {chosenPackage.learnerIds.map((uid) => students.find((s) => s.uid === uid)?.label ?? uid).join(" + ")}
            </p>
          ) : lockedStudent ? (
            <>
              <input type="hidden" name="studentId" value={existing?.studentId} />
              <p className="rounded-xl border border-border bg-cream-deep/40 px-3 py-2 text-sm text-brown">
                {students.find((s) => s.uid === existing?.studentId)?.label ?? "Package learner"} · uses a package credit (the learner cannot be changed)
              </p>
            </>
          ) : (
            <Field id={`c-studentId-${id}`} label="Student" error={e.studentId}>
              <NativeSelect id={`c-studentId-${id}`} name="studentId" defaultValue={existing?.studentId ?? ""} required {...invalid("studentId")}>
                <option value="">Choose a student…</option>
                {students.map((s) => (
                  <option key={s.uid} value={s.uid}>{s.label}</option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field id={`c-title-${id}`} label="Class title or subject" error={e.title}>
            <Input id={`c-title-${id}`} name="title" defaultValue={existing?.title} maxLength={120} placeholder="e.g. Varnam practice — Mohanam" required {...invalid("title")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={`c-date-${id}`} label="Date" error={e.date}>
              <Input id={`c-date-${id}`} name="date" type="date" defaultValue={existing?.date ?? todayInIndia()} min={existing ? undefined : todayInIndia()} required {...invalid("date")} />
            </Field>
            <Field id={`c-startTime-${id}`} label="Start (IST)" error={e.startTime}>
              <Input id={`c-startTime-${id}`} name="startTime" type="time" defaultValue={existing?.startTime} required {...invalid("startTime")} />
            </Field>
            <Field id={`c-endTime-${id}`} label="Expected end (IST)" error={e.endTime}>
              <Input id={`c-endTime-${id}`} name="endTime" type="time" defaultValue={existing?.endTime} required {...invalid("endTime")} />
            </Field>
          </div>
          <Field id={`c-meetUrl-${id}`} label="Google Meet link" error={e.meetUrl} hint="Paste the link from Google Meet, e.g. https://meet.google.com/abc-defg-hij">
            <Input id={`c-meetUrl-${id}`} name="meetUrl" type="url" inputMode="url" defaultValue={existing?.meetUrl} placeholder="https://meet.google.com/…" required autoComplete="off" {...invalid("meetUrl")} />
          </Field>
          <Field id={`c-notes-${id}`} label="Notes for the student (optional)" hint="Visible to the student, e.g. what to prepare.">
            <Textarea id={`c-notes-${id}`} name="notes" defaultValue={existing?.notes ?? ""} maxLength={1000} rows={3} className="min-h-20" />
          </Field>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            {existing ? "Save changes" : "Schedule class"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CancelClassDialog({ classId, title, when }: { classId: string; title: string; when: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, reset } = useServerAction();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-md"
      trigger={
        <Button type="button" variant="ghost" size="sm" className="text-destructive">
          <XCircle data-icon="inline-start" />
          Cancel class
        </Button>
      }
      title="Cancel this class?"
      description={`“${title}” · ${when}. The student will see it as cancelled and will not be able to join. This cannot be undone — schedule a new class if needed.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const reason = new FormData(event.currentTarget).get("reason");
          run(() => cancelClass(classId, reason), { onSuccess: () => setOpen(false) });
        }}
      >
        <Field id={`cancel-reason-${classId}`} label="Reason (optional, shown to the student)">
          <Input id={`cancel-reason-${classId}`} name="reason" maxLength={300} disabled={pending} />
        </Field>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Keep class</Button>
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending && <Spinner className="size-4 text-current" />}
            Cancel class
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function RecordOutcomeDialog({ classId, title, packageLinked = false }: { classId: string; title: string; packageLinked?: boolean }) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, run, reset } = useServerAction();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-md"
      trigger={
        <Button type="button" variant="outline" size="sm">
          <CheckCircle2 data-icon="inline-start" />
          Record outcome
        </Button>
      }
      title="Record class outcome"
      description={`Marks “${title}” as completed. Attendance is your own record — it is not detected from the Meet link.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          run(() => recordClassOutcome(classId, d.get("attendance"), d.get("note")), { onSuccess: () => setOpen(false) });
        }}
      >
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className="mb-1 text-sm font-medium text-brown">Did the student attend?</legend>
          {(
            [
              ["attended", "Attended"],
              ["absent", "Absent"],
              ["unknown", "Not sure / not recorded"],
            ] as const
          )
            .filter(([value]) => !(packageLinked && value === "unknown"))
            .map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-brown">
                <input type="radio" name="attendance" value={value} defaultChecked={value === "attended"} className="size-4 accent-maroon" />
                {label}
              </label>
            ))}
          {packageLinked && (
            <p className="text-xs text-muted-foreground">
              This class uses a package credit: attended and absent both use one credit (once per session, however often you record it).
            </p>
          )}
          {fieldErrors.attendance && <p className="text-xs text-destructive">{fieldErrors.attendance}</p>}
        </fieldset>
        <Field id={`outcome-note-${classId}`} label="Teacher note (private — never shown to the student)">
          <Textarea id={`outcome-note-${classId}`} name="note" maxLength={1000} rows={3} className="min-h-20" disabled={pending} />
        </Field>
        {error && !fieldErrors.attendance && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            Mark completed
          </Button>
        </div>
      </form>
    </Modal>
  );
}
