// Course Management rules. PURE: unit-tested, no I/O.
//
// Every course is a Firestore record created by a teacher in the dashboard.
// Nothing here names a real course: there is no hardcoded catalogue, and no
// course slug is treated specially.
//   * Regular Academy Courses: batch / individual classes billed monthly.
//   * Special Programmes (bhajan courses, workshops …): course records with a
//     `programme` object, paid once in full; they never have batches.

export type CourseGroup = "regular" | "programme";

interface Classifiable {
  id: string;
  slug: string;
  status: string;
  programme: unknown;
}

export function courseGroup(course: Pick<Classifiable, "programme">): CourseGroup {
  return course.programme ? "programme" : "regular";
}

/**
 * Course Management grouping: regular courses first, then special programmes.
 * Each group keeps the caller's order (newest first in the dashboard).
 */
export function groupManagedCourses<T extends Pick<Classifiable, "programme">>(courses: readonly T[]) {
  return {
    regular: courses.filter((c) => courseGroup(c) === "regular"),
    programme: courses.filter((c) => courseGroup(c) === "programme"),
  };
}

/**
 * Courses a NEW batch may belong to: any regular course that is not a draft.
 * Special programmes are paid once and have no billing account or batch
 * scheduling, so none are offered. Existing batches keep their course.
 */
export function isBatchEligible(course: Classifiable): boolean {
  return course.status !== "draft" && courseGroup(course) === "regular";
}

/** "Choose a course" options for a new batch: eligible courses, by title. */
export function courseOptionsFrom(courses: readonly (Classifiable & { title: string })[]): { id: string; title: string }[] {
  return courses
    .filter(isBatchEligible)
    .map((c) => ({ id: c.id, title: c.title || c.slug || c.id }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// --- Course deletion -----------------------------------------------------------------------------

/**
 * Records that tie a course to students or money. Any of them means the
 * course has history that must be kept (attendance, invoices, payments,
 * receipts): it is archived instead of deleted.
 */
export interface CourseUsage {
  enrollments: number;
  batches: number;
  registrations: number;
  billingAccounts: number;
  payments: number;
  packages: number;
  submissions: number;
  reviews: number;
}

export type CourseDeletion = { kind: "blocked"; reason: string } | { kind: "delete" };

const USAGE_LABELS: Record<keyof CourseUsage, [string, string]> = {
  enrollments: ["student enrolment", "student enrolments"],
  batches: ["batch", "batches"],
  registrations: ["registration", "registrations"],
  billingAccounts: ["billing account", "billing accounts"],
  payments: ["payment record", "payment records"],
  packages: ["package", "packages"],
  submissions: ["practice submission", "practice submissions"],
  reviews: ["review", "reviews"],
};

/**
 * What "Delete course" may do. A course that was never used by a student
 * (no enrolments, batches, registrations, billing accounts, payments,
 * packages, submissions or reviews — classes and invoices hang off batches
 * and billing accounts) is deleted with its modules, lessons and uploaded
 * media. Anything else is refused with the reason, and the teacher is pointed
 * to Archive, which keeps every student and payment record intact.
 */
export function courseDeletionPlan(usage: CourseUsage): CourseDeletion {
  const used = (Object.keys(USAGE_LABELS) as (keyof CourseUsage)[])
    .filter((key) => usage[key] > 0)
    .map((key) => `${usage[key]} ${USAGE_LABELS[key][usage[key] === 1 ? 0 : 1]}`);
  if (used.length === 0) return { kind: "delete" };
  return {
    kind: "blocked",
    reason: `This course cannot be deleted because it has ${used.join(", ")}. Archive it instead: archiving hides it from the website and keeps every student and payment record.`,
  };
}

/**
 * Cloudinary assets a course OWNS: only files inside the course's own upload
 * folder (`<root>/courses/<courseId>/`). Uploads are never shared between
 * courses (duplicating a course does not copy uploaded files), so these can be
 * deleted with the course without breaking any other record.
 */
export function ownedAssets(
  courseFolder: string,
  assets: readonly { publicId: string | null | undefined; resourceType: string | null | undefined }[],
): { publicId: string; resourceType: "image" | "video" | "raw" }[] {
  const prefix = `${courseFolder.replace(/\/+$/, "")}/`;
  const seen = new Set<string>();
  const owned: { publicId: string; resourceType: "image" | "video" | "raw" }[] = [];
  for (const a of assets) {
    if (!a.publicId || !a.publicId.startsWith(prefix)) continue;
    if (a.resourceType !== "image" && a.resourceType !== "video" && a.resourceType !== "raw") continue;
    if (seen.has(a.publicId)) continue;
    seen.add(a.publicId);
    owned.push({ publicId: a.publicId, resourceType: a.resourceType });
  }
  return owned;
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
