import { AlertCircle, CalendarClock, Settings2, ShieldAlert, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { OpenIndividualAccountDialog, RunBillingButton } from "@/components/lms/teacher/class-billing-controls";
import { StatCard } from "@/components/lms/teacher/stat-card";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { ADVANCE_STATUS_LABELS, BILLING_MODE_LABELS, paymentPurposeLabel } from "@/lib/lms/class-billing";
import { listCourseOptions } from "@/lib/lms/server/batches";
import { getClassBillingConfig, listBillingAccounts } from "@/lib/lms/server/class-billing";
import { listStudentOptions } from "@/lib/lms/server/classes";

export const metadata: Metadata = { title: "Billing · Teacher" };

/** One consistent payment-status vocabulary for invoices. */
function invoiceStatus(i: { dueState: "not_due" | "grace" | "overdue"; summary: { state: "unpaid" | "partial" | "paid" } }) {
  if (i.summary.state === "paid") return { label: "Paid", variant: "gold" as const };
  if (i.dueState === "overdue") return { label: i.summary.state === "partial" ? "Overdue — partially paid" : "Overdue", variant: "destructive" as const };
  if (i.summary.state === "partial") return { label: "Partially paid", variant: "outline" as const };
  return { label: i.dueState === "grace" ? "Pending (grace period)" : "Pending", variant: "secondary" as const };
}

async function Billing() {
  const teacher = await requireRole("teacher", "/teacher/billing");
  const [{ rows, unpaid, suspended, sessionsDue, sessionsNeedingReview, paymentsToReview }, config, students, courses] = await Promise.all([
    listBillingAccounts(teacher),
    getClassBillingConfig(),
    listStudentOptions(teacher),
    listCourseOptions(teacher),
  ]);
  const outstanding = unpaid.reduce((s, i) => s + i.summary.balanceMinor, 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-end gap-2">
        <OpenIndividualAccountDialog students={students} courses={courses} />
        <Button asChild variant="outline" size="sm">
          <Link href="/teacher/billing/settings">
            <Settings2 data-icon="inline-start" />
            Rates &amp; policy
          </Link>
        </Button>
        <RunBillingButton />
      </div>

      {!config.saved && (
        <p className="rounded-xl border border-gold/40 bg-gold-soft/50 px-4 py-3 text-sm text-brown">
          Using the confirmed default rates: batch ₹400 per class per student, individual ₹750 per session — invoiced at the end of each calendar month (initial enrolment payment deducted once).
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Billing accounts" value={rows.filter((r) => r.status === "active").length} detail="Batch and individual" icon={Users} />
        <StatCard label="Outstanding invoices" value={formatMoney(outstanding)} detail={`${unpaid.length} unpaid invoice(s)`} icon={AlertCircle} />
        <StatCard label="Suspended" value={suspended.length} detail="Unpaid after the payment deadline (reversible)" icon={ShieldAlert} />
        <StatCard label="Individual sessions due" value={formatMoney(sessionsDue.reduce((s, x) => s + x.amountMinor, 0))} detail={`${sessionsDue.length} unpaid session(s)`} icon={CalendarClock} />
      </div>

      {suspended.length > 0 && (
        <section aria-labelledby="suspended" className="flex flex-col gap-3">
          <h2 id="suspended" className="type-h3">Suspended access</h2>
          <ul className="divide-y divide-border rounded-2xl border border-destructive/30 bg-destructive/5">
            {suspended.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  <Link href={`/teacher/billing/${a.id}`} className="font-medium text-brown hover:text-maroon hover:underline">
                    {a.studentName}
                  </Link>{" "}
                  · {a.courseTitle}
                  <span className="block text-xs text-muted-foreground">Since {formatDateTime(a.suspension.since)} · restored automatically once the overdue invoices are paid and verified</span>
                </span>
                <span className="font-semibold text-maroon">{formatMoney(a.outstandingMinor)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="unpaid" className="flex flex-col gap-3">
        <h2 id="unpaid" className="type-h3">Unpaid invoices</h2>
        {unpaid.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">No unpaid invoices.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {unpaid.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  <Link href={`/teacher/billing/${i.accountId}`} className="font-medium text-brown hover:text-maroon hover:underline">
                    {i.studentName}
                  </Link>{" "}
                  · {i.courseTitle} · {i.label}
                  <span className="block text-xs text-muted-foreground">
                    {i.kind === "legacy_monthly" ? `Due ${formatDate(i.dueAt)} · payment deadline ${formatDateTime(i.deadlineAt)}` : `Payment deadline ${formatDateTime(i.deadlineAt)}`}
                    {i.kind !== "month" ? " · earlier billing" : ""}
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant={invoiceStatus(i).variant}>{invoiceStatus(i).label}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {i.mode === "batch" ? "Batch" : "Individual"} · paid {formatMoney(i.summary.paidMinor)} of {formatMoney(i.summary.totalDueMinor)}
                  </span>
                  <span className="font-semibold text-maroon">{formatMoney(i.summary.balanceMinor)} outstanding</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {paymentsToReview.length > 0 && (
        <section aria-labelledby="payments-review" className="flex flex-col gap-3">
          <h2 id="payments-review" className="type-h3">Payments under review or failed</h2>
          <p className="text-sm text-muted-foreground">
            Online payments are recorded only after server-side verification and are never marked successful by hand. These need a teacher decision (refund
            or adjustment) or were recorded as not received.
          </p>
          <ul className="divide-y divide-border rounded-2xl border border-gold/40 bg-gold-soft/30 text-sm">
            {paymentsToReview.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span>
                  {p.accountId ? (
                    <Link href={`/teacher/billing/${p.accountId}`} className="font-medium text-brown hover:text-maroon hover:underline">
                      {formatMoney(p.amountMinor)} · {paymentPurposeLabel(p) ?? "Payment"}
                    </Link>
                  ) : (
                    <span className="font-medium text-brown">
                      {formatMoney(p.amountMinor)} · {paymentPurposeLabel(p) ?? "Payment"}
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(p.paidAt)}
                    {p.reference ? ` · Ref ${p.reference}` : ""}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </span>
                </span>
                <Badge variant={p.status === "failed" ? "destructive" : "outline"}>{p.status === "failed" ? "Failed" : "Under review"}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sessionsNeedingReview.length > 0 && (
        <section aria-labelledby="review" className="flex flex-col gap-3">
          <h2 id="review" className="type-h3">Individual sessions needing review</h2>
          <ul className="divide-y divide-border rounded-2xl border border-gold/40 bg-gold-soft/30 text-sm">
            {sessionsNeedingReview.map((s) => (
              <li key={s.id} className="px-5 py-3">
                <Link href={`/teacher/billing/${s.accountId}`} className="font-medium text-brown hover:text-maroon hover:underline">
                  {s.title} · {s.date}
                </Link>
                <span className="block text-xs text-muted-foreground">{s.needsReview}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="accounts" className="flex flex-col gap-3">
        <h2 id="accounts" className="type-h3">Accounts</h2>
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
            No billing accounts yet. A batch account is opened when a student (with verified old dues) is added to a batch.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <caption className="sr-only">Billing accounts</caption>
                <thead className="bg-cream-deep/60 text-xs tracking-wide text-brown-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Student · Course</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Type · agreed rate</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Not yet invoiced</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Advance</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <Link href={`/teacher/billing/${a.id}`} className="font-medium text-brown hover:text-maroon hover:underline">
                          {a.studentName}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {a.courseTitle}
                          {a.status === "closed" ? " · closed" : ""}
                          {a.suspension.active ? " · suspended" : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-brown">
                        {BILLING_MODE_LABELS[a.mode]}
                        <span className="block text-xs text-muted-foreground">
                          {a.agreedRateMinor !== null ? `${formatMoney(a.agreedRateMinor)} per ${a.mode === "batch" ? "class" : "session"}` : "Academy rates (earlier account)"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-brown">
                        {a.uninvoicedCount} {a.mode === "batch" ? "class(es)" : "session(s)"} · {formatMoney(a.uninvoicedMinor)}
                        {a.sessionsDueMinor > 0 && <span className="block text-xs text-muted-foreground">+ {formatMoney(a.sessionsDueMinor)} earlier per-session charges due</span>}
                      </td>
                      <td className="px-4 py-3 text-brown">{ADVANCE_STATUS_LABELS[a.advance.status]}</td>
                      <td className="px-4 py-3 text-right font-semibold text-brown">{formatMoney(a.outstandingMinor + a.sessionsDueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function TeacherBillingPage() {
  return (
    <>
      <TeacherPageHeader
        title="Billing"
        description="Calendar-month billing: batch ₹400 per class per student, individual ₹750 per session. Invoices are generated on the last day of each month and due within 3 days; the initial enrolment payment is deducted once. All dates are IST."
      />
      <Suspense fallback={<LoadingState label="Loading billing…" />}>
        <Billing />
      </Suspense>
    </>
  );
}
