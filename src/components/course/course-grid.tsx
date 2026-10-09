import { CourseCard } from "@/components/course/course-card";
import { cn } from "@/lib/utils";
import type { Course } from "@/types/course";

interface CourseGridProps {
  courses: Course[];
  columns?: 3 | 4;
  className?: string;
}

export function CourseGrid({ courses, columns = 3, className }: CourseGridProps) {
  return (
    <div
      className={cn(
        "grid gap-6 sm:grid-cols-2",
        columns === 3 ? "lg:grid-cols-3" : "xl:grid-cols-4",
        className,
      )}
    >
      {courses.map((course) => (
        <CourseCard key={course.slug} course={course} />
      ))}
    </div>
  );
}
