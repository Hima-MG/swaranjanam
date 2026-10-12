"use client";

import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { enrollStudentByEmail, setEnrollmentStatus } from "@/app/(account)/teacher/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { FormField } from "@/components/forms/form-field";
import { ConfirmDialog } from "@/components/lms/confirm-dialog";
import { useServerAction } from "@/components/lms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import type { EnrollmentRecord } from "@/lib/lms/types";

export interface StudentRow {
  enrollment: EnrollmentRecord;
  displayName: string | null;
  email: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

function formatDate(iso: string | null) {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}

export function EnrollStudentForm({ courseId }: { courseId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { pending, error, fieldErrors, success, run } = useServerAction();

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const email = new FormData(event.currentTarget).get("email");
        run(() => enrollStudentByEmail(courseId, email), {
          onSuccess: () => formRef.current?.reset(),
          // Names the student so the teacher can confirm the right account was enrolled.
          success: ({ name }) =>
            `${name} is enrolled. They can open the course from their dashboard while it is published.`,
        });
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField
          id="enroll-email"
          name="email"
          type="email"
          label="Student's email address"
          placeholder="student@example.com"
          autoComplete="off"
          className="flex-1"
          aria-invalid={fieldErrors.email ? true : undefined}
          disabled={pending}
          required
        />
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner className="size-4 text-cream" /> : <UserPlus data-icon="inline-start" />}
          Enroll student
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The student must already have registered on the website with this email.
      </p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
    </form>
  );
}

export function StudentsTable({ courseId, students }: { courseId: string; students: StudentRow[] }) {
  if (students.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">
        No students are enrolled in this course yet.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-cream-deep/60 text-xs tracking-wide text-brown-muted uppercase">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">Student</th>
              <th scope="col" className="px-5 py-3 font-semibold">Status</th>
              <th scope="col" className="px-5 py-3 font-semibold">Enrolled</th>
              <th scope="col" className="px-5 py-3 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map(({ enrollment, displayName, email }) => {
              const name = displayName ?? email ?? "Unknown student";
              const active = enrollment.status === "active";
              return (
                <tr key={enrollment.id} className="border-t border-border">
                  <td className="px-5 py-3">
                    <Link href={`/teacher/students/${enrollment.studentId}`} className="block font-medium text-brown hover:text-maroon hover:underline">
                      {name}
                    </Link>
                    {email && <span className="block break-all text-xs text-muted-foreground">{email}</span>}
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={active ? "gold" : "outline"}>{active ? "Active" : "Revoked"}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {active ? formatDate(enrollment.enrolledAt) : `Revoked ${formatDate(enrollment.revokedAt)}`}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {active ? (
                      <ConfirmDialog
                        trigger={
                          <Button type="button" variant="ghost" size="sm" className="text-destructive">
                            Revoke
                          </Button>
                        }
                        title={`Revoke ${name}'s access?`}
                        description="The student will immediately lose access to this course. Their progress is kept, and you can restore access later."
                        confirmLabel="Revoke access"
                        action={() => setEnrollmentStatus(courseId, enrollment.studentId, "revoked")}
                      />
                    ) : (
                      <ConfirmDialog
                        trigger={
                          <Button type="button" variant="outline" size="sm">
                            Restore
                          </Button>
                        }
                        title={`Restore ${name}'s access?`}
                        description="The student will be able to open this course again."
                        confirmLabel="Restore access"
                        destructive={false}
                        action={() => setEnrollmentStatus(courseId, enrollment.studentId, "active")}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
