import { BookOpen, Layers, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LmsThumbnail } from "@/components/lms/lms-thumbnail";
import { CreateCourseDialog } from "@/components/lms/teacher/create-course-dialog";
import { CourseStatusBadge } from "@/components/lms/teacher/course-status-badge";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { listManagedCourses } from "@/lib/lms/server/teacher";

export const metadata: Metadata = { title: "Courses · Teacher" };

async function CourseList() {
  // Server-side guard: signed-out visitors go to /login, students to /dashboard.
  const teacher = await requireRole("teacher", "/teacher/courses");
  const courses = await listManagedCourses(teacher);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="my-courses" className="flex flex-col gap-5">
        <h2 id="my-courses" className="sr-only">
          All courses
        </h2>
        {courses.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8">
            <BookOpen className="size-6 text-maroon" aria-hidden="true" />
            <p className="max-w-xl text-muted-foreground">
              No courses yet. Create your first course to start adding modules, lessons and media.
            </p>
          </div>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={`/teacher/courses/${course.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-shadow outline-none hover:shadow-card focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <LmsThumbnail title={course.title} url={course.thumbnailUrl} />
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <CourseStatusBadge status={course.status} />
                    <h3 className="font-heading text-xl font-semibold text-brown group-hover:text-maroon">
                      {course.title}
                    </h3>
                    {course.titleMl ? (
                      <p lang="ml" className="text-sm text-brown-muted">
                        {course.titleMl}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No Malayalam title yet</p>
                    )}
                    <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
                      <li className="inline-flex items-center gap-1.5">
                        <Layers className="size-3.5 text-gold" aria-hidden="true" />
                        {course.moduleCount} modules · {course.lessonCount} lessons
                      </li>
                      <li className="inline-flex items-center gap-1.5">
                        <Users className="size-3.5 text-gold" aria-hidden="true" />
                        {course.activeStudentCount} students
                      </li>
                    </ul>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function TeacherCoursesPage() {
  return (
    <>
      <TeacherPageHeader
        title="Courses"
        description="Create courses, organise lessons in English and Malayalam, upload media and publish."
        actions={<CreateCourseDialog />}
      />
      <Suspense fallback={<LoadingState label="Loading courses…" />}>
        <CourseList />
      </Suspense>
    </>
  );
}
