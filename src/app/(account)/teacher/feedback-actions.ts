"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh } from "next/cache";

import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { col, db } from "@/lib/lms/server/db";
import { mapReview, mapSubmission } from "@/lib/lms/server/feedback";
import type { ActionResult } from "@/lib/lms/types";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Teacher feedback on practice submissions and moderation of course reviews.
// Each action re-checks the teacher session; changes are kept as history.

export async function giveSubmissionFeedback(
  submissionId: unknown,
  statusInput: unknown,
  textInput: unknown,
): Promise<ActionResult> {
  return runAction("giveSubmissionFeedback", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(submissionId)) throw new AccessError("That submission could not be found.");
    if (statusInput !== "reviewed" && statusInput !== "needs_revision") throw new AccessError("Choose Reviewed or Needs revision.");
    const text = cleanText(textInput, 2000);
    if (text.length < 2) throw new AccessError("Please fix the highlighted fields.", { text: "Write some feedback for the student." });

    const ref = col("submissions").doc(submissionId);
    const summary = await db().runTransaction(async (tx) => {
      const submission = mapSubmission(await tx.get(ref));
      if (!submission) throw new AccessError("That submission could not be found.");
      const attempt = submission.attempts.length;
      tx.update(ref, {
        status: statusInput,
        reviewedAt: FieldValue.serverTimestamp(),
        feedback: FieldValue.arrayUnion({
          attempt,
          status: statusInput,
          text,
          by: user.uid,
          byEmail: user.email,
          byName: user.name,
          at: Timestamp.now(),
        }),
      });
      return `Feedback on "${submission.title}" (attempt ${attempt}): ${statusInput === "reviewed" ? "reviewed" : "needs revision"}`;
    });
    await writeAudit(user, { action: "submission.feedback", targetType: "submission", targetId: submissionId, summary });
    refresh();
    return null;
  });
}

export async function moderateReview(reviewIdInput: unknown, statusInput: unknown, noteInput: unknown): Promise<ActionResult> {
  return runAction("moderateReview", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(reviewIdInput)) throw new AccessError("That review could not be found.");
    if (statusInput !== "approved" && statusInput !== "hidden") throw new AccessError("Choose Approve or Hide.");
    const note = cleanText(noteInput, 300) || null;
    const ref = col("reviews").doc(reviewIdInput);
    const review = mapReview(await ref.get());
    if (!review) throw new AccessError("That review could not be found.");
    if (review.status === statusInput) return null;
    await ref.update({
      status: statusInput,
      moderatedBy: user.uid,
      moderatedByEmail: user.email,
      moderatedAt: FieldValue.serverTimestamp(),
      moderationNote: note,
    });
    await writeAudit(user, {
      action: `review.${statusInput}`,
      targetType: "review",
      targetId: review.id,
      summary: `${statusInput === "approved" ? "Approved" : "Hid"} a ${review.rating}-star review${note ? ` (${note})` : ""}`,
    });
    refresh();
    return null;
  });
}
