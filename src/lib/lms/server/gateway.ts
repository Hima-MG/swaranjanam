import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { AccessError } from "@/lib/lms/server/access";
import { readReceiptContext, writeReceipt } from "@/lib/lms/server/billing";
import { applyVerifiedPayment, evaluateSuspension, readPaymentTarget, type PaymentTarget } from "@/lib/lms/server/class-billing";
import { provisionRegistrationAccount, readGuestRegistration } from "@/lib/lms/server/guest-enrolment";
import { col, db, toIso } from "@/lib/lms/server/db";
import { notifyPaymentFailed, notifyVerifiedPayment } from "@/lib/notifications/events";
import type { PaymentRecord } from "@/lib/lms/types";
import {
  createRazorpayOrder,
  fetchOrderPayments,
  fetchRazorpayPayment,
  GatewayConfigError,
  MIN_ORDER_MINOR,
  readRazorpayConfig,
  requirePaymentMode,
  type RazorpayConfig,
} from "@/lib/payments/razorpay";
import { verifyCheckoutSignature } from "@/lib/payments/razorpay-signature";

// Razorpay (Test Mode or Live Mode, from the key id) for class-based billing:
// the registration's initial payment (first class / full programme fee), the
// first-class advance, monthly invoices and individual sessions.
//
//  * Amounts are calculated on the server from the advance requirement or the
//    invoice balance — never taken from the browser.
//  * A payment counts only after the server has verified it: either the
//    checkout signature + a server-side lookup of the payment, or a webhook
//    with a valid signature. A browser "success" message alone does nothing.
//  * Processing is idempotent: payments/rzp_{paymentId} is created once, and
//    webhook events are recorded once in gatewayEvents/{eventId}.
//  * Receipts are issued through the existing transaction-guarded workflow.
//  * Before a new checkout opens, earlier open orders of the same item are
//    checked with Razorpay, so a payment whose confirmation was lost (browser
//    closed, webhook late) is recorded instead of charging the student twice.

const targetKey = (t: PaymentTarget) =>
  t.kind === "advance" ? `advance_${t.accountId}` : t.kind === "session" ? `session_${t.chargeId}` : t.kind === "registration" ? `registration_${t.registrationId}` : `invoice_${t.invoiceId}`;
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
  if (!state.owner.studentId || state.owner.studentId !== user.uid) throw new AccessError("That payment could not be found.");
  return createOrReuseOrder(config, target, state, { studentId: user.uid, guestRegistrationId: null });
}

/**
 * Guest checkout: a Razorpay order for a guest registration's initial payment,
 * authorised by the registration's checkout token (no account exists yet).
 */
export async function createOrderForGuest(registrationId: string, token: unknown): Promise<CheckoutOrder> {
  const config = readRazorpayConfig();
  if (!config) throw new AccessError("Online payment is not available yet. Please contact the academy.");
  const registration = await readGuestRegistration(registrationId, token);
  if (!registration || registration.studentId) throw new AccessError("That registration could not be found.");
  const target: PaymentTarget = { kind: "registration", registrationId };
  const state = await db().runTransaction((tx) => readPaymentTarget(tx, target));
  return createOrReuseOrder(config, target, state, { studentId: null, guestRegistrationId: registrationId });
}

type OrderOwner = { studentId: string | null; guestRegistrationId: string | null };

