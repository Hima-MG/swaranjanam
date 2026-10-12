import "server-only";

import { Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  COURSE_CATEGORIES,
  COURSE_FORMATS,
  COURSE_LEVELS,
  COURSE_TAGS,
} from "@/types/course";
import {
  COURSE_STATUSES,
  DEFAULT_CURRENCY,
  ENROLLMENT_STATUSES,
  LANGUAGES,
  RESOURCE_TYPES,
  type CourseCatalogFields,
  type CourseRecord,
  type EnrollmentRecord,
  type Language,
  type LessonProgressRecord,
  type LessonRecord,
  type LessonResource,
  type LessonSummary,
  type ModuleRecord,
} from "@/lib/lms/types";

// Low-level Firestore access for the LMS. No authorisation happens here:
// callers (access.ts, teacher.ts, student.ts, Server Actions) must authorise
// first. The Admin SDK bypasses security rules.

export const COLLECTIONS = {
  courses: "courses",
  modules: "modules",
  lessons: "lessons",
  enrollments: "enrollments",
  lessonProgress: "lessonProgress",
  users: "users",
  payments: "payments",
  submissions: "submissions",
  reviews: "reviews",
  announcements: "announcements",
  liveClasses: "liveClasses",
  auditLogs: "auditLogs",
} as const;

export function db() {
  return getAdminDb();
}

export function col(name: keyof typeof COLLECTIONS) {
  return getAdminDb().collection(COLLECTIONS[name]);
}

// --- Mapping (tolerant of missing fields so older documents still load) ----

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

