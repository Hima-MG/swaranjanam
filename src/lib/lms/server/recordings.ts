import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import type { LiveClassRecord } from "@/lib/lms/classes";
import { mapProgramme } from "@/lib/lms/programme";
import { parseYouTubeVideoId, RECORDING_URL_ERROR } from "@/lib/lms/recordings";
import { AccessError, getStudentCourseAccess } from "@/lib/lms/server/access";
import { mapLiveClass, sessionSiblings } from "@/lib/lms/server/classes";
import { col, db } from "@/lib/lms/server/db";
import { isValidId } from "@/lib/lms/validation";

// Class recordings for students. Never public: the reader requires a signed-in
// student with ACTIVE access to the course (enrolment, not suspended), and only
// returns that student's own class records (studentId == uid) whose batch or
// individual billing account belongs to the course. A Learn Together pair shares
// one login, so both learners see the same recordings.

export interface StudentClassRecording {
  number: number;
  classId: string;
  title: string;
  date: string;
  startAt: string;
  /** Null: not available yet. */
  videoId: string | null;
}

/** The held classes of this course in date order, with their recordings. Null without course access. */
export async function listOwnCourseRecordings(user: SessionUser, courseId: string): Promise<StudentClassRecording[] | null> {
  const access = await getStudentCourseAccess(user, courseId);
  if (!access) return null;
  const snap = await col("liveClasses").where("studentId", "==", user.uid).get();
  const classes = snap.docs
    .map(mapLiveClass)
    .filter((c): c is LiveClassRecord => c !== null && c.studentId === user.uid)
    .filter((c) => c.status === "completed" || (c.status === "cancelled" && c.cancelKind === "student"));
  if (classes.length === 0) return [];

  const batchIds = [...new Set(classes.map((c) => c.batchId).filter((v): v is string => Boolean(v)))];
  const accountIds = [...new Set(classes.map((c) => c.billingAccountId).filter((v): v is string => Boolean(v)))];
  const [batchSnaps, accountSnaps] = await Promise.all([
    batchIds.length ? db().getAll(...batchIds.map((id) => col("batches").doc(id))) : Promise.resolve([]),
    accountIds.length ? db().getAll(...accountIds.map((id) => col("billingAccounts").doc(id))) : Promise.resolve([]),
  ]);
  const ownAccount = new Set(accountSnaps.filter((s) => s.exists && s.get("studentId") === user.uid && s.get("courseId") === courseId).map((s) => s.id));
  const courseBatch = new Set(batchSnaps.filter((s) => s.exists && s.get("courseId") === courseId).map((s) => s.id));

  return classes
    .filter((c) => (c.batchId ? courseBatch.has(c.batchId) : c.billingAccountId ? ownAccount.has(c.billingAccountId) : false))
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((c, i) => ({ number: i + 1, classId: c.id, title: c.title, date: c.date, startAt: c.startAt, videoId: c.recordingVideoId }));
}

// --- Teacher writes (called by the teacher Server Actions after the role / course checks) ---------

/** The video id to store, or null to remove; an AccessError for anything that is not an accepted YouTube URL. */
function videoIdFrom(urlInput: unknown): string | null {
  const remove = urlInput === null || (typeof urlInput === "string" && urlInput.trim() === "");
  if (remove) return null;
  const id = parseYouTubeVideoId(urlInput);
  if (!id) throw new AccessError("Please fix the highlighted fields.", { url: RECORDING_URL_ERROR });
  return id;
}

/**
 * Sets the recording of a held class. A batch / pair session has one record per
 * learner: all of them get it (including a learner who cancelled — the academy
 * provides the recording). Only a validated video id is stored.
 */
export async function saveClassRecording(user: SessionUser, classId: unknown, urlInput: unknown) {
  if (user.role !== "teacher") throw new AccessError("Teacher role required.");
  if (!isValidId(classId)) throw new AccessError("That class could not be found.");
  const videoId = videoIdFrom(urlInput);
  return db().runTransaction(async (tx) => {
    const existing = mapLiveClass(await tx.get(col("liveClasses").doc(classId)));
    if (!existing) throw new AccessError("That class could not be found.");
    const siblings = await sessionSiblings(tx, existing);
    if (!siblings.some((s) => s.record.status === "completed" || (s.record.status === "cancelled" && s.record.cancelKind === "student"))) {
      throw new AccessError("A recording can be added once the class has been held and its outcome recorded.");
    }
    const change = videoId ? `Recording ${existing.recordingVideoId ? "changed" : "added"}` : "Recording removed";
    for (const s of siblings) {
      tx.update(s.ref, {
        recordingVideoId: videoId,
        recordingUpdatedAt: FieldValue.serverTimestamp(),
        recordingUpdatedBy: user.uid,
        history: FieldValue.arrayUnion({ at: Timestamp.now(), by: user.uid, change }),
      });
    }
    return {
      title: existing.title,
      date: existing.date,
      studentId: existing.studentId,
      change,
      records: siblings.length,
      videoId,
      targets: siblings.map((s) => ({ classId: s.ref.id, studentId: s.record.studentId, accountId: s.record.billingAccountId })),
    };
  });
}

/** Sets the recording of one programme session (the caller has checked the teacher manages the course). */
export async function saveProgrammeSessionRecording(courseId: string, sessionId: unknown, urlInput: unknown) {
  if (typeof sessionId !== "string" || !/^\d{4}-\d{2}-\d{2}_\d{4}$/.test(sessionId)) throw new AccessError("That session could not be found.");
  const videoId = videoIdFrom(urlInput);
  const ref = col("courses").doc(courseId);
  return db().runTransaction(async (tx) => {
    const programme = mapProgramme((await tx.get(ref)).get("programme"));
    const session = programme?.sessions.find((s) => s.id === sessionId);
    if (!programme || !session) throw new AccessError("That session could not be found.");
    const sessions = programme.sessions.map((s) => (s.id === sessionId ? { ...s, recordingVideoId: videoId } : s));
    tx.update(ref, { "programme.sessions": sessions, updatedAt: FieldValue.serverTimestamp() });
    return { title: `${session.title} (${session.date})`, saved: videoId !== null };
  });
}

/** Programme session recordings for a registered participant (active enrolment). Null without access. */
export async function listOwnProgrammeRecordings(user: SessionUser, courseId: string) {
  const access = await getStudentCourseAccess(user, courseId);
  if (!access?.course.programme) return null;
  return access.course.programme.sessions.map((s, i) => ({ number: i + 1, sessionId: s.id, title: s.title, date: s.date, start: s.start, videoId: s.recordingVideoId }));
}
