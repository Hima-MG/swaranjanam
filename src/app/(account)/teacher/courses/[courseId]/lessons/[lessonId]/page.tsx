import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LessonDetailsForm } from "@/components/lms/teacher/lesson-details-form";
import { LessonResourcesEditor } from "@/components/lms/teacher/lesson-resources-editor";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { getLessonForEditing } from "@/lib/lms/server/teacher";

export const metadata: Metadata = { title: "Edit lesson" };

type Params = PageProps<"/teacher/courses/[courseId]/lessons/[lessonId]">["params"];

async function LessonEditor({ params }: { params: Params }) {
  const { courseId, lessonId } = await params;
  const teacher = await requireRole("teacher", `/teacher/courses/${courseId}/lessons/${lessonId}`);
  const data = await getLessonForEditing(teacher, courseId, lessonId);
  if (!data) notFound();
  const { course, lesson, module } = data;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/teacher/courses" className="hover:text-maroon">
            Courses
          </Link>
          <ChevronRight className="size-4" aria-hidden="true" />
          <Link href={`/teacher/courses/${course.id}`} className="hover:text-maroon">
            {course.title}
          </Link>
          {module && (
            <>
              <ChevronRight className="size-4" aria-hidden="true" />
              <span>{module.title}</span>
            </>
          )}
        </nav>
        <h1 className="type-h2 break-words">{lesson.title}</h1>
        {lesson.titleMl && (
          <p lang="ml" className="text-brown-muted">
            {lesson.titleMl}
          </p>
        )}
      </div>

      <section aria-labelledby="lesson-details" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="lesson-details" className="type-h3">
          Lesson text
        </h2>
        <LessonDetailsForm courseId={course.id} lesson={lesson} />
      </section>

      <section aria-labelledby="lesson-resources" className="flex flex-col gap-4">
        <div>
          <h2 id="lesson-resources" className="type-h3">
            Learning materials
          </h2>
          <p className="text-sm text-muted-foreground">
            Add as many videos, audio files, PDFs and images as you need for each language. Students choose
            English or Malayalam and see only that language&apos;s materials. Nothing is translated automatically.
          </p>
        </div>
        <LessonResourcesEditor courseId={course.id} lessonId={lesson.id} resources={lesson.resources} />
      </section>
    </div>
  );
}

export default function TeacherLessonPage({ params }: PageProps<"/teacher/courses/[courseId]/lessons/[lessonId]">) {
  return (
    <>
      <Suspense fallback={<LoadingState label="Loading lesson…" />}>
        <LessonEditor params={params} />
      </Suspense>
    </>
  );
}
