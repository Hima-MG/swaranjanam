"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh } from "next/cache";

import { TEACHER_CLAIMS } from "@/lib/auth/constants";
import { getAdminAuth } from "@/lib/firebase/admin";
import { MAX_BATCH_CAPACITY, parseCapacity } from "@/lib/lms/class-billing";
import { ACADEMY_TIME_ZONE, formatClassTime, normalizeMeetUrl, parseClassTimes } from "@/lib/lms/classes";
import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { addMemberTx, mapBatch, mapMember, removeMemberTx, transferMemberTx } from "@/lib/lms/server/batches";
import { classBillingConfigRef, mapAccount, mapConfig } from "@/lib/lms/server/class-billing";
import { col, db, mapCourse } from "@/lib/lms/server/db";
import { assertStudent } from "@/lib/lms/server/students";
import type { ActionResult } from "@/lib/lms/types";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Teacher-only batch management. Every action re-verifies the teacher session,
// validates input on the server and is audited. Capacity and membership are
// enforced inside transactions (lib/lms/server/batches.ts).

export interface BatchInput {
  name: unknown;
  courseId: unknown;
  teacherId: unknown;
  schedule: unknown;
  meetUrl: unknown;
  capacity: unknown;
}

async function teacherFor(teacherId: unknown): Promise<{ uid: string; name: string }> {
  const invalid = new AccessError("Please fix the highlighted fields.", { teacherId: "Choose a teacher." });
  if (!isValidId(teacherId)) throw invalid;
  const account = await getAdminAuth()
    .getUser(teacherId)
    .catch(() => null);
  const claim = account?.customClaims?.role;
  if (!account || account.disabled || typeof claim !== "string" || !TEACHER_CLAIMS.includes(claim)) throw invalid;
  const profile = await col("users").doc(teacherId).get();
  return { uid: teacherId, name: (profile.get("displayName") as string | undefined) || account.displayName || account.email || "Teacher" };
}

function parseBatch(input: BatchInput) {
  const errors: Record<string, string> = {};
  const name = cleanText(input?.name, 80);
  if (!name) errors.name = "Enter a batch name.";
  const schedule = cleanText(input?.schedule, 120);
  if (!schedule) errors.schedule = "Describe the schedule, e.g. Saturdays, 7–8 PM IST.";
  const rawMeet = typeof input?.meetUrl === "string" ? input.meetUrl.trim() : "";
  const meetUrl = rawMeet ? normalizeMeetUrl(rawMeet) : null;
  if (rawMeet && !meetUrl) errors.meetUrl = "Enter a Google Meet link like https://meet.google.com/abc-defg-hij";
  const capacity = parseCapacity(input?.capacity ?? MAX_BATCH_CAPACITY);
  if (capacity === null) errors.capacity = `Enter a capacity from 1 to ${MAX_BATCH_CAPACITY}.`;
  return { name, schedule, meetUrl, capacity: capacity ?? MAX_BATCH_CAPACITY, errors };
}

export async function createBatch(input: BatchInput): Promise<ActionResult<{ batchId: string }>> {
  return runAction("createBatch", async () => {
    const user = await requireActionUser("teacher");
    const parsed = parseBatch(input);
    if (!isValidId(input?.courseId)) parsed.errors.courseId = "Choose a course.";
    if (Object.keys(parsed.errors).length) throw new AccessError("Please fix the highlighted fields.", parsed.errors);
    const [course, teacher] = await Promise.all([col("courses").doc(input.courseId as string).get().then(mapCourse), teacherFor(input?.teacherId)]);
    if (!course) throw new AccessError("Please fix the highlighted fields.", { courseId: "That course could not be found." });
    const ref = col("batches").doc();
    await ref.create({
      name: parsed.name,
      courseId: course.id,
      courseTitle: course.title,
      teacherId: teacher.uid,
      teacherName: teacher.name,
      schedule: parsed.schedule,
      meetUrl: parsed.meetUrl,
      capacity: parsed.capacity,
      memberCount: 0,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
      history: [{ at: Timestamp.now(), by: user.uid, byEmail: user.email, change: "Batch created" }],
    });
    await writeAudit(user, { action: "batch.create", targetType: "batch", targetId: ref.id, summary: `Created batch "${parsed.name}" for ${course.title}` });
    refresh();
    return { batchId: ref.id };
  });
}

