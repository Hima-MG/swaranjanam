import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EnrollStudentForm, StudentsTable } from "@/components/lms/teacher/students-manager";
import { CourseStatusBadge } from "@/components/lms/teacher/course-status-badge";
import { Container } from "@/components/ui/container";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { listCourseStudents } from "@/lib/lms/server/teacher";

export const metadata: Metadata = { title: "Course students" };

type Params = PageProps<"/teacher/courses/[courseId]/students">["params"];

async function CourseStudents({ params }: { params: Params }) {
  const { courseId } = await params;
  const teacher = await requireRole("teacher", `/teacher/courses/${courseId}/students`);
  const data = await listCourseStudents(teacher, courseId);
  if (!data) notFound();
  const { course, students } = data;
  const activeCount = students.filter((s) => s.enrollment.status === "active").length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href={`/teacher/courses/${course.id}`}
          className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to course
        </Link>
        <h1 className="type-h2 break-words">Students · {course.title}</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <CourseStatusBadge status={course.status} />
          {activeCount} active · {students.length - activeCount} revoked
        </div>
        {course.status === "draft" && (
          <p className="text-sm text-muted-foreground">
            This course is a draft. Enrolled students will see it once you publish it.
          </p>
        )}
      </div>

      <section aria-labelledby="enroll" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="enroll" className="type-h3">
          Enroll a student
        </h2>
        <EnrollStudentForm courseId={course.id} />
      </section>

      <section aria-labelledby="enrolled" className="flex flex-col gap-4">
        <h2 id="enrolled" className="type-h3">
          Enrolled students
        </h2>
        <StudentsTable courseId={course.id} students={students} />
      </section>
    </div>
  );
}

export default function CourseStudentsPage({ params }: PageProps<"/teacher/courses/[courseId]/students">) {
  return (
    <Container size="md" className="py-10 sm:py-14">
      <Suspense fallback={<LoadingState label="Loading students…" />}>
        <CourseStudents params={params} />
      </Suspense>
    </Container>
  );
}
