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
// session user and re-checks course assignment; none trust ids alone.

export interface TeacherCourseSummary extends CourseRecord {
  moduleCount: number;
  lessonCount: number;
  activeStudentCount: number;
}

export async function listManagedCourses(user: SessionUser): Promise<TeacherCourseSummary[]> {
  if (user.role !== "teacher") return [];
  const snapshot = await col("courses").where("teacherIds", "array-contains", user.uid).get();
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

/** Course plus its module/lesson outline, or null if the teacher does not manage it. */
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
