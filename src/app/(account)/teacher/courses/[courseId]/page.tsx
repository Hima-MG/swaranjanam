import { ArrowLeft, ExternalLink, Eye, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CourseCatalogForm } from "@/components/lms/teacher/course-catalog-form";
import { CourseDetailsForm } from "@/components/lms/teacher/course-details-form";
import { CourseStatusControl } from "@/components/lms/teacher/course-status-control";
import { DuplicateCourseButton } from "@/components/lms/teacher/duplicate-course-button";
import { OutlineEditor } from "@/components/lms/teacher/outline-editor";
import { ThumbnailUploader } from "@/components/lms/teacher/thumbnail-uploader";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { getCourseForEditing } from "@/lib/lms/server/teacher";

export const metadata: Metadata = { title: "Edit course" };

type Params = PageProps<"/teacher/courses/[courseId]">["params"];

async function CourseEditor({ params }: { params: Params }) {
  const { courseId } = await params;
  const teacher = await requireRole("teacher", `/teacher/courses/${courseId}`);
  const data = await getCourseForEditing(teacher, courseId);
  if (!data) notFound();
  const { course, outline } = data;
  const lessonCount = outline.reduce((sum, m) => sum + m.lessons.length, 0);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <Link
          href="/teacher/courses"
          className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All courses
        </Link>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="type-h2 break-words">{course.title}</h1>
            {course.titleMl && (
              <p lang="ml" className="text-brown-muted">
                {course.titleMl}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {outline.length} modules · {lessonCount} lessons · /{course.slug}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <CourseStatusControl courseId={course.id} status={course.status} />
            {course.status === "published" && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/courses/${course.slug}`} target="_blank">
                  <ExternalLink data-icon="inline-start" />
                  View public page
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link href={`/teacher/courses/${course.id}/preview`}>
                <Eye data-icon="inline-start" />
                Preview
              </Link>
            </Button>
            <DuplicateCourseButton courseId={course.id} title={course.title} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/teacher/courses/${course.id}/students`}>
                <Users data-icon="inline-start" />
                Students
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <section aria-labelledby="details" className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h2 id="details" className="type-h3">
            Course details
          </h2>
          <CourseDetailsForm course={course} />
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h2 className="type-h3">Thumbnail</h2>
          <ThumbnailUploader courseId={course.id} title={course.title} thumbnailUrl={course.thumbnailUrl} />
        </div>
      </section>

      <section aria-labelledby="catalogue" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div>
          <h2 id="catalogue" className="type-h3">
            Catalogue details
          </h2>
          <p className="text-sm text-muted-foreground">
            Shown on the public course pages once the course is published.
          </p>
        </div>
        <CourseCatalogForm course={course} />
      </section>

      <section aria-labelledby="curriculum" className="flex flex-col gap-5">
        <div>
          <h2 id="curriculum" className="type-h3">
            Curriculum
          </h2>
          <p className="text-sm text-muted-foreground">
            Organise modules and lessons. Open a lesson to add English and Malayalam videos, audio and PDFs.
          </p>
        </div>
        <OutlineEditor courseId={course.id} outline={outline} />
      </section>
    </div>
  );
}

export default function TeacherCoursePage({ params }: PageProps<"/teacher/courses/[courseId]">) {
  return (
    <>
      <Suspense fallback={<LoadingState label="Loading course…" />}>
        <CourseEditor params={params} />
      </Suspense>
    </>
  );
}
