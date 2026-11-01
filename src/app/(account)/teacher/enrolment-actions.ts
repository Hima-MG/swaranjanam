"use server";

import { refresh } from "next/cache";

import { requireActionUser, runAction } from "@/lib/lms/server/access";
import { writeAudit } from "@/lib/lms/server/audit";
import { resolveEnrolmentRequest } from "@/lib/lms/server/enrolment";
import type { ActionResult } from "@/lib/lms/types";

/** Marks a website enrolment request handled or declined (billing is changed only with the existing tools). */
export async function setEnrolmentRequestStatus(requestId: unknown, status: unknown, note: unknown): Promise<ActionResult> {
  return runAction("setEnrolmentRequestStatus", async () => {
    const user = await requireActionUser("teacher");
    const request = await resolveEnrolmentRequest(user, requestId, status, note);
    await writeAudit(user, {
      action: "enrolment.resolve",
      targetType: "enrolmentRequest",
      targetId: request.id,
      summary: `${request.status === "handled" ? "Handled" : "Declined"} ${request.studentName}'s ${request.mode} request for ${request.courseTitle}`,
    });
    refresh();
    return null;
  });
}
