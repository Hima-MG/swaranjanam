import { claimWebhookEvent, processVerifiedGatewayPayment, webhookEventSeen } from "@/lib/lms/server/gateway";
import { readRazorpayConfig } from "@/lib/payments/razorpay";
import { verifyWebhookSignature } from "@/lib/payments/razorpay-signature";

/**
 * Razorpay webhook (TEST MODE). Configure in the Razorpay test dashboard with
 * the events payment.captured and order.paid, and the secret in
 * RAZORPAY_WEBHOOK_SECRET.
 *
 *  * The signature of the RAW body is verified before anything is read.
 *  * Each event id is processed once (gatewayEvents/{eventId}).
 *  * Each payment is recorded once (payments/rzp_{paymentId}).
 * No session or CSRF check applies: authenticity comes from the signature.
 */
export async function POST(request: Request) {
  const config = (() => {
    try {
      return readRazorpayConfig();
    } catch {
      return null;
    }
  })();
  if (!config?.webhookSecret) return Response.json({ error: "Not configured" }, { status: 503 });

  const raw = await request.text();
  if (raw.length > 1_000_000) return Response.json({ error: "Too large" }, { status: 413 });
  if (!verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature"), config.webhookSecret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: { event?: string; payload?: { payment?: { entity?: Record<string, unknown> } } };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const event = String(body.event ?? "");
  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) return Response.json({ error: "Missing event id" }, { status: 400 });

  if (event !== "payment.captured" && event !== "order.paid") return Response.json({ ok: true, ignored: event });
  if (await webhookEventSeen(eventId)) return Response.json({ ok: true, duplicate: true });

  const entity = body.payload?.payment?.entity ?? {};
  const orderId = typeof entity.order_id === "string" ? entity.order_id : null;
  const paymentId = typeof entity.id === "string" ? entity.id : null;
  if (!orderId || !paymentId) return Response.json({ ok: true, ignored: "no payment entity" });
  try {
    const result = await processVerifiedGatewayPayment({
      orderId,
      paymentId,
      amountMinor: Number(entity.amount),
      currency: String(entity.currency ?? ""),
      status: String(entity.status ?? ""),
      via: "webhook",
    });
    // Recorded only after success, so a failed attempt is retried by Razorpay.
    // (Payment processing itself is idempotent, so a concurrent duplicate is harmless.)
    await claimWebhookEvent(eventId, event);
    return Response.json({ ok: true, outcome: result.outcome });
  } catch (error) {
    // Logged without payment details; Razorpay retries failed deliveries.
    console.error("[razorpay] webhook processing failed:", (error as Error)?.message);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
