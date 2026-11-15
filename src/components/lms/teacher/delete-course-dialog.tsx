"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { deleteCourse } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { FormField } from "@/components/forms/form-field";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";

/**
 * Permanent course deletion. The teacher types the course title to confirm.
 * The server refuses (with the reason) when the course has any student,
 * batch, billing or payment history; on success it redirects to the list.
 */
export function DeleteCourseDialog({ courseId, title }: { courseId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const { pending, error, fieldErrors, run, reset } = useServerAction();
  const matches = typed.trim() === title.trim();

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          reset();
          setTyped("");
        }
        setOpen(next);
      }}
      trigger={
        <Button type="button" variant="destructive" size="sm">
          <Trash2 data-icon="inline-start" />
          Delete course
        </Button>
      }
      title="Delete this course permanently?"
      description={
        <>
          This removes <strong>{title}</strong>, all of its modules and lessons, and the images, audio, video, PDFs and documents uploaded to it. This
          cannot be undone. Courses with students, batches, registrations or payments cannot be deleted — archive them instead.
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!matches) return;
          run(() => deleteCourse(courseId, typed));
        }}
      >
        <FormField
          id="delete-course-confirm"
          name="confirmTitle"
          label={`Type the course title to confirm: ${title}`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          aria-invalid={fieldErrors?.confirmTitle ? true : undefined}
          disabled={pending}
        />
        {fieldErrors?.confirmTitle && <p className="-mt-2 text-xs text-destructive">{fieldErrors.confirmTitle}</p>}
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={pending || !matches}>
            {pending && <Spinner className="size-4 text-cream" />}
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