/** Edits a batch. A new Meet link is also applied to the batch's future scheduled classes. */
export async function updateBatch(batchId: unknown, input: BatchInput & { status?: unknown }): Promise<ActionResult> {
  return runAction("updateBatch", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(batchId)) throw new AccessError("That batch could not be found.");
    const parsed = parseBatch(input);
    if (Object.keys(parsed.errors).length) throw new AccessError("Please fix the highlighted fields.", parsed.errors);
    const teacher = await teacherFor(input?.teacherId);
    const status = input?.status === "archived" ? "archived" : "active";
    const ref = col("batches").doc(batchId);
    const changes = await db().runTransaction(async (tx) => {
      const batch = mapBatch(await tx.get(ref));
      if (!batch) throw new AccessError("That batch could not be found.");
      if (parsed.capacity < batch.memberCount) {
        throw new AccessError("Please fix the highlighted fields.", { capacity: `The batch already has ${batch.memberCount} learners.` });
      }
      if (status === "archived" && batch.memberCount > 0) throw new AccessError("Remove or transfer all learners before archiving the batch.");
      const linkChanged = (parsed.meetUrl ?? null) !== batch.meetUrl;
      const future = linkChanged && parsed.meetUrl ? await tx.get(col("liveClasses").where("batchId", "==", batch.id)) : null;
      const upcoming = future ? future.docs.filter((d) => d.get("status") === "scheduled" && (d.get("endAt")?.toMillis?.() ?? 0) > Date.now()) : [];
      tx.update(ref, {
        name: parsed.name,
        schedule: parsed.schedule,
        meetUrl: parsed.meetUrl,
        capacity: parsed.capacity,
        teacherId: teacher.uid,
        teacherName: teacher.name,
        status,
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({ at: Timestamp.now(), by: user.uid, byEmail: user.email, change: `Updated${linkChanged ? " (Meet link changed)" : ""}` }),
      });
      for (const d of upcoming) tx.update(d.ref, { meetUrl: parsed.meetUrl, updatedAt: FieldValue.serverTimestamp() });
      return { linkChanged, updatedClasses: upcoming.length, name: parsed.name };
    });
    await writeAudit(user, {
      action: "batch.update",
      targetType: "batch",
      targetId: batchId,
      summary: `Updated batch "${changes.name}"${changes.linkChanged ? ` — Meet link changed (${changes.updatedClasses} upcoming class records updated)` : ""}`,
    });
    refresh();
    return null;
  });
}

export async function addBatchMember(batchId: unknown, studentIdInput: unknown): Promise<ActionResult> {
  return runAction("addBatchMember", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(batchId)) throw new AccessError("That batch could not be found.");
    const student = await assertStudent(studentIdInput);
    const result = await addMemberTx(user, batchId, { uid: student.uid, name: student.name });
    await writeAudit(user, {
      action: "batch.addMember",
      targetType: "batch",
      targetId: batchId,
      summary: `Added ${student.label} to "${result.batchName}"${result.created ? " — billing account opened (₹400 advance awaiting)" : ""}`,
    });
    refresh();
    return null;
  });
}

export async function removeBatchMember(batchId: unknown, studentId: unknown, reasonInput: unknown): Promise<ActionResult> {
  return runAction("removeBatchMember", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(batchId) || !isValidId(studentId)) throw new AccessError("That learner could not be found.");
    const reason = cleanText(reasonInput, 300);
    if (!reason) throw new AccessError("Please fix the highlighted fields.", { reason: "Give a reason." });
    const result = await removeMemberTx(user, batchId, studentId, reason);
    await writeAudit(user, { action: "batch.removeMember", targetType: "batch", targetId: batchId, summary: `Removed student ${studentId} from "${result.batchName}": ${reason}` });
    refresh();
    return null;
  });
}

export async function transferBatchMember(fromBatchId: unknown, studentId: unknown, toBatchId: unknown): Promise<ActionResult> {
  return runAction("transferBatchMember", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(fromBatchId) || !isValidId(toBatchId) || !isValidId(studentId)) throw new AccessError("Choose the batch to move to.");
    const result = await transferMemberTx(user, fromBatchId, toBatchId, studentId);
    await writeAudit(user, {
      action: "batch.transferMember",
      targetType: "batch",
      targetId: toBatchId,
      summary: `Moved student ${studentId} from "${result.from}" to "${result.to}" (billing unchanged)`,
    });
    refresh();
    return null;
  });
}

