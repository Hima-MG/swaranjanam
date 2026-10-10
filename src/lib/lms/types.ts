import type { CourseCategory, CourseFormat, CourseLevel, CourseTag } from "@/types/course";

// LMS data model, shared by server and client code. Contains no secrets.
//
// Firestore collections (all top-level, all written only by the server):
//   users/{uid}                          — see lib/auth/profile.ts
//   courses/{courseId}                   — migrated courses use their slug as id
//   modules/{moduleId}                   — courseId, order
//   lessons/{lessonId}                   — courseId, moduleId, order, resources[]
//   enrollments/{courseId}_{studentId}   — deterministic id: one per student+course
//   lessonProgress/{studentId}_{lessonId}
//
// Timestamps are Firestore Timestamps in the database and ISO strings once
// they leave the data layer, so records can be passed to Client Components.

export const LANGUAGES = ["en", "ml"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  ml: "മലയാളം",
};

export const COURSE_STATUSES = ["draft", "published"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const ENROLLMENT_STATUSES = ["active", "revoked"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const RESOURCE_TYPES = ["video", "audio", "pdf", "image"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** Where a resource is hosted. External resources are approved video links only. */
export type ResourceSource = "cloudinary" | "external";

export interface LessonResource {
  id: string;
  title: string;
  type: ResourceType;
  language: Language;
  source: ResourceSource;
  /** Delivery URL (Cloudinary secure URL, or the normalised embed URL for external video). */
  url: string;
  /** Cloudinary public id, for uploaded files. */
  publicId: string | null;
  /** Cloudinary resource type the asset was uploaded as ("image" | "video"). */
  cloudinaryResourceType: "image" | "video" | null;
  fileName: string | null;
  format: string | null;
  bytes: number | null;
  /** PDFs and images only: whether students may download the file. */
  downloadable: boolean;
  order: number;
  createdAt: string | null;
}

/** Public catalogue details, edited in the teacher dashboard ("Catalogue details"). */
export interface CourseCatalogFields {
  subtitle: string;
  subtitleMl: string;
  level: CourseLevel | null;
  category: CourseCategory | null;
  format: CourseFormat | null;
  duration: string;
  ageGroup: string;
  instructor: string;
  price: number | null;
  originalPrice: number | null;
  tag: CourseTag | null;
  featured: boolean;
  outcomes: string[];
  outcomesMl: string[];
}

export interface CourseRecord extends CourseCatalogFields {
  id: string;
  slug: string;
  title: string;
  titleMl: string;
  description: string;
  descriptionMl: string;
  thumbnailUrl: string | null;
  thumbnailPublicId: string | null;
  status: CourseStatus;
  teacherIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ModuleRecord {
  id: string;
  courseId: string;
  title: string;
  titleMl: string;
  description: string;
  descriptionMl: string;
  order: number;
}

export interface LessonRecord {
  id: string;
  courseId: string;
  moduleId: string;
  title: string;
  titleMl: string;
  description: string;
  descriptionMl: string;
  order: number;
  resources: LessonResource[];
}

/** Lesson without resources, for outlines and navigation. */
export type LessonSummary = Omit<LessonRecord, "resources"> & {
  resourceCounts: Record<Language, number>;
};

/** Lesson summary with the signed-in student's completion state. */
export interface StudentLessonSummary extends LessonSummary {
  completed: boolean;
}

export interface ModuleWithLessons<L = LessonSummary> extends ModuleRecord {
  lessons: L[];
}

export interface EnrollmentRecord {
  id: string;
  studentId: string;
  courseId: string;
  status: EnrollmentStatus;
  enrolledAt: string | null;
  enrolledBy: string | null;
  revokedAt: string | null;
}

export interface LessonProgressRecord {
  studentId: string;
  courseId: string;
  lessonId: string;
  completed: boolean;
  completedAt: string | null;
  lastAccessedAt: string | null;
}

/** Result shape returned by every Server Action. */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function enrollmentId(courseId: string, studentId: string): string {
  return `${courseId}_${studentId}`;
}

export function progressId(studentId: string, lessonId: string): string {
  return `${studentId}_${lessonId}`;
}

/** Picks the requested language's text. Returns null instead of substituting another language. */
export function localized(en: string, ml: string, language: Language): string | null {
  const value = language === "ml" ? ml : en;
  return value.trim() ? value : null;
}
