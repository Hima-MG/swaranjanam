import "server-only";

import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { col, db, toIso } from "@/lib/lms/server/db";
import {
  ACADEMY_TIME_ZONE,
  ATTENDANCE_VALUES,
  CLASS_STATUSES,
  istDateOf,
  toStudentView,
  type Attendance,
  type ClassStatus,
  type LiveClassRecord,
  type StudentClassView,
} from "@/lib/lms/classes";
import { isValidId } from "@/lib/lms/validation";

// Live classes (Google Meet). Collection: liveClasses/{autoId}.
//  * Teacher reads require the teacher role.
//  * Student reads ALWAYS filter by the signed-in student's own uid (never an
//    id from the request) and return StudentClassView, which omits every
//    teacher-only field (attendance, outcome notes, who edited).

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function mapLiveClass(snapshot: DocumentSnapshot<DocumentData>): LiveClassRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  const startAt = toIso(d.startAt);
  const endAt = toIso(d.endAt);
  if (!startAt || !endAt) return null;
  return {
    id: snapshot.id,
    studentId: String(d.studentId ?? ""),
    packageId: isValidId(d.packageId) ? d.packageId : null,
    sessionKey: isValidId(d.sessionKey) ? d.sessionKey : isValidId(d.packageId) ? snapshot.id : null,
    title: String(d.title ?? "Class"),
    startAt,
    endAt,
    timeZone: str(d.timeZone) ?? ACADEMY_TIME_ZONE,
    date: String(d.date ?? ""),
    startTime: String(d.startTime ?? ""),
    endTime: String(d.endTime ?? ""),
    meetUrl: String(d.meetUrl ?? ""),
    notes: str(d.notes),
    status: ((CLASS_STATUSES as readonly string[]).includes(d.status) ? d.status : "scheduled") as ClassStatus,
    cancelledAt: toIso(d.cancelledAt),
    cancelReason: str(d.cancelReason),
    attendance: ((ATTENDANCE_VALUES as readonly string[]).includes(d.attendance) ? d.attendance : null) as Attendance | null,
    outcomeNote: str(d.outcomeNote),
    outcomeRecordedAt: toIso(d.outcomeRecordedAt),
    createdBy: str(d.createdBy),
    createdByEmail: str(d.createdByEmail),
    createdAt: toIso(d.createdAt),
    updatedBy: str(d.updatedBy),
    updatedByEmail: str(d.updatedByEmail),
    updatedAt: toIso(d.updatedAt),
  };
}

// --- Teacher ------------------------------------------------------------------------

export type ClassTab = "upcoming" | "completed" | "cancelled";

export interface ClassFilters {
  tab: ClassTab;
  student: string | null;
  from: string | null;
  to: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseClassFilters(params: Record<string, string | string[] | undefined>): ClassFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tab = one(params.tab);
  const student = one(params.student);
  const date = (v: string) => (DATE_PATTERN.test(v) ? v : null);
  return {
    tab: tab === "completed" || tab === "cancelled" ? tab : "upcoming",
    student: isValidId(student) ? student : null,
    from: date(one(params.from)),
    to: date(one(params.to)),
  };
}

export interface TeacherClassRow extends LiveClassRecord {
  studentName: string;
  studentEmail: string | null;
  /** The scheduled start has passed (the outcome can be recorded). */
  started: boolean;
  /** Scheduled but the scheduled end has passed: the teacher should record the outcome. */
  needsOutcome: boolean;
}

async function studentDirectory() {
  const snapshot = await col("users").where("role", "==", "student").select("displayName", "email").get();
  return snapshot.docs
    .map((d) => ({ uid: d.id, name: str(d.get("displayName")), email: str(d.get("email")) }))
    .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));
}

export async function listClassesForTeacher(user: SessionUser, filters: ClassFilters) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const [snapshot, students] = await Promise.all([col("liveClasses").get(), studentDirectory()]);
  const byId = new Map(students.map((s) => [s.uid, s]));
  const now = Date.now();
  const all: TeacherClassRow[] = snapshot.docs
    .map(mapLiveClass)
    .filter((c): c is LiveClassRecord => c !== null)
    .map((c) => {
      const s = byId.get(c.studentId);
      return {
        ...c,
        studentName: s?.name ?? s?.email ?? "Unknown student",
        studentEmail: s?.email ?? null,
        started: Date.parse(c.startAt) <= now,
        needsOutcome: c.status === "scheduled" && Date.parse(c.endAt) < now,
      };
    });

  const inTab = (c: TeacherClassRow) =>
    filters.tab === "upcoming" ? c.status === "scheduled" : c.status === filters.tab;
  const rows = all
    .filter(inTab)
    .filter((c) => !filters.student || c.studentId === filters.student)
    // Date filters use the IST calendar date the class was entered with.
    .filter((c) => (!filters.from || c.date >= filters.from) && (!filters.to || c.date <= filters.to))
    .sort((a, b) =>
      filters.tab === "upcoming" ? a.startAt.localeCompare(b.startAt) : b.startAt.localeCompare(a.startAt),
    );

  return {
    rows,
    counts: {
      upcoming: all.filter((c) => c.status === "scheduled").length,
      completed: all.filter((c) => c.status === "completed").length,
      cancelled: all.filter((c) => c.status === "cancelled").length,
      needsOutcome: all.filter((c) => c.needsOutcome).length,
    },
    students: students.map((s) => ({ uid: s.uid, label: s.name ? `${s.name}${s.email ? ` (${s.email})` : ""}` : s.email ?? s.uid })),
  };
}

