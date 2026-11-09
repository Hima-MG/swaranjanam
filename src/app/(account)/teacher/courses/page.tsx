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
import { groupManagedCourses } from "@/lib/lms/academy-courses";
import { listManagedCourses, type TeacherCourseSummary } from "@/lib/lms/server/teacher";

export const metadata: Metadata = { title: "Courses · Teacher" };

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
              <h3 className="font-heading text-xl font-semibold text-brown group-hover:text-maroon">{course.title}</h3>
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
  );
}

async function CourseList() {
  // Server-side guard: signed-out visitors go to /login, students to /dashboard.
  const teacher = await requireRole("teacher", "/teacher/courses");
  const courses = await listManagedCourses(teacher);
  // Main academy courses first; syllabus topics never stand in for them.
  const { main, programme, other, missingMain } = groupManagedCourses(courses);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="main-courses" className="flex flex-col gap-5">
        <h2 id="main-courses" className="type-h3">
          Academy courses
        </h2>
        {missingMain.length > 0 && (
          <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6">
            <BookOpen className="size-6 text-maroon" aria-hidden="true" />
            <p className="max-w-2xl text-sm text-muted-foreground">
              Not set up as course records yet: {missingMain.map((c) => c.title).join(" and ")}. The public website shows them from the approved
              catalogue, but they cannot have batches, lessons or students until their course records exist.
            </p>
          </div>
        )}
        {main.length > 0 && <CourseCards courses={main} />}
      </section>
      {programme.length > 0 && (
        <section aria-labelledby="programmes" className="flex flex-col gap-5">
          <h2 id="programmes" className="type-h3">
            Special programmes
          </h2>
          <CourseCards courses={programme} />
        </section>
      )}
      {other.length > 0 && (
        <section aria-labelledby="other-courses" className="flex flex-col gap-5">
          <div>
            <h2 id="other-courses" className="type-h3">
              Syllabus topics and other course records
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Kept for existing lessons and students. Not offered for new batches.</p>
          </div>
          <CourseCards courses={other} />
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
