"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh, updateTag } from "next/cache";

import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { col, db } from "@/lib/lms/server/db";
import { mapTestimonial, TESTIMONIALS_TAG } from "@/lib/lms/server/testimonials";
import { MODERATION_ACTIONS, moderationTarget, type ModerationAction } from "@/lib/lms/testimonials";
import type { ActionResult } from "@/lib/lms/types";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Teacher moderation of student testimonials: approve (publish), reject, or
// unpublish. Re-checks the teacher session, never edits the student's words,
// refuses to publish without consent, and records every change.

export async function moderateTestimonial(testimonialId: unknown, actionInput: unknown, noteInput: unknown): Promise<ActionResult> {
  return runAction("moderateTestimonial", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(testimonialId)) throw new AccessError("That testimonial could not be found.");
    if (!(MODERATION_ACTIONS as readonly unknown[]).includes(actionInput)) throw new AccessError("Choose Approve, Reject or Unpublish.");
    const action = actionInput as ModerationAction;
    const note = cleanText(noteInput, 300) || null;
    const ref = col("testimonials").doc(testimonialId);

    const summary = await db().runTransaction(async (tx) => {
      const t = mapTestimonial(await tx.get(ref));
      if (!t) throw new AccessError("That testimonial could not be found.");
      const target = moderationTarget(t.status, action, t.consent);
      if (target !== "approved" && target !== "rejected" && target !== "unpublished") throw new AccessError(target);
      tx.update(ref, {
        status: target,
        moderationNote: target === "approved" ? null : note,
        moderatedBy: user.uid,
        moderatedByEmail: user.email,
        moderatedAt: FieldValue.serverTimestamp(),
        ...(target === "approved" ? { publishedAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({ at: Timestamp.now(), by: user.uid, change: `${t.status} → ${target}${note ? ` (${note})` : ""}` }),
      });
      return `${target === "approved" ? "Published" : target === "rejected" ? "Rejected" : "Unpublished"} a testimonial by ${t.publicName}${note ? ` (${note})` : ""}`;
    });
    await writeAudit(user, { action: `testimonial.${action}`, targetType: "testimonial", targetId: testimonialId, summary });
    updateTag(TESTIMONIALS_TAG);
    refresh();
    return null;
  });
}
