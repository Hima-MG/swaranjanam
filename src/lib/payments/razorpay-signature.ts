// Razorpay signature checks (HMAC-SHA256), constant-time. No network, no
// secrets stored here: callers pass the secret from server-side environment
// variables. Unit-tested in tests/unit/razorpay.test.mjs.
import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqualHex(expected: string, received: unknown): boolean {
  if (typeof received !== "string" || !/^[0-9a-f]{64}$/i.test(received)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checkout success handler: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: unknown, keySecret: string): boolean {
  if (!orderId || !paymentId || !keySecret) return false;
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

/** Webhooks: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook secret). */
export function verifyWebhookSignature(rawBody: string, signature: unknown, webhookSecret: string): boolean {
  if (!webhookSecret) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

/** Only Razorpay TEST keys are accepted by this build; live payments are disabled. */
export function isTestKeyId(keyId: string | undefined | null): boolean {
  return typeof keyId === "string" && /^rzp_test_[A-Za-z0-9]+$/.test(keyId);
}
