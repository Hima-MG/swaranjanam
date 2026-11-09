import "server-only";

import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { courseOptionsFrom, type BatchUsage } from "@/lib/lms/academy-courses";
import {
  accountIdFor,
  CLASS_BLOCK_MESSAGES,
  classAccessBlock,
  batchMemberId,
  type BillingMode,
  canAddMember,
  MAX_BATCH_CAPACITY,
  membershipLockId,
} from "@/lib/lms/class-billing";
import { toStudentView, type LiveClassRecord, type StudentClassView } from "@/lib/lms/classes";
import { scheduleLabel, schedulesConflict, WEEKDAYS, type Weekday, type WeeklySchedule } from "@/lib/lms/registration";
import { AccessError } from "@/lib/lms/server/access";
import { assertLegacyDuesClearedInTx, courseRateInTx, enforceOverdueForStudent, initialAgreedRates, mapAccount } from "@/lib/lms/server/class-billing";
import { mapLiveClass } from "@/lib/lms/server/classes";
import { col, db, mapEnrollment, toIso } from "@/lib/lms/server/db";
import { enrollmentId } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Batches: a group of up to five learners in one course, with one teacher,
// a weekly schedule and a shared Google Meet link.
//
//  * Capacity and "one active batch per learner per course" are enforced in
//    transactions (batch.memberCount + batchMembershipLocks), so concurrent
//    additions cannot overfill a batch or double-book a learner.
//  * Membership changes never touch billing: the learner's billing account is
//    keyed by learner + course (not batch), so a transfer keeps the charges and
//    the advance exactly as they are.
//  * Students only ever read batches they are an ACTIVE member of.

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export interface BatchRecord {
  id: string;
  name: string;
  courseId: string;
  courseTitle: string;
  teacherId: string;
  teacherName: string;
  /** Display text (derived from the weekly schedule for batches that have one). */
  schedule: string;
  /** Structured class days and times (IST); null for older batches that only have a text schedule. */
  weekly: WeeklySchedule | null;
  meetUrl: string | null;
  capacity: number;
  memberCount: number;
  /** "archived" is shown as Inactive. */
  status: "active" | "archived";
  createdAt: string | null;
}

export function mapBatch(snapshot: DocumentSnapshot<DocumentData>): BatchRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  const capacity = typeof d.capacity === "number" && Number.isInteger(d.capacity) ? Math.min(Math.max(d.capacity, 1), MAX_BATCH_CAPACITY) : MAX_BATCH_CAPACITY;
  return {
    id: snapshot.id,
    name: String(d.name ?? "Batch"),
    courseId: String(d.courseId ?? ""),
    courseTitle: String(d.courseTitle ?? "Course"),
    teacherId: String(d.teacherId ?? ""),
    teacherName: String(d.teacherName ?? "Teacher"),
    schedule: String(d.schedule ?? ""),
    weekly:
      Array.isArray(d.days) && d.days.length && typeof d.startTime === "string" && typeof d.endTime === "string"
        ? { days: WEEKDAYS.filter((w) => (d.days as unknown[]).includes(w)) as Weekday[], start: d.startTime, end: d.endTime }
        : null,
    meetUrl: str(d.meetUrl),
    capacity,
    memberCount: typeof d.memberCount === "number" ? d.memberCount : 0,
    status: d.status === "archived" ? "archived" : "active",
    createdAt: toIso(d.createdAt),
  };
}

export interface BatchMemberRecord {
  id: string;
  batchId: string;
  studentId: string;
  courseId: string;
  studentName: string;
  status: "active" | "removed" | "transferred";
  accountId: string;
  /** Places taken in the batch: 2 for a Learn Together enrolment (two learners, one login). */
  seats: number;
  /** Both learners' names for Learn Together, else the single learner. */
  learnerNames: string[];
  joinedAt: string | null;
  leftAt: string | null;
  transferredTo: string | null;
}

