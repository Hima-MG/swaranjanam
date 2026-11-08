import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { APPROVED_COURSES } from "@/data/approved-courses";
import { buildPublicCatalog, fromApproved, fromFirestore } from "@/lib/catalog/public-catalog";
import { publicFeesFromRate, type PublicCourseFees } from "@/lib/catalog/public-pricing";
import { periodOf, rateVersionForPeriod } from "@/lib/lms/class-billing";
import { getClassBillingConfig } from "@/lib/lms/server/class-billing";
import { col, mapCourse, readLessons, readModules } from "@/lib/lms/server/db";
import type { CourseRecord } from "@/lib/lms/types";
import type { Course, CourseCategory, CourseDetail } from "@/types/course";

// Public course catalogue (homepage "Courses & fees" section and course pages).
//
// * Courses: published Firestore courses whose availability a teacher has set,
//   plus the academy's approved catalogue for any approved course that does
//   not exist in Firestore yet (lib/catalog/public-catalog.ts).
// * Fees: each course's OWN rates (course pricing, Teacher → Courses → Classes &
//   pricing). A course saved before course pricing existed, and an approved-
//   catalogue course, uses the academy's confirmed rates in force
//   (settings/classBilling). Never the legacy course.price, never legacy package
//   plans, never a student's agreed rate.
// * Only catalogue fields and module/lesson TITLES leave this module — never
//   lesson resources, teacher ids, enrolments or payments.
// * Results are cached ("use cache") under CATALOG_TAG. Teacher mutations
//   that change public content (courses, rates) call updateTag(CATALOG_TAG).

export const CATALOG_TAG = "catalog";

export type CatalogResult<T> = { ok: true; data: T } | { ok: false };

function logFailure(label: string, error: unknown) {
  console.error(`[catalog] ${label} failed:`, (error as Error)?.name, (error as Error)?.message);
}

/** The academy's confirmed rates in force this month (IST) — for courses without their own pricing. */
async function currentPublicFees(): Promise<PublicCourseFees> {
  const config = await getClassBillingConfig();
  return publicFeesFromRate(rateVersionForPeriod(config.rateVersions, periodOf(new Date().toISOString())));
}

async function readCatalog(): Promise<Course[]> {
  const [published, slugs, fees] = await Promise.all([
    col("courses").where("status", "==", "published").get(),
    col("courses").select("slug").get(),
    currentPublicFees(),
  ]);
  const courses = published.docs.map(mapCourse).filter((c): c is CourseRecord => c !== null && c.availability !== null);
  const firestore = await Promise.all(
    courses.map(async (record) => {
      const [modules, lessons] = await Promise.all([
        col("modules").where("courseId", "==", record.id).count().get(),
        col("lessons").where("courseId", "==", record.id).count().get(),
      ]);
      return { record, moduleCount: modules.data().count, lessonCount: lessons.data().count };
    }),
  );
  const knownSlugs = new Set(slugs.docs.map((d) => (typeof d.get("slug") === "string" && d.get("slug")) || d.id));
  return buildPublicCatalog({ firestore, knownSlugs, approved: APPROVED_COURSES, fees });
}

/** Every publicly listed course. On failure returns `{ ok: false }`, cached only briefly. */
export async function getPublishedCourses(): Promise<CatalogResult<Course[]>> {
  "use cache";
  cacheTag(CATALOG_TAG);
  try {
    const data = await readCatalog();
    cacheLife("hours");
    return { ok: true, data };
  } catch (error) {
    logFailure("getPublishedCourses", error);
    cacheLife("seconds");
    return { ok: false };
  }
}

/**
 * Fees for the homepage summary and FAQ: the rates shared by EVERY open course,
 * or null when courses are priced differently (each course card then shows its
 * own rates) or the catalogue cannot be loaded.
 */
export async function getPublicFees(): Promise<PublicCourseFees | null> {
  "use cache";
  cacheTag(CATALOG_TAG);
  try {
    const fees = (await readCatalog()).filter((c) => c.availability === "open" && c.fee).map((c) => c.fee!);
    const shared = fees.length > 0 && fees.every((f) => JSON.stringify(f) === JSON.stringify(fees[0])) ? fees[0] : null;
    cacheLife("hours");
    return shared;
  } catch (error) {
    logFailure("getPublicFees", error);
    cacheLife("seconds");
    return null;
  }
}

const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/;

/** A publicly listed course with its curriculum outline, or `data: null` if none matches. */
export async function getPublishedCourseBySlug(slug: string): Promise<CatalogResult<CourseDetail | null>> {
  "use cache";
  cacheTag(CATALOG_TAG);
  if (!SLUG_PATTERN.test(slug)) {
    cacheLife("hours");
    return { ok: true, data: null };
  }
  try {
    const [snapshot, fees] = await Promise.all([col("courses").where("slug", "==", slug).limit(1).get(), currentPublicFees()]);
    if (snapshot.empty) {
      // Not in Firestore: the approved catalogue entry, if any.
      const approved = APPROVED_COURSES.find((a) => a.slug === slug);
      cacheLife("hours");
      return { ok: true, data: approved ? { ...fromApproved(approved, fees), curriculum: [] } : null };
    }
    const course = mapCourse(snapshot.docs[0]);
    if (!course || course.status !== "published" || !course.availability) {
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
    const publicCourse = fromFirestore({ record: course, moduleCount: modules.length, lessonCount: lessons.length }, fees);
    cacheLife("hours");
    return { ok: true, data: publicCourse ? { ...publicCourse, curriculum } : null };
  } catch (error) {
    logFailure("getPublishedCourseBySlug", error);
    cacheLife("seconds");
    return { ok: false };
  }
}

// --- Pure helpers over a loaded catalogue ----------------------------------------

export function openCourses(courses: Course[], limit = 4): Course[] {
  return courses.filter((c) => c.availability === "open").slice(0, limit);
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
