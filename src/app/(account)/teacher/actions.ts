"use server";

import { randomUUID } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { TEACHER_CLAIMS } from "@/lib/auth/constants";
import { CATALOG_TAG } from "@/lib/catalog/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import {
  AccessError,
  authorizeTeacherForCourse,
  requireActionUser,
  runAction,
} from "@/lib/lms/server/access";
import { col, db, mapLesson, mapModule } from "@/lib/lms/server/db";
import {
  createUploadTicket,
  deleteAsset,
  verifyUploadedAsset,
  type UploadReceipt,
  type UploadTicket,
} from "@/lib/media/cloudinary";
import { toApprovedVideoEmbed, type UploadKind } from "@/lib/media/config";
import {
  COURSE_STATUSES,
  ENROLLMENT_STATUSES,
  LANGUAGES,
  RESOURCE_TYPES,
  enrollmentId,
  type ActionResult,
  type CourseStatus,
  type EnrollmentStatus,
  type Language,
} from "@/lib/lms/types";
import {
  cleanEmail,
  cleanText,
  isValidId,
  LIMITS,
  parseBilingualText,
  parseCatalogInput,
  slugify,
} from "@/lib/lms/validation";

// Teacher mutations. Every action re-authorises from the session cookie and
// re-checks that the teacher is assigned to the course: rendering a button
// on a teacher page is not a security boundary.

type Direction = "up" | "down";

/** Expire the cached public catalogue so the website shows the change immediately. */
function invalidateCatalog() {
  updateTag(CATALOG_TAG);
}

/** Marks the course as changed (outline edits also change its public curriculum). */
async function touchCourse(courseId: string) {
  await col("courses").doc(courseId).update({ updatedAt: FieldValue.serverTimestamp() });
  invalidateCatalog();
}

function parseText(input: unknown) {
  const { value, errors } = parseBilingualText((input ?? {}) as Record<string, unknown>);
  if (Object.keys(errors).length > 0) {
    throw new AccessError("Please fix the highlighted fields.", errors);
  }
  return value;
}

function assertDirection(direction: unknown): asserts direction is Direction {
  if (direction !== "up" && direction !== "down") throw new AccessError("Invalid move.");
}

/** Swaps an item with its neighbour and renumbers the list 0..n-1. */
function reorder<T extends { id: string }>(items: T[], id: string, direction: Direction): T[] | null {
  const index = items.findIndex((item) => item.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= items.length) return null;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// --- Courses -------------------------------------------------------------------

async function uniqueSlug(base: string): Promise<string> {
  const root = base || "course";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [bySlug, byId] = await Promise.all([
      col("courses").where("slug", "==", candidate).limit(1).get(),
      col("courses").doc(candidate).get(),
    ]);
    if (bySlug.empty && !byId.exists) return candidate;
  }
  return `${root}-${randomUUID().slice(0, 8)}`;
}

const EMPTY_CATALOG_FIELDS = {
  subtitle: "",
  subtitleMl: "",
  level: null,
  category: null,
  format: null,
  duration: "",
  ageGroup: "",
  instructor: "",
  price: null,
  originalPrice: null,
  tag: null,
  featured: false,
  outcomes: [],
  outcomesMl: [],
};

export async function createCourse(input: unknown): Promise<ActionResult<{ courseId: string }>> {
  return runAction("createCourse", async () => {
    const user = await requireActionUser("teacher");
    const text = parseText(input);
    const ref = col("courses").doc();
    await ref.create({
      id: ref.id,
      slug: await uniqueSlug(slugify(text.title)),
      ...text,
      thumbnailUrl: null,
      thumbnailPublicId: null,
      ...EMPTY_CATALOG_FIELDS,
      status: "draft" satisfies CourseStatus,
      teacherIds: [user.uid],
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { courseId: ref.id };
  });
}

export async function updateCourseDetails(courseId: string, input: unknown): Promise<ActionResult> {
  return runAction("updateCourseDetails", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const text = parseText(input);
    await col("courses").doc(course.id).update({ ...text, updatedAt: FieldValue.serverTimestamp() });
    invalidateCatalog();
    refresh();
    return null;
  });
}

/**
 * Public catalogue details (subtitle, level, fees, outcomes …). The URL slug
 * can only change while the course is a draft, so published links never break.
 */
export async function updateCourseCatalog(courseId: string, input: unknown): Promise<ActionResult> {
  return runAction("updateCourseCatalog", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const { value, errors } = parseCatalogInput((input ?? {}) as Record<string, unknown>);
    if (Object.keys(errors).length > 0) throw new AccessError("Please fix the highlighted fields.", errors);

    const { slug: requestedSlug, ...fields } = value;
    let slug = course.slug;
    if (requestedSlug && requestedSlug !== course.slug) {
      if (course.status === "published") {
        throw new AccessError("Unpublish the course before changing its web address.", {
          slug: "The web address of a published course cannot be changed.",
        });
      }
      const taken = await col("courses").where("slug", "==", requestedSlug).limit(2).get();
      if (taken.docs.some((doc) => doc.id !== course.id)) {
        throw new AccessError("Please fix the highlighted fields.", { slug: "Another course already uses this web address." });
      }
      slug = requestedSlug;
    }

    await col("courses").doc(course.id).update({ ...fields, slug, updatedAt: FieldValue.serverTimestamp() });
    invalidateCatalog();
    refresh();
    return null;
  });
}

