"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh } from "next/cache";

import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { col, db, mapEnrollment } from "@/lib/lms/server/db";
import { mapPayment } from "@/lib/lms/server/payments";
import {
  DEFAULT_CURRENCY,
  PAYMENT_METHODS,
  PAYMENT_TRANSITIONS,
  type ActionResult,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/lms/types";
import { parseAmountMinor, parsePaidAt } from "@/lib/lms/payment-input";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Teacher payment actions. Every action re-checks the teacher session.
// Payments are never deleted: mistakes are corrected through status changes,
// and every change is recorded in the payment's history and the audit log.
// Client input is never trusted to mark a payment as received: a manual
// payment counts only when the teacher explicitly confirms they verified it.

const MANUAL_STATUSES: PaymentStatus[] = ["pending", "paid", "failed"];

export interface RecordPaymentInput {
  enrollmentId: unknown;
  amount: unknown;
  method: unknown;
  reference: unknown;
  paidAt: unknown;
  status: unknown;
  notes: unknown;
  /** Teacher confirms the money was actually received (required for "paid"). */
  verifiedConfirmation: unknown;
}

export async function recordPayment(input: RecordPaymentInput): Promise<ActionResult<{ paymentId: string }>> {
  return runAction("recordPayment", async () => {
    const user = await requireActionUser("teacher");
    const errors: Record<string, string> = {};

    const enrollmentId = isValidId(input?.enrollmentId) ? input.enrollmentId : null;
    if (!enrollmentId) errors.enrollmentId = "Choose the student and course this payment is for.";
    const amountMinor = parseAmountMinor(input?.amount);
    if (amountMinor === null) errors.amount = "Enter an amount greater than zero (up to 2 decimal places).";
    const method = (PAYMENT_METHODS as readonly string[]).includes(String(input?.method)) ? (input.method as PaymentMethod) : null;
    if (!method) errors.method = "Choose a payment method.";
    const paidAt = parsePaidAt(input?.paidAt);
    if (!paidAt) errors.paidAt = "Enter the payment date (not in the future).";
    const status = MANUAL_STATUSES.includes(input?.status as PaymentStatus) ? (input.status as PaymentStatus) : null;
    if (!status) errors.status = "Choose a status.";
    const reference = cleanText(input?.reference, 100) || null;
    const notes = cleanText(input?.notes, 500) || null;
    if (status === "paid" && input?.verifiedConfirmation !== true) {
      errors.verifiedConfirmation = "Confirm that you have verified this payment was received.";
    }
    if (Object.keys(errors).length > 0) throw new AccessError("Please fix the highlighted fields.", errors);

    const enrollment = mapEnrollment(await col("enrollments").doc(enrollmentId!).get());
    if (!enrollment) throw new AccessError("That enrollment could not be found.", { enrollmentId: "Not found." });

    // Guard against recording the same offline payment twice.
    if (reference) {
      const duplicate = await col("payments").where("reference", "==", reference).where("method", "==", method).limit(1).get();
      if (!duplicate.empty) {
        throw new AccessError("A payment with this reference has already been recorded.", {
          reference: "Already recorded. Check the existing payment instead.",
        });
      }
    }

    const ref = col("payments").doc();
    const now = Timestamp.now();
    await ref.create({
      studentId: enrollment.studentId,
      courseId: enrollment.courseId,
      enrollmentId: enrollment.id,
      amountMinor,
      currency: enrollment.currency || DEFAULT_CURRENCY,
      method,
      reference,
      paidAt: Timestamp.fromDate(paidAt!),
      status,
      // Manual records are verified by the teacher's explicit confirmation.
      verified: status === "paid",
      source: "manual",
      gateway: null,
      notes,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
      updatedByEmail: user.email,
      updatedAt: FieldValue.serverTimestamp(),
      history: [{ at: now, by: user.uid, byEmail: user.email, change: `Recorded as ${status}` }],
    });
    await writeAudit(user, {
      action: "payment.create",
      targetType: "payment",
      targetId: ref.id,
      summary: `Recorded ${status} payment of ₹${(amountMinor! / 100).toFixed(2)} for enrollment ${enrollment.id}`,
    });
    refresh();
    return { paymentId: ref.id };
  });
}

export async function updatePaymentStatus(
  paymentId: unknown,
  nextStatus: unknown,
  noteInput: unknown,
  verifiedConfirmation: unknown,
): Promise<ActionResult> {
  return runAction("updatePaymentStatus", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(paymentId)) throw new AccessError("That payment could not be found.");
    const ref = col("payments").doc(paymentId);
    const note = cleanText(noteInput, 300);

    const summary = await db().runTransaction(async (tx) => {
      const payment = mapPayment(await tx.get(ref));
      if (!payment) throw new AccessError("That payment could not be found.");
      const target = nextStatus as PaymentStatus;
      if (!PAYMENT_TRANSITIONS[payment.status]?.includes(target)) {
        throw new AccessError(`A ${payment.status} payment cannot be changed to ${String(nextStatus)}.`);
      }
      if (payment.source === "gateway") {
        // Gateway payments change state only through verified gateway events.
        throw new AccessError("Online gateway payments are updated automatically and cannot be changed by hand.");
      }
      if (target === "paid" && verifiedConfirmation !== true) {
        throw new AccessError("Confirm that you have verified this payment was received.");
      }
      if (target === "refunded" && !note) {
        throw new AccessError("Add a short note explaining the refund.", { note: "Required for refunds." });
      }
      const change = `${payment.status} → ${target}${note ? ` (${note})` : ""}`;
      tx.update(ref, {
        status: target,
        verified: target === "paid" ? true : target === "refunded" ? payment.verified : false,
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({ at: Timestamp.now(), by: user.uid, byEmail: user.email, change }),
      });
      return `Payment ${ref.id}: ${change}`;
    });

    await writeAudit(user, { action: "payment.status", targetType: "payment", targetId: ref.id, summary });
    refresh();
    return null;
  });
}

