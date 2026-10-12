"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh } from "next/cache";

import { AccessError, authorizeStudentForCourse, requireActionUser, runAction } from "@/lib/lms/server/access";
import { col, db } from "@/lib/lms/server/db";
import { mapSubmission } from "@/lib/lms/server/feedback";
import {
  createSubmissionUploadTicket,
  deleteAsset,
  verifySubmissionAsset,
  type UploadReceipt,
  type UploadTicket,
} from "@/lib/media/cloudinary";
import { reviewId, type ActionResult } from "@/lib/lms/types";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Student practice submissions and course reviews.
//  * Every action re-checks the student session and an active enrollment.
//  * Uploads are signed into the student's own Cloudinary folder and
//    re-verified on the server before anything is saved.
//  * A student can only ever touch documents whose studentId is their own uid.

const MAX_ATTEMPTS = 10;
const MAX_OPEN_PER_LESSON = 5;

function parseKind(value: unknown): "audio" | "video" {
  if (value !== "audio" && value !== "video") throw new AccessError("Choose audio or video.");
  return value;
}

async function lessonInCourse(courseId: string, lessonId: unknown): Promise<{ lessonId: string | null; moduleId: string | null }> {
  if (lessonId === null || lessonId === undefined || lessonId === "") return { lessonId: null, moduleId: null };
  if (!isValidId(lessonId)) throw new AccessError("That lesson could not be found.");
  const lesson = await col("lessons").doc(lessonId).get();
  if (!lesson.exists || lesson.get("courseId") !== courseId) throw new AccessError("That lesson could not be found.");
  return { lessonId, moduleId: typeof lesson.get("moduleId") === "string" ? lesson.get("moduleId") : null };
}

export async function createPracticeUpload(courseId: string, kind: unknown): Promise<ActionResult<UploadTicket>> {
  return runAction("createPracticeUpload", async () => {
    const { user } = await authorizeStudentForCourse(courseId);
    return createSubmissionUploadTicket(user.uid, parseKind(kind));
  });
}

export interface PracticeInput {
  kind: unknown;
  title: unknown;
  note: unknown;
  fileName: unknown;
  receipt: UploadReceipt;
}

function attemptFrom(number: number, kind: "audio" | "video", asset: Awaited<ReturnType<typeof verifySubmissionAsset>>, input: PracticeInput) {
  return {
    number,
    kind,
    url: asset.url,
    publicId: asset.publicId,
    format: asset.format,
    bytes: asset.bytes,
    fileName: cleanText(input.fileName, 200) || null,
    note: cleanText(input.note, 1000) || null,
    submittedAt: Timestamp.now(),
  };
}

/** New submission for a course (and optionally one of its lessons). */
export async function submitPractice(courseId: string, lessonIdInput: unknown, input: PracticeInput): Promise<ActionResult> {
  return runAction("submitPractice", async () => {
    const { user, course } = await authorizeStudentForCourse(courseId);
    const kind = parseKind(input?.kind);
    const { lessonId, moduleId } = await lessonInCourse(course.id, lessonIdInput);
    const title = cleanText(input?.title, 150);
    if (!title) throw new AccessError("Please fix the highlighted fields.", { title: "Give your recording a title." });

    if (lessonId) {
      const open = await col("submissions")
        .where("studentId", "==", user.uid)
        .where("lessonId", "==", lessonId)
        .where("status", "==", "pending_review")
        .count()
        .get();
      if (open.data().count >= MAX_OPEN_PER_LESSON) {
        throw new AccessError("You already have several recordings waiting for review for this lesson. Please wait for feedback.");
      }
    }

    const asset = await verifySubmissionAsset(user.uid, kind, input.receipt);
    try {
      const ref = col("submissions").doc();
      await ref.create({
        studentId: user.uid,
        courseId: course.id,
        moduleId,
        lessonId,
        title,
        status: "pending_review",
        attempts: [attemptFrom(1, kind, asset, input)],
        feedback: [],
        createdAt: FieldValue.serverTimestamp(),
        lastSubmittedAt: FieldValue.serverTimestamp(),
        reviewedAt: null,
      });
    } catch (error) {
      await deleteAsset(asset.publicId, asset.resourceType);
      throw error;
    }
    await col("users").doc(user.uid).set({ lastActiveAt: FieldValue.serverTimestamp() }, { merge: true });
    refresh();
    return null;
  });
}

/** A new attempt on the student's own submission after feedback. */
export async function resubmitPractice(submissionId: unknown, input: PracticeInput): Promise<ActionResult> {
  return runAction("resubmitPractice", async () => {
    const user = await requireActionUser("student");
    if (!isValidId(submissionId)) throw new AccessError("That submission could not be found.");
    const ref = col("submissions").doc(submissionId);
    const existing = mapSubmission(await ref.get());
    // Same message whether it is missing or someone else's: never confirm other students' records.
    if (!existing || existing.studentId !== user.uid) throw new AccessError("That submission could not be found.");
    await authorizeStudentForCourse(existing.courseId);
    if (existing.status === "pending_review") {
      throw new AccessError("Your latest recording is still waiting for review.");
    }
    if (existing.attempts.length >= MAX_ATTEMPTS) {
      throw new AccessError("This submission has reached the maximum number of attempts. Start a new submission instead.");
    }
    const kind = parseKind(input?.kind);
    const asset = await verifySubmissionAsset(user.uid, kind, input.receipt);
    try {
      await db().runTransaction(async (tx) => {
        const fresh = mapSubmission(await tx.get(ref));
        if (!fresh || fresh.studentId !== user.uid || fresh.status === "pending_review") {
          throw new AccessError("This submission changed. Please reload the page.");
        }
        tx.update(ref, {
          status: "pending_review",
          attempts: FieldValue.arrayUnion(attemptFrom(fresh.attempts.length + 1, kind, asset, input)),
          lastSubmittedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      await deleteAsset(asset.publicId, asset.resourceType);
      throw error;
    }
    refresh();
    return null;
  });
}

/** Create or update the student's own review. Any edit goes back to moderation. */
export async function submitReview(courseId: string, ratingInput: unknown, commentInput: unknown): Promise<ActionResult> {
  return runAction("submitReview", async () => {
    const { user, course } = await authorizeStudentForCourse(courseId);
    const rating = Number(ratingInput);
    const comment = cleanText(commentInput, 1000);
    const errors: Record<string, string> = {};
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = "Choose a rating from 1 to 5.";
    if (comment.length < 10) errors.comment = "Please write at least a sentence (10 characters or more).";
    if (Object.keys(errors).length) throw new AccessError("Please fix the highlighted fields.", errors);

    const ref = col("reviews").doc(reviewId(course.id, user.uid));
    await db().runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists && existing.get("studentId") !== user.uid) throw new AccessError("You cannot edit this review.");
      tx.set(
        ref,
        {
          courseId: course.id,
          studentId: user.uid,
          rating,
          comment,
          status: "pending",
          updatedAt: FieldValue.serverTimestamp(),
          ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          moderatedByEmail: null,
          moderatedAt: null,
          moderationNote: null,
        },
        { merge: true },
      );
    });
    refresh();
    return null;
  });
}