export function mapMember(snapshot: DocumentSnapshot<DocumentData>): BatchMemberRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  return {
    id: snapshot.id,
    batchId: String(d.batchId ?? ""),
    studentId: String(d.studentId ?? ""),
    courseId: String(d.courseId ?? ""),
    studentName: String(d.studentName ?? "Student"),
    status: d.status === "removed" || d.status === "transferred" ? d.status : "active",
    accountId: String(d.accountId ?? ""),
    seats: d.seats === 2 ? 2 : 1,
    learnerNames: Array.isArray(d.learnerNames) ? d.learnerNames.map(String) : [String(d.studentName ?? "Student")],
    joinedAt: toIso(d.joinedAt),
    leftAt: toIso(d.leftAt),
    transferredTo: str(d.transferredTo),
  };
}

const historyEntry = (actor: SessionUser, change: string) => ({ at: Timestamp.now(), by: actor.uid, byEmail: actor.email, change });

/** Future scheduled classes of one learner in one batch (read inside the membership transaction). */
async function futureBatchClasses(tx: FirebaseFirestore.Transaction, batchId: string, studentId: string) {
  const snap = await tx.get(col("liveClasses").where("batchId", "==", batchId));
  return snap.docs.filter((d) => d.get("studentId") === studentId && d.get("status") === "scheduled");
}

/** A learner who leaves a batch loses access to its future classes (and Meet link). Never billed. */
function cancelForMembershipChange(tx: FirebaseFirestore.Transaction, docs: FirebaseFirestore.QueryDocumentSnapshot[], actor: SessionUser, reason: string) {
  for (const d of docs) {
    tx.update(d.ref, {
      status: "cancelled",
      cancelKind: "academy",
      cancelReason: reason,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: actor.uid,
      membershipChange: true,
      updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion({ at: Timestamp.now(), by: actor.uid, change: `Cancelled: ${reason} (not billed)` }),
    });
  }
}

/**
 * Learn Together details kept on the billing account (and copied onto every
 * invoice): the enrolment type, both learners' names and the per-learner rate.
 */
export function sharedAccountFields(registration: DocumentData | null | undefined, learnerNames: string[]) {
  const count = registration && Number(registration.learnerCount) === 2 ? 2 : 1;
  return {
    enrolmentType: typeof registration?.enrolmentType === "string" ? registration.enrolmentType : null,
    learnerCount: count,
    learnerNames,
    perLearnerRateMinor: typeof registration?.perLearnerRateMinor === "number" ? registration.perLearnerRateMinor : null,
  };
}

/** Creates a batch. The caller has authorised the teacher and resolved the course and the batch's teacher. */
export async function createBatchRecord(
  actor: SessionUser,
  input: { name: string; course: { id: string; title: string }; teacher: { uid: string; name: string }; weekly: WeeklySchedule; meetUrl: string | null; capacity: number; active: boolean },
): Promise<string> {
  if (actor.role !== "teacher") throw new AccessError("Only the academy can create batches.");
  const ref = col("batches").doc();
  await ref.create({
    name: input.name,
    courseId: input.course.id,
    courseTitle: input.course.title,
    teacherId: input.teacher.uid,
    teacherName: input.teacher.name,
    days: input.weekly.days,
    startTime: input.weekly.start,
    endTime: input.weekly.end,
    schedule: scheduleLabel(input.weekly),
    meetUrl: input.meetUrl,
    capacity: input.capacity,
    memberCount: 0,
    status: input.active ? "active" : "archived",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    history: [{ at: Timestamp.now(), by: actor.uid, byEmail: actor.email, change: "Batch created" }],
  });
  return ref.id;
}

/**
 * Adds an enrolled student to a batch, creating their batch billing account
 * the first time (deterministic id, so a retry or a later batch reuses it).
 */