function oneOfOrNull<T extends string>(values: readonly T[], value: unknown): T | null {
  return values.includes(value as T) ? (value as T) : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

function price(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function mapCatalogFields(data: DocumentData): CourseCatalogFields {
  return {
    subtitle: str(data.subtitle),
    subtitleMl: str(data.subtitleMl),
    level: oneOfOrNull(COURSE_LEVELS, data.level),
    category: oneOfOrNull(COURSE_CATEGORIES, data.category),
    format: oneOfOrNull(COURSE_FORMATS, data.format),
    duration: str(data.duration),
    ageGroup: str(data.ageGroup),
    instructor: str(data.instructor),
    price: price(data.price),
    originalPrice: price(data.originalPrice),
    tag: oneOfOrNull(COURSE_TAGS, data.tag),
    featured: data.featured === true,
    outcomes: strings(data.outcomes),
    outcomesMl: strings(data.outcomesMl),
  };
}

export function mapCourse(snapshot: DocumentSnapshot<DocumentData>): CourseRecord | null {
  const data = snapshot.data();
  if (!data) return null;
  return {
    ...mapCatalogFields(data),
    id: snapshot.id,
    slug: str(data.slug) || snapshot.id,
    title: str(data.title),
    titleMl: str(data.titleMl),
    description: str(data.description),
    descriptionMl: str(data.descriptionMl),
    thumbnailUrl: str(data.thumbnailUrl) || null,
    thumbnailPublicId: str(data.thumbnailPublicId) || null,
    status: oneOf(COURSE_STATUSES, data.status, "draft"),
    teacherIds: Array.isArray(data.teacherIds) ? data.teacherIds.filter((id): id is string => typeof id === "string") : [],
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export function mapModule(snapshot: DocumentSnapshot<DocumentData>): ModuleRecord | null {
  const data = snapshot.data();
  if (!data) return null;
  return {
    id: snapshot.id,
    courseId: str(data.courseId),
    title: str(data.title),
    titleMl: str(data.titleMl),
    description: str(data.description),
    descriptionMl: str(data.descriptionMl),
    order: num(data.order),
  };
}

function mapResource(raw: unknown): LessonResource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.id) || !str(r.url)) return null;
  return {
    id: str(r.id),
    title: str(r.title),
    type: oneOf(RESOURCE_TYPES, r.type, "pdf"),
    language: oneOf(LANGUAGES, r.language, "en"),
    source: r.source === "external" ? "external" : "cloudinary",
    url: str(r.url),
    publicId: str(r.publicId) || null,
    cloudinaryResourceType: r.cloudinaryResourceType === "video" ? "video" : r.cloudinaryResourceType === "image" ? "image" : null,
    fileName: str(r.fileName) || null,
    format: str(r.format) || null,
    bytes: typeof r.bytes === "number" ? r.bytes : null,
    downloadable: r.downloadable === true,
    order: num(r.order),
    createdAt: toIso(r.createdAt),
  };
}

export function sortResources(resources: LessonResource[]): LessonResource[] {
  return [...resources].sort((a, b) => a.order - b.order);
}

export function mapLesson(snapshot: DocumentSnapshot<DocumentData>): LessonRecord | null {
  const data = snapshot.data();
  if (!data) return null;
  const resources = Array.isArray(data.resources)
    ? data.resources.map(mapResource).filter((r): r is LessonResource => r !== null)
    : [];
  return {
    id: snapshot.id,
    courseId: str(data.courseId),
    moduleId: str(data.moduleId),
    title: str(data.title),
    titleMl: str(data.titleMl),
    description: str(data.description),
    descriptionMl: str(data.descriptionMl),
    order: num(data.order),
    resources: sortResources(resources),
  };
}

export function summarizeLesson(lesson: LessonRecord): LessonSummary {
  const { resources, ...rest } = lesson;
  const resourceCounts = Object.fromEntries(
    LANGUAGES.map((language) => [language, resources.filter((r) => r.language === language).length]),
  ) as Record<Language, number>;
  return { ...rest, resourceCounts };
}

export function mapEnrollment(snapshot: DocumentSnapshot<DocumentData>): EnrollmentRecord | null {
  const data = snapshot.data();
  if (!data) return null;
  return {
    id: snapshot.id,
    studentId: str(data.studentId),
    courseId: str(data.courseId),
    status: oneOf(ENROLLMENT_STATUSES, data.status, "revoked"),
    enrolledAt: toIso(data.enrolledAt),
    enrolledBy: str(data.enrolledBy) || null,
    revokedAt: toIso(data.revokedAt),
    agreedFee: typeof data.agreedFee === "number" && Number.isFinite(data.agreedFee) && data.agreedFee >= 0 ? data.agreedFee : null,
    currency: str(data.currency) || DEFAULT_CURRENCY,
  };
}

export function mapProgress(snapshot: DocumentSnapshot<DocumentData>): LessonProgressRecord | null {
  const data = snapshot.data();
  if (!data) return null;
  return {
    studentId: str(data.studentId),
    courseId: str(data.courseId),
    lessonId: str(data.lessonId),
    completed: data.completed === true,
    completedAt: toIso(data.completedAt),
    lastAccessedAt: toIso(data.lastAccessedAt),
  };
}

// --- Readers ------------------------------------------------------------------

const byOrder = <T extends { order: number; title: string }>(a: T, b: T) =>
  a.order - b.order || a.title.localeCompare(b.title);

export async function readCourse(courseId: string): Promise<CourseRecord | null> {
  return mapCourse(await col("courses").doc(courseId).get());
}

/** Modules of a course, in order. Sorted in memory, so no composite index is needed. */
export async function readModules(courseId: string): Promise<ModuleRecord[]> {
  const snapshot = await col("modules").where("courseId", "==", courseId).get();
  return snapshot.docs
    .map(mapModule)
    .filter((m): m is ModuleRecord => m !== null)
    .sort(byOrder);
}

/** Lessons of a course, in order within each module. */
export async function readLessons(courseId: string): Promise<LessonRecord[]> {
  const snapshot = await col("lessons").where("courseId", "==", courseId).get();
  return snapshot.docs
    .map(mapLesson)
    .filter((l): l is LessonRecord => l !== null)
    .sort(byOrder);
}

export async function readLesson(lessonId: string): Promise<LessonRecord | null> {
  return mapLesson(await col("lessons").doc(lessonId).get());
}

/** Groups lessons under their modules (module order, then lesson order). */
export function buildOutline<L extends { moduleId: string }>(modules: ModuleRecord[], lessons: L[]) {
  return modules.map((module) => ({
    ...module,
    lessons: lessons.filter((lesson) => lesson.moduleId === module.id),
  }));
}
