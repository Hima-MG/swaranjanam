import "server-only";

import { unstable_rethrow } from "next/navigation";

import type { Role } from "@/lib/auth/constants";
import { getSession, type SessionUser } from "@/lib/auth/session";
import { AdminConfigError } from "@/lib/firebase/admin";
import { col, mapEnrollment, readCourse } from "@/lib/lms/server/db";
import { MediaConfigError, MediaValidationError } from "@/lib/media/cloudinary";
import {
  enrollmentId,
  isOpenToEnrolledStudents,
  type ActionResult,
  type CourseRecord,
  type EnrollmentRecord,
} from "@/lib/lms/types";
import { isValidId, type FieldErrors } from "@/lib/lms/validation";

// Authorisation for every LMS read and mutation. The Admin SDK bypasses
// Firestore security rules, so these checks ARE the security boundary:
//   * the teacher role (custom claim, granted only by scripts/set-role.mjs)
//     is the academy administrator: any verified teacher may manage every
//     course, student and payment. `teacherIds` on a course records its
//     instructors for display; it does not restrict access;
//   * students may read lesson content only with an active enrollment in a
//     published course, and only ever their own private records.

/** A refusal whose message is safe to show to the user. */
export class AccessError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

const NOT_FOUND = "That course could not be found, or you do not have access to it.";

/** Session check for Server Actions: never redirects, throws AccessError instead. */
export async function requireActionUser(role: Role): Promise<SessionUser> {
  const user = await getSession(true);
  if (!user) throw new AccessError("Your session has expired. Please sign in again.");
  if (user.role !== role) throw new AccessError("You do not have permission to do that.");
  return user;
}

/** Teachers administer the whole academy (see the note above). */
export function canManageCourses(user: SessionUser): boolean {
  return user.role === "teacher";
}

/** Loads a course for a teacher, or null (callers render notFound / return an error). */
export async function getManagedCourse(user: SessionUser, courseId: string): Promise<CourseRecord | null> {
  if (!isValidId(courseId) || !canManageCourses(user)) return null;
  return readCourse(courseId);
}

/** For teacher Server Actions: verified session + teacher role + existing course. */
export async function authorizeTeacherForCourse(courseId: unknown) {
  const user = await requireActionUser("teacher");
  if (!isValidId(courseId)) throw new AccessError(NOT_FOUND);
  const course = await getManagedCourse(user, courseId);
  if (!course) throw new AccessError(NOT_FOUND);
  return { user, course };
}

export async function getActiveEnrollment(studentId: string, courseId: string): Promise<EnrollmentRecord | null> {
  if (!isValidId(courseId)) return null;
  const enrollment = mapEnrollment(await col("enrollments").doc(enrollmentId(courseId, studentId)).get());
  return enrollment?.status === "active" ? enrollment : null;
}

/**
 * Student access to a course's content: active enrollment AND a published
 * (or archived) course. Returns null otherwise; it never reveals which check failed.
 */
export async function getStudentCourseAccess(user: SessionUser, courseId: string) {
  if (user.role !== "student" || !isValidId(courseId)) return null;
  const [course, enrollment] = await Promise.all([
    readCourse(courseId),
    getActiveEnrollment(user.uid, courseId),
  ]);
  if (!course || !enrollment || !isOpenToEnrolledStudents(course.status)) return null;
  return { course, enrollment };
}

/** For student Server Actions. */
export async function authorizeStudentForCourse(courseId: unknown) {
  const user = await requireActionUser("student");
  const access = typeof courseId === "string" ? await getStudentCourseAccess(user, courseId) : null;
  if (!access) throw new AccessError("You are not enrolled in this course.");
  return { user, ...access };
}

/**
 * Runs a Server Action body and converts failures into an ActionResult.
 * Expected refusals carry their own message; anything else is logged by
 * name only and reported generically.
 */
export async function runAction<T>(label: string, body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await body() };
  } catch (error) {
    // Let redirect()/notFound() from an action body reach Next.js.
    unstable_rethrow(error);
    if (error instanceof AccessError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof MediaValidationError) return { ok: false, error: error.message };
    if (error instanceof MediaConfigError || error instanceof AdminConfigError) {
      console.error(`[lms] ${label}: server is not configured:`, error.message);
      return { ok: false, error: "This feature is not configured on the server yet. Please contact the site administrator." };
    }
    console.error(`[lms] ${label} failed:`, (error as Error)?.name, (error as Error)?.message);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
