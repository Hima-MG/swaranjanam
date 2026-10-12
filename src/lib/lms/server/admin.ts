import "server-only";

import { cache } from "react";

import type { SessionUser } from "@/lib/auth/session";
import { col, mapCourse, mapEnrollment, toIso } from "@/lib/lms/server/db";
import type { CourseRecord, EnrollmentRecord, EnrollmentStatus } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Academy-wide read models for the teacher (admin) dashboard.
//
// Everything is computed from real Firestore records. At this academy's
// scale (hundreds of students, not millions) the snapshot below loads the
// relevant collections once per request, with field projections, and
// derives exact figures in memory. Firestore has no substring search, so
// the student search must happen in memory regardless. If the academy grows
// to many thousands of students, move counts to aggregation queries and
// add denormalised counters.

export const ACTIVE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StudentRow {
  uid: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  lastLoginAt: string | null;
}

interface ProgressRow {
  studentId: string;
  courseId: string;
  lessonId: string;
  completed: boolean;
  completedAt: string | null;
  lastAccessedAt: string | null;
}

function assertTeacher(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
}

/** One consistent snapshot per request (React cache dedupes calls within a render). */
const loadSnapshot = cache(async () => {
  const [usersSnap, coursesSnap, enrollmentsSnap, lessonsSnap, progressSnap] = await Promise.all([
    col("users").where("role", "==", "student").select("displayName", "email", "phone", "createdAt", "lastActiveAt", "lastLoginAt").get(),
    col("courses").get(),
    col("enrollments").get(),
    col("lessons").select("courseId").get(),
    col("lessonProgress").select("studentId", "courseId", "lessonId", "completed", "completedAt", "lastAccessedAt").get(),
  ]);

  const students: StudentRow[] = usersSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      uid: doc.id,
      displayName: typeof d.displayName === "string" ? d.displayName : null,
      email: typeof d.email === "string" ? d.email : null,
      phone: typeof d.phone === "string" ? d.phone : null,
      createdAt: toIso(d.createdAt),
      lastActiveAt: toIso(d.lastActiveAt),
      lastLoginAt: toIso(d.lastLoginAt),
    };
  });
  const courses = coursesSnap.docs.map(mapCourse).filter((c): c is CourseRecord => c !== null);
  const studentIds = new Set(students.map((s) => s.uid));
  // Only enrollments of existing student accounts count.
  const enrollments = enrollmentsSnap.docs
    .map(mapEnrollment)
    .filter((e): e is EnrollmentRecord => e !== null && studentIds.has(e.studentId));

  const lessonIdsByCourse = new Map<string, Set<string>>();
  for (const doc of lessonsSnap.docs) {
    const courseId = doc.get("courseId");
    if (typeof courseId !== "string") continue;
    if (!lessonIdsByCourse.has(courseId)) lessonIdsByCourse.set(courseId, new Set());
    lessonIdsByCourse.get(courseId)!.add(doc.id);
  }

  const progress: ProgressRow[] = progressSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      studentId: String(d.studentId ?? ""),
      courseId: String(d.courseId ?? ""),
      lessonId: String(d.lessonId ?? ""),
      completed: d.completed === true,
      completedAt: toIso(d.completedAt),
      lastAccessedAt: toIso(d.lastAccessedAt),
    };
  });

  return { students, courses, enrollments, lessonIdsByCourse, progress };
});

type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;

/** Completed lessons that still exist in the course / lessons in the course. */
function completionFor(snapshot: Snapshot, studentId: string, courseId: string) {
  const lessonIds = snapshot.lessonIdsByCourse.get(courseId) ?? new Set<string>();
  const completed = snapshot.progress.filter(
    (p) => p.studentId === studentId && p.courseId === courseId && p.completed && lessonIds.has(p.lessonId),
  ).length;
  const total = lessonIds.size;
  return { completed, total, percent: total === 0 ? null : Math.round((completed / total) * 100) };
}

function lastActivity(student: StudentRow): string | null {
  return [student.lastActiveAt, student.lastLoginAt].filter((d): d is string => d !== null).sort().at(-1) ?? null;
}

export type ActivityState = "active" | "inactive" | "never";

function activityState(student: StudentRow, now: number): ActivityState {
  const last = lastActivity(student);
  if (!last) return "never";
  return now - Date.parse(last) <= ACTIVE_WINDOW_DAYS * DAY_MS ? "active" : "inactive";
}

export const DATE_RANGES = { "7d": 7, "30d": 30, "90d": 90, "365d": 365, all: null } as const;
export type DateRange = keyof typeof DATE_RANGES;

