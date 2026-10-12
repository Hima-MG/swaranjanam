"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh } from "next/cache";

import { TEACHER_CLAIMS } from "@/lib/auth/constants";
import { getAdminAuth } from "@/lib/firebase/admin";
import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { mapLiveClass } from "@/lib/lms/server/classes";
import { col, db } from "@/lib/lms/server/db";
import {
  ACADEMY_TIME_ZONE,
  ATTENDANCE_VALUES,
  formatClassTime,
  normalizeMeetUrl,
  parseClassTimes,
  type Attendance,
} from "@/lib/lms/classes";
import type { ActionResult } from "@/lib/lms/types";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Teacher-only live-class actions. Every action re-verifies the teacher
// session (requireActionUser), validates all input on the server and is
// recorded in the audit log. Students have no action that can create, edit,
// cancel or reschedule a class.

export interface ClassInput {
  studentId: unknown;
  title: unknown;
  date: unknown;
  startTime: unknown;
  endTime: unknown;
  meetUrl: unknown;
  notes: unknown;
}

/** The uid must belong to an existing, enabled STUDENT account with a profile. */
async function assertStudent(studentId: unknown): Promise<{ uid: string; label: string }> {
  const invalid = () => new AccessError("Please fix the highlighted fields.", { studentId: "Choose a registered student." });
  if (!isValidId(studentId)) throw invalid();
  const [profile, account] = await Promise.all([
    col("users").doc(studentId).get(),
    getAdminAuth()
      .getUser(studentId)
      .catch(() => null),
  ]);
  const claim = account?.customClaims?.role;
  if (!profile.exists || !account || account.disabled || (typeof claim === "string" && TEACHER_CLAIMS.includes(claim))) throw invalid();
  return { uid: studentId, label: account.email ?? account.displayName ?? studentId };
}

function parseCommon(input: ClassInput) {
  const errors: Record<string, string> = {};
  const title = cleanText(input?.title, 120);
  if (!title) errors.title = "Enter a class title or subject.";
  const meetUrl = normalizeMeetUrl(input?.meetUrl);
  if (!meetUrl) errors.meetUrl = "Enter a Google Meet link like https://meet.google.com/abc-defg-hij";
  const notes = cleanText(input?.notes, 1000) || null;
  return { title, meetUrl, notes, errors };
}

export async function scheduleClass(input: ClassInput): Promise<ActionResult<{ classId: string }>> {
  return runAction("scheduleClass", async () => {
    const user = await requireActionUser("teacher");
    const common = parseCommon(input);
    const times = parseClassTimes(input, Date.now());
    const errors = { ...common.errors, ...(times.ok ? {} : times.errors) };
    if (Object.keys(errors).length || !times.ok) throw new AccessError("Please fix the highlighted fields.", errors);
    const student = await assertStudent(input?.studentId);

    const ref = col("liveClasses").doc();
    await ref.create({
      studentId: student.uid,
      title: common.title,
      startAt: Timestamp.fromDate(times.start),
      endAt: Timestamp.fromDate(times.end),
      timeZone: ACADEMY_TIME_ZONE,
      date: times.date,
      startTime: times.startTime,
      endTime: times.endTime,
      meetUrl: common.meetUrl,
      notes: common.notes,
      status: "scheduled",
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      attendance: null,
      outcomeNote: null,
      outcomeRecordedAt: null,
      outcomeRecordedBy: null,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
      updatedByEmail: user.email,
      updatedAt: FieldValue.serverTimestamp(),
      history: [{ at: Timestamp.now(), by: user.uid, change: `Scheduled for ${times.date} ${times.startTime}–${times.endTime} IST` }],
    });
    await writeAudit(user, {
      action: "class.schedule",
      targetType: "student",
      targetId: student.uid,
      summary: `Scheduled "${common.title}" for ${student.label} on ${formatClassTime(times.start.toISOString(), times.end.toISOString())}`,
    });
    refresh();
    return { classId: ref.id };
  });
}

/**
 * Edit details and/or reschedule. Only scheduled classes can be edited. If the
 * date/time is unchanged a class that has already started may still have its
 * title, link or notes corrected; a new time must not be in the past.
 */
