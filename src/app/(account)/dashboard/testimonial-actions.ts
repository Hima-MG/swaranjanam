"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh, updateTag } from "next/cache";

import { AccessError, getActiveEnrollment, requireActionUser, runAction } from "@/lib/lms/server/access";
import { col, db } from "@/lib/lms/server/db";
import { mapTestimonial, TESTIMONIALS_TAG } from "@/lib/lms/server/testimonials";
import { parseTestimonialInput, publicNameFor, TESTIMONIAL_LIMITS } from "@/lib/lms/testimonials";
import type { ActionResult } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Student testimonial actions.
//  * The student is ALWAYS the signed-in user (never an id from the form).
//  * The course must be one of the student's active enrollments.
//  * The public name is derived on the server from the student's own account.
//  * Students can submit and withdraw their own testimonials; they can never
//    approve, publish or touch anyone else's.

export interface TestimonialInput {
  text: unknown;
  courseId: unknown;
  nameDisplay: unknown;
  consent: unknown;
}

export async function submitTestimonial(input: TestimonialInput): Promise<ActionResult<{ id: string }>> {
  return runAction("submitTestimonial", async () => {
    const user = await requireActionUser("student");
    const { value, errors } = parseTestimonialInput(input as unknown as Record<string, unknown>);
    if (!value) throw new AccessError("Please fix the highlighted fields.", errors);

    let courseTitle: string | null = null;
    if (value.courseId) {
      const [enrollment, course] = await Promise.all([getActiveEnrollment(user.uid, value.courseId), col("courses").doc(value.courseId).get()]);
      if (!enrollment || !course.exists) throw new AccessError("Please fix the highlighted fields.", { courseId: "Choose one of your courses." });
      courseTitle = String(course.get("title") ?? "Course");
    }
    const profile = await col("users").doc(user.uid).get();
    const accountName = (typeof profile.get("displayName") === "string" ? (profile.get("displayName") as string) : null) ?? user.name;
    const publicName = publicNameFor(accountName, value.nameDisplay);

    const ref = col("testimonials").doc();
    await db().runTransaction(async (tx) => {
      // Limit open submissions per student (all reads before writes).
      const open = await tx.get(col("testimonials").where("studentId", "==", user.uid));
      if (open.docs.filter((d) => d.get("status") === "pending").length >= TESTIMONIAL_LIMITS.maxOpen) {
        throw new AccessError(`You already have ${TESTIMONIAL_LIMITS.maxOpen} testimonials awaiting review. Please wait for the academy to review them.`);
      }
      tx.create(ref, {
        studentId: user.uid,
        courseId: value.courseId,
        courseTitle,
        text: value.text,
        nameDisplay: value.nameDisplay,
        publicName,
        consent: true,
        consentAt: FieldValue.serverTimestamp(),
        status: "pending",
        moderationNote: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        moderatedAt: null,
        publishedAt: null,
        history: [{ at: Timestamp.now(), by: user.uid, change: "Submitted with consent to publish" }],
      });
    });
    refresh();
    return { id: ref.id };
  });
}

/** The student withdraws their own testimonial and consent. It is removed from the public site immediately. */
export async function withdrawTestimonial(testimonialId: unknown): Promise<ActionResult> {
  return runAction("withdrawTestimonial", async () => {
    const user = await requireActionUser("student");
    if (!isValidId(testimonialId)) throw new AccessError("That testimonial could not be found.");
    const ref = col("testimonials").doc(testimonialId);
    await db().runTransaction(async (tx) => {
      const t = mapTestimonial(await tx.get(ref));
      // Same message whether it is missing or someone else's: nothing is revealed.
      if (!t || t.studentId !== user.uid) throw new AccessError("That testimonial could not be found.");
      if (t.status === "withdrawn") return;
      tx.update(ref, {
        status: "withdrawn",
        consent: false,
        consentWithdrawnAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({ at: Timestamp.now(), by: user.uid, change: "Withdrawn by the student (consent withdrawn)" }),
      });
    });
    updateTag(TESTIMONIALS_TAG);
    refresh();
    return null;
  });
}
