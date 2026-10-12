import { ArrowLeft, PlayCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LmsThumbnail } from "@/components/lms/lms-thumbnail";
import { ProgressBar } from "@/components/lms/progress-bar";
import { CourseOutlineNav } from "@/components/lms/student/course-outline-nav";
import { ReviewForm } from "@/components/lms/student/review-form";
import { getOwnReview } from "@/lib/lms/server/feedback";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { getStudentCourse } from "@/lib/lms/server/student";

export const metadata: Metadata = { title: "My course" };

type Params = PageProps<"/dashboard/courses/[courseId]">["params"];

async function StudentCourse({ params }: { params: Params }) {
  const { courseId } = await params;
  const user = await requireRole("student", `/dashboard/courses/${courseId}`);
  // Enrollment and publication are verified before any content is returned.
  const data = await getStudentCourse(user, courseId);
  if (!data) notFound();
  const review = await getOwnReview(user, data.course.id);
  const { course, outline, progress, nextLessonId } = data;

  return (
    <div className="flex flex-col gap-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        My dashboard
      </Link>

      <div className="grid gap-6 md:grid-cols-[280px_1fr] md:items-center">
        <LmsThumbnail title={course.title} url={course.thumbnailUrl} className="rounded-2xl" sizes="280px" />
        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="type-h2 break-words">{course.title}</h1>
          {course.titleMl && (
            <p lang="ml" className="text-lg text-brown-muted">
              {course.titleMl}
            </p>
          )}
          {course.description && <p className="text-muted-foreground">{course.description}</p>}
          {course.descriptionMl && (
            <p lang="ml" className="text-muted-foreground">
              {course.descriptionMl}
            </p>
          )}
          <div className="flex max-w-md flex-col gap-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {progress.completedLessons} of {progress.totalLessons} lessons completed
              </span>
              <span>{progress.percent}%</span>
            </div>
            <ProgressBar percent={progress.percent} label="Course progress" />
          </div>
          {nextLessonId && (
            <Button asChild className="self-start">
              <Link href={`/dashboard/courses/${course.id}/lessons/${nextLessonId}`}>
                <PlayCircle data-icon="inline-start" />
                {progress.completedLessons === 0 ? "Start learning" : "Continue learning"}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <section aria-labelledby="lessons" className="flex flex-col gap-4">
        <h2 id="lessons" className="type-h3">
          Lessons
        </h2>
        {outline.length === 0 ? (
          <p className="text-muted-foreground">Your teacher has not added lessons yet.</p>
        ) : (
          <CourseOutlineNav courseId={course.id} outline={outline} />
        )}
      </section>

      <section aria-labelledby="review" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="review" className="type-h3">
          Review this course
        </h2>
        <ReviewForm courseId={course.id} existing={review} />
      </section>
    </div>
  );
}

export default function StudentCoursePage({ params }: PageProps<"/dashboard/courses/[courseId]">) {
  return (
    <Container size="md" className="py-10 sm:py-14">
      <Suspense fallback={<LoadingState label="Loading course…" />}>
        <StudentCourse params={params} />
      </Suspense>
    </Container>
  );
}
