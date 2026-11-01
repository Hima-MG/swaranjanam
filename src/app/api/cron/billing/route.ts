import { timingSafeEqual } from "node:crypto";

import { connection } from "next/server";

import { runScheduledBilling } from "@/lib/lms/server/class-billing";

/**
 * Scheduled billing job (Vercel Cron, see vercel.json; daily at 00:30 IST).
 *  1. Creates missing monthly batch invoices for completed months (IST).
 *  2. Suspends accounts with an invoice unpaid after its payment deadline,
 *     and restores accounts whose overdue invoices are now paid.
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
  return Response.json({ ok: summary.errors === 0, ...summary }, { status: summary.errors ? 500 : 200 });
}
