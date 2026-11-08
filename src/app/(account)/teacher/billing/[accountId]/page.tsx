import { ArrowLeft, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CloseAccountDialog, InvoiceAdjustmentDialog } from "@/components/lms/teacher/class-billing-controls";
import { PaymentStatusActions, RecordPaymentDialog } from "@/components/lms/teacher/payment-dialogs";
import { PaymentStatusBadge } from "@/components/lms/teacher/payment-status-badge";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate, formatDateTime } from "@/lib/format-date";
import {
  ADVANCE_STATUS_LABELS,
  CLASS_BLOCK_MESSAGES,
  classAccessBlock,
  BILLING_MODE_LABELS,
  CLASS_OUTCOME_LABELS,
  INVOICE_ADJUSTMENT_LABELS,
  lastDayOf,
  LEGACY_DUES_LABELS,
  monthlyPaymentDeadline,
  paymentPurposeLabel,
  periodLabel,
  periodOf,
  SESSION_CHARGE_LABELS,
} from "@/lib/lms/class-billing";
import { getBillingSettings } from "@/lib/lms/server/billing";
import { getBillingAccountDetail } from "@/lib/lms/server/class-billing";
import { PAYMENT_METHOD_LABELS } from "@/lib/lms/types";

export const metadata: Metadata = { title: "Billing account · Teacher" };

type Params = PageProps<"/teacher/billing/[accountId]">["params"];

const DUE_LABEL = { not_due: "Within the payment window", grace: "In grace period", overdue: "Overdue" } as const;