export async function setCourseStatus(courseId: string, status: unknown): Promise<ActionResult> {
  return runAction("setCourseStatus", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    if (!COURSE_STATUSES.includes(status as CourseStatus)) throw new AccessError("Invalid status.");
    if (status === "published") {
      const lessons = await col("lessons").where("courseId", "==", course.id).limit(1).get();
      if (lessons.empty) {
        throw new AccessError("Add at least one lesson before publishing this course.");
      }
    }
    await col("courses").doc(course.id).update({ status, updatedAt: FieldValue.serverTimestamp() });
    invalidateCatalog();
    refresh();
    return null;
  });
}

// --- Thumbnails ---------------------------------------------------------------

export async function createThumbnailUpload(courseId: string): Promise<ActionResult<UploadTicket>> {
  return runAction("createThumbnailUpload", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    return createUploadTicket(course.id, "image", "thumbnail");
  });
}

export async function saveCourseThumbnail(courseId: string, receipt: UploadReceipt): Promise<ActionResult> {
  return runAction("saveCourseThumbnail", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const asset = await verifyUploadedAsset(course.id, "image", "thumbnail", receipt);
    await col("courses").doc(course.id).update({
      thumbnailUrl: asset.url,
      thumbnailPublicId: asset.publicId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (course.thumbnailPublicId && course.thumbnailPublicId !== asset.publicId) {
      await deleteAsset(course.thumbnailPublicId, "image");
    }
    invalidateCatalog();
    refresh();
    return null;
  });
}

export async function removeCourseThumbnail(courseId: string): Promise<ActionResult> {
  return runAction("removeCourseThumbnail", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    await col("courses").doc(course.id).update({
      thumbnailUrl: null,
      thumbnailPublicId: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (course.thumbnailPublicId) await deleteAsset(course.thumbnailPublicId, "image");
    invalidateCatalog();
    refresh();
    return null;
  });
}

// --- Modules ------------------------------------------------------------------

async function nextOrder(collection: "modules" | "lessons", field: "courseId" | "moduleId", value: string) {
  const snapshot = await col(collection).where(field, "==", value).get();
  return snapshot.docs.reduce((max, doc) => Math.max(max, Number(doc.get("order")) || 0), -1) + 1;
}

async function getModuleOfCourse(courseId: string, moduleId: unknown) {
  if (!isValidId(moduleId)) throw new AccessError("That module could not be found.");
  const moduleRecord = mapModule(await col("modules").doc(moduleId).get());
  if (!moduleRecord || moduleRecord.courseId !== courseId) {
    throw new AccessError("That module could not be found.");
  }
  return moduleRecord;
}

export async function createModule(courseId: string, input: unknown): Promise<ActionResult<{ moduleId: string }>> {
  return runAction("createModule", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const text = parseText(input);
    const ref = col("modules").doc();
    await ref.create({
      id: ref.id,
      courseId: course.id,
      ...text,
      order: await nextOrder("modules", "courseId", course.id),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await touchCourse(course.id);
    refresh();
    return { moduleId: ref.id };
  });
}

export async function updateModule(courseId: string, moduleId: string, input: unknown): Promise<ActionResult> {
  return runAction("updateModule", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const moduleRecord = await getModuleOfCourse(course.id, moduleId);
    const text = parseText(input);
    await col("modules").doc(moduleRecord.id).update({ ...text, updatedAt: FieldValue.serverTimestamp() });
    await touchCourse(course.id);
    refresh();
    return null;
  });
}

export async function deleteModule(courseId: string, moduleId: string): Promise<ActionResult> {
  return runAction("deleteModule", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const moduleRecord = await getModuleOfCourse(course.id, moduleId);
    const lessons = await col("lessons").where("moduleId", "==", moduleRecord.id).limit(1).get();
    if (!lessons.empty) {
      throw new AccessError("Delete or move this module's lessons before deleting the module.");
    }
    await col("modules").doc(moduleRecord.id).delete();
    await touchCourse(course.id);
    refresh();
    return null;
  });
}

export async function moveModule(courseId: string, moduleId: string, direction: unknown): Promise<ActionResult> {
  return runAction("moveModule", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    assertDirection(direction);
    await db().runTransaction(async (tx) => {
      const snapshot = await tx.get(col("modules").where("courseId", "==", course.id));
      const modules = snapshot.docs
        .map(mapModule)
        .filter((m) => m !== null)
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
      const next = reorder(modules, moduleId, direction);
      if (!next) return;
      next.forEach((m, order) => tx.update(col("modules").doc(m.id), { order }));
    });
    await touchCourse(course.id);
    refresh();
    return null;
  });
}

