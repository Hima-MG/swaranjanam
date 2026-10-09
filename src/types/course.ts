export type CourseLevel = "Beginner" | "Intermediate" | "Advanced" | "All Levels";

export type CourseCategory =
  | "Foundations"
  | "Vocal Training"
  | "Children"
  | "Devotional"
  | "Workshops";

export type CourseFormat = "Live Online" | "Recorded" | "Hybrid";

export type CourseTag = "Bestseller" | "New" | "Popular" | "Limited Seats";

/** Visual palette for the generated placeholder thumbnail. */
export type CourseTone = "maroon" | "gold" | "brown" | "rose";

export interface CurriculumModule {
  title: string;
  lessons: string[];
}

export interface Course {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  level: CourseLevel;
  category: CourseCategory;
  format: CourseFormat;
  /** Human readable duration, e.g. "12 weeks". */
  duration: string;
  lessonCount: number;
  /** Price in INR (whole rupees). */
  price: number;
  /** Optional pre-discount price in INR. */
  originalPrice?: number;
  rating: number;
  reviewCount: number;
  studentCount: number;
  instructor: string;
  ageGroup: string;
  tag?: CourseTag;
  featured?: boolean;
  /** Optional real image path; a generated placeholder is used when absent. */
  image?: string;
  tone: CourseTone;
  outcomes: string[];
  curriculum: CurriculumModule[];
}
