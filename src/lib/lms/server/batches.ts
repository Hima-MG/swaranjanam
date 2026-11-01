import "server-only";

import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import {
  accountIdFor,
  BATCH_BLOCK_MESSAGES,
  batchClassBlock,
  batchMemberId,
  type BillingMode,
  canAddMember,
  initialAdvance,
  MAX_BATCH_CAPACITY,
  membershipLockId,
  periodOf,
  rateVersionForPeriod,
} from "@/lib/lms/class-billing";
import { toStudentView, type LiveClassRecord, type StudentClassView } from "@/lib/lms/classes";
import { AccessError } from "@/lib/lms/server/access";
import { assertLegacyDuesClearedInTx, classBillingConfigRef, mapAccount, mapConfig } from "@/lib/lms/server/class-billing";
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
  schedule: string;
  meetUrl: string | null;
  capacity: number;
  memberCount: number;
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
 * Adds an enrolled student to a batch, creating their batch billing account
 * the first time (deterministic id, so a retry or a later batch reuses it).
 */
export async function addMemberTx(actor: SessionUser, batchId: string, student: { uid: string; name: string }) {
  const batchRef = col("batches").doc(batchId);
  return db().runTransaction(async (tx) => {
    // ---- reads ----
    const batch = mapBatch(await tx.get(batchRef));
    if (!batch) throw new AccessError("That batch could not be found.");
    const enrollmentRef = col("enrollments").doc(enrollmentId(batch.courseId, student.uid));
    const lockRef = col("batchMembershipLocks").doc(membershipLockId(student.uid, batch.courseId));
    const memberRef = col("batchMembers").doc(batchMemberId(batch.id, student.uid));
    const accountId = accountIdFor(student.uid, batch.courseId, "batch");
    const accountRef = col("billingAccounts").doc(accountId);
    // Entering website billing requires verified clearance of fees before November 2026.
    await assertLegacyDuesClearedInTx(tx, student.uid);
    const [enrollmentSnap, lockSnap, accountSnap, configSnap] = await Promise.all([
      tx.get(enrollmentRef),
      tx.get(lockRef),
      tx.get(accountRef),
      tx.get(classBillingConfigRef()),
    ]);
    const enrollment = mapEnrollment(enrollmentSnap);
    if (!enrollment || enrollment.status !== "active") {
      throw new AccessError("Only students actively enrolled in this batch's course can be added.", { studentId: "Not enrolled in this course." });
    }
    if (lockSnap.exists) {
      throw new AccessError(
        lockSnap.get("batchId") === batch.id ? "This student is already in this batch." : "This student is already in another batch for this course. Use Transfer instead.",
        { studentId: "Already in a batch for this course." },
      );
    }
    const full = canAddMember(batch);
    if (full) throw new AccessError(full);
    const existingAccount = mapAccount(accountSnap);
    if (existingAccount?.status === "closed") {
      throw new AccessError("This student's billing account for the course is closed. Reopening needs a decision on the earlier billing history.");
    }

    // ---- writes ----
    const now = FieldValue.serverTimestamp();
    tx.update(batchRef, { memberCount: FieldValue.increment(1), updatedAt: now });
    tx.create(lockRef, { batchId: batch.id, studentId: student.uid, courseId: batch.courseId, since: now });
    tx.set(memberRef, {
      batchId: batch.id,
      studentId: student.uid,
      courseId: batch.courseId,
      studentName: student.name,
      accountId,
      status: "active",
      joinedAt: now,
      leftAt: null,
      transferredTo: null,
      history: FieldValue.arrayUnion(historyEntry(actor, `Added to ${batch.name}`)),
    }, { merge: true });
    if (!existingAccount) {
      const config = mapConfig(configSnap);
      const version = rateVersionForPeriod(config.rateVersions, periodOf(new Date().toISOString()));
      tx.create(accountRef, {
        studentId: student.uid,
        courseId: batch.courseId,
        mode: "batch" satisfies BillingMode,
        status: "active",
        batchId: batch.id,
        studentName: student.name,
        courseTitle: batch.courseTitle,
        // One-time registration advance (₹400 for batch learners): never created again.
        advance: initialAdvance("batch", version),
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
    tx.update(batchRef, { memberCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() });
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
    const full = canAddMember(to);
    if (full) throw new AccessError(full);
    const lockRef = col("batchMembershipLocks").doc(membershipLockId(studentId, from.courseId));
    const accountRef = col("billingAccounts").doc(member.accountId || accountIdFor(studentId, from.courseId, "batch"));
    const [accountSnap, future] = await Promise.all([tx.get(accountRef), futureBatchClasses(tx, from.id, studentId)]);

    const now = FieldValue.serverTimestamp();
    cancelForMembershipChange(tx, future, actor, `Moved to ${to.name}`);
    tx.update(fromRef, { memberCount: FieldValue.increment(-1), updatedAt: now });
    tx.update(toRef, { memberCount: FieldValue.increment(1), updatedAt: now });
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
  const batches = (await db().getAll(...active.map((m) => col("batches").doc(m.batchId)))).map(mapBatch).filter((b): b is BatchRecord => b !== null);
  const nowMs = Date.now();
  const [classesSnap, accounts] = await Promise.all([
    col("liveClasses").where("studentId", "==", user.uid).get(),
    db().getAll(...active.map((m) => col("billingAccounts").doc(m.accountId))),
  ]);
  const blockByBatch = new Map(
    active.map((m, i) => {
      const account = mapAccount(accounts[i]);
      return [m.batchId, account && account.studentId === user.uid ? batchClassBlock(account) : null] as const;
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
      blockedReason: block ? BATCH_BLOCK_MESSAGES[block] : null,
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

/** Courses that batches can belong to (drafts excluded). */
export async function listCourseOptions(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const snap = await col("courses").select("title", "status").get();
  return snap.docs
    .filter((d) => d.get("status") !== "draft")
    .map((d) => ({ id: d.id, title: String(d.get("title") ?? d.id) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