export function parseRange(value: unknown): DateRange {
  return typeof value === "string" && value in DATE_RANGES ? (value as DateRange) : "30d";
}

function sinceFor(range: DateRange, now: number): number | null {
  const days = DATE_RANGES[range];
  return days === null ? null : now - days * DAY_MS;
}

function inRange(iso: string | null, since: number | null) {
  return iso !== null && (since === null || Date.parse(iso) >= since);
}

// --- Overview -------------------------------------------------------------------

export interface OverviewData {
  range: DateRange;
  students: { total: number; newInRange: number; active: number; inactive: number; never: number; notEnrolled: number };
  courses: { published: number; draft: number; archived: number };
  enrollments: { active: number; revoked: number; newInRange: number };
  /** Mean completion across active enrollments in courses that have lessons; null when there are none. */
  averageCompletion: number | null;
  completionSample: number;
  recentEnrollments: {
    id: string;
    studentId: string;
    studentName: string;
    courseId: string;
    courseTitle: string;
    status: EnrollmentStatus;
    at: string | null;
  }[];
}

export async function getOverview(user: SessionUser, range: DateRange): Promise<OverviewData> {
  assertTeacher(user);
  const snapshot = await loadSnapshot();
  const now = Date.now();
  const since = sinceFor(range, now);
  const courseById = new Map(snapshot.courses.map((c) => [c.id, c]));
  const studentById = new Map(snapshot.students.map((s) => [s.uid, s]));

  const states = snapshot.students.map((s) => activityState(s, now));
  const enrolledStudents = new Set(snapshot.enrollments.filter((e) => e.status === "active").map((e) => e.studentId));

  const active = snapshot.enrollments.filter((e) => e.status === "active");
  const completions = active
    .map((e) => completionFor(snapshot, e.studentId, e.courseId).percent)
    .filter((p): p is number => p !== null);

  const recentEnrollments = [...snapshot.enrollments]
    .sort((a, b) => (b.enrolledAt ?? "").localeCompare(a.enrolledAt ?? ""))
    .slice(0, 8)
    .map((e) => {
      const student = studentById.get(e.studentId);
      return {
        id: e.id,
        studentId: e.studentId,
        studentName: student?.displayName ?? student?.email ?? "Student",
        courseId: e.courseId,
        courseTitle: courseById.get(e.courseId)?.title ?? "Deleted course",
        status: e.status,
        at: e.enrolledAt,
      };
    });

  return {
    range,
    students: {
      total: snapshot.students.length,
      newInRange: snapshot.students.filter((s) => inRange(s.createdAt, since)).length,
      active: states.filter((s) => s === "active").length,
      inactive: states.filter((s) => s === "inactive").length,
      never: states.filter((s) => s === "never").length,
      notEnrolled: snapshot.students.filter((s) => !enrolledStudents.has(s.uid)).length,
    },
    courses: {
      published: snapshot.courses.filter((c) => c.status === "published").length,
      draft: snapshot.courses.filter((c) => c.status === "draft").length,
      archived: snapshot.courses.filter((c) => c.status === "archived").length,
    },
    enrollments: {
      active: active.length,
      revoked: snapshot.enrollments.filter((e) => e.status === "revoked").length,
      newInRange: snapshot.enrollments.filter((e) => inRange(e.enrolledAt, since)).length,
    },
    averageCompletion: completions.length ? Math.round(completions.reduce((a, b) => a + b, 0) / completions.length) : null,
    completionSample: completions.length,
    recentEnrollments,
  };
}

// --- Student directory ------------------------------------------------------------

