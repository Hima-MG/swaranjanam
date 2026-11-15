import { BookOpen, CircleAlert, Layers, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LmsThumbnail } from "@/components/lms/lms-thumbnail";
import { CreateCourseDialog } from "@/components/lms/teacher/create-course-dialog";
import { CourseStatusBadge } from "@/components/lms/teacher/course-status-badge";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { groupManagedCourses } from "@/lib/lms/academy-courses";
import { logReadFailure, type DescribedError } from "@/lib/lms/server/firestore-errors";
import { listManagedCourses, type TeacherCourseSummary } from "@/lib/lms/server/teacher";

export const metadata: Metadata = { title: "Courses · Teacher" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function CourseCards({ courses }: { courses: TeacherCourseSummary[] }) {
  return (
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
              <h3 className="font-heading text-xl font-semibold break-words text-brown group-hover:text-maroon">{course.title || "Untitled course"}</h3>
              {course.titleMl && (
                <p lang="ml" className="text-sm text-brown-muted">
                  {course.titleMl}
                </p>
              )}
              {(course.category || course.level) && (
                <p className="text-xs text-muted-foreground">{[course.category, course.level].filter(Boolean).join(" · ")}</p>
              )}
              <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
                <li className="inline-flex items-center gap-1.5">
                  <Layers className="size-3.5 text-gold" aria-hidden="true" />
                  {course.moduleCount === null || course.lessonCount === null
                    ? "Outline count unavailable"
                    : `${plural(course.moduleCount, "module", "modules")} · ${plural(course.lessonCount, "lesson", "lessons")}`}
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5 text-gold" aria-hidden="true" />
                  {course.activeStudentCount === null ? "Student count unavailable" : plural(course.activeStudentCount, "student", "students")}
                </li>
              </ul>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CoursesError({ error }: { error: DescribedError }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
      <CircleAlert className="size-6 text-destructive" aria-hidden="true" />
      <div>
        <h2 className="type-h3">Courses could not be loaded</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{error.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">Error code: {error.code}</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/teacher/courses">Try again</Link>
      </Button>
    </div>
  );
}

async function CourseList() {
  // Server-side guard: signed-out visitors go to /login, students to /dashboard.
  const teacher = await requireRole("teacher", "/teacher/courses");

  let courses: TeacherCourseSummary[];
  try {
    courses = await listManagedCourses(teacher);
  } catch (error) {
    return <CoursesError error={logReadFailure("teacher.courses", error)} />;
  }

  if (courses.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-cream-deep/50 px-6 py-14 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-maroon-soft text-maroon">
          <BookOpen className="size-6" aria-hidden="true" />
        </span>
        <div>
          <h2 className="type-h3">No courses have been added yet.</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create your first course, add its lessons and materials, then publish it.</p>
        </div>
        <CreateCourseDialog label="Add course" />
      </div>
    );
  }

  const { regular, programme } = groupManagedCourses(courses);
  return (
    <div className="flex flex-col gap-10">
      {regular.length > 0 && (
        <section aria-labelledby="regular-courses" className="flex flex-col gap-5">
          <h2 id="regular-courses" className="type-h3">
            Courses <span className="text-base font-normal text-muted-foreground">({regular.length})</span>
          </h2>
          <CourseCards courses={regular} />
        </section>
      )}
      {programme.length > 0 && (
        <section aria-labelledby="programmes" className="flex flex-col gap-5">
          <h2 id="programmes" className="type-h3">
            Special programmes <span className="text-base font-normal text-muted-foreground">({programme.length})</span>
          </h2>
          <CourseCards courses={programme} />
        </section>
      )}
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
