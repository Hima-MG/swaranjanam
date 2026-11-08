"use client";

import { CreditCard, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { checkOnlinePayment, confirmOnlinePayment, startOnlinePayment } from "@/app/(account)/dashboard/payment-actions";
import { checkGuestPayment, confirmGuestPayment, startGuestPayment } from "@/app/(public)/enrol/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayCheckout {
  open(): void;
  on(event: "payment.failed", handler: (response: { error?: { description?: string; reason?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Online payment could not be loaded. Check your internet connection and try again.")), { once: true });
    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

type Message = { tone: "error" | "success" | "info"; text: string };
const NETWORK_AFTER_PAYMENT =
  "We could not reach the academy's server to confirm your payment. If money was deducted it is safe: use “Check payment status” in a moment — do not pay again.";

/**
 * Pays the student's own initial payment, advance or invoice with Razorpay
 * Standard Checkout. The amount and order come from the server. Success shown
 * here is only what the SERVER confirmed after verifying the payment with
 * Razorpay; the checkout's own "success" callback never marks anything paid.
 */
export function PayOnlineButton({
  kind,
  id,
  label,
  guestSlug,
  mode = null,
  statusCheck = false,
}: {
  kind: "advance" | "invoice" | "session" | "registration";
  id: string;
  label: string;
  /** Guest checkout (signed out): the registration is identified by its checkout cookie for this course. */
  guestSlug?: string;
  /** Razorpay mode configured on the server (labels Test Mode clearly). */
  mode?: "test" | "live" | null;
  /** Show "Check payment status" (recovery after the browser closed mid-payment). */
  statusCheck?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // Synchronous guard: a second click before React re-renders never opens a second checkout.
  const inFlight = useRef(false);

  function finish(next: Message | null) {
    if (next) setMessage(next);
    inFlight.current = false;
    setBusy(false);
  }

  async function pay() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    let settled = false; // the server was asked to verify (success path) — dismissal must not reset that
    let failed = false;
    try {
      const order = guestSlug ? await startGuestPayment(guestSlug) : await startOnlinePayment(kind, id);
      if (!order.ok) throw new Error(order.error);
      await loadCheckout();
      if (!window.Razorpay) throw new Error("Online payment could not be loaded. Please try again.");
      const checkout = new window.Razorpay({
        key: order.data.keyId,
        order_id: order.data.orderId,
        amount: order.data.amountMinor,
        currency: order.data.currency,
        name: "Swaraanjanam Music Academy",
        description: order.data.description,
        theme: { color: "#7a1f3d" },
        retry: { enabled: true },
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          settled = true;
          setMessage({ tone: "info", text: "Payment received by Razorpay. Verifying it with the academy's server — please keep this page open…" });
          const verified = { orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature };
          try {
            const result = guestSlug ? await confirmGuestPayment(guestSlug, verified) : await confirmOnlinePayment(verified);
            if (!result.ok) finish({ tone: "error", text: result.error });
            else if (result.data.status === "processing")
              finish({ tone: "info", text: "Razorpay is still processing your payment. It will be confirmed automatically — use “Check payment status” in a few minutes. Do not pay again." });
            else finish({ tone: "success", text: `Payment verified${result.data.receiptNumber ? ` — receipt ${result.data.receiptNumber}` : ""}.` });
          } catch {
            finish({ tone: "error", text: NETWORK_AFTER_PAYMENT });
          }
          router.refresh();
        },
        modal: {
          ondismiss: () => {
            if (settled) return;
            finish(failed ? null : { tone: "info", text: "Checkout closed. No payment was made — you can pay whenever you are ready." });
          },
        },
      });
      checkout.on("payment.failed", (r) => {
        failed = true;
        setMessage({ tone: "error", text: `${r.error?.description ?? "The payment failed."} No money was taken for a failed payment. You can try again.` });
      });
      checkout.open();
    } catch (error) {
      const text = (error as Error)?.message;
      finish({ tone: "error", text: text && !/fetch|network/i.test(text) ? text : "Could not start the payment. Check your internet connection and try again." });
    }
  }

  async function check() {
    if (checking || inFlight.current) return;
    setChecking(true);
    setMessage(null);
    try {
      const result = guestSlug ? await checkGuestPayment(guestSlug) : await checkOnlinePayment(kind, id);
      if (!result.ok) setMessage({ tone: "error", text: result.error });
      else if (result.data.status === "recorded") setMessage({ tone: "success", text: "Your payment has been verified." });
      else if (result.data.status === "already_recorded") setMessage({ tone: "success", text: "Your payment was already verified." });
      else if (result.data.status === "processing") setMessage({ tone: "info", text: "Razorpay is still processing your payment. Please check again in a few minutes. Do not pay again." });
      else setMessage({ tone: "info", text: "No completed payment was found yet. If you have not paid, use the Pay button." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Could not check right now. Check your internet connection and try again." });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={pay} disabled={busy || checking} aria-busy={busy}>
          {busy ? <Spinner className="size-4 text-cream" /> : <CreditCard data-icon="inline-start" />}
          {busy ? "Processing…" : label}
        </Button>
        {statusCheck && (
          <Button type="button" size="sm" variant="outline" onClick={check} disabled={busy || checking} aria-busy={checking}>
            {checking ? <Spinner className="size-4" /> : <RefreshCw data-icon="inline-start" />}
            Check payment status
          </Button>
        )}
      </div>
      {mode === "test" && <p className="text-xs text-muted-foreground">Test mode — no real money is charged.</p>}
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
    </div>
  );
}
