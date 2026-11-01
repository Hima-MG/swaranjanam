"use server";

import { refresh } from "next/cache";

import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { confirmCheckoutPayment, createOrderForStudent, type CheckoutOrder, type ConfirmedCheckout } from "@/lib/lms/server/gateway";
import type { ActionResult } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";
import { GatewayConfigError } from "@/lib/payments/razorpay";

// Student online payments (Razorpay TEST MODE) for the first-class payment,
// four-weekly batch invoices and individual sessions. The student is always the signed-in user; the amount is
// always calculated on the server.

export async function startOnlinePayment(kind: unknown, id: unknown): Promise<ActionResult<CheckoutOrder>> {
  return runAction("startOnlinePayment", async () => {
    const user = await requireActionUser("student");
    if ((kind !== "advance" && kind !== "invoice" && kind !== "session") || !isValidId(id)) throw new AccessError("That payment could not be found.");
    try {
      return await createOrderForStudent(user, kind === "advance" ? { kind, accountId: id } : kind === "session" ? { kind, chargeId: id } : { kind, invoiceId: id });
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
