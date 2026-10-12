import "server-only";

import type { SessionUser } from "@/lib/auth/session";
import { getManagedCourse } from "@/lib/lms/server/access";
import {
  buildOutline,
  col,
  db,
  mapCourse,
  mapEnrollment,
  readLesson,
  readLessons,
  readModules,
  summarizeLesson,
} from "@/lib/lms/server/db";
import type { CourseRecord, EnrollmentRecord } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Read models for the teacher dashboard. Every function takes the verified
// session user and re-checks the teacher role; none trust ids alone.

export interface TeacherCourseSummary extends CourseRecord {
  moduleCount: number;
  lessonCount: number;
  activeStudentCount: number;
}

export async function listManagedCourses(user: SessionUser): Promise<TeacherCourseSummary[]> {
  if (user.role !== "teacher") return [];
  const snapshot = await col("courses").get();
  const courses = snapshot.docs.map(mapCourse).filter((c): c is CourseRecord => c !== null);

  const summaries = await Promise.all(
    courses.map(async (course) => {
      const [modules, lessons, students] = await Promise.all([
        col("modules").where("courseId", "==", course.id).count().get(),
        col("lessons").where("courseId", "==", course.id).count().get(),
        col("enrollments")
          .where("courseId", "==", course.id)
          .where("status", "==", "active")
          .count()
          .get(),
      ]);
      return {
        ...course,
        moduleCount: modules.data().count,
        lessonCount: lessons.data().count,
        activeStudentCount: students.data().count,
      };
    }),
  );
  return summaries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** Course plus its module/lesson outline, or null when the course does not exist. */
export async function getCourseForEditing(user: SessionUser, courseId: string) {
  const course = await getManagedCourse(user, courseId);
  if (!course) return null;
  const [modules, lessons] = await Promise.all([readModules(course.id), readLessons(course.id)]);
  return { course, outline: buildOutline(modules, lessons.map(summarizeLesson)) };
}

export async function getLessonForEditing(user: SessionUser, courseId: string, lessonId: string) {
  const course = await getManagedCourse(user, courseId);
  if (!course || !isValidId(lessonId)) return null;
  const lesson = await readLesson(lessonId);
  if (!lesson || lesson.courseId !== course.id) return null;
  const modules = await readModules(course.id);
  const parentModule = modules.find((m) => m.id === lesson.moduleId) ?? null;
  return { course, lesson, module: parentModule };
}

export interface CourseStudent {
  enrollment: EnrollmentRecord;
  displayName: string | null;
  email: string | null;
}

export async function listCourseStudents(user: SessionUser, courseId: string) {
  const course = await getManagedCourse(user, courseId);
  if (!course) return null;

  const snapshot = await col("enrollments").where("courseId", "==", course.id).get();
  const enrollments = snapshot.docs
    .map(mapEnrollment)
    .filter((e): e is EnrollmentRecord => e !== null);

  const profiles = enrollments.length
    ? await db().getAll(...enrollments.map((e) => col("users").doc(e.studentId)))
    : [];
  const byId = new Map(profiles.map((p) => [p.id, p.data()]));

  const students: CourseStudent[] = enrollments
    .map((enrollment) => {
      const profile = byId.get(enrollment.studentId);
      return {
        enrollment,
        displayName: typeof profile?.displayName === "string" ? profile.displayName : null,
        email: typeof profile?.email === "string" ? profile.email : null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.enrollment.status === "active") - Number(a.enrollment.status === "active") ||
        (b.enrollment.enrolledAt ?? "").localeCompare(a.enrollment.enrolledAt ?? ""),
    );

  return { course, students };
}

/**
 * Teacher preview of the student view: outline plus one lesson with its
 * resources. Works for any status (draft, published, archived).
 */
export async function getCoursePreview(user: SessionUser, courseId: string, lessonId: string | null) {
  const course = await getManagedCourse(user, courseId);
  if (!course) return null;
  const [modules, lessons] = await Promise.all([readModules(course.id), readLessons(course.id)]);
  const outline = buildOutline(
    modules,
    lessons.map((l) => ({ ...summarizeLesson(l), completed: false })),
  );
  const ordered = outline.flatMap((m) => m.lessons);
  const currentId = lessonId && isValidId(lessonId) && ordered.some((l) => l.id === lessonId) ? lessonId : ordered[0]?.id ?? null;
  const lesson = currentId ? lessons.find((l) => l.id === currentId) ?? null : null;
  const index = currentId ? ordered.findIndex((l) => l.id === currentId) : -1;
  return {
    course,
    outline,
    lesson,
    module: lesson ? modules.find((m) => m.id === lesson.moduleId) ?? null : null,
    previous: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
  };
}