export async function updateClass(classId: unknown, input: ClassInput): Promise<ActionResult> {
  return runAction("updateClass", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(classId)) throw new AccessError("That class could not be found.");
    const ref = col("liveClasses").doc(classId);
    const existing = mapLiveClass(await ref.get());
    if (!existing) throw new AccessError("That class could not be found.");
    if (existing.status !== "scheduled") throw new AccessError(`A ${existing.status} class cannot be edited.`);

    const common = parseCommon(input);
    const timeUnchanged =
      input?.date === existing.date && input?.startTime === existing.startTime && input?.endTime === existing.endTime;
    const times = parseClassTimes(input, Date.now(), timeUnchanged);
    const errors = { ...common.errors, ...(times.ok ? {} : times.errors) };
    if (Object.keys(errors).length || !times.ok) throw new AccessError("Please fix the highlighted fields.", errors);
    const student = input?.studentId === existing.studentId ? { uid: existing.studentId, label: existing.studentId } : await assertStudent(input?.studentId);

    // History is computed from the record read INSIDE the transaction, so a
    // concurrent edit can never leave a stale "from" value in the history.
    const { changes, rescheduled, reassigned } = await db().runTransaction(async (tx) => {
      const fresh = mapLiveClass(await tx.get(ref));
      if (!fresh || fresh.status !== "scheduled") throw new AccessError("This class changed. Please reload the page.");
      const rescheduled = fresh.date !== times.date || fresh.startTime !== times.startTime || fresh.endTime !== times.endTime;
      const reassigned = student.uid !== fresh.studentId;
      const changes = [
        rescheduled ? `Rescheduled from ${fresh.date} ${fresh.startTime}–${fresh.endTime} to ${times.date} ${times.startTime}–${times.endTime} IST` : null,
        reassigned ? `Moved from student ${fresh.studentId} to ${student.label}` : null,
      ].filter((c): c is string => c !== null);
      tx.update(ref, {
        studentId: student.uid,
        title: common.title,
        startAt: Timestamp.fromDate(times.start),
        endAt: Timestamp.fromDate(times.end),
        date: times.date,
        startTime: times.startTime,
        endTime: times.endTime,
        meetUrl: common.meetUrl,
        notes: common.notes,
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: FieldValue.serverTimestamp(),
        ...(changes.length
          ? { history: FieldValue.arrayUnion(...changes.map((change) => ({ at: Timestamp.now(), by: user.uid, change }))) }
          : {}),
      });
      return { changes, rescheduled, reassigned };
    });
    await writeAudit(user, {
      action: reassigned ? "class.reassign" : rescheduled ? "class.reschedule" : "class.update",
      targetType: "student",
      targetId: student.uid,
      summary: changes.length
        ? `"${common.title}": ${changes.join("; ")}`
        : `Edited details of "${common.title}"`,
    });
    refresh();
    return null;
  });
}

export async function cancelClass(classId: unknown, reasonInput: unknown): Promise<ActionResult> {
  return runAction("cancelClass", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(classId)) throw new AccessError("That class could not be found.");
    const reason = cleanText(reasonInput, 300) || null;
    const ref = col("liveClasses").doc(classId);
    const title = await db().runTransaction(async (tx) => {
      const existing = mapLiveClass(await tx.get(ref));
      if (!existing) throw new AccessError("That class could not be found.");
      if (existing.status !== "scheduled") throw new AccessError(`A ${existing.status} class cannot be cancelled.`);
      tx.update(ref, {
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: user.uid,
        cancelReason: reason,
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({ at: Timestamp.now(), by: user.uid, change: `Cancelled${reason ? `: ${reason}` : ""}` }),
      });
      return { title: existing.title, studentId: existing.studentId, when: formatClassTime(existing.startAt, existing.endAt) };
    });
    await writeAudit(user, {
      action: "class.cancel",
      targetType: "student",
      targetId: title.studentId,
      summary: `Cancelled "${title.title}" (${title.when})${reason ? ` — ${reason}` : ""}`,
    });
    refresh();
    return null;
  });
}

/**
 * Teacher records how the class went. Status becomes "completed"; attendance
 * is a separate teacher judgement (never inferred from the Join button).
 * The note is teacher-only and is never shown to the student.
 */
export async function recordClassOutcome(classId: unknown, attendanceInput: unknown, noteInput: unknown): Promise<ActionResult> {
  return runAction("recordClassOutcome", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(classId)) throw new AccessError("That class could not be found.");
    if (!(ATTENDANCE_VALUES as readonly string[]).includes(String(attendanceInput))) {
      throw new AccessError("Please fix the highlighted fields.", { attendance: "Choose whether the student attended." });
    }
    const attendance = attendanceInput as Attendance;
    const note = cleanText(noteInput, 1000) || null;
    const ref = col("liveClasses").doc(classId);
    const info = await db().runTransaction(async (tx) => {
      const existing = mapLiveClass(await tx.get(ref));
      if (!existing) throw new AccessError("That class could not be found.");
      if (existing.status === "cancelled") throw new AccessError("A cancelled class has no outcome to record.");
      if (Date.parse(existing.startAt) > Date.now()) throw new AccessError("You can record the outcome once the class has started.");
      tx.update(ref, {
        status: "completed",
        attendance,
        outcomeNote: note,
        outcomeRecordedAt: FieldValue.serverTimestamp(),
        outcomeRecordedBy: user.uid,
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({ at: Timestamp.now(), by: user.uid, change: `Outcome recorded: ${attendance}` }),
      });
      return { title: existing.title, studentId: existing.studentId };
    });
    await writeAudit(user, {
      action: "class.outcome",
      targetType: "student",
      targetId: info.studentId,
      summary: `Recorded "${info.title}" as completed (attendance: ${attendance})`,
    });
    refresh();
    return null;
  });
}