async function AccountDetail({ params }: { params: Params }) {
  const { accountId } = await params;
  const teacher = await requireRole("teacher", `/teacher/billing/${accountId}`);
  const [detail, settings] = await Promise.all([getBillingAccountDetail(teacher, accountId), getBillingSettings()]);
  if (!detail) notFound();
  const { account, legacy, invoices, billable, payments, sessions, advanceLedger } = detail;
  const block = classAccessBlock(account);
  const billingOptions = [
    ...(account.advance.status === "awaiting" ? [{ value: `advance:${account.id}`, label: `Initial enrolment payment — ${formatMoney(account.advance.amountMinor)}` }] : []),
    ...invoices
      .filter((i) => i.status === "issued" && i.summary.balanceMinor > 0)
      .map((i) => ({ value: `invoice:${i.id}`, label: `${i.label} invoice — ${formatMoney(i.summary.balanceMinor)} outstanding` })),
    ...sessions
      .filter((s) => s.status === "due")
      .map((s) => ({ value: `session:${s.id}`, label: `Session ${s.date} ${s.startTime} (paid separately) — ${formatMoney(s.amountMinor)}` })),
  ];
  const uninvoiced = billable.filter((b) => b.invoiceId === null);
  const uninvoicedMinor = uninvoiced.filter((b) => b.coveredBy === null).reduce((t, b) => t + b.rateMinor, 0);
  // The current month (IST): its invoice is generated on its last calendar day.
  const currentMonth = periodOf(new Date().toISOString());
  const unit = account.mode === "batch" ? "class" : "session";
  const paymentRef = (paymentId: string | null) => payments.find((p) => p.id === paymentId)?.reference ?? null;

  return (
    <div className="flex flex-col gap-8">
      <Link href="/teacher/billing" className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Billing
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-h2">{account.studentName}</h1>
          {account.learnerCount > 1 && (
            <p className="text-sm text-brown">
              Learn Together ({account.mode === "batch" ? "shared batch" : "shared one-to-one"}): {account.learnerNames.join(" & ")}
              {account.perLearnerRateMinor ? ` · ${formatMoney(account.perLearnerRateMinor)} per person` : ""} — one login, one invoice
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {account.courseTitle} · {BILLING_MODE_LABELS[account.mode]}
            {account.batchId && (
              <>
                {" · "}
                <Link href={`/teacher/batches/${account.batchId}`} className="font-semibold text-maroon hover:underline">
                  Current batch
                </Link>
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={account.status === "active" ? "gold" : "secondary"}>{account.status === "active" ? "Active" : "Closed"}</Badge>
            {account.suspension.active && <Badge variant="destructive">Access suspended since {formatDate(account.suspension.since)}</Badge>}
            {account.advance.status !== "not_required" && <Badge variant="outline">Initial enrolment payment: {ADVANCE_STATUS_LABELS[account.advance.status]}</Badge>}
            {account.status === "active" && (
              <Badge variant={block ? "destructive" : "gold"}>{block ? "Not eligible for the next class" : "Eligible for the next class"}</Badge>
            )}
            <Badge variant="outline">Old dues: {legacy ? LEGACY_DUES_LABELS[legacy.status] : LEGACY_DUES_LABELS.not_verified}</Badge>
          </div>
          {account.closedReason && <p className="mt-2 text-sm text-muted-foreground">Closed: {account.closedReason}</p>}
          {block && <p className="mt-2 text-sm text-destructive">{CLASS_BLOCK_MESSAGES[block]}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {billingOptions.length > 0 && <RecordPaymentDialog enrollmentOptions={[]} billingOptions={billingOptions} methods={settings.methods} defaultTarget={billingOptions[0].value} />}
          {account.status === "active" && <CloseAccountDialog accountId={account.id} name={account.studentName} />}
        </div>
      </div>

      <section aria-labelledby="pending-charges" className="flex flex-col gap-2">
        <h2 id="pending-charges" className="type-h3">Monthly billing</h2>
        <p className="text-sm text-muted-foreground">
          {uninvoiced.length} {unit}(es) held and recorded but not yet invoiced · {formatMoney(uninvoicedMinor)}
          {uninvoiced.some((b) => b.coveredBy === "advance") ? ` (the first ${unit} is paid by the initial enrolment payment and deducted on its invoice)` : ""}. The{" "}
          {periodLabel(currentMonth)} invoice is generated on {formatDate(lastDayOf(currentMonth))} (from 23:00 IST); payment deadline{" "}
          {formatDateTime(monthlyPaymentDeadline(lastDayOf(currentMonth)))} IST. Access pauses only after the deadline.
        </p>
      </section>

          <section aria-labelledby="invoices" className="flex flex-col gap-3">
            <h2 id="invoices" className="type-h3">Invoices</h2>
            {invoices.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {invoices.map((i) => (
                  <li key={i.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-brown">{i.label}</p>
                        {i.learnerCount > 1 && (
                          <p className="text-xs text-brown">
                            {i.learnerNames.join(" & ")}
                            {i.perLearnerRateMinor ? ` · ${formatMoney(i.perLearnerRateMinor)} per person × ${i.learnerCount} = ${formatMoney(i.perLearnerRateMinor * i.learnerCount)} per session` : ""}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {i.id} · {account.studentName} · {account.courseTitle}
                          {i.batchId ? " · batch" : ""} · {i.invoiceDate ? `invoice date ${formatDate(i.invoiceDate)}` : `issued ${formatDate(i.issuedAt)}`} ·{" "}
                          {i.kind === "legacy_monthly" ? `due ${formatDate(i.dueAt)} · payment deadline ${formatDateTime(i.deadlineAt)}` : `payment deadline ${formatDateTime(i.deadlineAt)}`}
                          {i.kind !== "month" ? " · earlier billing (history)" : ""}
                        </p>
                      </div>
                      <span className="flex flex-wrap items-center gap-2">
                        {i.summary.balanceMinor > 0 && <Badge variant={i.dueState === "overdue" ? "destructive" : "outline"}>{DUE_LABEL[i.dueState]}</Badge>}
                        <Badge variant={i.summary.state === "paid" ? "gold" : i.summary.state === "partial" ? "outline" : "secondary"}>
                          {i.summary.state === "paid" ? "Paid" : i.summary.state === "partial" ? "Partly paid" : "Unpaid"}
                        </Badge>
                        <InvoiceAdjustmentDialog invoiceId={i.id} />
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <caption className="sr-only">Invoice lines</caption>
                      <tbody>
                        {i.lines.map((l) => (
                          <tr key={l.classId} className="border-t border-border">
                            <td className="py-1.5 text-brown">
                              {l.date} · {l.title}
                              {i.kind !== "cycle" && l.period !== i.period ? ` (recorded late, ${periodLabel(l.period)})` : ""}
                              {l.coveredByInitialPayment ? " · paid by the initial enrolment payment" : ""}
                            </td>
                            <td className="py-1.5 text-muted-foreground">{CLASS_OUTCOME_LABELS[l.outcome]}</td>
                            <td className="py-1.5 text-right text-brown">{formatMoney(l.rateMinor)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-border">
                          <td colSpan={2} className="py-1.5 text-muted-foreground">
                            Billable {i.mode === "batch" ? "classes" : "sessions"}: {i.lines.length}
                            {new Set(i.lines.map((l) => l.rateMinor)).size === 1 && i.lines.length > 0 ? ` × ${formatMoney(i.lines[0].rateMinor)}` : ""}
                          </td>
                          <td className="py-1.5 text-right text-brown">{formatMoney(i.subtotalMinor)}</td>
                        </tr>
                        {i.advanceAppliedMinor > 0 && (
                          <tr>
                            <td colSpan={2} className="py-1.5 text-muted-foreground">Initial enrolment payment deducted</td>
                            <td className="py-1.5 text-right text-brown">−{formatMoney(i.advanceAppliedMinor)}</td>
                          </tr>
                        )}
                        {i.adjustments.map((a) => (
                          <tr key={a.id}>
                            <td colSpan={2} className="py-1.5 text-muted-foreground">
                              {INVOICE_ADJUSTMENT_LABELS[a.kind]} — {a.reason} ({a.byEmail ?? "teacher"}, {formatDate(a.at)})
                            </td>
                            <td className="py-1.5 text-right text-brown">
                              {a.kind === "debit_note" ? "+" : "−"}
                              {formatMoney(a.amountMinor)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t border-border font-semibold">
                          <td colSpan={2} className="py-1.5 text-brown">Total due · paid (verified) · balance</td>
                          <td className="py-1.5 text-right text-brown">
                            {formatMoney(i.summary.totalDueMinor)} · {formatMoney(i.summary.paidMinor)} · {formatMoney(i.summary.balanceMinor)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    {i.payments.some((p) => p.status === "paid" && p.verified) && (
                      <p className="text-xs text-muted-foreground">
                        Verified payment ref:{" "}
                        {i.payments
                          .filter((p) => p.status === "paid" && p.verified)
                          .map((p) => p.reference ?? p.id)
                          .join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

      {sessions.length > 0 && (
        <section aria-labelledby="sessions" className="flex flex-col gap-3">
          <h2 id="sessions" className="type-h3">Sessions paid separately (earlier per-session method)</h2>
          <p className="text-sm text-muted-foreground">Scheduled before monthly invoicing: still payable one at a time, never added to a monthly invoice.</p>
          {(
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm shadow-soft">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span>
                    <span className="font-medium text-brown">
                      {s.date} {s.startTime} IST · {s.title}
                    </span>
                    {s.cancelKind && <span className="block text-xs text-muted-foreground">Cancelled ({s.cancelKind})</span>}
                    {s.needsReview && <span className="block text-xs text-destructive">{s.needsReview}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={s.status === "paid" ? "gold" : s.status === "due" ? "outline" : "secondary"}>{SESSION_CHARGE_LABELS[s.status]}</Badge>
                    <span className="font-semibold text-brown">{s.status === "no_charge" ? "₹0" : formatMoney(s.amountMinor)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="payments" className="flex flex-col gap-3">
        <h2 id="payments" className="type-h3">Payments</h2>
        {payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">No payments recorded.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="font-semibold text-brown">{formatMoney(p.amountMinor)}</span>
                  <span className="text-muted-foreground">
                    {" "}· {paymentPurposeLabel(p) ?? "Payment"} · {PAYMENT_METHOD_LABELS[p.method]} · {formatDate(p.paidAt)}
                    {p.reference ? ` · Ref ${p.reference}` : ""}
                  </span>
                  {p.notes && p.source === "gateway" && <span className="block text-xs text-destructive">{p.notes}</span>}
                  {p.rejectionReason && <span className="block text-xs text-destructive">Rejected: {p.rejectionReason}</span>}
                  {p.receiptId && (
                    <Link href={`/receipts/${p.receiptId}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-maroon hover:underline">
                      <FileText className="size-3.5" aria-hidden="true" />
                      Receipt
                    </Link>
                  )}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <PaymentStatusBadge status={p.status} verified={p.verified} />
                  <PaymentStatusActions paymentId={p.id} status={p.status} source={p.source} purpose={p.purpose} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(
        <section aria-labelledby="ledger" className="flex flex-col gap-3">
          <h2 id="ledger" className="type-h3">Charged {account.mode === "batch" ? "classes" : "sessions"}</h2>
          {billable.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm shadow-soft">
              {billable.map((b) => (
                <li key={b.classId} className="flex flex-wrap justify-between gap-2 px-5 py-2">
                  <span className="text-brown">
                    {b.date} · {b.title}
                  </span>
                  <span className="text-muted-foreground">
                    {CLASS_OUTCOME_LABELS[b.outcome]} · {formatMoney(b.rateMinor)} (rate {b.rateVersionId}) ·{" "}
                    {b.coveredBy === "advance"
                      ? `first ${unit} — paid by the initial enrolment payment${account.advance.status === "awaiting" ? " (not yet received)" : paymentRef(account.advance.paymentId) ? ` (ref ${paymentRef(account.advance.paymentId)})` : ""}${b.invoiceId ? `, deducted on ${b.invoiceId.split("_").pop()}` : ""}`
                      : b.invoiceId
                        ? `invoiced (${b.invoiceId.split("_").pop()})`
                        : "not yet invoiced"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {advanceLedger.length > 0 && (
        <section aria-labelledby="advance-ledger" className="flex flex-col gap-2">
          <h2 id="advance-ledger" className="type-h3">Initial enrolment payment ledger</h2>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {advanceLedger.map((e) => (
              <li key={e.id}>
                {formatDateTime(e.at)} · {e.kind === "received" ? "Received" : e.kind === "reversed" ? "Reversed (payment error)" : "Deducted"} {formatMoney(e.amountMinor)}
                {e.invoiceId ? ` on ${e.invoiceId.split("_").pop()}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-2xl border border-border bg-card p-5 text-sm shadow-soft">
        <summary className="cursor-pointer font-semibold text-maroon">Account history ({account.history.length})</summary>
        <ol className="mt-3 flex flex-col gap-1 border-l border-border pl-4 text-muted-foreground">
          {account.history.map((h, idx) => (
            <li key={idx}>
              {formatDateTime(h.at)} · {h.change}
              {h.byEmail ? ` · ${h.byEmail}` : ""}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export default function TeacherBillingAccountPage({ params }: PageProps<"/teacher/billing/[accountId]">) {
  return (
    <Suspense fallback={<LoadingState label="Loading account…" />}>
      <AccountDetail params={params} />
    </Suspense>
  );
}
