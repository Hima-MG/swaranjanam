"use client";

import { Trash2 } from "lucide-react";

import { deleteLesson, updateLesson } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { BilingualFields, readBilingualForm } from "@/components/lms/bilingual-fields";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import type { LessonRecord } from "@/lib/lms/types";

export function LessonDetailsForm({ courseId, lesson }: { courseId: string; lesson: LessonRecord }) {
  const { pending, error, fieldErrors, success, run } = useServerAction();

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const values = readBilingualForm(event.currentTarget);
        run(() => updateLesson(courseId, lesson.id, values), { success: "Lesson saved." });
      }}
    >
      <fieldset disabled={pending}>
        <BilingualFields idPrefix="lesson" defaults={lesson} errors={fieldErrors} descriptionLabel="Lesson notes" />
      </fieldset>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ConfirmDialog
          trigger={
            <Button type="button" variant="ghost" className="text-destructive">
              <Trash2 data-icon="inline-start" />
              Delete lesson
            </Button>
          }
          title="Delete this lesson?"
          description="The lesson and all of its uploaded files will be deleted. Students' progress for this lesson will no longer count. This cannot be undone."
          confirmLabel="Delete lesson"
          action={() => deleteLesson(courseId, lesson.id)}
        />
        <Button type="submit" disabled={pending}>
          {pending && <Spinner className="size-4 text-cream" />}
          {pending ? "Saving…" : "Save lesson"}
        </Button>
      </div>
    </form>
  );
}
