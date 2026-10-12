"use client";

import { Archive, ArchiveRestore, Eye, EyeOff } from "lucide-react";

import { setCourseStatus } from "@/app/(account)/teacher/actions";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { CourseStatusBadge } from "@/components/lms/teacher/course-status-badge";
import { Button } from "@/components/ui/button";
import type { CourseStatus } from "@/lib/lms/types";

export function CourseStatusControl({ courseId, status }: { courseId: string; status: CourseStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <CourseStatusBadge status={status} />

      {status === "draft" && (
        <ConfirmDialog
          trigger={
            <Button size="sm">
              <Eye data-icon="inline-start" />
              Publish
            </Button>
          }
          title="Publish this course?"
          description="It appears on the public website, and enrolled students can open it immediately."
          confirmLabel="Publish"
          destructive={false}
          action={() => setCourseStatus(courseId, "published")}
        />
      )}

      {status === "published" && (
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm">
              <EyeOff data-icon="inline-start" />
              Unpublish
            </Button>
          }
          title="Unpublish this course?"
          description="It disappears from the website and enrolled students can no longer open it. Enrollments, progress and payments are kept; you can publish again at any time."
          confirmLabel="Unpublish"
          action={() => setCourseStatus(courseId, "draft")}
        />
      )}

      {status !== "archived" ? (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm">
              <Archive data-icon="inline-start" />
              Archive
            </Button>
          }
          title="Archive this course?"
          description="It is removed from the website and closed to new enrollments. Students who are already enrolled keep access. Nothing is deleted, and you can restore it later."
          confirmLabel="Archive"
          action={() => setCourseStatus(courseId, "archived")}
        />
      ) : (
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm">
              <ArchiveRestore data-icon="inline-start" />
              Restore as draft
            </Button>
          }
          title="Restore this course as a draft?"
          description="It stays hidden from the website and from students until you publish it again."
          confirmLabel="Restore as draft"
          destructive={false}
          action={() => setCourseStatus(courseId, "draft")}
        />
      )}
    </div>
  );
}
