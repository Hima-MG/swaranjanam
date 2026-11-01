import "server-only";

import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { getPublishedCourseBySlug } from "@/lib/catalog/server";
import { accountIdFor } from "@/lib/lms/class-billing";
import { AccessError } from "@/lib/lms/server/access";
import { mapAccount, type BillingAccountRecord } from "@/lib/lms/server/class-billing";
import { col, db, mapEnrollment, toIso } from "@/lib/lms/server/db";
import { enrollmentId } from "@/lib/lms/types";
import { cleanText } from "@/lib/lms/validation";
import type { CourseDetail } from "@/types/course";

// Website enrolment (student self-service), built on the EXISTING billing
// sequence — nothing here creates a billing account, a charge or a payment:
//
//  1. A signed-in student asks to join an OPEN course as a batch or an
//     individual learner → enrolmentRequests/{studentId}_{slug} (one per
//     student and course; repeated submits are idempotent).
//  2. A teacher handles the request with the existing tools: verifies the
//     student's old dues, enrols them in the course, adds them to a batch
//     (which opens the batch billing account with the ₹400 advance) or opens
//     an individual account.
//  3. The student then pays the advance — or each individual session — with
//     the existing Razorpay Test Mode flow (server-created order, signature +
//     payment lookup, webhook, idempotent recording, test-mode isolation).
//
// Paying before a teacher has placed the student would need a billing account
// before old-dues verification and batch assignment, i.e. a change to the
// billing sequence; that is deliberately not done here.

export const ENROLMENT_MODES = ["batch", "individual"] as const;
export type EnrolmentMode = (typeof ENROLMENT_MODES)[number];
export const ENROLMENT_MODE_LABELS: Record<EnrolmentMode, string> = {
  batch: "Batch class (up to 5 students)",
  individual: "Individual class (one-to-one)",
};

export const ENROLMENT_REQUEST_STATUSES = ["pending", "handled", "declined"] as const;
export type EnrolmentRequestStatus = (typeof ENROLMENT_REQUEST_STATUSES)[number];
export const ENROLMENT_REQUEST_STATUS_LABELS: Record<EnrolmentRequestStatus, string> = {
  pending: "Waiting for the academy",
  handled: "Handled by the academy",
  declined: "Declined",
};

export interface EnrolmentRequestRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail: string | null;
  courseSlug: string;
  courseId: string;
  courseTitle: string;
  mode: EnrolmentMode;
  note: string;
  status: EnrolmentRequestStatus;
  createdAt: string | null;
  updatedAt: string | null;
  resolvedNote: string | null;
}

export const enrolmentRequestId = (studentId: string, slug: string) => `${studentId}_${slug}`;

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

export function mapEnrolmentRequest(snap: DocumentSnapshot): EnrolmentRequestRecord | null {
  const d = snap.data();
  if (!d) return null;
  return {
    id: snap.id,
    studentId: String(d.studentId ?? ""),
    studentName: String(d.studentName ?? ""),
    studentEmail: typeof d.studentEmail === "string" ? d.studentEmail : null,
    courseSlug: String(d.courseSlug ?? ""),
    courseId: String(d.courseId ?? ""),
    courseTitle: String(d.courseTitle ?? ""),
    mode: oneOf(ENROLMENT_MODES, d.mode, "batch"),
    note: String(d.note ?? ""),
    status: oneOf(ENROLMENT_REQUEST_STATUSES, d.status, "pending"),
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
    resolvedNote: typeof d.resolvedNote === "string" ? d.resolvedNote : null,
  };
}

const SLUG = /^[a-z0-9-]{1,80}$/;

/** The publicly listed course a student may enrol in, or an AccessError. Server-checked, never trusted from the form. */
export async function openCourseForEnrolment(slug: unknown): Promise<CourseDetail> {
  if (typeof slug !== "string" || !SLUG.test(slug)) throw new AccessError("That course could not be found.");
  const result = await getPublishedCourseBySlug(slug);
  if (!result.ok) throw new Error("Course catalogue unavailable");
  const course = result.data;
  if (!course) throw new AccessError("That course could not be found.");
  if (course.availability !== "open") throw new AccessError(`${course.title} is coming soon and not yet open for enrolment.`);
  return course;
}

/**
 * Records (or re-opens) the signed-in student's enrolment request for an open
 * course. Idempotent: a second submit while a request is pending changes nothing.
 */
