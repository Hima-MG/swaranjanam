"use server";

import { refresh } from "next/cache";

import { requireActionUser, runAction } from "@/lib/lms/server/access";
import { writeAudit } from "@/lib/lms/server/audit";
import { saveRegistration } from "@/lib/lms/server/registrations";
import type { ActionResult } from "@/lib/lms/types";

// Website registration. The student is always the signed-in user; the course
// must be listed as "Open for enrolment" and every field is re-validated on the
// server. No payment is recorded here: the initial payment goes through the
// existing Razorpay flow and counts only after server-side verification.

export async function saveMyRegistration(
  slug: unknown,
  mode: unknown,
  details: Record<string, unknown>,
): Promise<ActionResult<{ registrationId: string; initialAmountMinor: number }>> {
  return runAction("saveMyRegistration", async () => {
    const user = await requireActionUser("student");
    const result = await saveRegistration(user, { slug, mode, details });
    await writeAudit(user, {
      action: result.outcome === "created" ? "registration.create" : "registration.update",
      targetType: "registration",
      targetId: result.registrationId,
      summary: `${result.outcome === "created" ? "Registered" : "Updated registration"} for ${String(slug)} (${String(mode)})`,
    });
    refresh();
    return { registrationId: result.registrationId, initialAmountMinor: result.initialAmountMinor };
  });
}
