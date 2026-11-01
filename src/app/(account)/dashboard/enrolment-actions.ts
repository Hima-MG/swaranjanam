"use server";

import { refresh } from "next/cache";

import { requireActionUser, runAction } from "@/lib/lms/server/access";
import { writeAudit } from "@/lib/lms/server/audit";
import { createEnrolmentRequest } from "@/lib/lms/server/enrolment";
import type { ActionResult } from "@/lib/lms/types";

// Website enrolment request. The student is always the signed-in user, the
// course must be publicly listed as "Open for enrolment" (checked on the
// server), and no billing account, charge or payment is created here.

export async function requestEnrolment(slug: unknown, mode: unknown, note: unknown): Promise<ActionResult<{ outcome: "created" | "already_pending" | "reopened" }>> {
  return runAction("requestEnrolment", async () => {
    const user = await requireActionUser("student");
    const { outcome, requestId } = await createEnrolmentRequest(user, { slug, mode, note });
    if (outcome !== "already_pending") {
      await writeAudit(user, { action: "enrolment.request", targetType: "enrolmentRequest", targetId: requestId, summary: `Requested ${String(mode)} enrolment in ${String(slug)}` });
    }
    refresh();
    return { outcome };
  });
}