export async function createEnrolmentRequest(
  user: SessionUser,
  input: { slug: unknown; mode: unknown; note: unknown },
): Promise<{ outcome: "created" | "already_pending" | "reopened"; requestId: string }> {
  if (user.role !== "student") throw new AccessError("Only student accounts can enrol in a course.");
  const course = await openCourseForEnrolment(input?.slug);
  if (!ENROLMENT_MODES.includes(input?.mode as EnrolmentMode)) {
    throw new AccessError("Please fix the highlighted fields.", { mode: "Choose batch or individual classes." });
  }
  const mode = input.mode as EnrolmentMode;
  const note = cleanText(input?.note, 300);
  const ref = col("enrolmentRequests").doc(enrolmentRequestId(user.uid, course.slug));
  const accountRef = col("billingAccounts").doc(accountIdFor(user.uid, course.id, mode));

  const outcome = await db().runTransaction(async (tx) => {
    const [existing, accountSnap] = await Promise.all([tx.get(ref), tx.get(accountRef)]);
    const account = mapAccount(accountSnap);
    if (account && account.status === "active") {
      throw new AccessError("You are already enrolled for this course. Your fees and payments are on your billing page.");
    }
    const entry = { at: Timestamp.now(), by: user.uid, change: `Requested ${mode} classes${note ? `: ${note}` : ""}` };
    if (existing.exists && existing.get("status") === "pending") return "already_pending" as const;
    const fields = {
      studentId: user.uid,
      studentName: user.name ?? user.email ?? "Student",
      studentEmail: user.email ?? null,
      courseSlug: course.slug,
      courseId: course.id,
      courseTitle: course.title,
      mode,
      note,
      status: "pending" satisfies EnrolmentRequestStatus,
      resolvedNote: null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (existing.exists) {
      tx.update(ref, { ...fields, history: FieldValue.arrayUnion(entry) });
      return "reopened" as const;
    }
    tx.create(ref, { ...fields, createdAt: FieldValue.serverTimestamp(), history: [entry] });
    return "created" as const;
  });
  return { outcome, requestId: ref.id };
}

export interface EnrolmentState {
  request: EnrolmentRequestRecord | null;
  /** Active course enrolment (course access). */
  enrolled: boolean;
  batch: BillingAccountRecord | null;
  individual: BillingAccountRecord | null;
}

/** Everything the student's enrolment page needs about their own enrolment in one course. */
export async function getOwnEnrolmentState(user: SessionUser, course: Pick<CourseDetail, "id" | "slug">): Promise<EnrolmentState> {
  const [requestSnap, enrollmentSnap, batchSnap, individualSnap] = await db().getAll(
    col("enrolmentRequests").doc(enrolmentRequestId(user.uid, course.slug)),
    col("enrollments").doc(enrollmentId(course.id, user.uid)),
    col("billingAccounts").doc(accountIdFor(user.uid, course.id, "batch")),
    col("billingAccounts").doc(accountIdFor(user.uid, course.id, "individual")),
  );
  const enrollment = mapEnrollment(enrollmentSnap);
  return {
    request: mapEnrolmentRequest(requestSnap),
    enrolled: enrollment?.status === "active",
    batch: mapAccount(batchSnap),
    individual: mapAccount(individualSnap),
  };
}

// --- Teacher side ---------------------------------------------------------------------------------

export async function listEnrolmentRequests(): Promise<EnrolmentRequestRecord[]> {
  const snap = await col("enrolmentRequests").get();
  const rank: Record<EnrolmentRequestStatus, number> = { pending: 0, handled: 1, declined: 2 };
  return snap.docs
    .map(mapEnrolmentRequest)
    .filter((r): r is EnrolmentRequestRecord => r !== null)
    .sort((a, b) => rank[a.status] - rank[b.status] || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Marks a request handled or declined. Billing and enrolment are changed only with the existing teacher tools. */
export async function resolveEnrolmentRequest(user: SessionUser, requestId: unknown, status: unknown, note: unknown): Promise<EnrolmentRequestRecord> {
  if (user.role !== "teacher") throw new AccessError("Only the academy can handle enrolment requests.");
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(requestId)) throw new AccessError("That request could not be found.");
  if (status !== "handled" && status !== "declined") throw new AccessError("Choose handled or declined.");
  const reason = cleanText(note, 300);
  if (status === "declined" && !reason) throw new AccessError("Please fix the highlighted fields.", { note: "Tell the student why." });
  const ref = col("enrolmentRequests").doc(requestId);
  return db().runTransaction(async (tx) => {
    const request = mapEnrolmentRequest(await tx.get(ref));
    if (!request) throw new AccessError("That request could not be found.");
    tx.update(ref, {
      status,
      resolvedNote: reason || null,
      updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion({ at: Timestamp.now(), by: user.uid, change: `${status === "handled" ? "Handled" : "Declined"}${reason ? `: ${reason}` : ""}` }),
    });
    return { ...request, status, resolvedNote: reason || null };
  });
}
