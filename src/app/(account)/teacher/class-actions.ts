"use server";

import { FieldValue, Timestamp, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { refresh } from "next/cache";

import {
  creditLedgerId,
  creditsAvailableToSchedule,
  outcomeCredit,
  schedulingBlock,
  statusAfterConsumption,
} from "@/lib/lms/billing";
import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { historyEntry, mapPackage } from "@/lib/lms/server/billing";
import { mapLiveClass } from "@/lib/lms/server/classes";
import { col, db } from "@/lib/lms/server/db";
import { assertStudent } from "@/lib/lms/server/students";
import {
  ACADEMY_TIME_ZONE,
  ATTENDANCE_VALUES,
  formatClassTime,
  normalizeMeetUrl,
  parseClassTimes,
  type Attendance,
  type LiveClassRecord,
} from "@/lib/lms/classes";
import type { ActionResult } from "@/lib/lms/types";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Teacher-only live-class actions. Every action re-verifies the teacher
// session (requireActionUser), validates all input on the server and is
// recorded in the audit log. Students have no action that can create, edit,
// cancel or reschedule a class.
//
// Package credits (optional per class):
//  * A class may use a package. A pair package creates ONE record per learner
//    (separate attendance and history) sharing a sessionKey and Meet link.
//  * Scheduling is blocked when the package has no free credits.
//  * Recording an Attended/Absent outcome consumes one credit per package
//    session through an idempotent ledger entry (creditLedger/{package}_{session})
//    written in the same transaction, so re-recording, retries and the second
//    learner of a pair never consume another credit.
//  * Cancelling (always by the academy here) consumes nothing; the credit
//    stays available, so the class carries forward.

export interface ClassInput {
  studentId: unknown;
  title: unknown;
  date: unknown;
  startTime: unknown;
  endTime: unknown;
  meetUrl: unknown;
  notes: unknown;
  /** Optional: the package whose credits this class uses. */
  packageId?: unknown;
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

/** All class records of one session (pair sessions have one per learner). */
async function sessionSiblings(tx: Transaction, record: LiveClassRecord) {
  if (!record.packageId || !record.sessionKey) return [{ ref: col("liveClasses").doc(record.id), record }];
  const snap = await tx.get(col("liveClasses").where("sessionKey", "==", record.sessionKey));
  return snap.docs
    .map((d) => ({ ref: d.ref as DocumentReference, record: mapLiveClass(d) }))
    .filter((s): s is { ref: DocumentReference; record: LiveClassRecord } => s.record !== null && s.record.packageId === record.packageId);
}

export async function scheduleClass(input: ClassInput): Promise<ActionResult<{ classId: string }>> {
  return runAction("scheduleClass", async () => {
    const user = await requireActionUser("teacher");
    const common = parseCommon(input);
    const times = parseClassTimes(input, Date.now());
    const errors = { ...common.errors, ...(times.ok ? {} : times.errors) };
    if (Object.keys(errors).length || !times.ok) throw new AccessError("Please fix the highlighted fields.", errors);

    const base = {
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
    };

    // --- Class without a package (unchanged behaviour) ---
    if (input?.packageId === undefined || input?.packageId === null || input?.packageId === "") {
      const student = await assertStudent(input?.studentId);
      const ref = col("liveClasses").doc();
      await ref.create({ ...base, studentId: student.uid, packageId: null, sessionKey: null });
      await writeAudit(user, {
        action: "class.schedule",
        targetType: "student",
        targetId: student.uid,
        summary: `Scheduled "${common.title}" for ${student.label} on ${formatClassTime(times.start.toISOString(), times.end.toISOString())}`,
      });
      refresh();
      return { classId: ref.id };
    }

    // --- Class using a package credit ---
    if (!isValidId(input.packageId)) throw new AccessError("Please fix the highlighted fields.", { packageId: "Choose a package from the list." });
    const packageId = input.packageId;
    const pkgRef = col("packages").doc(packageId);
    const first = mapPackage(await pkgRef.get());
    if (!first) throw new AccessError("Please fix the highlighted fields.", { packageId: "That package could not be found." });
    // The learners come from the package, never from the form; each must still be a valid student.
    const students = await Promise.all(first.learnerIds.map((id) => assertStudent(id, "packageId")));
    if (input?.studentId && !first.learnerIds.includes(String(input.studentId))) {
      throw new AccessError("Please fix the highlighted fields.", { studentId: "This student is not a learner on the chosen package." });
    }

    const sessionRef = col("liveClasses").doc();
    const sessionKey = sessionRef.id;
    const refs = students.map((_, i) => (i === 0 ? sessionRef : col("liveClasses").doc()));
    await db().runTransaction(async (tx) => {
      const [pkgSnap, classesSnap] = await Promise.all([tx.get(pkgRef), tx.get(col("liveClasses").where("packageId", "==", packageId))]);
      const pkg = mapPackage(pkgSnap);
      if (!pkg) throw new AccessError("That package could not be found.");
      if (JSON.stringify(pkg.learnerIds) !== JSON.stringify(first.learnerIds)) throw new AccessError("This package changed. Please reload the page.");
      const classes = classesSnap.docs.map(mapLiveClass).filter((c): c is LiveClassRecord => c !== null);
      const remaining = Math.max(pkg.sessionsIncluded + pkg.creditAdjustment - pkg.creditsUsed, 0);
      const available = creditsAvailableToSchedule(
        remaining,
        classes.map((c) => ({ sessionKey: c.sessionKey ?? c.id, status: c.status })),
      );
      const blocked = schedulingBlock(pkg.status, available);
      if (blocked) throw new AccessError(blocked, { packageId: blocked });
      students.forEach((s, i) => {
        tx.create(refs[i], { ...base, studentId: s.uid, packageId, sessionKey, title: common.title });
      });
    });
    await writeAudit(user, {
      action: "class.schedule",
      targetType: "package",
      targetId: packageId,
      summary: `Scheduled "${common.title}" for ${students.map((s) => s.label).join(" + ")} on ${formatClassTime(times.start.toISOString(), times.end.toISOString())} (package “${first.title}”)`,
    });
    refresh();
    return { classId: sessionRef.id };
  });
}

/**
 * Edit details and/or reschedule. Only scheduled classes can be edited. If the
 * date/time is unchanged a class that has already started may still have its
 * title, link or notes corrected; a new time must not be in the past.
 * Package classes keep their learners (assign a different package instead), and
 * a pair session is edited for both learners together.
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
    if (existing.packageId && input?.studentId !== existing.studentId) {
      throw new AccessError("Please fix the highlighted fields.", { studentId: "A package class stays with the package's learners." });
    }
    const student = input?.studentId === existing.studentId ? { uid: existing.studentId, label: existing.studentId } : await assertStudent(input?.studentId);

    // History is computed from the record read INSIDE the transaction, so a
    // concurrent edit can never leave a stale "from" value in the history.
    const { changes, rescheduled, reassigned } = await db().runTransaction(async (tx) => {
      const fresh = mapLiveClass(await tx.get(ref));
      if (!fresh || fresh.status !== "scheduled") throw new AccessError("This class changed. Please reload the page.");
      const siblings = (await sessionSiblings(tx, fresh)).filter((s) => s.record.status === "scheduled");
      const rescheduled = fresh.date !== times.date || fresh.startTime !== times.startTime || fresh.endTime !== times.endTime;
      const reassigned = student.uid !== fresh.studentId;
      const changes = [
        rescheduled ? `Rescheduled from ${fresh.date} ${fresh.startTime}–${fresh.endTime} to ${times.date} ${times.startTime}–${times.endTime} IST` : null,
        reassigned ? `Moved from student ${fresh.studentId} to ${student.label}` : null,
      ].filter((c): c is string => c !== null);
      const shared = {
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
      };
      for (const s of siblings) {
        tx.update(s.ref, s.ref.id === ref.id ? { ...shared, studentId: student.uid } : shared);
      }
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

/** Cancellation by the academy. No credit is consumed; a pair session is cancelled for both learners. */
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
      const siblings = (await sessionSiblings(tx, existing)).filter((s) => s.record.status === "scheduled");
      for (const s of siblings) {
        tx.update(s.ref, {
          status: "cancelled",
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: user.uid,
          cancelledByAcademy: true,
          cancelReason: reason,
          updatedBy: user.uid,
          updatedByEmail: user.email,
          updatedAt: FieldValue.serverTimestamp(),
          history: FieldValue.arrayUnion({
            at: Timestamp.now(),
            by: user.uid,
            change: `Cancelled by the academy${reason ? `: ${reason}` : ""}${existing.packageId ? " (no class credit used; carries forward)" : ""}`,
          }),
        });
      }
      return {
        title: existing.title,
        studentId: existing.studentId,
        when: formatClassTime(existing.startAt, existing.endAt),
        learners: siblings.length,
        packageId: existing.packageId,
      };
    });
    await writeAudit(user, {
      action: "class.cancel",
      targetType: title.packageId ? "package" : "student",
      targetId: title.packageId ?? title.studentId,
      summary: `Cancelled "${title.title}" (${title.when})${title.learners > 1 ? ` for ${title.learners} learners` : ""}${reason ? ` — ${reason}` : ""}`,
    });
    refresh();
    return null;
  });
}

