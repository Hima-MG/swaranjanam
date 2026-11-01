import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { AccessError } from "@/lib/lms/server/access";
import { readReceiptContext, writeReceipt } from "@/lib/lms/server/billing";
import { applyVerifiedPayment, evaluateSuspension, readPaymentTarget, type PaymentTarget } from "@/lib/lms/server/class-billing";
import { col, db, toIso } from "@/lib/lms/server/db";
import type { PaymentRecord } from "@/lib/lms/types";
import { assertTestPaymentEnvironment, createRazorpayOrder, fetchRazorpayPayment, GatewayConfigError, readRazorpayConfig } from "@/lib/payments/razorpay";
import { verifyCheckoutSignature } from "@/lib/payments/razorpay-signature";

// Razorpay (test mode) for class-based billing: the registration advance and
// monthly batch invoices and individual sessions.
//
//  * Amounts are calculated on the server from the advance requirement or the
//    invoice balance — never taken from the browser.
//  * A payment counts only after the server has verified it: either the
//    checkout signature + a server-side lookup of the payment, or a webhook
//    with a valid signature. A browser "success" message alone does nothing.
//  * Processing is idempotent: payments/rzp_{paymentId} is created once, and
//    webhook events are recorded once in gatewayEvents/{eventId}.
//  * Receipts are issued through the existing transaction-guarded workflow.

const targetKey = (t: PaymentTarget) => (t.kind === "advance" ? `advance_${t.accountId}` : t.kind === "session" ? `session_${t.chargeId}` : `invoice_${t.invoiceId}`);
const ORDER_REUSE_MS = 12 * 60 * 60 * 1000;
const GATEWAY_ACTOR = { uid: "razorpay", email: null };

export interface CheckoutOrder {
  keyId: string;
  orderId: string;
  amountMinor: number;
  currency: "INR";
  description: string;
}

