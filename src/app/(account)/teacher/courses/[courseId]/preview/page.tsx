import { ArrowLeft, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CourseOutlineNav } from "@/components/lms/student/course-outline-nav";
import { LessonPlayer } from "@/components/lms/student/lesson-player";
import { CourseStatusBadge } from "@/components/lms/teacher/course-status-badge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { getCoursePreview } from "@/lib/lms/server/teacher";

export const metadata: Metadata = { title: "Preview · Teacher" };

type Props = PageProps<"/teacher/courses/[courseId]/preview">;

async function Preview({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ courseId }, query] = await Promise.all([params, searchParams]);
  const teacher = await requireRole("teacher", `/teacher/courses/${courseId}/preview`);
  const lessonParam = typeof query.lesson === "string" ? query.lesson : null;
  const data = await getCoursePreview(teacher, courseId, lessonParam);
  if (!data) notFound();
  const { course, outline, lesson, module, previous, next } = data;
  const hrefFor = (lessonId: string) => `/teacher/courses/${course.id}/preview?lesson=${lessonId}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-gold/40 bg-gold-soft/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-brown">
          <Eye className="size-4 text-maroon" aria-hidden="true" />
          Student preview of <strong className="font-semibold">{course.title}</strong>
          <CourseStatusBadge status={course.status} />
          <span className="text-muted-foreground">— progress is not recorded.</span>
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/teacher/courses/${course.id}`}>
            <ArrowLeft data-icon="inline-start" />
            Back to editor
          </Link>
        </Button>
      </div>

      {!lesson ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          This course has no lessons yet, so there is nothing for students to see.
        </p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <nav aria-label="Course lessons" className="self-start rounded-2xl border border-border bg-card p-4 shadow-soft lg:sticky lg:top-24">
            <CourseOutlineNav courseId={course.id} outline={outline} currentLessonId={lesson.id} compact lessonHref={hrefFor} />
          </nav>
          <div className="flex min-w-0 flex-col gap-6">
            {module && <p className="type-eyebrow text-gold">{module.title}</p>}
            <LessonPlayer courseId={course.id} lesson={lesson} completed={false} preview />
            <nav aria-label="Lesson navigation" className="flex flex-wrap justify-between gap-3">
              {previous ? (
                <Button asChild variant="outline">
                  <Link href={hrefFor(previous.id)}>
                    <ChevronLeft data-icon="inline-start" />
                    <span className="max-w-48 truncate">{previous.title}</span>
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              {next && (
                <Button asChild>
                  <Link href={hrefFor(next.id)}>
                    <span className="max-w-48 truncate">{next.title}</span>
                    <ChevronRight data-icon="inline-end" />
                  </Link>
                </Button>
              )}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CoursePreviewPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<LoadingState label="Loading preview…" />}>
      <Preview params={params} searchParams={searchParams} />
    </Suspense>
  );
}
