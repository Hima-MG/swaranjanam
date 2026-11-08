"use client";

import { CreditCard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { confirmOnlinePayment, startOnlinePayment } from "@/app/(account)/dashboard/payment-actions";
import { confirmGuestPayment, startGuestPayment } from "@/app/(public)/enrol/actions";
import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayCheckout {
  open(): void;
  on(event: "payment.failed", handler: (response: { error?: { description?: string } }) => void): void;
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
    script.addEventListener("error", () => reject(new Error("load")), { once: true });
    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

/**
 * Pays the student's own advance or invoice with Razorpay (TEST MODE).
 * The amount comes from the server. Success shown here is only what the
 * SERVER confirmed after verifying the payment with Razorpay.
 */
export function PayOnlineButton({
  kind,
  id,
  label,
  guestSlug,
}: {
  kind: "advance" | "invoice" | "session" | "registration";
  id: string;
  label: string;
  /** Guest checkout (signed out): the registration is identified by its checkout cookie for this course. */
  guestSlug?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);

  async function pay() {
    setBusy(true);
    setMessage(null);
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
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          setMessage({ tone: "info", text: "Verifying your payment with the server…" });
          const verified = { orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature };
          const result = guestSlug ? await confirmGuestPayment(guestSlug, verified) : await confirmOnlinePayment(verified);
          if (!result.ok) setMessage({ tone: "error", text: result.error });
          else if (result.data.status === "processing") setMessage({ tone: "info", text: "Payment received by Razorpay and is still being confirmed. This page will update once it is verified." });
          else setMessage({ tone: "success", text: `Payment verified${result.data.receiptNumber ? ` — receipt ${result.data.receiptNumber}` : ""}.` });
          setBusy(false);
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.on("payment.failed", (r) => setMessage({ tone: "error", text: r.error?.description ?? "The payment failed. No money was taken." }));
      checkout.open();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message || "Could not start the payment." });
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" size="sm" onClick={pay} disabled={busy} className="self-start">
        {busy ? <Spinner className="size-4 text-cream" /> : <CreditCard data-icon="inline-start" />}
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">Test mode — no real money is charged.</p>
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
    </div>
  );
}