export interface BatchClassInput {
  title: unknown;
  date: unknown;
  startTime: unknown;
  endTime: unknown;
  notes: unknown;
}

/**
 * Schedules ONE session for every active member: one class record per
 * learner (individual attendance and billing), sharing a session key and the
 * batch's Meet link.
 */
export async function scheduleBatchClass(batchId: unknown, input: BatchClassInput): Promise<ActionResult<{ sessionKey: string; learners: number }>> {
  return runAction("scheduleBatchClass", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(batchId)) throw new AccessError("That batch could not be found.");
    const title = cleanText(input?.title, 120);
    const notes = cleanText(input?.notes, 1000) || null;
    const times = parseClassTimes(input, Date.now());
    const errors: Record<string, string> = { ...(times.ok ? {} : times.errors) };
    if (!title) errors.title = "Enter a class title or subject.";
    if (Object.keys(errors).length || !times.ok) throw new AccessError("Please fix the highlighted fields.", errors);

    const batchRef = col("batches").doc(batchId);
    const result = await db().runTransaction(async (tx) => {
      // ---- reads ----
      const [batchSnap, membersSnap, configSnap] = await Promise.all([
        tx.get(batchRef),
        tx.get(col("batchMembers").where("batchId", "==", batchId)),
        tx.get(classBillingConfigRef()),
      ]);
      const batch = mapBatch(batchSnap);
      if (!batch) throw new AccessError("That batch could not be found.");
      if (batch.status !== "active") throw new AccessError("This batch is archived.");
      if (!batch.meetUrl) throw new AccessError("Add the batch's Google Meet link before scheduling classes.");
      const members = membersSnap.docs.map(mapMember).filter((m) => m !== null && m.status === "active");
      if (members.length === 0) throw new AccessError("Add learners to the batch before scheduling a class.");
      const accounts = await Promise.all(members.map((m) => tx.get(col("billingAccounts").doc(m!.accountId)).then(mapAccount)));
      const policy = mapConfig(configSnap).policy;
      if (policy.advanceBeforeScheduling) {
        const unpaid = members.filter((m, i) => accounts[i]?.advance.status === "awaiting");
        if (unpaid.length) {
          throw new AccessError(`The registration advance is not yet verified for: ${unpaid.map((m) => m!.studentName).join(", ")}.`);
        }
      }

      // ---- writes ----
      const sessionRef = col("liveClasses").doc();
      const base = {
        title,
        startAt: Timestamp.fromDate(times.start),
        endAt: Timestamp.fromDate(times.end),
        timeZone: ACADEMY_TIME_ZONE,
        date: times.date,
        startTime: times.startTime,
        endTime: times.endTime,
        meetUrl: batch.meetUrl,
        notes,
        status: "scheduled",
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        cancelKind: null,
        attendance: null,
        outcomeNote: null,
        outcomeRecordedAt: null,
        outcomeRecordedBy: null,
        packageId: null,
        batchId: batch.id,
        sessionKey: sessionRef.id,
        createdBy: batch.teacherId || user.uid,
        createdByEmail: user.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: FieldValue.serverTimestamp(),
        history: [{ at: Timestamp.now(), by: user.uid, change: `Scheduled for ${times.date} ${times.startTime}–${times.endTime} IST (batch ${batch.name})` }],
      };
      members.forEach((m, i) => {
        const ref = i === 0 ? sessionRef : col("liveClasses").doc();
        tx.create(ref, { ...base, studentId: m!.studentId, billingAccountId: accounts[i] ? accounts[i]!.id : null });
      });
      return { sessionKey: sessionRef.id, learners: members.length, name: batch.name };
    });
    await writeAudit(user, {
      action: "class.schedule",
      targetType: "batch",
      targetId: batchId,
      summary: `Scheduled "${title}" for batch "${result.name}" (${result.learners} learners) on ${formatClassTime(times.start.toISOString(), times.end.toISOString())}`,
    });
    refresh();
    return { sessionKey: result.sessionKey, learners: result.learners };
  });
}
