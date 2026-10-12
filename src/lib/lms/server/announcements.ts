import "server-only";

import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { col, mapEnrollment, toIso } from "@/lib/lms/server/db";
import type { EnrollmentRecord } from "@/lib/lms/types";

// Announcements to students. `courseId` null = every student; otherwise only
// students with ACTIVE access to that course see it.

export interface AnnouncementRecord {
  id: string;
  title: string;
  titleMl: string;
  body: string;
  bodyMl: string;
  courseId: string | null;
  published: boolean;
  pinned: boolean;
  createdByEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function mapAnnouncement(snapshot: DocumentSnapshot<DocumentData>): AnnouncementRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id: snapshot.id,
    title: s(d.title),
    titleMl: s(d.titleMl),
    body: s(d.body),
    bodyMl: s(d.bodyMl),
    courseId: typeof d.courseId === "string" && d.courseId ? d.courseId : null,
    published: d.published === true,
    pinned: d.pinned === true,
    createdByEmail: typeof d.createdByEmail === "string" ? d.createdByEmail : null,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}

const newestFirst = (a: AnnouncementRecord, b: AnnouncementRecord) =>
  Number(b.pinned) - Number(a.pinned) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "");

export async function listAnnouncementsForTeacher(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const [snapshot, courses] = await Promise.all([col("announcements").get(), col("courses").select("title").get()]);
  return {
    announcements: snapshot.docs.map(mapAnnouncement).filter((a): a is AnnouncementRecord => a !== null).sort(newestFirst),
    courses: courses.docs.map((d) => ({ id: d.id, title: String(d.get("title") ?? "Course") })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

/** Published announcements this student may see (all-student ones + their active courses). */
export async function listAnnouncementsForStudent(user: SessionUser, limit = 5) {
  if (user.role !== "student") return [];
  const [snapshot, enrollments] = await Promise.all([
    col("announcements").where("published", "==", true).get(),
    col("enrollments").where("studentId", "==", user.uid).get(),
  ]);
  const activeCourses = new Set(
    enrollments.docs
      .map(mapEnrollment)
      .filter((e): e is EnrollmentRecord => e !== null && e.status === "active")
      .map((e) => e.courseId),
  );
  return snapshot.docs
    .map(mapAnnouncement)
    .filter((a): a is AnnouncementRecord => a !== null && a.published && (a.courseId === null || activeCourses.has(a.courseId)))
    .sort(newestFirst)
    .slice(0, limit)
    .map((a) => ({ id: a.id, title: a.title, titleMl: a.titleMl, body: a.body, bodyMl: a.bodyMl, pinned: a.pinned, createdAt: a.createdAt }));
}
