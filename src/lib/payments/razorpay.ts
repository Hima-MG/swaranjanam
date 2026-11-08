import "server-only";

import { paymentEnvironment, TEST_PROJECTS_ENV, type RazorpayMode } from "@/lib/payments/environment";
import { razorpayKeyMode } from "@/lib/payments/razorpay-signature";

// Minimal Razorpay REST client (Orders + Payments) for Test Mode and Live Mode.
// No SDK dependency: a few authenticated HTTPS calls to the official REST API.
// The key secret and the webhook secret never leave the server; only the key
// id is sent to the browser (Razorpay requires it for Checkout).
//
// The MODE follows the key id: rzp_test_… = Test Mode, rzp_live_… = Live Mode.
// Each mode is fenced to the right Firebase project (payments/environment.ts):
// Test Mode only on an emulator / listed non-production project, Live Mode
// never on one of those.
//
// Environment variables (names only — set them in .env.local / Vercel):
//   RAZORPAY_KEY_ID          rzp_test_… or rzp_live_…
//   RAZORPAY_KEY_SECRET      the secret of that key
//   RAZORPAY_WEBHOOK_SECRET  secret configured on the webhook of the same mode
//   NEXT_PUBLIC_RAZORPAY_KEY_ID  optional; when set it must equal RAZORPAY_KEY_ID
//   RAZORPAY_TEST_FIREBASE_PROJECTS  non-production Firebase projects allowed to
//                            record Test Mode payments (see payments/environment.ts)

export type { RazorpayMode };

export class GatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayConfigError";
  }
}

export interface RazorpayConfig {
  mode: RazorpayMode;
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
}

/**
 * Throws unless payments of this mode may be recorded in this server's
 * Firebase project (fail-closed; see payments/environment.ts).
 */
export function assertPaymentEnvironment(mode: RazorpayMode): void {
  const env = paymentEnvironment(mode, process.env.FIREBASE_ADMIN_PROJECT_ID, process.env[TEST_PROJECTS_ENV]);
  if (!env.allowed) throw new GatewayConfigError(env.reason);
}

/** Null when online payments are not configured (the manual workflow keeps working). Throws when misconfigured or refused here. */
export function readRazorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  const mode = razorpayKeyMode(keyId);
  if (!mode) throw new GatewayConfigError("RAZORPAY_KEY_ID is not a Razorpay key id (rzp_test_… or rzp_live_…).");
  const publicKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim();
  if (publicKeyId && publicKeyId !== keyId) throw new GatewayConfigError("NEXT_PUBLIC_RAZORPAY_KEY_ID does not match RAZORPAY_KEY_ID.");
  assertPaymentEnvironment(mode);
  return { mode, keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null };
}

/**
 * The mode payments are recorded in, for the payment processor: the configured
 * key's mode, or Test Mode when no keys are set. Throws unless payments of that
 * mode may be recorded in this Firebase project.
 */
export function requirePaymentMode(): RazorpayMode {
  const config = readRazorpayConfig();
  if (config) return config.mode;
  assertPaymentEnvironment("test");
  return "test";
}

function auth(config: RazorpayConfig) {
  return `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

/** Razorpay's minimum order amount (₹1). */
export const MIN_ORDER_MINOR = 100;

export async function createRazorpayOrder(
  config: RazorpayConfig,
  input: { amountMinor: number; receipt: string; notes: Record<string, string> },
): Promise<RazorpayOrder> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < MIN_ORDER_MINOR) throw new Error("Order amount is below Razorpay's minimum.");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: auth(config), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: input.amountMinor, currency: "INR", receipt: input.receipt.slice(0, 40), notes: input.notes }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Razorpay order creation failed with status ${response.status}`);
  return (await response.json()) as RazorpayOrder;
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method?: string;
}

/** The authoritative payment record, fetched from Razorpay (never trusted from the browser). */
export async function fetchRazorpayPayment(config: RazorpayConfig, paymentId: string): Promise<RazorpayPayment> {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new Error("Invalid payment id");
  const response = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: auth(config) },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Razorpay payment lookup failed with status ${response.status}`);
  return (await response.json()) as RazorpayPayment;
}

/** Every payment attempt Razorpay holds for an order (status recovery when the browser closed). */
export async function fetchOrderPayments(config: RazorpayConfig, orderId: string): Promise<RazorpayPayment[]> {
  if (!/^order_[A-Za-z0-9]+$/.test(orderId)) throw new Error("Invalid order id");
  const response = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
    headers: { Authorization: auth(config) },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Razorpay order lookup failed with status ${response.status}`);
  const body = (await response.json()) as { items?: RazorpayPayment[] };
  return Array.isArray(body.items) ? body.items : [];
}

/** True when online payments are configured AND allowed here (never throws). */
export function onlinePaymentsEnabled(): boolean {
  return onlinePaymentsStatus().enabled;
}

/** For student and staff screens: whether online payments are on, in which mode, and why not. Never includes secrets. */
export function onlinePaymentsStatus(): { enabled: boolean; mode: RazorpayMode | null; reason: string | null } {
  try {
    const config = readRazorpayConfig();
    return config ? { enabled: true, mode: config.mode, reason: null } : { enabled: false, mode: null, reason: "Razorpay keys are not configured." };
  } catch (error) {
    return { enabled: false, mode: null, reason: error instanceof GatewayConfigError ? error.message : "Online payment settings are invalid." };
  }
}