export const ACCESS_FILTERS = ["any", "active", "revoked", "none"] as const;
export type AccessFilter = (typeof ACCESS_FILTERS)[number];
export const ACTIVITY_FILTERS = ["any", "active", "inactive", "never"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export interface DirectoryQuery {
  q: string;
  course: string | null;
  access: AccessFilter;
  activity: ActivityFilter;
  page: number;
}

export const PAGE_SIZE = 25;

export function parseDirectoryQuery(params: Record<string, string | string[] | undefined>): DirectoryQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const access = one(params.access);
  const activity = one(params.activity);
  const course = one(params.course);
  const page = Number.parseInt(one(params.page), 10);
  return {
    q: one(params.q).trim().slice(0, 100),
    course: isValidId(course) ? course : null,
    access: (ACCESS_FILTERS as readonly string[]).includes(access) ? (access as AccessFilter) : "any",
    activity: (ACTIVITY_FILTERS as readonly string[]).includes(activity) ? (activity as ActivityFilter) : "any",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

export interface DirectoryRow extends StudentRow {
  lastActivity: string | null;
  activity: ActivityState;
  activeCourses: { id: string; title: string }[];
  revokedCount: number;
  averageCompletion: number | null;
}

export async function listStudents(user: SessionUser, query: DirectoryQuery) {
  assertTeacher(user);
  const snapshot = await loadSnapshot();
  const now = Date.now();
  const courseById = new Map(snapshot.courses.map((c) => [c.id, c]));
  const needle = query.q.toLowerCase();

  const rows: DirectoryRow[] = snapshot.students.map((student) => {
    const own = snapshot.enrollments.filter((e) => e.studentId === student.uid);
    const activeEnrollments = own.filter((e) => e.status === "active");
    const completions = activeEnrollments
      .map((e) => completionFor(snapshot, student.uid, e.courseId).percent)
      .filter((p): p is number => p !== null);
    return {
      ...student,
      lastActivity: lastActivity(student),
      activity: activityState(student, now),
      activeCourses: activeEnrollments.map((e) => ({ id: e.courseId, title: courseById.get(e.courseId)?.title ?? "Deleted course" })),
      revokedCount: own.filter((e) => e.status === "revoked").length,
      averageCompletion: completions.length ? Math.round(completions.reduce((a, b) => a + b, 0) / completions.length) : null,
    };
  });

  const filtered = rows.filter((row) => {
    if (needle && !`${row.displayName ?? ""} ${row.email ?? ""} ${row.phone ?? ""}`.toLowerCase().includes(needle)) return false;
    const own = snapshot.enrollments.filter((e) => e.studentId === row.uid && (!query.course || e.courseId === query.course));
    if (query.course && own.length === 0) return false;
    if (query.access === "active" && !own.some((e) => e.status === "active")) return false;
    if (query.access === "revoked" && !own.some((e) => e.status === "revoked")) return false;
    if (query.access === "none" && own.length > 0) return false;
    if (query.activity !== "any" && row.activity !== query.activity) return false;
    return true;
  });

  filtered.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  return {
    rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    allRows: filtered,
    total: filtered.length,
    page,
    pageCount,
    courses: snapshot.courses.map((c) => ({ id: c.id, title: c.title })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

// --- Student profile ----------------------------------------------------------------

export async function getStudentDetail(user: SessionUser, studentId: string) {
  assertTeacher(user);
  if (!isValidId(studentId)) return null;
  const snapshot = await loadSnapshot();
  const student = snapshot.students.find((s) => s.uid === studentId);
  if (!student) return null;
  const courseById = new Map(snapshot.courses.map((c) => [c.id, c]));

  const enrollmentDocs = await col("enrollments").where("studentId", "==", studentId).get();
  const enrollments = enrollmentDocs.docs.map((doc) => {
    const record = mapEnrollment(doc)!;
    const rawHistory = doc.get("history");
    const history = Array.isArray(rawHistory)
      ? rawHistory
          .map((h: Record<string, unknown>) => ({ type: String(h.type ?? ""), at: toIso(h.at), by: String(h.by ?? ""), note: typeof h.note === "string" ? h.note : null }))
          .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))
      : [];
    const course = courseById.get(record.courseId);
    const courseProgress = snapshot.progress.filter((p) => p.studentId === studentId && p.courseId === record.courseId);
    return {
      ...record,
      courseTitle: course?.title ?? "Deleted course",
      courseStatus: course?.status ?? null,
      completion: completionFor(snapshot, studentId, record.courseId),
      lastAccessedAt: courseProgress.map((p) => p.lastAccessedAt).filter((d): d is string => d !== null).sort().at(-1) ?? null,
      history,
    };
  });
  enrollments.sort((a, b) => (b.enrolledAt ?? "").localeCompare(a.enrolledAt ?? ""));

  const enrolledIds = new Set(enrollments.map((e) => e.courseId));
  return {
    student: { ...student, lastActivity: lastActivity(student), activity: activityState(student, Date.now()) },
    enrollments,
    availableCourses: snapshot.courses
      .filter((c) => !enrolledIds.has(c.id) && c.status !== "archived")
      .map((c) => ({ id: c.id, title: c.title, status: c.status, price: c.price }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

// --- Learning analytics -----------------------------------------------------------------

export interface CourseAnalyticsRow {
  courseId: string;
  title: string;
  status: CourseRecord["status"];
  lessons: number;
  enrollmentsTotal: number;
  enrollmentsActive: number;
  enrollmentsNew: number;
  /** Mean completion % across active enrollments; null without lessons or students. */
  averageCompletion: number | null;
  /** Active enrollments that have completed every lesson. */
  completedStudents: number;
  lessonCompletionsInRange: number;
  reviewAverage: number | null;
  reviewCount: number;
}

export interface WeeklyPoint {
  weekStart: string;
  completions: number;
}

export async function getAnalytics(user: SessionUser, range: DateRange) {
  assertTeacher(user);
  const snapshot = await loadSnapshot();
  const reviewsSnap = await col("reviews").select("courseId", "rating", "status").get();
  const now = Date.now();
  const since = sinceFor(range, now);

  const reviews = reviewsSnap.docs
    .map((d) => ({ courseId: String(d.get("courseId") ?? ""), rating: Number(d.get("rating")), status: String(d.get("status") ?? "") }))
    .filter((r) => Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5);

  const courses: CourseAnalyticsRow[] = snapshot.courses.map((course) => {
    const enrollments = snapshot.enrollments.filter((e) => e.courseId === course.id);
    const active = enrollments.filter((e) => e.status === "active");
    const completions = active.map((e) => completionFor(snapshot, e.studentId, course.id));
    const percents = completions.map((c) => c.percent).filter((p): p is number => p !== null);
    const lessonIds = snapshot.lessonIdsByCourse.get(course.id) ?? new Set<string>();
    // Ratings from actual submitted reviews; hidden reviews are excluded.
    const courseReviews = reviews.filter((r) => r.courseId === course.id && r.status !== "hidden");
    return {
      courseId: course.id,
      title: course.title,
      status: course.status,
      lessons: lessonIds.size,
      enrollmentsTotal: enrollments.length,
      enrollmentsActive: active.length,
      enrollmentsNew: enrollments.filter((e) => inRange(e.enrolledAt, since)).length,
      averageCompletion: percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null,
      completedStudents: completions.filter((c) => c.total > 0 && c.completed === c.total).length,
      lessonCompletionsInRange: snapshot.progress.filter(
        (p) => p.courseId === course.id && p.completed && lessonIds.has(p.lessonId) && inRange(p.completedAt, since),
      ).length,
      reviewAverage: courseReviews.length
        ? Math.round((courseReviews.reduce((a, r) => a + r.rating, 0) / courseReviews.length) * 10) / 10
        : null,
      reviewCount: courseReviews.length,
    };
  });
  courses.sort((a, b) => b.enrollmentsActive - a.enrollmentsActive || a.title.localeCompare(b.title));

  // Lesson completions per week (Monday start, India time) over the range, capped at 26 weeks.
  const weeks = range === "all" ? 26 : Math.min(26, Math.ceil((DATE_RANGES[range] ?? 182) / 7));
  const weekMs = 7 * DAY_MS;
  const istOffset = 330 * 60 * 1000;
  const startOfWeek = (ms: number) => {
    const local = new Date(ms + istOffset);
    const day = (local.getUTCDay() + 6) % 7; // Monday = 0
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day) - istOffset;
  };
  const currentWeek = startOfWeek(now);
  const trend: WeeklyPoint[] = Array.from({ length: weeks }, (_, i) => {
    const start = currentWeek - (weeks - 1 - i) * weekMs;
    const end = start + weekMs;
    return {
      weekStart: new Date(start).toISOString(),
      completions: snapshot.progress.filter((p) => {
        if (!p.completed || !p.completedAt) return false;
        const t = Date.parse(p.completedAt);
        return t >= start && t < end;
      }).length,
    };
  });

  // Inactive learners: active access to at least one course but no activity in the window.
  const studentById = new Map(snapshot.students.map((s) => [s.uid, s]));
  const inactive = [...new Set(snapshot.enrollments.filter((e) => e.status === "active").map((e) => e.studentId))]
    .map((uid) => studentById.get(uid))
    .filter((s): s is StudentRow => s !== undefined && activityState(s, now) !== "active")
    .map((s) => ({ uid: s.uid, name: s.displayName ?? s.email ?? "Student", email: s.email, lastActivity: lastActivity(s) }))
    .sort((a, b) => (a.lastActivity ?? "").localeCompare(b.lastActivity ?? ""));

  const allApproved = reviews.filter((r) => r.status === "approved");
  return {
    range,
    courses,
    trend,
    inactive,
    totals: {
      lessonCompletionsInRange: courses.reduce((a, c) => a + c.lessonCompletionsInRange, 0),
      approvedReviewAverage: allApproved.length
        ? Math.round((allApproved.reduce((a, r) => a + r.rating, 0) / allApproved.length) * 10) / 10
        : null,
      approvedReviewCount: allApproved.length,
    },
  };
}
