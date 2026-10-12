"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";

import { enrollStudentById, setEnrollmentStatus } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { formatINR } from "@/lib/format";

export function EnrollInCourseForm({
  studentId,
  courses,
}: {
  studentId: string;
  courses: { id: string; title: string; status: string; price: number | null }[];
}) {
  const [courseId, setCourseId] = useState("");
  const { pending, error, success, run } = useServerAction();
  const selected = courses.find((c) => c.id === courseId);

  if (courses.length === 0) {
    return <p className="text-sm text-muted-foreground">This student is already enrolled in every available course.</p>;
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!courseId) return;
        run(() => enrollStudentById(courseId, studentId), {
          success: "Enrolled. The student can open the course from their dashboard while it is published.",
          onSuccess: () => setCourseId(""),
        });
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="enroll-course" className="text-sm font-medium text-brown">
            Course
          </Label>
          <NativeSelect id="enroll-course" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={pending} required>
            <option value="">Choose a course…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.status === "draft" ? " (draft)" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={pending || !courseId}>
          {pending ? <Spinner className="size-4 text-cream" /> : <UserPlus data-icon="inline-start" />}
          Enroll
        </Button>
      </div>
      {selected && (
        <p className="text-xs text-muted-foreground">
          Agreed fee will be recorded as {selected.price === null ? "not set (no listed fee)" : formatINR(selected.price)}, the
          course’s current fee. You can adjust it later.
        </p>
      )}
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
    </form>
  );
}

export function EnrollmentAccessControl({
  courseId,
  studentId,
  courseTitle,
  active,
}: {
  courseId: string;
  studentId: string;
  courseTitle: string;
  active: boolean;
}) {
  return active ? (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="ghost" size="sm" className="text-destructive">
          Revoke access
        </Button>
      }
      title={`Revoke access to “${courseTitle}”?`}
      description="The student immediately loses access to this course. Progress, payments and history are kept, and you can restore access later."
      confirmLabel="Revoke access"
      action={() => setEnrollmentStatus(courseId, studentId, "revoked")}
    />
  ) : (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          Restore access
        </Button>
      }
      title={`Restore access to “${courseTitle}”?`}
      description="The student will be able to open this course again."
      confirmLabel="Restore access"
      destructive={false}
      action={() => setEnrollmentStatus(courseId, studentId, "active")}
    />
  );
}
