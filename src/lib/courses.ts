import { courses } from "@/data/courses";
import type { Course, CourseCategory } from "@/types/course";

// Data-access layer for courses. Pages call these helpers rather than importing
// the static data directly, so swapping in Firestore later is a local change.

export function getAllCourses(): Course[] {
  return courses;
}

export function getCourseBySlug(slug: string): Course | undefined {
  return courses.find((course) => course.slug === slug);
}

export function getFeaturedCourses(limit = 4): Course[] {
  return courses.filter((course) => course.featured).slice(0, limit);
}

export function getRelatedCourses(course: Course, limit = 3): Course[] {
  const sameCategory = courses.filter(
    (c) => c.slug !== course.slug && c.category === course.category,
  );
  const others = courses.filter(
    (c) => c.slug !== course.slug && c.category !== course.category,
  );
  return [...sameCategory, ...others].slice(0, limit);
}

export function getCourseCategories(): CourseCategory[] {
  return Array.from(new Set(courses.map((course) => course.category)));
}
