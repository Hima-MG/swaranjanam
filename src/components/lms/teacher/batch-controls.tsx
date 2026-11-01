"use client";

import { ArrowRightLeft, CalendarPlus, Pencil, Plus, UserMinus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { addBatchMember, createBatch, removeBatchMember, scheduleBatchClass, transferBatchMember, updateBatch } from "@/app/(account)/teacher/batch-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/lms/types";

export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
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

function todayInIndia() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Generic confirm-with-reason dialog for teacher actions. */
export function ActionDialog({
  trigger,
  title,
  description,
  label,
  required,
  confirmLabel,
  destructive,
  action,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  label?: string;
  required?: boolean;
  confirmLabel: string;
  destructive?: boolean;
  action: (data: FormData) => Promise<ActionResult<unknown>>;
  children?: React.ReactNode;
}) {
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
      trigger={trigger}
      title={title}
      description={description}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          run(() => action(data), { onSuccess: () => setOpen(false) });
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          {children}
          {label && (
            <Field id="action-reason" label={label} error={fieldErrors.reason}>
              <Input id="action-reason" name="reason" maxLength={300} required={required} />
            </Field>
          )}
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Back
          </Button>
          <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
            {pending && <Spinner className="size-4 text-current" />}
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export interface BatchFormValues {
  id: string;
  name: string;
  courseId: string;
  teacherId: string;
  schedule: string;
  meetUrl: string | null;
  capacity: number;
  status: "active" | "archived";
}

export function BatchFormDialog({
  courses,
  teachers,
  existing,
  maxCapacity,
}: {
  courses: { id: string; title: string }[];
  teachers: { uid: string; label: string }[];
  existing?: BatchFormValues;
  maxCapacity: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors: e, run, reset } = useServerAction();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-lg"
      trigger={
        existing ? (
          <Button type="button" variant="outline" size="sm">
            <Pencil data-icon="inline-start" />
            Edit batch
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={courses.length === 0 || teachers.length === 0}>
            <Plus data-icon="inline-start" />
            New batch
          </Button>
        )
      }
      title={existing ? "Edit batch" : "Create a batch"}
      description={`Up to ${maxCapacity} learners. Only active members can see the batch's Meet link, in their own dashboard.`}
    >
      <form
        className="-mx-1 flex max-h-[72vh] flex-col gap-4 overflow-y-auto px-1 pb-1"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          const input = {
            name: d.get("name"),
            courseId: d.get("courseId"),
            teacherId: d.get("teacherId"),
            schedule: d.get("schedule"),
            meetUrl: d.get("meetUrl"),
            capacity: d.get("capacity"),
            status: d.get("status") ?? "active",
          };
          run(() => (existing ? updateBatch(existing.id, input) : createBatch(input)), {
            onSuccess: (data) => {
              setOpen(false);
              if (!existing && data && typeof data === "object" && "batchId" in data) router.push(`/teacher/batches/${(data as { batchId: string }).batchId}`);
            },
          });
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <Field id="batch-name" label="Batch name" error={e.name}>
            <Input id="batch-name" name="name" defaultValue={existing?.name} maxLength={80} placeholder="e.g. Saturday evening — beginners" required />
          </Field>
          {existing ? (
            <input type="hidden" name="courseId" value={existing.courseId} />
          ) : (
            <Field id="batch-course" label="Course" error={e.courseId}>
              <NativeSelect id="batch-course" name="courseId" defaultValue="" required>
                <option value="">Choose a course…</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field id="batch-teacher" label="Teacher" error={e.teacherId}>
            <NativeSelect id="batch-teacher" name="teacherId" defaultValue={existing?.teacherId ?? teachers[0]?.uid ?? ""} required>
              {teachers.map((t) => (
                <option key={t.uid} value={t.uid}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="batch-schedule" label="Schedule" error={e.schedule} hint="Shown to members, e.g. Saturdays, 7–8 PM IST.">
            <Input id="batch-schedule" name="schedule" defaultValue={existing?.schedule} maxLength={120} required />
          </Field>
          <Field id="batch-meet" label="Google Meet link" error={e.meetUrl} hint="Shared by every class of this batch. Changing it updates upcoming classes.">
            <Input id="batch-meet" name="meetUrl" type="url" defaultValue={existing?.meetUrl ?? ""} placeholder="https://meet.google.com/…" autoComplete="off" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="batch-capacity" label={`Capacity (max ${maxCapacity})`} error={e.capacity}>
              <Input id="batch-capacity" name="capacity" inputMode="numeric" defaultValue={existing?.capacity ?? maxCapacity} />
            </Field>
            {existing && (
              <Field id="batch-status" label="Status">
                <NativeSelect id="batch-status" name="status" defaultValue={existing.status}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </NativeSelect>
              </Field>
            )}
          </div>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            {existing ? "Save batch" : "Create batch"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AddMemberForm({ batchId, candidates, disabled }: { batchId: string; candidates: { uid: string; label: string }[]; disabled: boolean }) {
  const { pending, error, fieldErrors, success, run } = useServerAction();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const studentId = new FormData(event.currentTarget).get("studentId");
        run(() => addBatchMember(batchId, studentId), { success: "Learner added. Their billing account is ready (₹400 non-refundable advance awaiting)." });
      }}
    >
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="add-member" className="text-sm font-medium text-brown">
          Add an enrolled student
        </Label>
        <NativeSelect id="add-member" name="studentId" defaultValue="" disabled={disabled || pending}>
          <option value="">{candidates.length ? "Choose a student enrolled in this course…" : "No other enrolled students"}</option>
          {candidates.map((c) => (
            <option key={c.uid} value={c.uid}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
        {fieldErrors.studentId && <p className="text-xs text-destructive">{fieldErrors.studentId}</p>}
      </div>
      <Button type="submit" disabled={disabled || pending || candidates.length === 0}>
        {pending ? <Spinner className="size-4 text-cream" /> : <UserPlus data-icon="inline-start" />}
        Add
      </Button>
      {error && !fieldErrors.studentId && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
    </form>
  );
}

export function RemoveMemberDialog({ batchId, studentId, name }: { batchId: string; studentId: string; name: string }) {
  return (
    <ActionDialog
      trigger={
        <Button type="button" variant="ghost" size="sm" className="text-destructive">
          <UserMinus data-icon="inline-start" />
          Remove
        </Button>
      }
      title={`Remove ${name} from this batch?`}
      description="Their upcoming classes in this batch are cancelled (not billed). Attendance, billing account, invoices and payments are kept unchanged."
      label="Reason (required)"
      required
      confirmLabel="Remove"
      destructive
      action={(d) => removeBatchMember(batchId, studentId, d.get("reason"))}
    />
  );
}

export function TransferMemberDialog({ batchId, studentId, name, targets }: { batchId: string; studentId: string; name: string; targets: { id: string; label: string }[] }) {
  if (targets.length === 0) return null;
  return (
    <ActionDialog
      trigger={
        <Button type="button" variant="ghost" size="sm">
          <ArrowRightLeft data-icon="inline-start" />
          Transfer
        </Button>
      }
      title={`Move ${name} to another batch`}
      description="Their charges, invoices, advance and history stay exactly as they are. Upcoming classes in this batch are cancelled (not billed)."
      confirmLabel="Transfer"
      action={(d) => transferBatchMember(batchId, studentId, d.get("toBatchId"))}
    >
      <Field id="transfer-to" label="New batch">
        <NativeSelect id="transfer-to" name="toBatchId" defaultValue={targets[0].id}>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </ActionDialog>
  );
}

export function ScheduleBatchClassDialog({ batchId, disabledReason }: { batchId: string; disabledReason: string | null }) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors: e, run, reset } = useServerAction();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-lg"
      trigger={
        <Button type="button" size="sm" disabled={disabledReason !== null} title={disabledReason ?? undefined}>
          <CalendarPlus data-icon="inline-start" />
          Schedule class
        </Button>
      }
      title="Schedule a class for the whole batch"
      description="One session for every active member, using the batch's Meet link. Attendance and billing are recorded per learner. Times are IST."
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          run(
            () => scheduleBatchClass(batchId, { title: d.get("title"), date: d.get("date"), startTime: d.get("startTime"), endTime: d.get("endTime"), notes: d.get("notes") }),
            { onSuccess: () => setOpen(false) },
          );
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <Field id="bc-title" label="Class title or subject" error={e.title}>
            <Input id="bc-title" name="title" maxLength={120} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="bc-date" label="Date" error={e.date}>
              <Input id="bc-date" name="date" type="date" defaultValue={todayInIndia()} min={todayInIndia()} required />
            </Field>
            <Field id="bc-start" label="Start (IST)" error={e.startTime}>
              <Input id="bc-start" name="startTime" type="time" required />
            </Field>
            <Field id="bc-end" label="End (IST)" error={e.endTime}>
              <Input id="bc-end" name="endTime" type="time" required />
            </Field>
          </div>
          <Field id="bc-notes" label="Notes for learners (optional)">
            <Textarea id="bc-notes" name="notes" maxLength={1000} rows={2} className="min-h-16" />
          </Field>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            Schedule for the batch
          </Button>
        </div>
      </form>
    </Modal>
  );
}
