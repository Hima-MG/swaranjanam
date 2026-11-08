"use server";

import { FieldValue } from "firebase-admin/firestore";
import { refresh, updateTag } from "next/cache";

import { CATALOG_TAG } from "@/lib/catalog/server";
import { formatMoney } from "@/lib/format";
import { mapProgramme, parseProgramme, programmeAvailability, PROGRAMME_STATUS_LABELS } from "@/lib/lms/programme";
import { AccessError, authorizeTeacherForCourse, runAction } from "@/lib/lms/server/access";
import { writeAudit } from "@/lib/lms/server/audit";
import { col, db } from "@/lib/lms/server/db";
import { saveProgrammeSessionRecording } from "@/lib/lms/server/recordings";
import type { ActionResult } from "@/lib/lms/types";

// Special Programme settings (teachers of the course only). Additive: a course
// without a `programme` object is a Regular Academy Course and is unchanged.

/** Saves the course as a Special Programme (fee, dates, sessions, limit, materials, status). */
export async function updateCourseProgramme(courseId: unknown, input: Record<string, unknown>): Promise<ActionResult> {
  return runAction("updateCourseProgramme", async () => {
    const { user, course } = await authorizeTeacherForCourse(courseId);
    const ref = col("courses").doc(course.id);
    const value = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const previous = mapProgramme(snap.get("programme"));
      const parsed = parseProgramme(input ?? {}, previous);
      if (!parsed.value) throw new AccessError("Please fix the highlighted fields.", parsed.errors);
      // A course with regular (monthly-billed) students cannot become a programme.
      if (!previous) {
        const accounts = await tx.get(col("billingAccounts").where("courseId", "==", course.id).limit(1));
        if (!accounts.empty) throw new AccessError("This course already has regular students with monthly billing. Create a separate course for the programme.");
      }
      tx.update(ref, { programme: parsed.value, availability: programmeAvailability(parsed.value.status), updatedAt: FieldValue.serverTimestamp() });
      return parsed.value;
    });
    await writeAudit(user, {
      action: "course.programme",
      targetType: "course",
      targetId: course.id,
      summary: `Special Programme "${course.title}": fee ${formatMoney(value.feeMinor)}, ${value.sessions.length} sessions, ${PROGRAMME_STATUS_LABELS[value.status]}`,
    });
    updateTag(CATALOG_TAG);
    refresh();
    return null;
  });
}

/** Adds, changes or removes the YouTube recording of one programme session (registered participants only). */
export async function setProgrammeSessionRecording(courseId: unknown, sessionId: unknown, urlInput: unknown): Promise<ActionResult> {
  return runAction("setProgrammeSessionRecording", async () => {
    const { user, course } = await authorizeTeacherForCourse(courseId);
    const { title, saved } = await saveProgrammeSessionRecording(course.id, sessionId, urlInput);
    await writeAudit(user, {
      action: "course.programme.recording",
      targetType: "course",
      targetId: course.id,
      summary: `Recording ${saved ? "saved" : "removed"} for "${title}" of "${course.title}"`,
    });
    refresh();
    return null;
  });
}