export async function addMemberTx(actor: SessionUser, batchId: string, student: { uid: string; name: string }, opts: { registrationId?: string } = {}) {
  const batchRef = col("batches").doc(batchId);
  return db().runTransaction(async (tx) => {
    // ---- reads ----
    const batch = mapBatch(await tx.get(batchRef));
    if (!batch) throw new AccessError("That batch could not be found.");
    if (batch.status !== "active") throw new AccessError("This batch is inactive. Choose an active batch.");
    // Website registration (paid initial payment): validated here, in the same transaction.
    const registrationRef = opts.registrationId ? col("registrations").doc(opts.registrationId) : null;
    const [registrationSnap, courseSnap] = await Promise.all([
      registrationRef ? tx.get(registrationRef) : Promise.resolve(null),
      registrationRef ? tx.get(col("courses").doc(batch.courseId)) : Promise.resolve(null),
    ]);
    const registration = registrationSnap?.exists ? registrationSnap.data()! : null;
    if (registrationRef) {
      if (!registration || registration.studentId !== student.uid) throw new AccessError("That registration could not be found.");
      if (registration.kind === "special") throw new AccessError("This is a Special Programme registration: it is confirmed by its payment and is not placed in a batch.");
      if (registration.mode !== "batch") throw new AccessError("This is an individual-class registration. Individual students are scheduled one-to-one, not assigned to a batch.");
      if (registration.status !== "paid") {
        throw new AccessError(registration.status === "pending_payment" ? "The initial payment has not been verified yet." : "This registration has already been placed.");
      }
      const courseSlug = courseSnap?.exists ? String(courseSnap.get("slug") ?? courseSnap.id) : null;
      if (registration.courseId !== batch.courseId && registration.courseSlug !== courseSlug) {
        throw new AccessError("This batch is for a different course than the student's registration.");
      }
    }
    const paymentRef = registration?.paymentId ? col("payments").doc(String(registration.paymentId)) : null;
    // Schedule clash with the student's other ACTIVE batches (any course).
    const otherMemberships = (await tx.get(col("batchMembers").where("studentId", "==", student.uid))).docs
      .map(mapMember)
      .filter((m): m is BatchMemberRecord => m !== null && m.status === "active" && m.batchId !== batch.id);
    const otherBatches = otherMemberships.length ? (await tx.getAll(...otherMemberships.map((m) => col("batches").doc(m.batchId)))).map(mapBatch) : [];
    const clash = batch.weekly ? otherBatches.find((b) => b && b.status === "active" && b.weekly && schedulesConflict(batch.weekly!, b.weekly)) : undefined;
    if (clash) throw new AccessError(`Schedule conflict: the student is already in "${clash.name}" (${clash.schedule}).`);
    const paymentSnap = paymentRef ? await tx.get(paymentRef) : null;
    const enrollmentRef = col("enrollments").doc(enrollmentId(batch.courseId, student.uid));
    const lockRef = col("batchMembershipLocks").doc(membershipLockId(student.uid, batch.courseId));
    const memberRef = col("batchMembers").doc(batchMemberId(batch.id, student.uid));
    const accountId = accountIdFor(student.uid, batch.courseId, "batch");
    const accountRef = col("billingAccounts").doc(accountId);
    // Entering website billing requires verified clearance of fees before November 2026.
    await assertLegacyDuesClearedInTx(tx, student.uid);
    const [enrollmentSnap, lockSnap, accountSnap] = await Promise.all([tx.get(enrollmentRef), tx.get(lockRef), tx.get(accountRef)]);
    // The student's agreed rate: the paid registration's rate, else the course's current batch rate (fixed from now on).
    const agreedRateMinor =
      registration && typeof registration.rateMinor === "number" && registration.rateMinor > 0
        ? registration.rateMinor
        : registration && Number(registration.initialAmountMinor) > 0
          ? Number(registration.initialAmountMinor)
          : await courseRateInTx(tx, batch.courseId, "batch");
    const enrollment = mapEnrollment(enrollmentSnap);
    // A paid website registration IS the enrolment: the course enrolment is created (or restored) with the assignment.
    if (!registration && (!enrollment || enrollment.status !== "active")) {
      throw new AccessError("Only students actively enrolled in this batch's course can be added.", { studentId: "Not enrolled in this course." });
    }
    if (lockSnap.exists) {
      throw new AccessError(
        lockSnap.get("batchId") === batch.id ? "This student is already in this batch." : "This student is already in another batch for this course. Use Transfer instead.",
        { studentId: "Already in a batch for this course." },
      );
    }
    // Learn Together: two learners under one login take two places in the batch.
    const seats = registration && Number(registration.learnerCount) === 2 ? 2 : 1;
    const learnerNames: string[] =
      registration && Array.isArray(registration.details?.learners) && registration.details.learners.length
        ? registration.details.learners.map((l: { fullName?: unknown }) => String(l?.fullName ?? ""))
        : [student.name];
    const full = canAddMember(batch, seats);
    if (full) throw new AccessError(full);
    const existingAccount = mapAccount(accountSnap);
    if (existingAccount?.status === "closed") {
      throw new AccessError("This student's billing account for the course is closed. Reopening needs a decision on the earlier billing history.");
    }

    // ---- writes ----
    const now = FieldValue.serverTimestamp();
    if (registration && (!enrollment || enrollment.status !== "active")) {
      tx.set(
        enrollmentRef,
        {
          id: enrollmentRef.id,
          studentId: student.uid,
          courseId: batch.courseId,
          status: "active",
          enrolledAt: enrollment ? enrollmentSnap.get("enrolledAt") ?? now : now,
          enrolledBy: actor.uid,
          revokedAt: null,
          revokedBy: null,
          agreedFee: null,
          currency: "INR",
          registrationId: registrationRef!.id,
          history: FieldValue.arrayUnion({ type: enrollment ? "restored" : "enrolled", at: Timestamp.now(), by: actor.uid }),
        },
        { merge: true },
      );
    }
    tx.update(batchRef, { memberCount: FieldValue.increment(seats), updatedAt: now });
    tx.create(lockRef, { batchId: batch.id, studentId: student.uid, courseId: batch.courseId, since: now });
    tx.set(memberRef, {
      batchId: batch.id,
      studentId: student.uid,
      courseId: batch.courseId,
      studentName: learnerNames.join(" & ") || student.name,
      learnerNames,
      seats,
      accountId,
      status: "active",
      joinedAt: now,
      leftAt: null,
      transferredTo: null,
      history: FieldValue.arrayUnion(historyEntry(actor, `Added to ${batch.name}`)),
    }, { merge: true });
    // The registration's verified initial payment IS the first-class payment: never charged again.
    const prepaid = registration?.paymentId
      ? { status: "verified" as const, amountMinor: Number(registration.initialAmountMinor) || 0, appliedMinor: 0, paymentId: String(registration.paymentId) }
      : null;
    if (prepaid) {
      tx.create(col("advanceLedger").doc(), {
        accountId,
        studentId: student.uid,
        kind: "received",
        amountMinor: prepaid.amountMinor,
        paymentId: prepaid.paymentId,
        registrationId: registrationRef!.id,
        at: now,
        by: actor.uid,
      });
      if (paymentSnap?.exists) tx.update(paymentRef!, { accountId, courseId: batch.courseId, updatedAt: now });
      tx.update(registrationRef!, {
        status: "assigned",
        courseId: batch.courseId,
        batchId: batch.id,
        accountId,
        assignedAt: now,
        updatedAt: now,
        history: FieldValue.arrayUnion(historyEntry(actor, `Assigned to batch ${batch.name} (${batch.schedule})`)),
      });
    }
    if (existingAccount && prepaid && existingAccount.advance.status === "awaiting") {
      tx.update(accountRef, { advance: prepaid, history: FieldValue.arrayUnion(historyEntry(actor, "First-class payment received with the website registration")) });
    }
    if (!existingAccount) {
      tx.create(accountRef, {
        studentId: student.uid,
        courseId: batch.courseId,
        mode: "batch" satisfies BillingMode,
        status: "active",
        batchId: batch.id,
        studentName: student.name,
        courseTitle: batch.courseTitle,
        // Initial payment = one class at the agreed rate (one-time; never created again).
        advance: prepaid ?? { status: "awaiting", amountMinor: agreedRateMinor, appliedMinor: 0, paymentId: null },
        // The agreed rate (per SESSION for the whole enrolment) is fixed here; course price changes never alter it.
        agreedRates: initialAgreedRates(agreedRateMinor),
        ...sharedAccountFields(registration, learnerNames),
        suspension: { active: false, since: null, invoiceIds: [], liftedAt: null },
        billableCount: 0,
        invoiceCount: 0,
        createdAt: now,
        createdBy: actor.uid,
        history: [historyEntry(actor, `Billing account opened (batch ${batch.name})`)],
      });
    } else {
      // Existing account (e.g. re-joining): charges, invoices and advance are kept exactly as they are.
      tx.update(accountRef, { batchId: batch.id, history: FieldValue.arrayUnion(historyEntry(actor, `Joined batch ${batch.name}`)) });
    }
    return { accountId, created: !existingAccount, batchName: batch.name };
  });
}

