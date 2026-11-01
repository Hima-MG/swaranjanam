import "server-only";

import { TEST_PROJECTS_ENV, testModeEnvironment } from "@/lib/payments/environment";
import { isTestKeyId } from "@/lib/payments/razorpay-signature";

// Minimal Razorpay REST client (Orders + Payments), TEST MODE ONLY.
// No SDK dependency: two authenticated HTTPS calls. The key secret and the
// webhook secret never leave the server; only the key id is sent to the
// browser (Razorpay requires it for Checkout).
//
// Environment variables (names only — set them in .env.local / Vercel):
//   RAZORPAY_KEY_ID          rzp_test_… (live keys are refused)
//   RAZORPAY_KEY_SECRET      test key secret
//   RAZORPAY_WEBHOOK_SECRET  secret configured on the test-mode webhook
//   RAZORPAY_TEST_FIREBASE_PROJECTS  non-production Firebase projects allowed to
//                            record Test Mode payments (see payments/environment.ts)

export class GatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayConfigError";
  }
}

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
}

/**
 * Throws unless Test Mode payments may be recorded in this server's Firebase
 * project (fail-closed; see payments/environment.ts). Called before any order
 * is created and again before any payment is recorded.
 */
export function assertTestPaymentEnvironment(): void {
  const env = testModeEnvironment(process.env.FIREBASE_ADMIN_PROJECT_ID, process.env[TEST_PROJECTS_ENV]);
  if (!env.allowed) throw new GatewayConfigError(env.reason);
}

/** Null when online payments are not configured (the manual workflow keeps working). */
export function readRazorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  if (!isTestKeyId(keyId)) throw new GatewayConfigError("Only Razorpay test-mode keys (rzp_test_…) are allowed in this build.");
  assertTestPaymentEnvironment();
  return { keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null };
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

export async function createRazorpayOrder(
  config: RazorpayConfig,
  input: { amountMinor: number; receipt: string; notes: Record<string, string> },
): Promise<RazorpayOrder> {
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

/** True when test-mode online payments are configured AND allowed here (never throws). */
export function onlinePaymentsEnabled(): boolean {
  return onlinePaymentsStatus().enabled;
}

/** For staff screens: whether online payments are on, and why not. Never includes secrets. */
export function onlinePaymentsStatus(): { enabled: boolean; reason: string | null } {
  try {
    return readRazorpayConfig() ? { enabled: true, reason: null } : { enabled: false, reason: "Razorpay keys are not configured." };
  } catch (error) {
    return { enabled: false, reason: error instanceof GatewayConfigError ? error.message : "Online payment settings are invalid." };
  }
}