/** Overview card: classes today (IST) and outcomes still to record. */
export async function getClassSummary(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const snapshot = await col("liveClasses").where("status", "==", "scheduled").get();
  const now = Date.now();
  const today = istDateOf(new Date(now));
  const scheduled = snapshot.docs.map(mapLiveClass).filter((c): c is LiveClassRecord => c !== null);
  return {
    today: scheduled.filter((c) => c.date === today).length,
    upcoming: scheduled.filter((c) => Date.parse(c.endAt) >= now).length,
    needsOutcome: scheduled.filter((c) => Date.parse(c.endAt) < now).length,
  };
}

// --- Student (own classes only) --------------------------------------------------

const RECENT_DAYS = 14;

/**
 * The signed-in student's classes: everything not yet ended plus the last two
 * weeks of history. The query is bound to user.uid — a student cannot ask for
 * anyone else's classes.
 */
export async function listOwnClasses(user: SessionUser): Promise<{ classes: StudentClassView[]; nowMs: number }> {
  const nowMs = Date.now();
  if (user.role !== "student") return { classes: [], nowMs };
  const snapshot = await col("liveClasses").where("studentId", "==", user.uid).get();
  const cutoff = nowMs - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const records = snapshot.docs
    .map(mapLiveClass)
    .filter((c): c is LiveClassRecord => c !== null && c.studentId === user.uid && Date.parse(c.endAt) >= cutoff);

  const teacherIds = [...new Set(records.map((c) => c.createdBy).filter((id): id is string => id !== null))];
  // Only the teachers' display names are read — no other profile data.
  const teachers = teacherIds.length ? await db().getAll(...teacherIds.map((id) => col("users").doc(id)), { fieldMask: ["displayName"] }) : [];
  const teacherName = new Map(teachers.map((d) => [d.id, str(d.get("displayName"))]));

  const classes = records
    .map((c) => toStudentView(c, (c.createdBy && teacherName.get(c.createdBy)) || "Swaraanjanam Academy", nowMs))
    .sort((a, b) => {
      // Not-yet-ended first (soonest first), then past ones (most recent first).
      const aPast = Date.parse(a.endAt) < nowMs;
      const bPast = Date.parse(b.endAt) < nowMs;
      if (aPast !== bPast) return aPast ? 1 : -1;
      return aPast ? b.startAt.localeCompare(a.startAt) : a.startAt.localeCompare(b.startAt);
    });
  return { classes, nowMs };
}

/** Every class of one student, newest first (teacher's student profile: class history and attendance). */
export async function listClassesForStudent(user: SessionUser, studentId: string): Promise<LiveClassRecord[]> {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  if (!isValidId(studentId)) return [];
  const snapshot = await col("liveClasses").where("studentId", "==", studentId).get();
  return snapshot.docs
    .map(mapLiveClass)
    .filter((c): c is LiveClassRecord => c !== null)
    .sort((a, b) => b.startAt.localeCompare(a.startAt));
}

/** Registered students as select options (teacher forms). */
export async function listStudentOptions(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  return (await studentDirectory()).map((s) => ({
    uid: s.uid,
    label: s.name ? `${s.name}${s.email ? ` (${s.email})` : ""}` : (s.email ?? s.uid),
  }));
}

/**
 * The signed-in student's full class history (past classes), newest first.
 * Bound to user.uid; returns student views only (no private notes).
 */
export async function listOwnClassHistory(user: SessionUser): Promise<StudentClassView[]> {
  if (user.role !== "student") return [];
  const nowMs = Date.now();
  const snapshot = await col("liveClasses").where("studentId", "==", user.uid).get();
  return snapshot.docs
    .map(mapLiveClass)
    .filter((c): c is LiveClassRecord => c !== null && c.studentId === user.uid && (Date.parse(c.endAt) < nowMs || c.status !== "scheduled"))
    .sort((a, b) => b.startAt.localeCompare(a.startAt))
    .map((c) => toStudentView(c, "Swaraanjanam Academy", nowMs));
}