/** Creates (or reuses) a Razorpay order for the signed-in student's own advance or invoice. */
export async function createOrderForStudent(user: SessionUser, target: PaymentTarget): Promise<CheckoutOrder> {
  if (user.role !== "student") throw new AccessError("Only students can pay online.");
  const config = readRazorpayConfig();
  if (!config) throw new AccessError("Online payment is not available yet. Please pay the academy directly.");

  // Read-only check of ownership and the amount payable right now.
  const state = await db().runTransaction((tx) => readPaymentTarget(tx, target));
  if (state.account.studentId !== user.uid) throw new AccessError("That payment could not be found.");
  if (state.payableMinor === null) throw new AccessError("Nothing is payable on this item right now.");
  const amountMinor = state.payableMinor;
  const description = state.titleSuffix;
  const key = targetKey(target);

  const existing = await col("gatewayOrders").where("targetKey", "==", key).get();
  const reusable = existing.docs.find(
    (d) =>
      d.get("status") === "created" &&
      d.get("studentId") === user.uid &&
      d.get("amountMinor") === amountMinor &&
      Date.now() - (d.get("createdAt")?.toMillis?.() ?? 0) < ORDER_REUSE_MS,
  );
  if (reusable) return { keyId: config.keyId, orderId: reusable.id, amountMinor, currency: "INR", description };

  const order = await createRazorpayOrder(config, {
    amountMinor,
    receipt: key,
    notes: { target: key, studentId: user.uid },
  });
  if (order.amount !== amountMinor || order.currency !== "INR") throw new Error("Razorpay returned an unexpected order amount.");
  await col("gatewayOrders").doc(order.id).create({
    targetKey: key,
    target,
    mode: "test",
    studentId: user.uid,
    amountMinor,
    currency: "INR",
    status: "created",
    paymentId: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { keyId: config.keyId, orderId: order.id, amountMinor, currency: "INR", description };
}

export interface VerifiedGatewayPayment {
  orderId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  status: string;
  via: "checkout" | "webhook";
}

export type ProcessResult =
  | { outcome: "recorded"; paymentId: string; receiptNumber: string | null; needsReview: string | null }
  | { outcome: "duplicate"; paymentId: string }
  | { outcome: "not_captured"; status: string };

/**
 * Records a payment that has ALREADY been verified with Razorpay (signature
 * checked and details fetched server-side, or a signed webhook). Safe to call
 * any number of times for the same payment.
 */
export async function processVerifiedGatewayPayment(input: VerifiedGatewayPayment): Promise<ProcessResult> {
  // Fail-closed: a Test Mode payment never touches a production project's billing.
  assertTestPaymentEnvironment();
  if (input.status !== "captured") return { outcome: "not_captured", status: input.status };
  const orderRef = col("gatewayOrders").doc(input.orderId);
  const paymentDocId = `rzp_${input.paymentId}`;
  const paymentRef = col("payments").doc(paymentDocId);

  const result = await db().runTransaction(async (tx) => {
    // ---- reads ----
    const [orderSnap, paymentSnap] = await Promise.all([tx.get(orderRef), tx.get(paymentRef)]);
    if (paymentSnap.exists) return { outcome: "duplicate" as const, paymentId: paymentDocId };
    if (!orderSnap.exists) throw new Error("Payment for an unknown order");
    const order = orderSnap.data()!;
    if (order.mode !== undefined && order.mode !== "test") throw new Error("Payment for an order of another payment mode");
    if (order.amountMinor !== input.amountMinor || input.currency !== "INR") {
      throw new Error("Payment amount does not match the order");
    }
    const target = order.target as PaymentTarget;
    const state = await readPaymentTarget(tx, target);
    const nowIso = new Date().toISOString();
    // Money was received in every case; anything unexpected is flagged for review, never applied twice.
    let needsReview: string | null = null;
    if (state.payableMinor === null) needsReview = "Received after the item was already settled — refund or adjust.";
    else if (input.amountMinor > state.payableMinor) needsReview = "Received more than the outstanding balance — refund or adjust.";
    const record: PaymentRecord = {
      id: paymentDocId,
      studentId: state.account.studentId,
      courseId: state.account.courseId,
      enrollmentId: "",
      packageId: null,
      purpose: target.kind,
      accountId: state.account.id,
      invoiceId: target.kind === "invoice" ? target.invoiceId : null,
      sessionChargeId: target.kind === "session" ? target.chargeId : null,
      learnerIds: [state.account.studentId],
      payerName: null,
      rejectionReason: null,
      verifiedAt: nowIso,
      verifiedByEmail: null,
      receiptId: null,
      amountMinor: input.amountMinor,
      currency: "INR",
      method: "gateway",
      reference: input.paymentId,
      paidAt: nowIso,
      status: "paid",
      verified: true,
      source: "gateway",
      notes: needsReview,
      createdBy: GATEWAY_ACTOR.uid,
      createdByEmail: null,
      createdAt: nowIso,
      updatedBy: GATEWAY_ACTOR.uid,
      updatedByEmail: null,
      updatedAt: nowIso,
      history: [],
    };
    const receiptCtx = await readReceiptContext(tx, record, null, state.titleSuffix);

    // ---- writes ----
    if (!needsReview) applyVerifiedPayment(tx, state, paymentDocId, GATEWAY_ACTOR);
    const receiptNumber = writeReceipt(tx, receiptCtx, record, null);
    tx.create(paymentRef, {
      studentId: record.studentId,
      courseId: record.courseId,
      enrollmentId: "",
      packageId: null,
      purpose: record.purpose,
      accountId: record.accountId,
      invoiceId: record.invoiceId,
      sessionChargeId: record.sessionChargeId,
      learnerIds: record.learnerIds,
      payerName: null,
      amountMinor: record.amountMinor,
      currency: "INR",
      method: "gateway",
      reference: input.paymentId,
      paidAt: Timestamp.fromMillis(Date.parse(nowIso)),
      status: "paid",
      // Verified by the server against Razorpay, not by a browser message.
      verified: true,
      verifiedAt: FieldValue.serverTimestamp(),
      verifiedBy: GATEWAY_ACTOR.uid,
      verifiedByEmail: null,
      rejectionReason: null,
      receiptId: receiptNumber ? paymentDocId : null,
      source: "gateway",
      gateway: { provider: "razorpay", mode: "test", orderId: input.orderId, paymentId: input.paymentId, via: input.via },
      notes: needsReview,
      needsReview: needsReview !== null,
      createdBy: GATEWAY_ACTOR.uid,
      createdByEmail: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: GATEWAY_ACTOR.uid,
      updatedByEmail: null,
      updatedAt: FieldValue.serverTimestamp(),
      history: [{ at: Timestamp.now(), by: GATEWAY_ACTOR.uid, byEmail: null, change: `Online payment verified (${input.via})${needsReview ? ` — needs review: ${needsReview}` : ""}` }],
    });
    tx.update(orderRef, { status: "paid", paymentId: input.paymentId, paidAt: FieldValue.serverTimestamp() });
    return { outcome: "recorded" as const, paymentId: paymentDocId, receiptNumber, needsReview, accountId: state.account.id };
  });
  // A verified invoice payment may restore access (idempotent; the scheduled job re-checks too).
  if (result.outcome === "recorded") {
    await evaluateSuspension(result.accountId, GATEWAY_ACTOR);
    return { outcome: result.outcome, paymentId: result.paymentId, receiptNumber: result.receiptNumber, needsReview: result.needsReview };
  }
  return result;
}

export async function webhookEventSeen(eventId: string): Promise<boolean> {
  return (await col("gatewayEvents").doc(eventId).get()).exists;
}

/** Records a webhook event id once. Returns false when it was already processed. */
export async function claimWebhookEvent(eventId: string, event: string): Promise<boolean> {
  try {
    await col("gatewayEvents").doc(eventId).create({ event, receivedAt: FieldValue.serverTimestamp() });
    return true;
  } catch (error) {
    if ((error as { code?: number })?.code === 6) return false; // ALREADY_EXISTS
    throw error;
  }
}

export async function gatewayOrderOwner(orderId: string): Promise<{ studentId: string; createdAt: string | null } | null> {
  const snap = await col("gatewayOrders").doc(orderId).get();
  return snap.exists ? { studentId: String(snap.get("studentId") ?? ""), createdAt: toIso(snap.get("createdAt")) } : null;
}

export interface ConfirmedCheckout {
  status: "recorded" | "already_recorded" | "processing";
  receiptNumber: string | null;
}

/**
 * Called after Razorpay Checkout reports success in the student's browser.
 * The browser's message is NOT trusted: the order must belong to this
 * student, the checkout signature is verified with the key secret, and the
 * payment is fetched from Razorpay before anything is recorded (through the
 * same idempotent processor the webhook uses).
 */
export async function confirmCheckoutPayment(
  user: SessionUser,
  input: { orderId: unknown; paymentId: unknown; signature: unknown },
): Promise<ConfirmedCheckout> {
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
  if (result.outcome === "not_captured") return { status: "processing", receiptNumber: null };
  if (result.outcome === "duplicate") return { status: "already_recorded", receiptNumber: null };
  return { status: "recorded", receiptNumber: result.receiptNumber };
}
