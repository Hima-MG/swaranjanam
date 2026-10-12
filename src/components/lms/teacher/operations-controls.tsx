"use client";

import { CheckCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  deleteAnnouncement,
  markNotificationsRead,
  saveAnnouncement,
  updateTeacherProfile,
} from "@/app/(account)/teacher/operations-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export interface AnnouncementDraft {
  id: string;
  title: string;
  titleMl: string;
  body: string;
  bodyMl: string;
  courseId: string | null;
  published: boolean;
  pinned: boolean;
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium text-brown">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function AnnouncementDialog({ courses, existing }: { courses: { id: string; title: string }[]; existing?: AnnouncementDraft }) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors: e, run, reset } = useServerAction();
  const id = existing?.id ?? "new";
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) reset();
        setOpen(next);
      }}
      className="sm:max-w-2xl"
      trigger={
        existing ? (
          <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${existing.title}`}>
            <Pencil />
          </Button>
        ) : (
          <Button type="button">
            <Plus data-icon="inline-start" />
            New announcement
          </Button>
        )
      }
      title={existing ? "Edit announcement" : "New announcement"}
      description="Shown on students’ dashboards. Malayalam is optional and never filled in automatically."
    >
      <form
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          run(
            () =>
              saveAnnouncement(existing?.id ?? null, {
                title: d.get("title"),
                titleMl: d.get("titleMl"),
                body: d.get("body"),
                bodyMl: d.get("bodyMl"),
                courseId: d.get("courseId"),
                published: d.get("published") === "on",
                pinned: d.get("pinned") === "on",
              }),
            { onSuccess: () => setOpen(false) },
          );
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <Field id={`a-course-${id}`} label="Audience" error={e.courseId}>
            <NativeSelect id={`a-course-${id}`} name="courseId" defaultValue={existing?.courseId ?? ""}>
              <option value="">All students</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>Students of: {c.title}</option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id={`a-title-${id}`} label="Title (English)" error={e.title}>
              <Input id={`a-title-${id}`} name="title" defaultValue={existing?.title} maxLength={150} required />
            </Field>
            <Field id={`a-titleMl-${id}`} label="Title (Malayalam, optional)">
              <Input id={`a-titleMl-${id}`} name="titleMl" lang="ml" defaultValue={existing?.titleMl} maxLength={150} />
            </Field>
            <Field id={`a-body-${id}`} label="Message (English)" error={e.body}>
              <Textarea id={`a-body-${id}`} name="body" defaultValue={existing?.body} maxLength={4000} rows={5} required />
            </Field>
            <Field id={`a-bodyMl-${id}`} label="Message (Malayalam, optional)">
              <Textarea id={`a-bodyMl-${id}`} name="bodyMl" lang="ml" defaultValue={existing?.bodyMl} maxLength={4000} rows={5} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm text-brown">
              <input type="checkbox" name="published" defaultChecked={existing?.published ?? true} className="size-4 accent-maroon" />
              Visible to students
            </label>
            <label className="flex items-center gap-2 text-sm text-brown">
              <input type="checkbox" name="pinned" defaultChecked={existing?.pinned ?? false} className="size-4 accent-maroon" />
              Pin to the top
            </label>
          </div>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteAnnouncementButton({ id, title }: { id: string; title: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${title}`}>
          <Trash2 />
        </Button>
      }
      title="Delete this announcement?"
      description="Students will no longer see it. The deletion is recorded in the activity log."
      confirmLabel="Delete"
      action={() => deleteAnnouncement(id)}
    />
  );
}

export function MarkNotificationsReadButton({ disabled }: { disabled: boolean }) {
  const { pending, error, run } = useServerAction();
  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || pending} onClick={() => run(() => markNotificationsRead())}>
        {pending ? <Spinner className="size-4" /> : <CheckCheck data-icon="inline-start" />}
        Mark all as read
      </Button>
      {error && <FormAlert tone="error">{error}</FormAlert>}
    </div>
  );
}

export function TeacherProfileForm({ displayName, phone }: { displayName: string; phone: string }) {
  const { pending, error, fieldErrors: e, success, run } = useServerAction();
  return (
    <form
      className="flex max-w-lg flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const d = new FormData(event.currentTarget);
        run(() => updateTeacherProfile({ displayName: d.get("displayName"), phone: d.get("phone") }), { success: "Profile saved." });
      }}
    >
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <Field id="t-name" label="Your name" error={e.displayName}>
          <Input id="t-name" name="displayName" defaultValue={displayName} maxLength={100} autoComplete="name" required />
        </Field>
        <Field id="t-phone" label="Phone (optional)" error={e.phone}>
          <Input id="t-phone" name="phone" type="tel" defaultValue={phone} maxLength={20} autoComplete="tel" />
        </Field>
      </fieldset>
      {error && !e.displayName && !e.phone && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending && <Spinner className="size-4 text-cream" />}
        Save profile
      </Button>
    </form>
  );
}