/** Removes a learner from a batch. Attendance and billing history are kept. */
export async function removeMemberTx(actor: SessionUser, batchId: string, studentId: string, reason: string) {
  const batchRef = col("batches").doc(batchId);
  const memberRef = col("batchMembers").doc(batchMemberId(batchId, studentId));
  return db().runTransaction(async (tx) => {
    const [batchSnap, memberSnap] = await Promise.all([tx.get(batchRef), tx.get(memberRef)]);
    const batch = mapBatch(batchSnap);
    const member = mapMember(memberSnap);
    if (!batch || !member || member.status !== "active") throw new AccessError("That learner is not an active member of this batch.");
    const lockRef = col("batchMembershipLocks").doc(membershipLockId(studentId, batch.courseId));
    const future = await futureBatchClasses(tx, batchId, studentId);
    cancelForMembershipChange(tx, future, actor, `Removed from ${batch.name}`);
    tx.update(batchRef, { memberCount: FieldValue.increment(-member.seats), updatedAt: FieldValue.serverTimestamp() });
    tx.delete(lockRef);
    tx.update(memberRef, {
      status: "removed",
      leftAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion(historyEntry(actor, `Removed from ${batch.name}: ${reason}`)),
    });
    // The billing account is NOT closed or changed: leaving the course is a separate, explicit decision.
    return { batchName: batch.name };
  });
}