// --- Lessons ------------------------------------------------------------------

async function getLessonOfCourse(courseId: string, lessonId: unknown) {
  if (!isValidId(lessonId)) throw new AccessError("That lesson could not be found.");
  const lesson = mapLesson(await col("lessons").doc(lessonId).get());
  if (!lesson || lesson.courseId !== courseId) throw new AccessError("That lesson could not be found.");
  return lesson;
}

export async function createLesson(
  courseId: string,
  moduleId: string,
  input: unknown,
): Promise<ActionResult<{ lessonId: string }>> {
  return runAction("createLesson", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const moduleRecord = await getModuleOfCourse(course.id, moduleId);
    const text = parseText(input);
    const ref = col("lessons").doc();
    await ref.create({
      id: ref.id,
      courseId: course.id,
      moduleId: moduleRecord.id,
      ...text,
      order: await nextOrder("lessons", "moduleId", moduleRecord.id),
      resources: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await touchCourse(course.id);
    refresh();
    return { lessonId: ref.id };
  });
}

export async function updateLesson(courseId: string, lessonId: string, input: unknown): Promise<ActionResult> {
  return runAction("updateLesson", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const lesson = await getLessonOfCourse(course.id, lessonId);
    const text = parseText(input);
    await col("lessons").doc(lesson.id).update({ ...text, updatedAt: FieldValue.serverTimestamp() });
    await touchCourse(course.id);
    refresh();
    return null;
  });
}

export async function deleteLesson(courseId: string, lessonId: string): Promise<ActionResult> {
  return runAction("deleteLesson", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const lesson = await getLessonOfCourse(course.id, lessonId);
    await col("lessons").doc(lesson.id).delete();
    // Uploaded files belong only to this lesson; remove them from Cloudinary too.
    await Promise.all(
      lesson.resources
        .filter((r) => r.source === "cloudinary" && r.publicId && r.cloudinaryResourceType)
        .map((r) => deleteAsset(r.publicId!, r.cloudinaryResourceType!)),
    );
    await touchCourse(course.id);
    // The lesson page no longer exists; go back to the course.
    redirect(`/teacher/courses/${course.id}`);
  });
}

export async function moveLesson(courseId: string, lessonId: string, direction: unknown): Promise<ActionResult> {
  return runAction("moveLesson", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    assertDirection(direction);
    const lesson = await getLessonOfCourse(course.id, lessonId);
    await db().runTransaction(async (tx) => {
      const snapshot = await tx.get(col("lessons").where("moduleId", "==", lesson.moduleId));
      const lessons = snapshot.docs
        .map(mapLesson)
        .filter((l) => l !== null && l.courseId === course.id)
        .map((l) => l!)
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
      const next = reorder(lessons, lesson.id, direction);
      if (!next) return;
      next.forEach((l, order) => tx.update(col("lessons").doc(l.id), { order }));
    });
    await touchCourse(course.id);
    refresh();
    return null;
  });
}

// --- Lesson resources ---------------------------------------------------------

function parseLanguage(value: unknown): Language {
  if (!LANGUAGES.includes(value as Language)) throw new AccessError("Please choose English or Malayalam.");
  return value as Language;
}

function parseKind(value: unknown): UploadKind {
  if (!RESOURCE_TYPES.includes(value as UploadKind)) throw new AccessError("Unsupported resource type.");
  return value as UploadKind;
}

function parseResourceTitle(value: unknown): string {
  const title = cleanText(value, LIMITS.resourceTitle);
  if (!title) throw new AccessError("Please fix the highlighted fields.", { title: "Please enter a title." });
  return title;
}

