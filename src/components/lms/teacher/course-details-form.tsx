"use client";

import { updateCourseDetails } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { BilingualFields, readBilingualForm } from "@/components/lms/bilingual-fields";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import type { CourseRecord } from "@/lib/lms/types";

export function CourseDetailsForm({ course }: { course: CourseRecord }) {
  const { pending, error, fieldErrors, success, run } = useServerAction();

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const values = readBilingualForm(event.currentTarget);
        run(() => updateCourseDetails(course.id, values), { success: "Course details saved." });
      }}
    >
      <fieldset disabled={pending}>
        <BilingualFields idPrefix="course" defaults={course} errors={fieldErrors} />
      </fieldset>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Saving keeps the current status. Drafts stay hidden from students.
        </p>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner className="size-4 text-cream" />}
          {pending ? "Saving…" : "Save details"}
        </Button>
      </div>
    </form>
  );
}
