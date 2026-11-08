"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { AccessError, runAction } from "@/lib/lms/server/access";
import { writeAudit } from "@/lib/lms/server/audit";
import { confirmGuestCheckoutPayment, createOrderForGuest, type CheckoutOrder, type ConfirmedCheckout } from "@/lib/lms/server/gateway";
import { saveGuestRegistration } from "@/lib/lms/server/guest-enrolment";
import { guestCookieName, parseGuestCookie } from "@/lib/lms/guest-cookie";
import type { ActionResult } from "@/lib/lms/types";
import { GatewayConfigError } from "@/lib/payments/razorpay";

// Guest enrolment (signed-out visitors). The browser keeps a random checkout
// token in an HttpOnly cookie scoped to this course; the server stores only its
// hash. Amounts always come from the server; a payment counts only after
// server-side verification; the student account is created after that.

const SLUG = /^[a-z0-9-]{1,80}$/;
const COOKIE_DAYS = 14;

async function readCookie(slug: unknown): Promise<{ registrationId: string; token: string } | null> {
  if (typeof slug !== "string" || !SLUG.test(slug)) return null;
  return parseGuestCookie((await cookies()).get(guestCookieName(slug))?.value);
}

/** Signed-in users use their own (dashboard) enrolment instead. */
async function assertSignedOut() {
  if (await getSession()) throw new AccessError("You are signed in. Please enrol from your dashboard.");
}

export async function saveGuestRegistrationAction(
  slug: string,
  mode: unknown,
  details: Record<string, unknown>,
): Promise<ActionResult<{ registrationId: string; initialAmountMinor: number }>> {
  return runAction("saveGuestRegistration", async () => {
    await assertSignedOut();
    const current = await readCookie(slug);
    const result = await saveGuestRegistration({ slug, mode, details }, current?.token ?? null);
    (await cookies()).set(guestCookieName(slug), `${result.registrationId}.${result.token}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_DAYS * 24 * 60 * 60,
    });
    await writeAudit(
      { uid: "guest", email: null, name: null, role: "student" },
      { action: result.outcome === "created" ? "registration.create" : "registration.update", targetType: "registration", targetId: result.registrationId, summary: `Guest registration for ${slug} (${String(mode)})` },
    );
    refresh();
    return { registrationId: result.registrationId, initialAmountMinor: result.initialAmountMinor };
  });
}

export async function startGuestPayment(slug: string): Promise<ActionResult<CheckoutOrder>> {
  return runAction("startGuestPayment", async () => {
    await assertSignedOut();
    const current = await readCookie(slug);
    if (!current) throw new AccessError("Your registration could not be found. Please fill in the form again.");
    try {
      return await createOrderForGuest(current.registrationId, current.token);
    } catch (error) {
      if (error instanceof GatewayConfigError) throw new AccessError("Online payment is not available right now. Please contact the academy.");
      throw error;
    }
  });
}

export async function confirmGuestPayment(slug: string, input: { orderId: unknown; paymentId: unknown; signature: unknown }): Promise<ActionResult<ConfirmedCheckout>> {
  return runAction("confirmGuestPayment", async () => {
    const current = await readCookie(slug);
    if (!current) throw new AccessError("The payment could not be verified.");
    const result = await confirmGuestCheckoutPayment(current.registrationId, current.token, input);
    refresh();
    return result;
  });
}
