import type { PublicCourseFees } from "@/lib/catalog/public-pricing";

// Course taxonomy (the option lists teachers choose from) and the public
// catalogue view of a course. Course records themselves live in Firestore and
// are managed in the teacher dashboard; nothing here describes a real course.

export const COURSE_LEVELS = ["Beginner", "Intermediate", "Advanced", "All Levels"] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

export const COURSE_CATEGORIES = ["Foundations", "Vocal Training", "Children", "Devotional", "Workshops"] as const;
export type CourseCategory = (typeof COURSE_CATEGORIES)[number];

export const COURSE_FORMATS = ["Live Online", "Recorded", "Hybrid"] as const;
export type CourseFormat = (typeof COURSE_FORMATS)[number];

export const COURSE_TAGS = ["Bestseller", "New", "Popular", "Limited Seats"] as const;
export type CourseTag = (typeof COURSE_TAGS)[number];

/**
 * Public enrolment status, set by a teacher in "Catalogue details".
 * "open" courses show the academy's current per-session fees; "coming_soon"
 * courses show "Fees to be announced" and cannot be enrolled in. A published
 * course with no availability set is not listed on the public website.
 */
export const COURSE_AVAILABILITY = ["open", "coming_soon"] as const;
export type CourseAvailability = (typeof COURSE_AVAILABILITY)[number];
export const COURSE_AVAILABILITY_LABELS: Record<CourseAvailability, string> = {
  open: "Open for enrolment",
  coming_soon: "Coming soon",
};

/** Visual palette for the generated placeholder thumbnail. */
export type CourseTone = "maroon" | "gold" | "brown" | "rose";

/** A published course as shown on the public website. Never contains lesson resources. */
export interface Course {
  id: string;
  slug: string;
  title: string;
  titleMl: string;
  subtitle: string;
  subtitleMl: string;
  description: string;
  descriptionMl: string;
  thumbnailUrl: string | null;
  level: CourseLevel | null;
  category: CourseCategory | null;
  format: CourseFormat | null;
  /** Kept for the teacher dashboard; never shown publicly (no fixed course duration). */
  duration: string;
  ageGroup: string;
  instructor: string;
  availability: CourseAvailability;
  /**
   * The academy's current per-session fees (from the billing rates in force)
   * for an "open" course; null for "coming_soon" ("Fees to be announced").
   * The legacy course.price field and student-specific agreed fees are never
   * part of the public course.
   */
  fee: PublicCourseFees | null;
  /** "approved" = the academy's approved catalogue, used until the course exists in Firestore. */
  source: "firestore" | "approved";
  tag: CourseTag | null;
  featured: boolean;
  outcomes: string[];
  outcomesMl: string[];
  moduleCount: number;
  lessonCount: number;
  /** Derived from the id, so placeholder artwork stays stable. */
  tone: CourseTone;
}

/** Public curriculum outline: titles only. */
export interface CurriculumModule {
  title: string;
  titleMl: string;
  lessons: { title: string; titleMl: string }[];
}

export interface CourseDetail extends Course {
  curriculum: CurriculumModule[];
}