/**
 * Moves a learner to another batch of the same course in one transaction:
 * capacity is checked on the target, and the billing account (charges, advance,
 * history) is untouched apart from the batch reference.
 */
export async function transferMemberTx(actor: SessionUser, fromBatchId: string, toBatchId: string, studentId: string) {
  if (fromBatchId === toBatchId) throw new AccessError("Choose a different batch.");
  const fromRef = col("batches").doc(fromBatchId);
  const toRef = col("batches").doc(toBatchId);
  const fromMemberRef = col("batchMembers").doc(batchMemberId(fromBatchId, studentId));
  const toMemberRef = col("batchMembers").doc(batchMemberId(toBatchId, studentId));
  return db().runTransaction(async (tx) => {
    const [fromSnap, toSnap, fromMemberSnap] = await Promise.all([tx.get(fromRef), tx.get(toRef), tx.get(fromMemberRef)]);
    const from = mapBatch(fromSnap);
    const to = mapBatch(toSnap);
    const member = mapMember(fromMemberSnap);
    if (!from || !to) throw new AccessError("That batch could not be found.");
    if (!member || member.status !== "active") throw new AccessError("That learner is not an active member of this batch.");
    if (from.courseId !== to.courseId) throw new AccessError("Learners can only move between batches of the same course.");
    const full = canAddMember(to, member.seats);
    if (full) throw new AccessError(full);
    const lockRef = col("batchMembershipLocks").doc(membershipLockId(studentId, from.courseId));
    const accountRef = col("billingAccounts").doc(member.accountId || accountIdFor(studentId, from.courseId, "batch"));
    const [accountSnap, future] = await Promise.all([tx.get(accountRef), futureBatchClasses(tx, from.id, studentId)]);

    const now = FieldValue.serverTimestamp();
    cancelForMembershipChange(tx, future, actor, `Moved to ${to.name}`);
    tx.update(fromRef, { memberCount: FieldValue.increment(-member.seats), updatedAt: now });
    tx.update(toRef, { memberCount: FieldValue.increment(member.seats), updatedAt: now });
    tx.set(lockRef, { batchId: to.id, studentId, courseId: from.courseId, since: now });
    tx.update(fromMemberRef, {
      status: "transferred",
      leftAt: now,
      transferredTo: to.id,
      history: FieldValue.arrayUnion(historyEntry(actor, `Transferred to ${to.name}`)),
    });
    tx.set(toMemberRef, {
      batchId: to.id,
      studentId,
      courseId: to.courseId,
      studentName: member.studentName,
      learnerNames: member.learnerNames,
      seats: member.seats,
      accountId: member.accountId,
      status: "active",
      joinedAt: now,
      leftAt: null,
      transferredTo: null,
      history: FieldValue.arrayUnion(historyEntry(actor, `Transferred from ${from.name}`)),
    }, { merge: true });
    if (accountSnap.exists) {
      tx.update(accountRef, { batchId: to.id, history: FieldValue.arrayUnion(historyEntry(actor, `Moved from ${from.name} to ${to.name} (billing unchanged)`)) });
    }
    return { from: from.name, to: to.name };
  });
}

