"use server";

import { FieldValue } from "firebase-admin/firestore";
import { refresh } from "next/cache";

import { AccessError, authorizeStudentForCourse, runAction } from "@/lib/lms/server/access";
import { col } from "@/lib/lms/server/db";
import { progressId, type ActionResult } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Student progress. Each action re-checks the session, an active enrollment
// and that the lesson belongs to the course. Students can only ever write
// their own progress (the document id is derived from the session uid).

/** Student activity signal for the teacher dashboard (active/inactive learners). */
function touchActivity(uid: string) {
  return col("users").doc(uid).set({ lastActiveAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function assertLessonInCourse(courseId: string, lessonId: unknown): Promise<string> {
  if (!isValidId(lessonId)) throw new AccessError("That lesson could not be found.");
  const lesson = await col("lessons").doc(lessonId).get();
  if (!lesson.exists || lesson.get("courseId") !== courseId) {
    throw new AccessError("That lesson could not be found.");
  }
  return lessonId;
}

export async function setLessonCompleted(
  courseId: string,
  lessonId: string,
  completed: boolean,
): Promise<ActionResult> {
  return runAction("setLessonCompleted", async () => {
    const { user, course } = await authorizeStudentForCourse(courseId);
    const id = await assertLessonInCourse(course.id, lessonId);
    await col("lessonProgress")
      .doc(progressId(user.uid, id))
      .set(
        {
          studentId: user.uid,
          courseId: course.id,
          lessonId: id,
          completed: completed === true,
          completedAt: completed === true ? FieldValue.serverTimestamp() : null,
          lastAccessedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    await touchActivity(user.uid);
    refresh();
    return null;
  });
}

/** Records that the lesson was opened, for "Continue learning". Does not re-render. */
export async function recordLessonAccess(courseId: string, lessonId: string): Promise<ActionResult> {
  return runAction("recordLessonAccess", async () => {
    const { user, course } = await authorizeStudentForCourse(courseId);
    const id = await assertLessonInCourse(course.id, lessonId);
    await col("lessonProgress")
      .doc(progressId(user.uid, id))
      .set(
        { studentId: user.uid, courseId: course.id, lessonId: id, lastAccessedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    await touchActivity(user.uid);
    return null;
  });
}
