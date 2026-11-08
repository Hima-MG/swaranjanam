"use server";

import { refresh } from "next/cache";

import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { confirmCheckoutPayment, createOrderForStudent, recoverStudentPayment, type CheckoutOrder, type ConfirmedCheckout, type RecoveredPayment } from "@/lib/lms/server/gateway";
import type { PaymentTarget } from "@/lib/lms/server/class-billing";
import type { ActionResult } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";
import { GatewayConfigError } from "@/lib/payments/razorpay";

// Student online payments (Razorpay Test or Live Mode) for the first-class payment,
// monthly invoices and (earlier) per-session charges. The student is always the signed-in user; the amount is
// always calculated on the server.

function toTarget(kind: "advance" | "invoice" | "session" | "registration", id: string): PaymentTarget {
  return kind === "advance" ? { kind, accountId: id } : kind === "session" ? { kind, chargeId: id } : kind === "registration" ? { kind, registrationId: id } : { kind, invoiceId: id };
}

export async function startOnlinePayment(kind: unknown, id: unknown): Promise<ActionResult<CheckoutOrder>> {
  return runAction("startOnlinePayment", async () => {
    const user = await requireActionUser("student");
    if ((kind !== "advance" && kind !== "invoice" && kind !== "session" && kind !== "registration") || !isValidId(id)) throw new AccessError("That payment could not be found.");
    try {
      return await createOrderForStudent(user, toTarget(kind, id));
    } catch (error) {
      if (error instanceof GatewayConfigError) throw new AccessError("Online payment is not available right now. Please pay the academy directly.");
      throw error;
    }
  });
}

/**
 * Called after Razorpay Checkout reports success. The browser's message is
 * NOT trusted: the signature is verified with the key secret and the payment
 * is fetched from Razorpay before anything is recorded (confirmCheckoutPayment).
 */
export async function confirmOnlinePayment(input: { orderId: unknown; paymentId: unknown; signature: unknown }): Promise<ActionResult<ConfirmedCheckout>> {
  return runAction("confirmOnlinePayment", async () => {
    const user = await requireActionUser("student");
    const result = await confirmCheckoutPayment(user, input);
    refresh();
    return result;
  });
}

/**
 * "Check payment status": asks Razorpay about this student's open orders for the
 * item and records any captured payment (e.g. the browser closed after paying).
 */
export async function checkOnlinePayment(kind: unknown, id: unknown): Promise<ActionResult<RecoveredPayment>> {
  return runAction("checkOnlinePayment", async () => {
    const user = await requireActionUser("student");
    if ((kind !== "advance" && kind !== "invoice" && kind !== "session" && kind !== "registration") || !isValidId(id)) throw new AccessError("That payment could not be found.");
    const result = await recoverStudentPayment(user, toTarget(kind, id));
    refresh();
    return result;
  });
}