/** Sets the agreed fee for one enrollment (discounts, scholarships). null clears it. */
export async function updateEnrollmentFee(enrollmentId: unknown, feeInput: unknown, reasonInput: unknown): Promise<ActionResult> {
  return runAction("updateEnrollmentFee", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(enrollmentId)) throw new AccessError("That enrollment could not be found.");
    const raw = typeof feeInput === "string" ? feeInput.trim().replace(/[,\s₹]/g, "") : feeInput;
    let fee: number | null;
    if (raw === "" || raw === null || raw === undefined) fee = null;
    else if (typeof raw === "number" || /^\d+$/.test(String(raw))) fee = Number(raw);
    else throw new AccessError("Please fix the highlighted fields.", { fee: "Enter the fee in whole rupees, or leave it empty." });
    if (fee !== null && (!Number.isSafeInteger(fee) || fee < 0 || fee > 10_000_000)) {
      throw new AccessError("Please fix the highlighted fields.", { fee: "Enter a fee between ₹0 and ₹1,00,00,000." });
    }
    const reason = cleanText(reasonInput, 200);
    if (!reason) throw new AccessError("Please fix the highlighted fields.", { reason: "Give a short reason for the change." });

    const ref = col("enrollments").doc(enrollmentId);
    const before = mapEnrollment(await ref.get());
    if (!before) throw new AccessError("That enrollment could not be found.");
    if (before.agreedFee === fee) return null;
    await ref.update({
      agreedFee: fee,
      feeUpdatedAt: FieldValue.serverTimestamp(),
      feeUpdatedBy: user.uid,
      history: FieldValue.arrayUnion({
        type: "fee",
        at: Timestamp.now(),
        by: user.uid,
        note: `Fee ${before.agreedFee ?? "not set"} → ${fee ?? "not set"}: ${reason}`,
      }),
    });
    await writeAudit(user, {
      action: "enrollment.fee",
      targetType: "enrollment",
      targetId: enrollmentId,
      summary: `Agreed fee ₹${before.agreedFee ?? "—"} → ₹${fee ?? "—"} (${reason})`,
    });
    refresh();
    return null;
  });
}
