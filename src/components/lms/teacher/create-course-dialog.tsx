"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createCourse } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { BilingualFields, readBilingualForm } from "@/components/lms/bilingual-fields";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/native-select";
import { COURSE_CATEGORIES, COURSE_LEVELS } from "@/types/course";

function OptionalChoice({ id, label, options, error }: { id: string; label: string; options: readonly string[]; error?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium text-brown">
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <NativeSelect id={id} name={id.replace("new-course-", "")} defaultValue="" aria-invalid={error ? true : undefined}>
        <option value="">Not set</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </NativeSelect>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function CreateCourseDialog({ label = "New course" }: { label?: string }) {
  const router = useRouter();
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
      className="sm:max-w-3xl"
      trigger={
        <Button>
          <Plus data-icon="inline-start" />
          {label}
        </Button>
      }
      title="Create a course"
      description="New courses start as drafts. Students see a course only after you publish it and enroll them."
    >
      <form
        className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const values = { ...readBilingualForm(form), category: String(data.get("category") ?? ""), level: String(data.get("level") ?? "") };
          run(() => createCourse(values), {
            onSuccess: ({ courseId }) => router.push(`/teacher/courses/${courseId}`),
          });
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-5">
          <BilingualFields idPrefix="new-course" errors={fieldErrors} />
          <div className="grid gap-4 sm:grid-cols-2">
            <OptionalChoice id="new-course-category" label="Category" options={COURSE_CATEGORIES} error={fieldErrors?.category} />
            <OptionalChoice id="new-course-level" label="Level" options={COURSE_LEVELS} error={fieldErrors?.level} />
          </div>
          <p className="text-xs text-muted-foreground">
            After creating the draft you can add the thumbnail, cover image, modules, lessons, audio, video, PDF notes and documents, then publish.
          </p>
        </fieldset>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner className="size-4 text-cream" />}
            {pending ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
