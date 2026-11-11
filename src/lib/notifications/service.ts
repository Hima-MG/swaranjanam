import "server-only";

import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import { after } from "next/server";

import { siteConfig } from "@/config/site";
import type { SessionUser } from "@/lib/auth/session";
import { AccessError } from "@/lib/lms/server/access";
import { col, db, toIso } from "@/lib/lms/server/db";
import { renderEmail, type EmailContent } from "@/lib/notifications/email-template";
import { NOTIFICATION_ID_PATTERN, notificationId } from "@/lib/notifications/ids";
import { getEmailTransport } from "@/lib/notifications/transport";
import { NOTIFICATION_TYPES, safeNotificationLink, type NotificationType, type NotificationView } from "@/lib/notifications/types";

/**
 * Centralised student notifications (in-app + email).
 *
 *  * Called only AFTER a business operation has committed (registration saved,
 *    payment verified server-side, batch/schedule confirmed, …). It never
 *    throws: a notification problem cannot undo or fail that operation.
 *  * Idempotent: the document id is a hash of the event key, created with
 *    create() in one batch with its email. A webhook redelivery, retry or
 *    repeated action with the same event key writes nothing and sends nothing.
 *  * Email goes through emailOutbox/{id}: written with the notification,
 *    delivered after the response (next/server `after`), and retried by the
 *    scheduled job (retryFailedEmails) when delivery fails. Resend receives the
 *    same id as its idempotency key, so a retried send is delivered once.
 *
 * Collections (server only; client access denied by the catch-all rule):
 *   notifications/{n_<hash>}  userId, title, message, type, relatedRecordId, link, isRead, createdAt, readAt, eventKey
 *   emailOutbox/{n_<hash>}    to, subject, html, text, userId, type, eventKey, status
 *                             (pending | sending | sent | failed | abandoned), attempts, lastError, nextAttemptAt, sentAt
 */

export interface NotifyInput {
  /** Unique, deterministic key of the business event (e.g. "payment:rzp_pay_123"). */
  eventKey: string;
  /** The student; null for an email-only notice (guest registration before an account exists). */
  userId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  relatedRecordId: string | null;
  link: string;
  /** Email content (omit for in-app only). */
  email?: EmailContent | null;
  /** Address used when the student's profile has none (guest registrations). */
  emailTo?: string | null;
}

export type NotifyOutcome = "created" | "duplicate" | "skipped" | "error";

const MAX_ATTEMPTS = 6;
const SENDING_LOCK_MS = 5 * 60 * 1000;

export { notificationId };

const ID_PATTERN = NOTIFICATION_ID_PATTERN;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === 6 || code === "already-exists" || /ALREADY_EXISTS/.test(String((error as Error)?.message ?? ""));
}

function safeMessage(error: unknown): string {
  // Never log or store API keys or email bodies: only the error's class and message, trimmed.
  return String((error as Error)?.message ?? error ?? "unknown error")
    .replace(/re_[A-Za-z0-9_]{8,}/g, "re_***")
    .slice(0, 300);
}

async function resolveAddress(userId: string | null, fallback: string | null | undefined): Promise<string | null> {
  if (userId) {
    const profile = await col("users").doc(userId).get();
    const email = profile.get("email");
    if (typeof email === "string" && EMAIL_PATTERN.test(email)) return email;
  }
  return typeof fallback === "string" && EMAIL_PATTERN.test(fallback) ? fallback : null;
}

export async function notify(input: NotifyInput): Promise<NotifyOutcome> {
  try {
    const id = notificationId(input.eventKey);
    const inApp = Boolean(input.userId);
    const to = input.email ? await resolveAddress(input.userId, input.emailTo) : null;
    if (!inApp && !to) return "skipped";
    const batch = db().batch();
    const now = FieldValue.serverTimestamp();
    if (inApp) {
      batch.create(col("notifications").doc(id), {
        userId: input.userId,
        title: input.title.slice(0, 160),
        message: input.message.slice(0, 1000),
        type: input.type,
        relatedRecordId: input.relatedRecordId,
        link: safeNotificationLink(input.link),
        isRead: false,
        readAt: null,
        eventKey: input.eventKey,
        createdAt: now,
      });
    }
    if (input.email && to) {
      const rendered = renderEmail(input.email, siteConfig.url);
      batch.create(col("emailOutbox").doc(id), {
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        userId: input.userId,
        type: input.type,
        eventKey: input.eventKey,
        status: "pending",
        attempts: 0,
        lastError: null,
        nextAttemptAt: Timestamp.now(),
        createdAt: now,
      });
    }
    await batch.commit();
    if (input.email && to) scheduleEmailDelivery(id);
    return "created";
  } catch (error) {
    if (isAlreadyExists(error)) return "duplicate";
    console.error("[notifications] could not record notification:", input.type, safeMessage(error));
    return "error";
  }
}

// --- Email delivery ----------------------------------------------------------------------------------

const inflight = new Set<Promise<unknown>>();

/** Delivers after the response when inside a request; otherwise in the background. Never blocks the caller. */
function scheduleEmailDelivery(id: string) {
  const run = () =>
    deliverEmail(id).catch((error) => {
      console.error("[email] delivery error:", id, safeMessage(error));
    });
  try {
    after(run);
  } catch {
    const p = run();
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  }
}

