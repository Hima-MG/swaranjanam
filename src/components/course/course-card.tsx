import { ArrowRight, BookOpen, MonitorPlay } from "lucide-react";
import Link from "next/link";

import { CourseBadge } from "@/components/course/course-badge";
import { CourseFeeLine } from "@/components/course/course-fees";
import { CourseThumbnail } from "@/components/course/course-thumbnail";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { COURSE_AVAILABILITY_LABELS, type Course } from "@/types/course";

interface CourseCardProps {
  course: Course;
  className?: string;
}

export function CourseCard({ course, className }: CourseCardProps) {
  const href = `/courses/${course.slug}`;

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-gold/50 hover:shadow-card",
        className,
      )}
    >
      <div className="relative">
        <CourseThumbnail course={course} />
        <div className="absolute top-4 left-4 flex flex-wrap gap-2">
          <Badge variant={course.availability === "open" ? "gold" : "cream"} className="shadow-soft">
            {COURSE_AVAILABILITY_LABELS[course.availability]}
          </Badge>
          {course.tag && <CourseBadge kind="tag" value={course.tag} />}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-6">
        {(course.category || course.level) && (
          <div className="flex items-center justify-between gap-2">
            <span className="type-eyebrow text-gold">{course.category}</span>
            {course.level && <CourseBadge kind="level" value={course.level} />}
          </div>
        )}

        <h3 className="type-h3">
          {/* Stretched link makes the whole card clickable while keeping one tab stop. */}
          <Link
            href={href}
            className="outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-3 focus-visible:after:ring-ring/60"
          >
            {course.title}
          </Link>
        </h3>
        {course.titleMl && (
          <p lang="ml" className="-mt-2 text-sm text-brown-muted">
            {course.titleMl}
          </p>
        )}
        {(course.subtitle || course.description) && (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {course.subtitle || course.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-brown-muted">
          {course.availability === "open" && (
            <span className="inline-flex items-center gap-1.5">
              <MonitorPlay className="size-4" aria-hidden="true" />
              Live online · 1 hour weekly
            </span>
          )}
          {course.lessonCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <BookOpen className="size-4" aria-hidden="true" />
              {course.lessonCount} {course.lessonCount === 1 ? "lesson" : "lessons"}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-border pt-4">
          {/* Per-session rates only — never a total course fee. Enrolment starts on the course page. */}
          <CourseFeeLine fee={course.fee} programme={course.programme} />
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-full bg-maroon-soft text-maroon transition-colors group-hover:bg-maroon group-hover:text-cream"
          >
            <ArrowRight className="size-4" />
          </span>
        </div>
      </div>
    </article>
  );
}