// --- Readers -------------------------------------------------------------------------------------

export async function listBatches(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const snap = await col("batches").get();
  return snap.docs
    .map(mapBatch)
    .filter((b): b is BatchRecord => b !== null)
    .sort((a, b) => Number(a.status === "archived") - Number(b.status === "archived") || a.name.localeCompare(b.name));
}

export async function getBatchDetail(user: SessionUser, batchId: string) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  if (!isValidId(batchId)) return null;
  const batch = mapBatch(await col("batches").doc(batchId).get());
  if (!batch) return null;
  const [membersSnap, classesSnap, enrollmentsSnap, otherBatches] = await Promise.all([
    col("batchMembers").where("batchId", "==", batchId).get(),
    col("liveClasses").where("batchId", "==", batchId).get(),
    col("enrollments").where("courseId", "==", batch.courseId).get(),
    col("batches").where("courseId", "==", batch.courseId).get(),
  ]);
  const members = membersSnap.docs.map(mapMember).filter((m): m is BatchMemberRecord => m !== null);
  const active = members.filter((m) => m.status === "active");
  const accounts = active.length ? await db().getAll(...active.map((m) => col("billingAccounts").doc(m.accountId))) : [];
  const accountById = new Map(accounts.map(mapAccount).filter((a) => a !== null).map((a) => [a!.id, a!]));
  const classes = classesSnap.docs.map(mapLiveClass).filter((c): c is LiveClassRecord => c !== null);
  const sessions = new Map<string, LiveClassRecord[]>();
  for (const c of classes) {
    const key = c.sessionKey ?? c.id;
    sessions.set(key, [...(sessions.get(key) ?? []), c]);
  }
  const lockedIds = new Set(active.map((m) => m.studentId));
  const enrolled = enrollmentsSnap.docs
    .map(mapEnrollment)
    .filter((e) => e !== null && e.status === "active" && !lockedIds.has(e.studentId))
    .map((e) => e!.studentId);
  const names = enrolled.length ? await db().getAll(...enrolled.map((id) => col("users").doc(id)), { fieldMask: ["displayName", "email"] }) : [];
  return {
    nowMs: Date.now(),
    batch,
    members: members.sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || a.studentName.localeCompare(b.studentName)),
    accounts: Object.fromEntries(accountById),
    sessions: [...sessions.entries()]
      .map(([key, records]) => ({ key, records: records.sort((a, b) => a.studentId.localeCompare(b.studentId)), first: records[0] }))
      .sort((a, b) => b.first.startAt.localeCompare(a.first.startAt)),
    candidates: names.map((d) => ({ uid: d.id, label: str(d.get("displayName")) ?? str(d.get("email")) ?? d.id })),
    transferTargets: otherBatches.docs
      .map(mapBatch)
      .filter((b): b is BatchRecord => b !== null && b.id !== batchId && b.status === "active")
      .map((b) => ({ id: b.id, label: `${b.name} (${b.memberCount}/${b.capacity})` })),
  };
}

