"use server";

import { refresh } from "next/cache";

import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { createOrderForStudent, gatewayOrderOwner, processVerifiedGatewayPayment, type CheckoutOrder } from "@/lib/lms/server/gateway";
import type { ActionResult } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";
import { fetchRazorpayPayment, GatewayConfigError, readRazorpayConfig } from "@/lib/payments/razorpay";
import { verifyCheckoutSignature } from "@/lib/payments/razorpay-signature";

// Student online payments (Razorpay TEST MODE) for the enrolment advance,
// monthly batch invoices and individual sessions. The student is always the signed-in user; the amount is
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
 * is fetched from Razorpay before anything is recorded.
 */
export async function confirmOnlinePayment(input: { orderId: unknown; paymentId: unknown; signature: unknown }): Promise<ActionResult<{ status: "recorded" | "already_recorded" | "processing"; receiptNumber: string | null }>> {
  return runAction("confirmOnlinePayment", async () => {
    const user = await requireActionUser("student");
    const orderId = typeof input?.orderId === "string" && /^order_[A-Za-z0-9]+$/.test(input.orderId) ? input.orderId : null;
    const paymentId = typeof input?.paymentId === "string" && /^pay_[A-Za-z0-9]+$/.test(input.paymentId) ? input.paymentId : null;
    if (!orderId || !paymentId) throw new AccessError("The payment could not be verified.");
    let config: ReturnType<typeof readRazorpayConfig>;
    try {
      config = readRazorpayConfig();
    } catch (error) {
      // Includes the fail-closed environment check (Test Mode never records into production).
      if (error instanceof GatewayConfigError) throw new AccessError("Online payment is not available right now.");
      throw error;
    }
    if (!config) throw new AccessError("Online payment is not available right now.");
    const owner = await gatewayOrderOwner(orderId);
    if (!owner || owner.studentId !== user.uid) throw new AccessError("The payment could not be verified.");
    if (!verifyCheckoutSignature(orderId, paymentId, input.signature, config.keySecret)) {
      throw new AccessError("The payment could not be verified. If money was deducted, it will be confirmed automatically or the academy will contact you.");
    }
    const payment = await fetchRazorpayPayment(config, paymentId);
    if (payment.order_id !== orderId) throw new AccessError("The payment could not be verified.");
    const result = await processVerifiedGatewayPayment({
      orderId,
      paymentId,
      amountMinor: payment.amount,
      currency: payment.currency,
      status: payment.status,
      via: "checkout",
    });
    refresh();
    if (result.outcome === "not_captured") return { status: "processing" as const, receiptNumber: null };
    if (result.outcome === "duplicate") return { status: "already_recorded" as const, receiptNumber: null };
    return { status: "recorded" as const, receiptNumber: result.receiptNumber };
  });
}
