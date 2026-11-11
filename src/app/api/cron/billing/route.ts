import { timingSafeEqual } from "node:crypto";

import { connection } from "next/server";

import { runScheduledBilling } from "@/lib/lms/server/class-billing";
import { provisionPendingRegistrations } from "@/lib/lms/server/guest-enrolment";
import { retryFailedEmails } from "@/lib/notifications/service";

/**
 * Scheduled billing job (Vercel Cron, see vercel.json; daily at 23:30 IST).
 *  1. On the last calendar day of a month (from 23:00 IST), creates that month's
 *     invoice for every batch and individual account with billable classes.
 *  2. Retries student-account provisioning for verified guest registrations.
 *  3. Suspends accounts with an invoice unpaid after its payment deadline,
 *     and restores accounts whose overdue invoices are now paid.
 *  4. Notifies students (invoice, payment due, overdue) and retries failed
 *     notification emails (emailOutbox).
 * Idempotent: running it again (or concurrently) never duplicates anything.
 *
 * Protected by CRON_SECRET: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
 * Without CRON_SECRET the route is disabled (503) — nothing runs.
 */
export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "Not configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runScheduledBilling({ uid: "scheduler", email: null });
  const accounts = await provisionPendingRegistrations();
  // Email retries never fail the job: delivery problems are recorded on each outbox entry.
  const emails = await retryFailedEmails().catch((error) => {
    console.error("[cron] email retry failed:", (error as Error)?.message);
    return { attempted: 0, sent: 0, failed: 0 };
  });
  const errors = summary.errors + accounts.errors;
  return Response.json({ ok: errors === 0, ...summary, accountsProvisioned: accounts.attempted, emailsRetried: emails.attempted, emailsSent: emails.sent, errors }, { status: errors ? 500 : 200 });
}
