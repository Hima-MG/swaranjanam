import { ChevronLeft, ChevronRight, ListOrdered } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ProgressBar } from "@/components/lms/progress-bar";
import { CourseOutlineNav } from "@/components/lms/student/course-outline-nav";
import { LessonPlayer } from "@/components/lms/student/lesson-player";
import { PracticePanel } from "@/components/lms/student/practice-panel";
import { listOwnSubmissions } from "@/lib/lms/server/feedback";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { getStudentLesson } from "@/lib/lms/server/student";

export const metadata: Metadata = { title: "Lesson" };

type Params = PageProps<"/dashboard/courses/[courseId]/lessons/[lessonId]">["params"];

async function StudentLesson({ params }: { params: Params }) {
  const { courseId, lessonId } = await params;
  const user = await requireRole("student", `/dashboard/courses/${courseId}/lessons/${lessonId}`);
  // Verifies an active enrollment in a published course before returning resources.
  const data = await getStudentLesson(user, courseId, lessonId);
  if (!data) notFound();
  // Only this student's own recordings, after enrollment has been verified above.
  const submissions = await listOwnSubmissions(user, data.course.id, data.lesson.id);
  const { course, outline, progress, module, lesson, completed, previous, next } = data;

  const outlineNav = (
    <CourseOutlineNav courseId={course.id} outline={outline} currentLessonId={lesson.id} compact />
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
        <div className="flex flex-col gap-2">
          <Link href={`/dashboard/courses/${course.id}`} className="font-heading text-xl font-semibold text-brown hover:text-maroon">
            {course.title}
          </Link>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress.completedLessons}/{progress.totalLessons} lessons
            </span>
            <span>{progress.percent}%</span>
          </div>
          <ProgressBar percent={progress.percent} label="Course progress" />
        </div>
        {/* Collapsible on small screens so the lesson stays near the top. */}
        <details className="group rounded-2xl border border-border bg-card p-4 shadow-soft lg:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-brown [&::-webkit-details-marker]:hidden">
            <ListOrdered className="size-4 text-gold" aria-hidden="true" />
            All lessons
            <ChevronRight className="ml-auto size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
          </summary>
          <nav aria-label="Course lessons" className="mt-3">
            {outlineNav}
          </nav>
        </details>
        <nav aria-label="Course lessons" className="hidden rounded-2xl border border-border bg-card p-4 shadow-soft lg:block">
          {outlineNav}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        {module && <p className="type-eyebrow text-gold">{module.title}</p>}
        <LessonPlayer courseId={course.id} lesson={lesson} completed={completed} />
        <PracticePanel courseId={course.id} lessonId={lesson.id} lessonTitle={lesson.title} submissions={submissions} />
        <nav aria-label="Lesson navigation" className="flex flex-wrap justify-between gap-3">
          {previous ? (
            <Button asChild variant="outline">
              <Link href={`/dashboard/courses/${course.id}/lessons/${previous.id}`}>
                <ChevronLeft data-icon="inline-start" />
                <span className="max-w-48 truncate">{previous.title}</span>
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {next && (
            <Button asChild>
              <Link href={`/dashboard/courses/${course.id}/lessons/${next.id}`}>
                <span className="max-w-48 truncate">{next.title}</span>
                <ChevronRight data-icon="inline-end" />
              </Link>
            </Button>
          )}
        </nav>
      </div>
    </div>
  );
}

export default function StudentLessonPage({ params }: PageProps<"/dashboard/courses/[courseId]/lessons/[lessonId]">) {
  return (
    <Container className="py-8 sm:py-12">
      <Suspense fallback={<LoadingState label="Loading lesson…" />}>
        <StudentLesson params={params} />
      </Suspense>
    </Container>
  );
}