/** Applies a change to a lesson's resources array inside a transaction. */
async function updateResources(
  courseId: string,
  lessonId: string,
  change: (resources: Record<string, unknown>[]) => Record<string, unknown>[],
) {
  const ref = col("lessons").doc(lessonId);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.get("courseId") !== courseId) {
      throw new AccessError("That lesson could not be found.");
    }
    const current = Array.isArray(snapshot.get("resources")) ? (snapshot.get("resources") as Record<string, unknown>[]) : [];
    tx.update(ref, { resources: change(current), updatedAt: FieldValue.serverTimestamp() });
  });
}

function nextResourceOrder(resources: Record<string, unknown>[], language: Language) {
  return (
    resources
      .filter((r) => r.language === language)
      .reduce((max, r) => Math.max(max, Number(r.order) || 0), -1) + 1
  );
}

export async function createResourceUpload(
  courseId: string,
  lessonId: string,
  kind: unknown,
): Promise<ActionResult<UploadTicket>> {
  return runAction("createResourceUpload", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    await getLessonOfCourse(course.id, lessonId);
    return createUploadTicket(course.id, parseKind(kind), "resource");
  });
}

export interface UploadedResourceInput {
  kind: UploadKind;
  language: Language;
  title: string;
  fileName: string;
  downloadable: boolean;
  receipt: UploadReceipt;
}

export async function addUploadedResource(
  courseId: string,
  lessonId: string,
  input: UploadedResourceInput,
): Promise<ActionResult> {
  return runAction("addUploadedResource", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const lesson = await getLessonOfCourse(course.id, lessonId);
    const kind = parseKind(input?.kind);
    const language = parseLanguage(input?.language);
    const title = parseResourceTitle(input?.title);
    const asset = await verifyUploadedAsset(course.id, kind, "resource", input.receipt);

    try {
      await updateResources(course.id, lesson.id, (resources) => [
        ...resources,
        {
          id: randomUUID(),
          title,
          type: kind,
          language,
          source: "cloudinary",
          url: asset.url,
          publicId: asset.publicId,
          cloudinaryResourceType: asset.resourceType,
          fileName: cleanText(input.fileName, 200) || null,
          format: asset.format,
          bytes: asset.bytes,
          downloadable: (kind === "pdf" || kind === "image") && input.downloadable === true,
          order: nextResourceOrder(resources, language),
          createdAt: Timestamp.now(),
        },
      ]);
    } catch (error) {
      // Do not leave an orphaned file behind if the record could not be saved.
      await deleteAsset(asset.publicId, asset.resourceType);
      throw error;
    }
    await touchCourse(course.id);
    refresh();
    return null;
  });
}

export async function addExternalVideo(
  courseId: string,
  lessonId: string,
  input: { language: unknown; title: unknown; url: unknown },
): Promise<ActionResult> {
  return runAction("addExternalVideo", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const lesson = await getLessonOfCourse(course.id, lessonId);
    const language = parseLanguage(input?.language);
    const title = parseResourceTitle(input?.title);
    const embed = toApprovedVideoEmbed(cleanText(input?.url, LIMITS.url));
    if (!embed) {
      throw new AccessError("Please fix the highlighted fields.", {
        url: "Enter a YouTube or Vimeo video link (https://…).",
      });
    }
    await updateResources(course.id, lesson.id, (resources) => [
      ...resources,
      {
        id: randomUUID(),
        title,
        type: "video",
        language,
        source: "external",
        url: embed,
        publicId: null,
        cloudinaryResourceType: null,
        fileName: null,
        format: null,
        bytes: null,
        downloadable: false,
        order: nextResourceOrder(resources, language),
        createdAt: Timestamp.now(),
      },
    ]);
    await touchCourse(course.id);
    refresh();
    return null;
  });
}

export async function updateResource(
  courseId: string,
  lessonId: string,
  resourceId: string,
  input: { title: unknown; language: unknown; downloadable: unknown },
): Promise<ActionResult> {
  return runAction("updateResource", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const lesson = await getLessonOfCourse(course.id, lessonId);
    const title = parseResourceTitle(input?.title);
    const language = parseLanguage(input?.language);
    let found = false;
    await updateResources(course.id, lesson.id, (resources) =>
      resources.map((r) => {
        if (r.id !== resourceId) return r;
        found = true;
        const languageChanged = r.language !== language;
        return {
          ...r,
          title,
          language,
          downloadable: (r.type === "pdf" || r.type === "image") && input.downloadable === true,
          order: languageChanged ? nextResourceOrder(resources, language) : r.order,
        };
      }),
    );
    if (!found) throw new AccessError("That resource could not be found.");
    await touchCourse(course.id);
    refresh();
    return null;
  });
}

