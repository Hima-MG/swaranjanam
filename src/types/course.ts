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
  /** Human readable duration, e.g. "12 weeks". Empty when not set. */
  duration: string;
  ageGroup: string;
  instructor: string;
  /** Price in INR (whole rupees); null when fees are not listed. */
  price: number | null;
  originalPrice: number | null;
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