/**
 * The signed-in student's ACTIVE batches with schedule, teacher, Meet link and
 * upcoming classes. Bound to user.uid; removed/transferred memberships give
 * no access to the old batch's private details.
 */
export async function getOwnBatches(user: SessionUser) {
  if (user.role !== "student") return [];
  const membersSnap = await col("batchMembers").where("studentId", "==", user.uid).get();
  const active = membersSnap.docs.map(mapMember).filter((m): m is BatchMemberRecord => m !== null && m.status === "active" && m.studentId === user.uid);
  if (active.length === 0) return [];
  // An invoice past its payment deadline suspends access now, not only at the next scheduled run.
  await enforceOverdueForStudent(user.uid);
  const batches = (await db().getAll(...active.map((m) => col("batches").doc(m.batchId)))).map(mapBatch).filter((b): b is BatchRecord => b !== null);
  const nowMs = Date.now();
  const [classesSnap, accounts] = await Promise.all([
    col("liveClasses").where("studentId", "==", user.uid).get(),
    db().getAll(...active.map((m) => col("billingAccounts").doc(m.accountId))),
  ]);
  const blockByBatch = new Map(
    active.map((m, i) => {
      const account = mapAccount(accounts[i]);
      return [m.batchId, account && account.studentId === user.uid ? classAccessBlock(account) : null] as const;
    }),
  );
  const own = classesSnap.docs.map(mapLiveClass).filter((c): c is LiveClassRecord => c !== null && c.studentId === user.uid);
  return batches.map((b) => {
    // Unpaid invoice past its due date, or first-class payment not verified: no Meet link or join buttons (reversible).
    const block = blockByBatch.get(b.id) ?? null;
    return {
      id: b.id,
      name: b.name,
      courseTitle: b.courseTitle,
      teacherName: b.teacherName,
      schedule: b.schedule,
      suspended: block === "suspended",
      blockedReason: block ? CLASS_BLOCK_MESSAGES[block] : null,
      meetUrl: block ? null : b.meetUrl,
      upcoming: block ? [] : own
        .filter((c) => c.batchId === b.id && c.status === "scheduled" && Date.parse(c.endAt) >= nowMs)
        .sort((x, y) => x.startAt.localeCompare(y.startAt))
        .slice(0, 5)
        .map((c): StudentClassView => toStudentView(c, b.teacherName, nowMs)),
      nowMs,
    };
  });
}

export async function listTeachers(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const snap = await col("users").where("role", "==", "teacher").select("displayName", "email").get();
  return snap.docs.map((d) => ({ uid: d.id, label: str(d.get("displayName")) ?? str(d.get("email")) ?? d.id }));
}

/** Courses a new batch can belong to: the academy's main courses (lib/lms/academy-courses.ts). */
export async function listCourseOptions(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const snap = await col("courses").select("title", "slug", "status", "programme").get();
  return courseOptionsFrom(
    snap.docs.map((d) => ({ id: d.id, slug: String(d.get("slug") || d.id), title: String(d.get("title") ?? d.id), status: String(d.get("status") ?? "draft"), programme: d.get("programme") ?? null })),
  );
}

/** Records referencing a batch, for "Delete batch" (archive when anything exists). */
export async function batchUsage(batchId: string): Promise<BatchUsage> {
  const [members, ...history] = await Promise.all([
    col("batchMembers").where("batchId", "==", batchId).select("status").get(),
    ...(["liveClasses", "billableClasses", "billingAccounts", "invoices", "registrations", "payments"] as const).map((name) =>
      col(name).where("batchId", "==", batchId).count().get(),
    ),
  ]);
  return {
    activeMembers: members.docs.filter((d) => d.get("status") === "active").length,
    historyRecords: members.size + history.reduce((sum, snap) => sum + snap.data().count, 0),
  };
}
