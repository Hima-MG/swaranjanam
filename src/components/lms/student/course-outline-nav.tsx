import { CheckCircle2, Circle, PlayCircle } from "lucide-react";
import Link from "next/link";

import type { ModuleWithLessons, StudentLessonSummary } from "@/lib/lms/types";
import { cn } from "@/lib/utils";

/** Module/lesson list with completion state. Used on the course page and beside the lesson player. */
export function CourseOutlineNav({
  courseId,
  outline,
  currentLessonId,
  compact = false,
  lessonHref = (lessonId) => `/dashboard/courses/${courseId}/lessons/${lessonId}`,
}: {
  courseId: string;
  outline: ModuleWithLessons<StudentLessonSummary>[];
  currentLessonId?: string;
  compact?: boolean;
  /** Link target per lesson (the teacher preview uses its own URLs). */
  lessonHref?: (lessonId: string) => string;
}) {
  return (
    <ol className={cn("flex flex-col", compact ? "gap-4" : "gap-5")}>
      {outline.map((module, moduleIndex) => (
        <li key={module.id} className={cn(!compact && "rounded-2xl border border-border bg-card p-5 shadow-soft")}>
          <h3 className={cn("font-heading font-semibold text-brown", compact ? "text-base" : "text-xl")}>
            {moduleIndex + 1}. {module.title}
          </h3>
          {module.titleMl && !compact && (
            <p lang="ml" className="text-sm text-brown-muted">
              {module.titleMl}
            </p>
          )}
          {module.lessons.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Lessons coming soon.</p>
          ) : (
            <ol className="mt-2 flex flex-col">
              {module.lessons.map((lesson) => {
                const current = lesson.id === currentLessonId;
                const Icon = lesson.completed ? CheckCircle2 : current ? PlayCircle : Circle;
                return (
                  <li key={lesson.id}>
                    <Link
                      href={lessonHref(lesson.id)}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex items-start gap-3 rounded-lg px-2 py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        current ? "bg-maroon-soft font-semibold text-maroon" : "text-brown hover:bg-cream-deep",
                      )}
                    >
                      <Icon
                        className={cn("mt-0.5 size-4 shrink-0", lesson.completed ? "text-gold" : "text-brown-muted")}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        {lesson.title}
                        <span className="sr-only">{lesson.completed ? " (completed)" : ""}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </li>
      ))}
    </ol>
  );
}
