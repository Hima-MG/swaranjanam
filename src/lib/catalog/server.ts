import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { col, mapCourse, readLessons, readModules } from "@/lib/lms/server/db";
import type { CourseRecord } from "@/lib/lms/types";
import type { Course, CourseCategory, CourseDetail, CourseTone } from "@/types/course";

// Public course catalogue, read from Firestore (the single source of truth).
//
// * Only `status == "published"` courses are ever returned.
// * Only catalogue fields and module/lesson TITLES leave this module — never
//   lesson resources, teacher ids or enrollment data.
// * Results are cached ("use cache") under CATALOG_TAG. Every teacher
//   mutation that can change public content calls updateTag(CATALOG_TAG), so
//   edits, publishing and unpublishing show up immediately.

export const CATALOG_TAG = "catalog";

export type CatalogResult<T> = { ok: true; data: T } | { ok: false };

const TONES: CourseTone[] = ["maroon", "gold", "brown", "rose"];

/** Stable placeholder colour per course (no stored styling needed). */
function toneFor(id: string): CourseTone {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

function toPublicCourse(course: CourseRecord, moduleCount: number, lessonCount: number): Course {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    titleMl: course.titleMl,
    subtitle: course.subtitle,
    subtitleMl: course.subtitleMl,
    description: course.description,
    descriptionMl: course.descriptionMl,
    thumbnailUrl: course.thumbnailUrl,
    level: course.level,
    category: course.category,
    format: course.format,
    duration: course.duration,
    ageGroup: course.ageGroup,
    instructor: course.instructor,
    price: course.price,
    originalPrice: course.originalPrice,
    tag: course.tag,
    featured: course.featured,
    outcomes: course.outcomes,
    outcomesMl: course.outcomesMl,
    moduleCount,
    lessonCount,
    tone: toneFor(course.id),
  };
}

function logFailure(label: string, error: unknown) {
  console.error(`[catalog] ${label} failed:`, (error as Error)?.name, (error as Error)?.message);
}

async function readPublishedCourses(): Promise<Course[]> {
  const snapshot = await col("courses").where("status", "==", "published").get();
  const courses = snapshot.docs.map(mapCourse).filter((c): c is CourseRecord => c !== null);
  const withCounts = await Promise.all(
    courses.map(async (course) => {
      const [modules, lessons] = await Promise.all([
        col("modules").where("courseId", "==", course.id).count().get(),
        col("lessons").where("courseId", "==", course.id).count().get(),
      ]);
      return toPublicCourse(course, modules.data().count, lessons.data().count);
    }),
  );
  // Featured first, then alphabetical: a stable order teachers can influence.
  return withCounts.sort((a, b) => Number(b.featured) - Number(a.featured) || a.title.localeCompare(b.title));
}

/** All published courses. On failure returns `{ ok: false }`, cached only briefly. */
export async function getPublishedCourses(): Promise<CatalogResult<Course[]>> {
  "use cache";
  cacheTag(CATALOG_TAG);
  try {
    const data = await readPublishedCourses();
    cacheLife("hours");
    return { ok: true, data };
  } catch (error) {
    logFailure("getPublishedCourses", error);
    cacheLife("seconds");
    return { ok: false };
  }
}

const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/;

/** A published course with its public curriculum outline, or `data: null` if none matches. */
export async function getPublishedCourseBySlug(slug: string): Promise<CatalogResult<CourseDetail | null>> {
  "use cache";
  cacheTag(CATALOG_TAG);
  if (!SLUG_PATTERN.test(slug)) {
    cacheLife("hours");
    return { ok: true, data: null };
  }
  try {
    const snapshot = await col("courses")
      .where("slug", "==", slug)
      .where("status", "==", "published")
      .limit(1)
      .get();
    const course = snapshot.empty ? null : mapCourse(snapshot.docs[0]);
    if (!course) {
      cacheLife("hours");
      return { ok: true, data: null };
    }
    const [modules, lessons] = await Promise.all([readModules(course.id), readLessons(course.id)]);
    const curriculum = modules.map((module) => ({
      title: module.title,
      titleMl: module.titleMl,
      lessons: lessons
        .filter((lesson) => lesson.moduleId === module.id)
        .map((lesson) => ({ title: lesson.title, titleMl: lesson.titleMl })),
    }));
    cacheLife("hours");
    return { ok: true, data: { ...toPublicCourse(course, modules.length, lessons.length), curriculum } };
  } catch (error) {
    logFailure("getPublishedCourseBySlug", error);
    cacheLife("seconds");
    return { ok: false };
  }
}

// --- Pure helpers over a loaded catalogue ----------------------------------------

export function featuredCourses(courses: Course[], limit = 4): Course[] {
  const featured = courses.filter((c) => c.featured);
  return (featured.length > 0 ? featured : courses).slice(0, limit);
}

export function relatedCourses(courses: Course[], course: Pick<Course, "slug" | "category">, limit = 3): Course[] {
  const others = courses.filter((c) => c.slug !== course.slug);
  const sameCategory = others.filter((c) => course.category && c.category === course.category);
  const rest = others.filter((c) => !sameCategory.includes(c));
  return [...sameCategory, ...rest].slice(0, limit);
}

export function categoriesOf(courses: Course[]): CourseCategory[] {
  return Array.from(new Set(courses.map((c) => c.category).filter((c): c is CourseCategory => c !== null)));
}
