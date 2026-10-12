"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { duplicateCourse } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";

export function DuplicateCourseButton({ courseId, title }: { courseId: string; title: string }) {
  const router = useRouter();
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
      trigger={
        <Button variant="ghost" size="sm">
          <Copy data-icon="inline-start" />
          Duplicate
        </Button>
      }
      title={`Duplicate “${title}”?`}
      description="A new draft is created with the same details, catalogue information, modules, lessons and YouTube/Vimeo links. Uploaded files and the thumbnail are not copied — upload them again in the new course. Students and payments are not copied."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => duplicateCourse(courseId), {
                onSuccess: ({ courseId: newId }) => router.push(`/teacher/courses/${newId}`),
              })
            }
          >
            {pending && <Spinner className="size-4 text-cream" />}
            Duplicate as draft
          </Button>
        </>
      }
    >
      {error && <FormAlert tone="error">{error}</FormAlert>}
    </Modal>
  );
}