/** Tests and jobs: waits for background deliveries started outside a request. */
export async function settleEmailDeliveries(): Promise<void> {
  while (inflight.size) await Promise.all([...inflight]);
}

export type DeliveryOutcome = "sent" | "failed" | "skipped";

/** Sends one outbox email (claims it first, so concurrent runs never send it twice). */
export async function deliverEmail(id: string, nowMs = Date.now()): Promise<DeliveryOutcome> {
  if (!ID_PATTERN.test(id)) return "skipped";
  const ref = col("emailOutbox").doc(id);
  const claimed = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data()!;
    if (d.status === "sent" || d.status === "abandoned") return null;
    const lockedAt = toIso(d.lockedAt);
    if (d.status === "sending" && lockedAt && Date.parse(lockedAt) > nowMs - SENDING_LOCK_MS) return null;
    const attempts = (typeof d.attempts === "number" ? d.attempts : 0) + 1;
    tx.update(ref, { status: "sending", lockedAt: Timestamp.fromMillis(nowMs), attempts });
    return { to: String(d.to), subject: String(d.subject), html: String(d.html), text: String(d.text), attempts };
  });
  if (!claimed) return "skipped";
  const transport = getEmailTransport();
  try {
    const result = await transport.send({ to: claimed.to, subject: claimed.subject, html: claimed.html, text: claimed.text, idempotencyKey: id });
    await ref.update({ status: "sent", sentAt: FieldValue.serverTimestamp(), providerId: result.id, transport: transport.name, lastError: null, lockedAt: null });
    return "sent";
  } catch (error) {
    const message = safeMessage(error);
    const final = claimed.attempts >= MAX_ATTEMPTS;
    // Exponential backoff: 5, 10, 20, 40, 80 minutes.
    const backoffMs = Math.min(5 * 60 * 1000 * 2 ** (claimed.attempts - 1), 6 * 60 * 60 * 1000);
    await ref.update({
      status: final ? "abandoned" : "failed",
      lastError: message,
      lockedAt: null,
      transport: transport.name,
      nextAttemptAt: Timestamp.fromMillis(nowMs + backoffMs),
    });
    console.error(`[email] delivery failed (attempt ${claimed.attempts}${final ? ", giving up" : ""}):`, id, message);
    return "failed";
  }
}

/** Retries pending, failed and stuck emails whose next attempt is due (scheduled job). */
export async function retryFailedEmails(nowMs = Date.now(), limit = 50): Promise<{ attempted: number; sent: number; failed: number }> {
  const snap = await col("emailOutbox").where("status", "in", ["pending", "failed", "sending"]).limit(300).get();
  const due = snap.docs
    .filter((d) => {
      const next = toIso(d.get("nextAttemptAt"));
      if (d.get("status") === "sending") {
        const lockedAt = toIso(d.get("lockedAt"));
        return !lockedAt || Date.parse(lockedAt) <= nowMs - SENDING_LOCK_MS;
      }
      return !next || Date.parse(next) <= nowMs;
    })
    .slice(0, limit);
  const tally = { attempted: 0, sent: 0, failed: 0 };
  for (const doc of due) {
    const outcome = await deliverEmail(doc.id, nowMs);
    if (outcome === "skipped") continue;
    tally.attempted += 1;
    if (outcome === "sent") tally.sent += 1;
    else tally.failed += 1;
  }
  return tally;
}

// --- Student access (own notifications only) ----------------------------------------------------------

function mapNotification(snap: DocumentSnapshot<DocumentData>): NotificationView | null {
  const d = snap.data();
  if (!d) return null;
  return {
    id: snap.id,
    type: (NOTIFICATION_TYPES as readonly string[]).includes(d.type) ? (d.type as NotificationType) : "registration_submitted",
    title: String(d.title ?? ""),
    message: String(d.message ?? ""),
    link: safeNotificationLink(d.link),
    isRead: d.isRead === true,
    createdAt: toIso(d.createdAt),
  };
}

function assertStudent(user: SessionUser) {
  if (user.role !== "student") throw new AccessError("You do not have permission to do that.");
}

export async function listOwnNotifications(user: SessionUser, max = 50): Promise<{ items: NotificationView[]; unreadCount: number }> {
  assertStudent(user);
  // Equality filter only (no composite index); newest first, sorted here.
  const snap = await col("notifications").where("userId", "==", user.uid).limit(300).get();
  const all = snap.docs
    .map(mapNotification)
    .filter((n): n is NotificationView => n !== null)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return { items: all.slice(0, max), unreadCount: all.filter((n) => !n.isRead).length };
}

export async function markNotificationRead(user: SessionUser, id: unknown): Promise<void> {
  assertStudent(user);
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new AccessError("That notification could not be found.");
  const ref = col("notifications").doc(id);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Someone else's notification is reported exactly like a missing one.
    if (!snap.exists || snap.get("userId") !== user.uid) throw new AccessError("That notification could not be found.");
    if (snap.get("isRead") !== true) tx.update(ref, { isRead: true, readAt: FieldValue.serverTimestamp() });
  });
}

export async function markAllNotificationsRead(user: SessionUser): Promise<number> {
  assertStudent(user);
  const snap = await col("notifications").where("userId", "==", user.uid).where("isRead", "==", false).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db().batch();
    for (const doc of snap.docs.slice(i, i + 400)) batch.update(doc.ref, { isRead: true, readAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }
  return snap.size;
}