/**
 * Teacher records how the class went. Status becomes "completed"; attendance
 * is a separate teacher judgement (never inferred from the Join button).
 * The note is teacher-only and is never shown to the student.
 * Package classes need Attended or Absent and consume at most one credit per
 * session, however often the outcome is recorded.
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
      // ---- reads ----
      const existing = mapLiveClass(await tx.get(ref));
      if (!existing) throw new AccessError("That class could not be found.");
      if (existing.status === "cancelled") throw new AccessError("A cancelled class has no outcome to record.");
      if (Date.parse(existing.startAt) > Date.now()) throw new AccessError("You can record the outcome once the class has started.");

      const sessionKey = existing.sessionKey ?? existing.id;
      const ledgerRef = existing.packageId ? col("creditLedger").doc(creditLedgerId(existing.packageId, sessionKey)) : null;
      const pkgRef = existing.packageId ? col("packages").doc(existing.packageId) : null;
      const [ledgerSnap, pkgSnap] = await Promise.all([
        ledgerRef ? tx.get(ledgerRef) : Promise.resolve(null),
        pkgRef ? tx.get(pkgRef) : Promise.resolve(null),
      ]);
      const credit = outcomeCredit({ packageLinked: Boolean(existing.packageId), attendance, ledgerExists: Boolean(ledgerSnap?.exists) });
      if (!credit.ok) throw new AccessError(credit.error, { attendance: credit.error });
      const pkg = pkgSnap ? mapPackage(pkgSnap) : null;
      if (existing.packageId && !pkg) throw new AccessError("The package for this class could not be found.");

      // ---- writes ----
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
      let creditsRemaining: number | null = null;
      if (credit.consume && ledgerRef && pkgRef && pkg) {
        creditsRemaining = Math.max(pkg.sessionsIncluded + pkg.creditAdjustment - (pkg.creditsUsed + 1), 0);
        const nextStatus = statusAfterConsumption(pkg.status, creditsRemaining);
        // create() fails if the entry already exists, so a credit can never be charged twice.
        tx.create(ledgerRef, {
          packageId: pkg.id,
          sessionKey,
          classId: existing.id,
          learnerIds: pkg.learnerIds,
          kind: "consume",
          attendance,
          at: FieldValue.serverTimestamp(),
          by: user.uid,
        });
        tx.update(pkgRef, {
          creditsUsed: FieldValue.increment(1),
          ...(nextStatus !== pkg.status ? { status: nextStatus } : {}),
          updatedAt: FieldValue.serverTimestamp(),
          history: FieldValue.arrayUnion(
            historyEntry(user, `Class “${existing.title}” on ${existing.date}: ${attendance} — 1 credit used (${creditsRemaining} left)`),
          ),
        });
      }
      return { title: existing.title, studentId: existing.studentId, consumed: credit.consume, creditsRemaining, packageId: existing.packageId };
    });
    await writeAudit(user, {
      action: "class.outcome",
      targetType: "student",
      targetId: info.studentId,
      summary: `Recorded "${info.title}" as completed (attendance: ${attendance})${
        info.packageId ? (info.consumed ? ` — 1 package credit used, ${info.creditsRemaining} left` : " — credit already counted for this session") : ""
      }`,
    });
    refresh();
    return null;
  });
}
