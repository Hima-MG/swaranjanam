"use server";

import { requireActionUser, runAction } from "@/lib/lms/server/access";
import { sendVerificationEmailFor } from "@/lib/lms/server/guest-enrolment";
import type { ActionResult } from "@/lib/lms/types";

/** Emails the signed-in student a link to verify their email (needed to link enrolments paid as a guest). */
export async function sendMyVerificationEmail(): Promise<ActionResult<{ sent: boolean }>> {
  return runAction("sendMyVerificationEmail", async () => {
    const user = await requireActionUser("student");
    return { sent: await sendVerificationEmailFor(user) };
  });
}
