"use client";

import { Eye, EyeOff } from "lucide-react";

import { setCourseStatus } from "@/app/(account)/teacher/actions";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { CourseStatusBadge } from "@/components/lms/teacher/course-status-badge";
import { Button } from "@/components/ui/button";
import type { CourseStatus } from "@/lib/lms/types";

export function CourseStatusControl({ courseId, status }: { courseId: string; status: CourseStatus }) {
  const published = status === "published";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <CourseStatusBadge status={status} />
      {published ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm">
              <EyeOff data-icon="inline-start" />
              Unpublish
            </Button>
          }
          title="Unpublish this course?"
          description="Enrolled students will no longer be able to open it. Enrollments and progress are kept, and you can publish again at any time."
          confirmLabel="Unpublish"
          action={() => setCourseStatus(courseId, "draft")}
        />
      ) : (
        <ConfirmDialog
          trigger={
            <Button size="sm">
              <Eye data-icon="inline-start" />
              Publish
            </Button>
          }
          title="Publish this course?"
          description="Enrolled students will be able to open the course and its lessons immediately."
          confirmLabel="Publish"
          destructive={false}
          action={() => setCourseStatus(courseId, "published")}
        />
      )}
    </div>
  );
}
