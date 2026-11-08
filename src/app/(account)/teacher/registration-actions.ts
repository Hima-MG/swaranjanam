"use server";

import { refresh } from "next/cache";

import { requireActionUser, runAction } from "@/lib/lms/server/access";
import { writeAudit } from "@/lib/lms/server/audit";
import { assignRegistrationToBatch, confirmIndividualSchedule, updateIndividualSchedule } from "@/lib/lms/server/registrations";
import type { ActionResult } from "@/lib/lms/types";

// Teacher (academy administrator) actions on website registrations. All checks
// run on the server inside transactions (lib/lms/server/registrations.ts and
// lib/lms/server/batches.ts): verified initial payment, matching course,
// active batch, capacity, schedule conflicts and duplicate assignment.

export async function assignToBatch(registrationId: unknown, batchId: unknown): Promise<ActionResult> {
  return runAction("assignToBatch", async () => {
    const user = await requireActionUser("teacher");
    const result = await assignRegistrationToBatch(user, registrationId, batchId);
    await writeAudit(user, {
      action: "registration.assign",
      targetType: "registration",
      targetId: String(registrationId),
      summary: `Assigned registration ${String(registrationId)} to batch "${result.batchName}"`,
    });
    refresh();
    return null;
  });
}

export async function confirmSchedule(registrationId: unknown, input: { days: unknown; start: unknown; end: unknown; note: unknown; teacherId?: unknown }): Promise<ActionResult> {
  return runAction("confirmSchedule", async () => {
    const user = await requireActionUser("teacher");
    const result = await confirmIndividualSchedule(user, registrationId, input);
    await writeAudit(user, {
      action: "registration.schedule",
      targetType: "registration",
      targetId: String(registrationId),
      summary: `Confirmed individual schedule: ${result.schedule}`,
    });
    refresh();
    return null;
  });
}

export async function changeSchedule(registrationId: unknown, input: { days: unknown; start: unknown; end: unknown; note: unknown; teacherId?: unknown }): Promise<ActionResult> {
  return runAction("changeSchedule", async () => {
    const user = await requireActionUser("teacher");
    const result = await updateIndividualSchedule(user, registrationId, input);
    await writeAudit(user, {
      action: "registration.reschedule",
      targetType: "registration",
      targetId: String(registrationId),
      summary: `Changed individual schedule: ${result.previous ?? "—"} → ${result.schedule}`,
    });
    refresh();
    return null;
  });
}
