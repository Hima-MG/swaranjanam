// Academy-level courses vs. other course records. PURE: unit-tested, no I/O.
//
// The academy runs two MAIN courses (approved catalogue, data/approved-courses.ts):
//   * swara-foundation — Swara Foundation (Adults)
//   * little-swaras    — Little Swaras (Kids)
// Special Programmes (bhajan courses, workshops …) are course records with a
// `programme` object. Every other course record — e.g. the topics imported
// from the old static catalogue (Sarali Varisai, Janta Varisai, Alankaram,
// Geetham …) — is a syllabus topic / legacy record: kept, but never shown as
// a main course and never offered for new batches.

import { APPROVED_COURSES, type ApprovedCourse } from "@/data/approved-courses";

export const MAIN_COURSE_SLUGS = ["swara-foundation", "little-swaras"] as const;

export type CourseGroup = "main" | "programme" | "other";

interface Classifiable {
  id: string;
  slug: string;
  status: string;
  programme: unknown;
}

const isMainSlug = (slug: string) => (MAIN_COURSE_SLUGS as readonly string[]).includes(slug);

export function courseGroup(course: Pick<Classifiable, "id" | "slug" | "programme">): CourseGroup {
  if (isMainSlug(course.slug) || isMainSlug(course.id)) return "main";
  if (course.programme) return "programme";
  return "other";
}

/** The approved details of each main course (source for creating a missing one). */
export function approvedMainCourses(approved: readonly ApprovedCourse[] = APPROVED_COURSES): ApprovedCourse[] {
  return MAIN_COURSE_SLUGS.map((slug) => approved.find((a) => a.slug === slug)).filter((a): a is ApprovedCourse => Boolean(a));
}

/**
 * Course Management grouping: main courses first (in MAIN_COURSE_SLUGS order),
 * then special programmes, then other records. `missingMain` lists approved
 * main courses that have no course record yet.
 */
export function groupManagedCourses<T extends Pick<Classifiable, "id" | "slug" | "programme">>(courses: readonly T[], approved: readonly ApprovedCourse[] = APPROVED_COURSES) {
  const main = courses.filter((c) => courseGroup(c) === "main");
  const order = (c: T) => MAIN_COURSE_SLUGS.findIndex((s) => s === c.slug || s === c.id);
  main.sort((a, b) => order(a) - order(b));
  const present = new Set(main.flatMap((c) => [c.slug, c.id]));
  return {
    main,
    programme: courses.filter((c) => courseGroup(c) === "programme"),
    other: courses.filter((c) => courseGroup(c) === "other"),
    missingMain: approvedMainCourses(approved).filter((a) => !present.has(a.slug)),
  };
}

/**
 * Courses a NEW batch may belong to: the main courses (not drafts). Special
 * programmes are paid once and have no billing account, and no programme has
 * batch scheduling, so none are offered. Existing batches keep their course.
 */
export function isBatchEligible(course: Classifiable): boolean {
  return course.status !== "draft" && courseGroup(course) === "main";
}

/** "Choose a course" options for a new batch: eligible courses, main courses in their fixed order. */
export function courseOptionsFrom(courses: readonly (Classifiable & { title: string })[]): { id: string; title: string }[] {
  return groupManagedCourses(courses.filter(isBatchEligible), []).main.map((c) => ({ id: c.id, title: c.title }));
}

/**
 * Plan for creating the missing main courses without duplicates: an approved
 * main course is created only if no existing record has its slug as id or
 * slug, and none has the same title (case-insensitive).
 */
export function planMainCourseCreation(
  existing: readonly { id: string; slug?: string | null; title?: string | null }[],
  approved: readonly ApprovedCourse[] = APPROVED_COURSES,
): { create: ApprovedCourse[]; skip: { slug: string; reason: string }[] } {
  const create: ApprovedCourse[] = [];
  const skip: { slug: string; reason: string }[] = [];
  for (const a of approvedMainCourses(approved)) {
    const clash = existing.find(
      (e) => e.id === a.slug || e.slug === a.slug || (e.title ?? "").trim().toLowerCase() === a.title.trim().toLowerCase(),
    );
    if (clash) skip.push({ slug: a.slug, reason: `already exists as courses/${clash.id}` });
    else create.push(a);
  }
  return { create, skip };
}

/**
 * Firestore fields for a new main course record, taken ONLY from the approved
 * catalogue entry and matching exactly what the public site shows for it today
 * (published, same availability; no stored pricing, so the academy's confirmed
 * rates still apply). Timestamps are added by the caller.
 */
export function mainCourseFields(a: ApprovedCourse) {
  return {
    id: a.slug,
    slug: a.slug,
    title: a.title,
    titleMl: "",
    description: a.description,
    descriptionMl: "",
    thumbnailUrl: null,
    thumbnailPublicId: null,
    subtitle: a.subtitle,
    subtitleMl: "",
    level: a.level,
    category: a.category,
    format: "Live Online",
    duration: "",
    ageGroup: a.audience,
    instructor: "",
    price: null,
    originalPrice: null,
    tag: null,
    featured: a.featured,
    outcomes: [...a.content],
    outcomesMl: [],
    prerequisites: [],
    availability: a.availability,
    status: "published",
    teacherIds: [] as string[],
    createdFrom: "approved-catalogue",
  };
}

// --- Batch deletion ----------------------------------------------------------------------------

export interface BatchUsage {
  activeMembers: number;
  /** Membership rows (any status), classes, billing accounts, invoices, registrations … referencing the batch. */
  historyRecords: number;
}

export type BatchDeletion = { kind: "blocked"; reason: string } | { kind: "archive" } | { kind: "delete" };

/**
 * What "Delete batch" may do. Learners still in the batch must be removed or
 * transferred first (an inactive batch never holds learners). A batch with any
 * history is archived (Inactive) so attendance, invoices and payments keep
 * their batch reference; only a batch that was never used is deleted.
 */
export function batchDeletionPlan(usage: BatchUsage): BatchDeletion {
  if (usage.activeMembers > 0) {
    return {
      kind: "blocked",
      reason: `This batch still has ${usage.activeMembers} learner${usage.activeMembers === 1 ? "" : "s"}. Remove or transfer them before deleting the batch.`,
    };
  }
  return usage.historyRecords > 0 ? { kind: "archive" } : { kind: "delete" };
}
