"use client";

import { useMemo, useState } from "react";

import { CourseGrid } from "@/components/course/course-grid";
import { cn } from "@/lib/utils";
import type { Course, CourseCategory } from "@/types/course";

const ALL = "All Courses";
type Filter = CourseCategory | typeof ALL;

interface CourseCatalogProps {
  courses: Course[];
  categories: CourseCategory[];
}

/** Course grid with client-side category filtering. */
export function CourseCatalog({ courses, categories }: CourseCatalogProps) {
  const [active, setActive] = useState<Filter>(ALL);

  const filters: Filter[] = [ALL, ...categories];
  const visible = useMemo(
    () => (active === ALL ? courses : courses.filter((c) => c.category === active)),
    [active, courses],
  );

  return (
    <div className="flex flex-col gap-10">
      <div
        role="group"
        aria-label="Filter courses by category"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0"
      >
        {filters.map((category) => {
          const selected = category === active;
          return (
            <button
              key={category}
              type="button"
              aria-pressed={selected}
              onClick={() => setActive(category)}
              className={cn(
                "shrink-0 rounded-full border px-5 py-2 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                selected
                  ? "border-maroon bg-maroon text-cream shadow-soft"
                  : "border-border bg-ivory text-brown hover:border-gold hover:text-maroon",
              )}
            >
              {category}
            </button>
          );
        })}
      </div>

      <p className="sr-only" aria-live="polite">
        Showing {visible.length} {visible.length === 1 ? "course" : "courses"}
      </p>
      <CourseGrid courses={visible} />
    </div>
  );
}
