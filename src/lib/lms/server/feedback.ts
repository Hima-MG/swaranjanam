import "server-only";

import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { col, db, toIso } from "@/lib/lms/server/db";
import {
  REVIEW_STATUSES,
  SUBMISSION_STATUSES,
  reviewId,
  type ReviewRecord,
  type ReviewStatus,
  type SubmissionAttempt,
  type SubmissionFeedback,
  type SubmissionRecord,
  type SubmissionStatus,
} from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Read models for practice submissions and course reviews.
//  * Student functions only ever return the signed-in student's own records.
//  * Teacher functions require the teacher role.
// Ratings and counts come only from submitted reviews — nothing is invented.

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function mapSubmission(snapshot: DocumentSnapshot<DocumentData>): SubmissionRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  const attempts: SubmissionAttempt[] = Array.isArray(d.attempts)
    ? d.attempts.map((a: Record<string, unknown>) => ({
        number: Number(a.number) || 0,
        kind: a.kind === "video" ? "video" : "audio",
        url: String(a.url ?? ""),
        publicId: String(a.publicId ?? ""),
        format: str(a.format),
        bytes: typeof a.bytes === "number" ? a.bytes : null,
        fileName: str(a.fileName),
        note: str(a.note),
        submittedAt: toIso(a.submittedAt),
      }))
    : [];
  const feedback: SubmissionFeedback[] = Array.isArray(d.feedback)
    ? d.feedback.map((f: Record<string, unknown>) => ({
        attempt: Number(f.attempt) || 0,
        status: f.status === "needs_revision" ? "needs_revision" : "reviewed",
        text: String(f.text ?? ""),
        byEmail: str(f.byEmail),
        byName: str(f.byName),
        at: toIso(f.at),
      }))
    : [];
  return {
    id: snapshot.id,
    studentId: String(d.studentId ?? ""),
    courseId: String(d.courseId ?? ""),
    moduleId: str(d.moduleId),
    lessonId: str(d.lessonId),
    title: String(d.title ?? "Practice"),
    status: ((SUBMISSION_STATUSES as readonly string[]).includes(d.status) ? d.status : "pending_review") as SubmissionStatus,
    attempts: attempts.sort((a, b) => a.number - b.number),
    feedback: feedback.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "")),
    createdAt: toIso(d.createdAt),
    lastSubmittedAt: toIso(d.lastSubmittedAt),
    reviewedAt: toIso(d.reviewedAt),
  };
}

export function mapReview(snapshot: DocumentSnapshot<DocumentData>): ReviewRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  const rating = Number(d.rating);
  return {
    id: snapshot.id,
    courseId: String(d.courseId ?? ""),
    studentId: String(d.studentId ?? ""),
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0,
    comment: String(d.comment ?? ""),
    status: ((REVIEW_STATUSES as readonly string[]).includes(d.status) ? d.status : "pending") as ReviewStatus,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
    moderatedByEmail: str(d.moderatedByEmail),
    moderatedAt: toIso(d.moderatedAt),
    moderationNote: str(d.moderationNote),
  };
}

function assertTeacher(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
}

async function lookups() {
  const [courses, lessons, students] = await Promise.all([
    col("courses").select("title").get(),
    col("lessons").select("title").get(),
    col("users").where("role", "==", "student").select("displayName", "email").get(),
  ]);
  return {
    courseTitle: new Map(courses.docs.map((d) => [d.id, String(d.get("title") ?? "Course")])),
    lessonTitle: new Map(lessons.docs.map((d) => [d.id, String(d.get("title") ?? "Lesson")])),
    student: new Map(
      students.docs.map((d) => [
        d.id,
        { name: str(d.get("displayName")), email: str(d.get("email")) },
      ]),
    ),
  };
}

// --- Student (own records only) -------------------------------------------------------

export async function listOwnSubmissions(user: SessionUser, courseId: string, lessonId?: string) {
  if (user.role !== "student" || !isValidId(courseId)) return [];
  let query = col("submissions").where("studentId", "==", user.uid).where("courseId", "==", courseId);
  if (lessonId && isValidId(lessonId)) query = query.where("lessonId", "==", lessonId);
  const snapshot = await query.get();
  return snapshot.docs
    .map(mapSubmission)
    .filter((s): s is SubmissionRecord => s !== null && s.studentId === user.uid)
    .sort((a, b) => (b.lastSubmittedAt ?? "").localeCompare(a.lastSubmittedAt ?? ""));
}

export async function getOwnReview(user: SessionUser, courseId: string) {
  if (user.role !== "student" || !isValidId(courseId)) return null;
  const review = mapReview(await col("reviews").doc(reviewId(courseId, user.uid)).get());
  return review && review.studentId === user.uid ? review : null;
}

// --- Teacher ---------------------------------------------------------------------------

export interface SubmissionFilters {
  status: SubmissionStatus | "any";
  course: string | null;
  q: string;
}

