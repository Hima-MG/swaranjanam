"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createCourse } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { BilingualFields, readBilingualForm } from "@/components/lms/bilingual-fields";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";

export function CreateCourseDialog() {
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
          New course
        </Button>
      }
      title="Create a course"
      description="New courses start as drafts. Students see a course only after you publish it and enroll them."
    >
      <form
        className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault();
          const values = readBilingualForm(event.currentTarget);
          run(() => createCourse(values), {
            onSuccess: ({ courseId }) => router.push(`/teacher/courses/${courseId}`),
          });
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-5">
          <BilingualFields idPrefix="new-course" errors={fieldErrors} />
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
