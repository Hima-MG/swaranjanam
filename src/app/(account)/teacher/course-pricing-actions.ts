"use server";

import { FieldValue } from "firebase-admin/firestore";
import { refresh, updateTag } from "next/cache";

import { CATALOG_TAG } from "@/lib/catalog/server";
import { periodLabel } from "@/lib/lms/class-billing";
import { parseScheduleInfo } from "@/lib/lms/course-pricing";
import { AccessError, authorizeTeacherForCourse, runAction } from "@/lib/lms/server/access";
import { writeAudit } from "@/lib/lms/server/audit";
import { changeEnrolledRates, saveCoursePricing } from "@/lib/lms/server/course-pricing";
import { col } from "@/lib/lms/server/db";
import type { ActionResult } from "@/lib/lms/types";

// Course-specific pricing actions (rules and transactions: lib/lms/server/course-pricing.ts).

const rupees = (minor: number | null) => (minor === null ? "off" : `₹${(minor / 100).toLocaleString("en-IN")}`);

export async function updateCoursePricing(courseId: unknown, input: Record<string, unknown>): Promise<ActionResult> {
  return runAction("updateCoursePricing", async () => {
    const { user, course } = await authorizeTeacherForCourse(courseId);
    const { pricing, hadPricing } = await saveCoursePricing(user, course.id, input);
    await writeAudit(user, {
      action: "course.pricing",
      targetType: "course",
      targetId: course.id,
      summary: `Course pricing for "${course.title}" (new students): batch ${rupees(pricing.batchMinor)} per class, individual ${rupees(pricing.individualMinor)} per session, Learn Together ${rupees(pricing.sharedBatchMinor)} batch / ${rupees(pricing.sharedIndividualMinor)} one-to-one per person${
        hadPricing ? "" : " (first saved; replaces the confirmed default rates)"
      }`,
    });
    updateTag(CATALOG_TAG);
    refresh();
    return null;
  });
}

export async function updateCourseScheduleInfo(courseId: unknown, input: Record<string, unknown>): Promise<ActionResult> {
  return runAction("updateCourseScheduleInfo", async () => {
    const { user, course } = await authorizeTeacherForCourse(courseId);
    const { value, errors } = parseScheduleInfo(input ?? {});
    if (!value) throw new AccessError("Please fix the highlighted fields.", errors);
    await col("courses").doc(course.id).update({ scheduleInfo: value, updatedAt: FieldValue.serverTimestamp() });
    await writeAudit(user, { action: "course.schedule", targetType: "course", targetId: course.id, summary: `Updated general schedule information of "${course.title}"` });
    updateTag(CATALOG_TAG);
    refresh();
    return null;
  });
}

/** Approved rate change for students already enrolled (from a future month). */
export async function changeEnrolledStudentsRate(
  courseId: unknown,
  input: { mode: unknown; rate: unknown; effectiveFrom: unknown; reason: unknown; confirm: unknown },
): Promise<ActionResult<{ accounts: number }>> {
  return runAction("changeEnrolledStudentsRate", async () => {
    const { user, course } = await authorizeTeacherForCourse(courseId);
    const r = await changeEnrolledRates(user, course.id, input);
    await writeAudit(user, {
      action: "course.pricing.enrolled",
      targetType: "course",
      targetId: course.id,
      summary: `Approved ${r.mode} rate ${rupees(r.rateMinor)} for ${r.accounts} enrolled student(s) of "${course.title}" from ${periodLabel(r.effectiveFrom)} — ${r.reason}`,
    });
    refresh();
    return { accounts: r.accounts };
  });
}
