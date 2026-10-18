import "server-only";

import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import { cacheLife, cacheTag } from "next/cache";

import type { SessionUser } from "@/lib/auth/session";
import { col, mapEnrollment, toIso } from "@/lib/lms/server/db";
import {
  ANONYMOUS_NAME,
  isPublishable,
  NAME_DISPLAYS,
  TESTIMONIAL_STATUSES,
  toPublicTestimonial,
  type NameDisplay,
  type PublicTestimonial,
  type TestimonialRecord,
  type TestimonialStatus,
} from "@/lib/lms/testimonials";
import type { EnrollmentRecord } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Testimonials read models.
//  * Students only ever get their own submissions (query bound to user.uid).
//  * Teachers get the moderation list.
//  * The public site gets PublicTestimonial objects (quote, chosen name,
//    course title) for approved + consented testimonials only — never ids,
//    emails or anything else about the student. Cached under TESTIMONIALS_TAG;
//    every moderation and withdrawal calls updateTag(TESTIMONIALS_TAG).

export const TESTIMONIALS_TAG = "testimonials";

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function mapTestimonial(snapshot: DocumentSnapshot<DocumentData>): TestimonialRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  return {
    id: snapshot.id,
    studentId: String(d.studentId ?? ""),
    courseId: isValidId(d.courseId) ? d.courseId : null,
    courseTitle: str(d.courseTitle),
    text: String(d.text ?? ""),
    nameDisplay: ((NAME_DISPLAYS as readonly unknown[]).includes(d.nameDisplay) ? d.nameDisplay : "anonymous") as NameDisplay,
    publicName: str(d.publicName) ?? ANONYMOUS_NAME,
    // Anything other than an explicit true is treated as no consent.
    consent: d.consent === true,
    // Unknown statuses are never treated as approved.
    status: ((TESTIMONIAL_STATUSES as readonly unknown[]).includes(d.status) ? d.status : "pending") as TestimonialStatus,
    moderationNote: str(d.moderationNote),
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
    moderatedAt: toIso(d.moderatedAt),
    publishedAt: toIso(d.publishedAt),
  };
}

/** The signed-in student's own submissions, plus the courses they may write about. */
export async function getOwnTestimonials(user: SessionUser) {
  if (user.role !== "student") return { testimonials: [] as TestimonialRecord[], courses: [] as { id: string; title: string }[] };
  const [snapshot, enrollments] = await Promise.all([
    col("testimonials").where("studentId", "==", user.uid).get(),
    col("enrollments").where("studentId", "==", user.uid).get(),
  ]);
  const active = enrollments.docs.map(mapEnrollment).filter((e): e is EnrollmentRecord => e?.status === "active");
  const courses = active.length
    ? (await Promise.all(active.map((e) => col("courses").doc(e.courseId).get())))
        .filter((s) => s.exists)
        .map((s) => ({ id: s.id, title: String(s.get("title") ?? "Course") }))
        .sort((a, b) => a.title.localeCompare(b.title))
    : [];
  return {
    testimonials: snapshot.docs
      .map(mapTestimonial)
      .filter((t): t is TestimonialRecord => t !== null && t.studentId === user.uid)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    courses,
  };
}

export async function listTestimonialsForTeacher(user: SessionUser, status: TestimonialStatus | "any") {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const [snapshot, students] = await Promise.all([
    col("testimonials").get(),
    col("users").where("role", "==", "student").select("displayName", "email").get(),
  ]);
  const names = new Map(students.docs.map((d) => [d.id, { name: str(d.get("displayName")), email: str(d.get("email")) }]));
  const all = snapshot.docs.map(mapTestimonial).filter((t): t is TestimonialRecord => t !== null);
  const counts = Object.fromEntries(TESTIMONIAL_STATUSES.map((s) => [s, all.filter((t) => t.status === s).length])) as Record<TestimonialStatus, number>;
  return {
    counts,
    rows: all
      .filter((t) => status === "any" || t.status === status)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .map((t) => ({ ...t, studentName: names.get(t.studentId)?.name ?? names.get(t.studentId)?.email ?? "Unknown student" })),
  };
}

/** Approved, consented testimonials for the public site. Returns [] on failure (nothing invented). */
export async function getPublicTestimonials(limit = 6): Promise<PublicTestimonial[]> {
  "use cache";
  cacheTag(TESTIMONIALS_TAG);
  try {
    const snapshot = await col("testimonials").where("status", "==", "approved").get();
    cacheLife("hours");
    return snapshot.docs
      .map(mapTestimonial)
      .filter((t): t is TestimonialRecord => t !== null && isPublishable(t))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
      .slice(0, limit)
      .map(toPublicTestimonial);
  } catch (error) {
    console.error("[testimonials] public read failed:", (error as Error)?.name);
    cacheLife("seconds");
    return [];
  }
}