export async function deleteResource(courseId: string, lessonId: string, resourceId: string): Promise<ActionResult> {
  return runAction("deleteResource", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    const lesson = await getLessonOfCourse(course.id, lessonId);
    const resource = lesson.resources.find((r) => r.id === resourceId);
    if (!resource) throw new AccessError("That resource could not be found.");
    await updateResources(course.id, lesson.id, (resources) => resources.filter((r) => r.id !== resourceId));
    if (resource.source === "cloudinary" && resource.publicId && resource.cloudinaryResourceType) {
      await deleteAsset(resource.publicId, resource.cloudinaryResourceType);
    }
    await touchCourse(course.id);
    refresh();
    return null;
  });
}

export async function moveResource(
  courseId: string,
  lessonId: string,
  resourceId: string,
  direction: unknown,
): Promise<ActionResult> {
  return runAction("moveResource", async () => {
    const { course } = await authorizeTeacherForCourse(courseId);
    assertDirection(direction);
    const lesson = await getLessonOfCourse(course.id, lessonId);
    const resource = lesson.resources.find((r) => r.id === resourceId);
    if (!resource) throw new AccessError("That resource could not be found.");
    await updateResources(course.id, lesson.id, (resources) => {
      // Reorder within the resource's language only.
      const sameLanguage = resources
        .filter((r) => r.language === resource.language)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)) as ({ id: string } & Record<string, unknown>)[];
      const next = reorder(sameLanguage, resourceId, direction);
      if (!next) return resources;
      const orders = new Map(next.map((r, order) => [r.id, order]));
      return resources.map((r) => (orders.has(r.id as string) ? { ...r, order: orders.get(r.id as string) } : r));
    });
    refresh();
    return null;
  });
}

// --- Enrollments --------------------------------------------------------------

export async function enrollStudentByEmail(courseId: string, emailInput: unknown): Promise<ActionResult<{ name: string }>> {
  return runAction("enrollStudentByEmail", async () => {
    const { user, course } = await authorizeTeacherForCourse(courseId);
    const email = cleanEmail(emailInput);
    if (!email) {
      throw new AccessError("Please fix the highlighted fields.", { email: "Enter a valid email address." });
    }

    let student;
    try {
      student = await getAdminAuth().getUserByEmail(email);
    } catch (error) {
      if ((error as { code?: string })?.code === "auth/user-not-found") {
        throw new AccessError("No student account uses that email. Ask the student to register on the site first.", {
          email: "No account found for this email.",
        });
      }
      throw error;
    }
    const claim = student.customClaims?.role;
    if (typeof claim === "string" && TEACHER_CLAIMS.includes(claim)) {
      throw new AccessError("That account belongs to a teacher, not a student.");
    }
    if (student.disabled) throw new AccessError("That account is disabled.");

    const ref = col("enrollments").doc(enrollmentId(course.id, student.uid));
    const outcome = await db().runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists && existing.get("status") === "active") return "already" as const;
      tx.set(ref, {
        id: ref.id,
        studentId: student.uid,
        courseId: course.id,
        status: "active" satisfies EnrollmentStatus,
        enrolledAt: FieldValue.serverTimestamp(),
        enrolledBy: user.uid,
        revokedAt: null,
        revokedBy: null,
      });
      return existing.exists ? ("restored" as const) : ("created" as const);
    });
    if (outcome === "already") throw new AccessError("This student is already enrolled.");
    refresh();
    return { name: student.displayName || email };
  });
}

export async function setEnrollmentStatus(
  courseId: string,
  studentId: string,
  status: unknown,
): Promise<ActionResult> {
  return runAction("setEnrollmentStatus", async () => {
    const { user, course } = await authorizeTeacherForCourse(courseId);
    if (!isValidId(studentId)) throw new AccessError("That enrollment could not be found.");
    if (!ENROLLMENT_STATUSES.includes(status as EnrollmentStatus)) throw new AccessError("Invalid status.");
    const ref = col("enrollments").doc(enrollmentId(course.id, studentId));
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.get("courseId") !== course.id) {
      throw new AccessError("That enrollment could not be found.");
    }
    await ref.update(
      status === "revoked"
        ? { status, revokedAt: FieldValue.serverTimestamp(), revokedBy: user.uid }
        : { status, enrolledAt: FieldValue.serverTimestamp(), enrolledBy: user.uid, revokedAt: null, revokedBy: null },
    );
    refresh();
    return null;
  });
}