async function createOrReuseOrder(
  config: RazorpayConfig,
  target: PaymentTarget,
  state: Awaited<ReturnType<typeof readPaymentTarget>>,
  owner: OrderOwner,
): Promise<CheckoutOrder> {
  if (state.payableMinor === null) throw new AccessError("Nothing is payable on this item right now.");
  const amountMinor = state.payableMinor;
  if (amountMinor < MIN_ORDER_MINOR) throw new AccessError("This amount is too small to pay online. Please contact the academy.");
  const description = state.titleSuffix;
  const key = targetKey(target);

  // Double-charge guard: settle (or wait for) any payment already made on an earlier order of this item.
  const earlier = await reconcileOpenOrders(config, key, owner);
  if (earlier.recorded > 0 || earlier.duplicate > 0) throw new AccessError("Your payment has already been received and verified. Please refresh the page.");
  if (earlier.pending > 0) throw new AccessError("A payment for this is still being processed by Razorpay. Please check the payment status again in a few minutes before paying again.");

  const existing = await col("gatewayOrders").where("targetKey", "==", key).get();
  const reusable = existing.docs.find(
    (d) =>
      d.get("status") === "created" &&
      (d.get("mode") ?? "test") === config.mode &&
      (d.get("studentId") ?? null) === owner.studentId &&
      (d.get("guestRegistrationId") ?? null) === owner.guestRegistrationId &&
      d.get("amountMinor") === amountMinor &&
      Date.now() - (d.get("createdAt")?.toMillis?.() ?? 0) < ORDER_REUSE_MS,
  );
  if (reusable) return { keyId: config.keyId, orderId: reusable.id, amountMinor, currency: "INR", description };

  const order = await createRazorpayOrder(config, {
    amountMinor,
    receipt: key,
    notes: { target: key, ...(owner.studentId ? { studentId: owner.studentId } : { guest: "registration" }) },
  });
  if (order.amount !== amountMinor || order.currency !== "INR") throw new Error("Razorpay returned an unexpected order amount.");
  await col("gatewayOrders").doc(order.id).create({
    targetKey: key,
    target,
    mode: config.mode,
    studentId: owner.studentId,
    guestRegistrationId: owner.guestRegistrationId,
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
  via: "checkout" | "webhook" | "recovery";
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
  // Fail-closed: Test Mode payments never touch a production project's billing, and Live Mode only a real project.
  const mode = requirePaymentMode();
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
    if ((order.mode ?? "test") !== mode) throw new Error("Payment for an order of another payment mode");
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
    // Only invoices take part payments. A fixed amount (first class, session, registration) that changed after checkout opened is never applied short.
    else if (target.kind !== "invoice" && input.amountMinor < state.payableMinor) needsReview = "Received less than the amount now due (the item changed after checkout) — collect the difference or refund.";
    const record: PaymentRecord = {
      id: paymentDocId,
      studentId: state.owner.studentId,
      courseId: state.owner.courseId,
      enrollmentId: "",
      packageId: null,
      purpose: target.kind,
      accountId: state.owner.accountId,
      invoiceId: target.kind === "invoice" ? target.invoiceId : null,
      sessionChargeId: target.kind === "session" ? target.chargeId : null,
      registrationId: target.kind === "registration" ? target.registrationId : null,
      learnerIds: state.owner.studentId ? [state.owner.studentId] : [],
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
    const receiptCtx = await readReceiptContext(tx, record, null, state.titleSuffix, state.registration?.learnerName);

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
      registrationId: record.registrationId,
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
      gateway: { provider: "razorpay", mode, orderId: input.orderId, paymentId: input.paymentId, via: input.via },
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
    return {
      outcome: "recorded" as const,
      paymentId: paymentDocId,
      receiptNumber,
      needsReview,
      accountId: state.owner.accountId,
      registrationId: target.kind === "registration" && !needsReview ? target.registrationId : null,
    };
  });
  // A verified invoice payment may restore access (idempotent; the scheduled job re-checks too).
  if (result.outcome === "recorded") {
    if (result.accountId) await evaluateSuspension(result.accountId, GATEWAY_ACTOR);
    // A verified guest registration payment: create (or find) the student account and send the invitation.
    // Best effort here; the scheduled job retries anything left over.
    if (result.registrationId) {
      try {
        await provisionRegistrationAccount(result.registrationId);
      } catch (error) {
        console.error("[gateway] account provisioning will be retried:", (error as Error)?.message);
      }
    }
    // Server-verified payment committed (after provisioning, so a guest's new account gets the in-app
    // notice): notified once, keyed by the payment id — the checkout callback, recovery and webhook
    // redeliveries never notify twice.
    await notifyVerifiedPayment(result.paymentId, "online");
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

export async function gatewayOrderOwner(orderId: string): Promise<{ studentId: string; guestRegistrationId: string | null; createdAt: string | null } | null> {
  const snap = await col("gatewayOrders").doc(orderId).get();
  return snap.exists
    ? { studentId: String(snap.get("studentId") ?? ""), guestRegistrationId: (snap.get("guestRegistrationId") as string | null) ?? null, createdAt: toIso(snap.get("createdAt")) }
    : null;
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
  if (!owner || !owner.studentId || owner.studentId !== user.uid) throw new AccessError("The payment could not be verified.");
  return verifyAndRecordCheckout(config, orderId, paymentId, input.signature);
}

/** Guest checkout confirmation: the order must belong to this guest registration (checkout token). */
export async function confirmGuestCheckoutPayment(
  registrationId: string,
  token: unknown,
  input: { orderId: unknown; paymentId: unknown; signature: unknown },
): Promise<ConfirmedCheckout> {
  const orderId = typeof input?.orderId === "string" && /^order_[A-Za-z0-9]+$/.test(input.orderId) ? input.orderId : null;
  const paymentId = typeof input?.paymentId === "string" && /^pay_[A-Za-z0-9]+$/.test(input.paymentId) ? input.paymentId : null;
  if (!orderId || !paymentId) throw new AccessError("The payment could not be verified.");
  let config: ReturnType<typeof readRazorpayConfig>;
  try {
    config = readRazorpayConfig();
  } catch (error) {
    if (error instanceof GatewayConfigError) throw new AccessError("Online payment is not available right now.");
    throw error;
  }
  if (!config) throw new AccessError("Online payment is not available right now.");
  const registration = await readGuestRegistration(registrationId, token);
  const owner = await gatewayOrderOwner(orderId);
  if (!registration || !owner || owner.guestRegistrationId !== registrationId) throw new AccessError("The payment could not be verified.");
  return verifyAndRecordCheckout(config, orderId, paymentId, input.signature);
}

async function verifyAndRecordCheckout(
  config: RazorpayConfig,
  orderId: string,
  paymentId: string,
  signature: unknown,
): Promise<ConfirmedCheckout> {
  if (!verifyCheckoutSignature(orderId, paymentId, signature, config.keySecret)) {
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

// --- Recovery: payments whose confirmation never reached the server ------------------------------------------

const RECONCILE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const RECONCILE_MAX_ORDERS = 5;

/**
 * Asks Razorpay about this owner's recent open orders for one item and records
 * every CAPTURED payment through the same idempotent processor (amount, currency
 * and order are re-checked there). "pending" counts payments Razorpay has
 * authorised but not captured yet.
 */
async function reconcileOpenOrders(config: RazorpayConfig, key: string, owner: OrderOwner): Promise<{ recorded: number; duplicate: number; pending: number; paidOrders: number }> {
  const snap = await col("gatewayOrders").where("targetKey", "==", key).get();
  const mine = snap.docs.filter(
    (d) => (d.get("studentId") ?? null) === owner.studentId && (d.get("guestRegistrationId") ?? null) === owner.guestRegistrationId && (d.get("mode") ?? "test") === config.mode,
  );
  const open = mine
    .filter((d) => d.get("status") === "created" && Date.now() - (d.get("createdAt")?.toMillis?.() ?? 0) < RECONCILE_WINDOW_MS)
    .sort((a, b) => (b.get("createdAt")?.toMillis?.() ?? 0) - (a.get("createdAt")?.toMillis?.() ?? 0))
    .slice(0, RECONCILE_MAX_ORDERS);
  const tally = { recorded: 0, duplicate: 0, pending: 0, paidOrders: mine.filter((d) => d.get("status") === "paid").length };
  for (const order of open) {
    const payments = await fetchOrderPayments(config, order.id);
    for (const payment of payments) {
      if (payment.order_id !== order.id) continue;
      if (payment.status === "authorized") tally.pending += 1;
      if (payment.status !== "captured") continue;
      const result = await processVerifiedGatewayPayment({ orderId: order.id, paymentId: payment.id, amountMinor: payment.amount, currency: payment.currency, status: payment.status, via: "recovery" });
      if (result.outcome === "recorded") tally.recorded += 1;
      else if (result.outcome === "duplicate") tally.duplicate += 1;
    }
  }
  return tally;
}

export interface RecoveredPayment {
  /** recorded = verified now; already_recorded = verified earlier; processing = Razorpay has not captured it yet; none = no payment found. */
  status: "recorded" | "already_recorded" | "processing" | "none";
}

function summarise(t: Awaited<ReturnType<typeof reconcileOpenOrders>>): RecoveredPayment {
  if (t.recorded > 0) return { status: "recorded" };
  if (t.pending > 0) return { status: "processing" };
  if (t.duplicate > 0 || t.paidOrders > 0) return { status: "already_recorded" };
  return { status: "none" };
}

function requireConfig(): RazorpayConfig {
  try {
    const config = readRazorpayConfig();
    if (config) return config;
  } catch (error) {
    if (!(error instanceof GatewayConfigError)) throw error;
  }
  throw new AccessError("Online payment is not available right now.");
}

/** "Check payment status" for the signed-in student's own item (e.g. after closing the browser mid-payment). */
export async function recoverStudentPayment(user: SessionUser, target: PaymentTarget): Promise<RecoveredPayment> {
  if (user.role !== "student") throw new AccessError("Only students can check their payments.");
  const config = requireConfig();
  const state = await db().runTransaction((tx) => readPaymentTarget(tx, target));
  if (!state.owner.studentId || state.owner.studentId !== user.uid) throw new AccessError("That payment could not be found.");
  return summarise(await reconcileOpenOrders(config, targetKey(target), { studentId: user.uid, guestRegistrationId: null }));
}

/** "Check payment status" for a guest registration (checkout token). */
export async function recoverGuestPayment(registrationId: string, token: unknown): Promise<RecoveredPayment> {
  const config = requireConfig();
  const registration = await readGuestRegistration(registrationId, token);
  if (!registration) throw new AccessError("That registration could not be found.");
  return summarise(await reconcileOpenOrders(config, targetKey({ kind: "registration", registrationId }), { studentId: null, guestRegistrationId: registrationId }));
}

/**
 * A signed payment.failed webhook: noted on the order for the academy (no
 * money moved, nothing else changes; the student can simply try again).
 */
export async function recordGatewayPaymentFailure(input: { orderId: string; paymentId: string; code: string | null; description: string | null }): Promise<"noted" | "ignored"> {
  const outcome = await noteGatewayPaymentFailure(input);
  // Signed webhook only (never the browser); once per Razorpay payment id.
  if (outcome === "noted") await notifyPaymentFailed(input.orderId, input.paymentId, input.description?.slice(0, 300) ?? null);
  return outcome;
}

async function noteGatewayPaymentFailure(input: { orderId: string; paymentId: string; code: string | null; description: string | null }): Promise<"noted" | "ignored"> {
  const ref = col("gatewayOrders").doc(input.orderId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("status") !== "created") return "ignored" as const;
    tx.update(ref, {
      failedAttempts: FieldValue.increment(1),
      lastFailure: { paymentId: input.paymentId, code: input.code?.slice(0, 80) ?? null, description: input.description?.slice(0, 300) ?? null, at: FieldValue.serverTimestamp() },
    });
    return "noted" as const;
  });
}
