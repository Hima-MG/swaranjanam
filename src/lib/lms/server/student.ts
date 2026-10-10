import "server-only";

import type { SessionUser } from "@/lib/auth/session";
import { getStudentCourseAccess } from "@/lib/lms/server/access";
import {
  buildOutline,
  col,
  db,
  mapCourse,
  mapEnrollment,
  mapProgress,
  readLesson,
  readLessons,
  readModules,
  summarizeLesson,
} from "@/lib/lms/server/db";
import {
  progressId,
  type CourseRecord,
  type EnrollmentRecord,
  type LessonProgressRecord,
  type LessonRecord,
  type StudentLessonSummary,
} from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Read models for the student dashboard. Lesson content (resources) is only
// returned after getStudentCourseAccess confirms an active enrollment in a
// published course.

export interface CourseProgress {
  totalLessons: number;
  completedLessons: number;
  percent: number;
}

function computeProgress(lessons: { id: string }[], progress: Map<string, LessonProgressRecord>): CourseProgress {
  const totalLessons = lessons.length;
  const completedLessons = lessons.filter((l) => progress.get(l.id)?.completed).length;
  return {
    totalLessons,
    completedLessons,
    percent: totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100),
  };
}

async function readStudentProgress(studentId: string, courseId?: string) {
  let query = col("lessonProgress").where("studentId", "==", studentId);
  if (courseId) query = query.where("courseId", "==", courseId);
  const snapshot = await query.get();
  return new Map(
    snapshot.docs
      .map(mapProgress)
      .filter((p): p is LessonProgressRecord => p !== null)
      .map((p) => [p.lessonId, p]),
  );
}

/** First lesson not yet completed, else the first lesson. */
function nextLessonToStudy(lessons: LessonRecord[], progress: Map<string, LessonProgressRecord>) {
  return lessons.find((l) => !progress.get(l.id)?.completed) ?? lessons[0] ?? null;
}

export interface DashboardCourse {
  course: CourseRecord;
  enrollment: EnrollmentRecord;
  progress: CourseProgress;
  /** Lesson to open from "Continue". */
  nextLesson: Pick<LessonRecord, "id" | "title" | "titleMl"> | null;
  lastAccessedAt: string | null;
}

export interface StudentOverview {
  courses: DashboardCourse[];
  /** Enrolled courses that are currently unpublished by the teacher. */
  unavailableCount: number;
  resume: { courseId: string; courseTitle: string; lessonId: string; lessonTitle: string } | null;
}

export async function getStudentOverview(user: SessionUser): Promise<StudentOverview> {
  const empty: StudentOverview = { courses: [], unavailableCount: 0, resume: null };
  if (user.role !== "student") return empty;

  const enrollmentSnapshot = await col("enrollments").where("studentId", "==", user.uid).get();
  const enrollments = enrollmentSnapshot.docs
    .map(mapEnrollment)
    .filter((e): e is EnrollmentRecord => e?.status === "active");
  if (enrollments.length === 0) return empty;

  const [courseSnapshots, progress] = await Promise.all([
    db().getAll(...enrollments.map((e) => col("courses").doc(e.courseId))),
    readStudentProgress(user.uid),
  ]);
  const courses = new Map(
    courseSnapshots.map(mapCourse).filter((c): c is CourseRecord => c !== null).map((c) => [c.id, c]),
  );

  let unavailableCount = 0;
  const items: DashboardCourse[] = [];
  const lessonsByCourse = new Map<string, LessonRecord[]>();
  for (const enrollment of enrollments) {
    const course = courses.get(enrollment.courseId);
    if (!course || course.status !== "published") {
      unavailableCount += 1;
      continue;
    }
    const lessons = await readLessons(course.id);
    lessonsByCourse.set(course.id, lessons);
    const lastAccessedAt =
      lessons
        .map((l) => progress.get(l.id)?.lastAccessedAt ?? null)
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1) ?? null;
    const next = nextLessonToStudy(lessons, progress);
    items.push({
      course,
      enrollment,
      progress: computeProgress(lessons, progress),
      nextLesson: next ? { id: next.id, title: next.title, titleMl: next.titleMl } : null,
      lastAccessedAt,
    });
  }

  // Resume: the most recently opened lesson that still exists in a published course.
  let resume: StudentOverview["resume"] = null;
  const recent = [...progress.values()]
    .filter((p) => p.lastAccessedAt)
    .sort((a, b) => (b.lastAccessedAt ?? "").localeCompare(a.lastAccessedAt ?? ""));
  for (const entry of recent) {
    const item = items.find((i) => i.course.id === entry.courseId);
    const lesson = lessonsByCourse.get(entry.courseId)?.find((l) => l.id === entry.lessonId);
    if (!item) continue;
    if (!lesson) continue;
    resume = { courseId: item.course.id, courseTitle: item.course.title, lessonId: lesson.id, lessonTitle: lesson.title };
    break;
  }

  items.sort((a, b) => (b.lastAccessedAt ?? b.enrollment.enrolledAt ?? "").localeCompare(a.lastAccessedAt ?? a.enrollment.enrolledAt ?? ""));
  return { courses: items, unavailableCount, resume };
}

/** Course outline with per-lesson completion. Null without access. */
export async function getStudentCourse(user: SessionUser, courseId: string) {
  const access = await getStudentCourseAccess(user, courseId);
  if (!access) return null;
  const [modules, lessons, progress] = await Promise.all([
    readModules(courseId),
    readLessons(courseId),
    readStudentProgress(user.uid, courseId),
  ]);
  const summaries: StudentLessonSummary[] = lessons.map((l) => ({
    ...summarizeLesson(l),
    completed: progress.get(l.id)?.completed ?? false,
  }));
  return {
    course: access.course,
    outline: buildOutline(modules, summaries),
    progress: computeProgress(lessons, progress),
    nextLessonId: nextLessonToStudy(lessons, progress)?.id ?? null,
  };
}

/** A lesson with its resources, plus neighbours for navigation. Null without access. */
export async function getStudentLesson(user: SessionUser, courseId: string, lessonId: string) {
  if (!isValidId(lessonId)) return null;
  const course = await getStudentCourse(user, courseId);
  if (!course) return null;

  const ordered = course.outline.flatMap((m) => m.lessons);
  const index = ordered.findIndex((l) => l.id === lessonId);
  if (index === -1) return null;

  // The full lesson (with resources) is read only after access is confirmed.
  const [lesson, progressSnapshot] = await Promise.all([
    readLesson(lessonId),
    col("lessonProgress").doc(progressId(user.uid, lessonId)).get(),
  ]);
  if (!lesson || lesson.courseId !== course.course.id) return null;

  const parentModule = course.outline.find((m) => m.id === lesson.moduleId) ?? null;

  return {
    course: course.course,
    outline: course.outline,
    progress: course.progress,
    module: parentModule,
    lesson,
    completed: mapProgress(progressSnapshot)?.completed ?? false,
    previous: ordered[index - 1] ?? null,
    next: ordered[index + 1] ?? null,
  };
}