export function parseSubmissionFilters(params: Record<string, string | string[] | undefined>): SubmissionFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(params.status);
  const course = one(params.course);
  return {
    // The review queue opens on what needs attention.
    status: status === "any" ? "any" : (SUBMISSION_STATUSES as readonly string[]).includes(status) ? (status as SubmissionStatus) : "pending_review",
    course: isValidId(course) ? course : null,
    q: one(params.q).trim().slice(0, 100),
  };
}

export async function listSubmissions(user: SessionUser, filters: SubmissionFilters) {
  assertTeacher(user);
  const [snapshot, names] = await Promise.all([col("submissions").get(), lookups()]);
  const needle = filters.q.toLowerCase();
  const all = snapshot.docs.map(mapSubmission).filter((s): s is SubmissionRecord => s !== null);
  const rows = all
    .map((s) => {
      const student = names.student.get(s.studentId);
      return {
        ...s,
        studentName: student?.name ?? student?.email ?? "Unknown student",
        courseTitle: names.courseTitle.get(s.courseId) ?? "Deleted course",
        lessonTitle: s.lessonId ? names.lessonTitle.get(s.lessonId) ?? "Deleted lesson" : null,
      };
    })
    .filter((s) => {
      if (filters.status !== "any" && s.status !== filters.status) return false;
      if (filters.course && s.courseId !== filters.course) return false;
      if (needle && !`${s.studentName} ${s.title} ${s.lessonTitle ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    })
    // Oldest waiting first, so nobody is forgotten.
    .sort((a, b) =>
      filters.status === "pending_review"
        ? (a.lastSubmittedAt ?? "").localeCompare(b.lastSubmittedAt ?? "")
        : (b.lastSubmittedAt ?? "").localeCompare(a.lastSubmittedAt ?? ""),
    );
  return {
    rows,
    counts: {
      pending_review: all.filter((s) => s.status === "pending_review").length,
      needs_revision: all.filter((s) => s.status === "needs_revision").length,
      reviewed: all.filter((s) => s.status === "reviewed").length,
    },
    courses: [...names.courseTitle.entries()].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export async function getSubmissionForTeacher(user: SessionUser, submissionId: string) {
  assertTeacher(user);
  if (!isValidId(submissionId)) return null;
  const submission = mapSubmission(await col("submissions").doc(submissionId).get());
  if (!submission) return null;
  const refs = [col("users").doc(submission.studentId), col("courses").doc(submission.courseId)];
  if (submission.lessonId) refs.push(col("lessons").doc(submission.lessonId));
  const [student, course, lesson] = await db().getAll(...refs);
  return {
    submission,
    studentName: str(student?.get("displayName")) ?? str(student?.get("email")) ?? "Unknown student",
    studentEmail: str(student?.get("email")),
    courseTitle: str(course?.get("title")) ?? "Deleted course",
    lessonTitle: lesson ? str(lesson.get("title")) ?? "Deleted lesson" : null,
  };
}

export async function listReviews(user: SessionUser, filters: { status: ReviewStatus | "any"; course: string | null }) {
  assertTeacher(user);
  const [snapshot, names] = await Promise.all([col("reviews").get(), lookups()]);
  const all = snapshot.docs.map(mapReview).filter((r): r is ReviewRecord => r !== null && r.rating > 0);
  const rows = all
    .filter((r) => (filters.status === "any" || r.status === filters.status) && (!filters.course || r.courseId === filters.course))
    .map((r) => {
      const student = names.student.get(r.studentId);
      return {
        ...r,
        studentName: student?.name ?? student?.email ?? "Unknown student",
        courseTitle: names.courseTitle.get(r.courseId) ?? "Deleted course",
      };
    })
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return {
    rows,
    counts: {
      pending: all.filter((r) => r.status === "pending").length,
      approved: all.filter((r) => r.status === "approved").length,
      hidden: all.filter((r) => r.status === "hidden").length,
    },
    ratings: ratingStats(all),
    courses: [...names.courseTitle.entries()].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

/** Averages from actual submitted reviews, overall and approved-only. */
export function ratingStats(reviews: Pick<ReviewRecord, "rating" | "status">[]) {
  const avg = (list: { rating: number }[]) =>
    list.length ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10 : null;
  const approved = reviews.filter((r) => r.status === "approved");
  return { averageAll: avg(reviews), countAll: reviews.length, averageApproved: avg(approved), countApproved: approved.length };
}

/** Overview counts. */
export async function getFeedbackSummary(user: SessionUser) {
  assertTeacher(user);
  const [submissions, reviews] = await Promise.all([
    col("submissions").where("status", "==", "pending_review").get(),
    col("reviews").where("status", "==", "pending").count().get(),
  ]);
  const pending = submissions.docs.map(mapSubmission).filter((s): s is SubmissionRecord => s !== null);
  return {
    pendingSubmissions: pending.length,
    oldestPendingAt: pending.map((s) => s.lastSubmittedAt).filter((d): d is string => d !== null).sort()[0] ?? null,
    pendingReviews: reviews.data().count,
  };
}
