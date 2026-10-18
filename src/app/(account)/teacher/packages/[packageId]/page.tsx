import { ArrowLeft, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CreditsMeter, nextPaymentText, PackageStatusBadge, PaymentStateBadge } from "@/components/lms/billing-display";
import { ActivatePackageDialog, AdjustmentDialog, CancelPackageDialog } from "@/components/lms/teacher/package-controls";
import { PaymentStatusActions, RecordPaymentDialog } from "@/components/lms/teacher/payment-dialogs";
import { PaymentStatusBadge } from "@/components/lms/teacher/payment-status-badge";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { ADJUSTMENT_KIND_LABELS, countsAsReceived, LEARNER_CATEGORY_LABELS, PACKAGE_TYPE_LABELS, PAIR_TYPE_LABELS, type PairType } from "@/lib/lms/billing";
import { CLASS_STATUS_LABELS, formatClassTime } from "@/lib/lms/classes";
import { getBillingSettings, getPackageDetail } from "@/lib/lms/server/billing";
import { PAYMENT_METHOD_LABELS } from "@/lib/lms/types";

export const metadata: Metadata = { title: "Package · Teacher" };

type Params = PageProps<"/teacher/packages/[packageId]">["params"];

function basisLabel(basis: string): string {
  if (basis === "adult" || basis === "student") return LEARNER_CATEGORY_LABELS[basis];
  if (basis === "flat") return "Program fee (all ages)";
  return `Pair: ${PAIR_TYPE_LABELS[basis as PairType] ?? basis}`;
}

async function PackageDetail({ params }: { params: Params }) {
  const { packageId } = await params;
  const teacher = await requireRole("teacher", `/teacher/packages/${packageId}`);
  const [detail, settings] = await Promise.all([getPackageDetail(teacher, packageId), getBillingSettings()]);
  if (!detail) notFound();
  const { pkg, summary, next, payments, adjustments, classes, receipts } = detail;
  const nextText = nextPaymentText(next, pkg.currency);
  const receiptByPayment = new Map(receipts.map((r) => [r.paymentId, r]));
  const learnerName = new Map(pkg.learners.map((l) => [l.studentId, l.name]));
  const sessions = [...new Set(classes.map((c) => c.sessionKey ?? c.id))];

  return (
    <div className="flex flex-col gap-8">
      <Link href="/teacher/packages" className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All packages
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="type-h2 break-words">{pkg.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {PACKAGE_TYPE_LABELS[pkg.type]} ·{" "}
            {pkg.learners.map((l, i) => (
              <span key={l.studentId}>
                {i > 0 && " + "}
                <Link href={`/teacher/students/${l.studentId}`} className="font-medium text-brown hover:text-maroon hover:underline">
                  {l.name}
                </Link>{" "}
                ({l.category})
              </span>
            ))}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <PackageStatusBadge status={pkg.status} />
            <PaymentStateBadge state={summary.paymentState} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pkg.status !== "cancelled" && (
            <RecordPaymentDialog
              enrollmentOptions={[]}
              packageOptions={[{ id: pkg.id, label: `${pkg.learners.map((l) => l.name).join(" + ")} — ${pkg.title}` }]}
              methods={settings.methods}
              defaultTarget={`package:${pkg.id}`}
            />
          )}
          {pkg.status === "awaiting_payment" && <ActivatePackageDialog packageId={pkg.id} balanceMinor={summary.balanceMinor} />}
          {pkg.status !== "cancelled" && (
            <AdjustmentDialog
              packageId={pkg.id}
              refundablePayments={payments
                .filter(countsAsReceived)
                .map((p) => ({ id: p.id, label: `${formatMoney(p.amountMinor, p.currency)} · ${formatDate(p.paidAt)} · ${PAYMENT_METHOD_LABELS[p.method]}` }))}
            />
          )}
          {pkg.status !== "cancelled" && <CancelPackageDialog packageId={pkg.id} title={pkg.title} />}
        </div>
      </div>

      <section aria-label="Summary" className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Package price (fixed at assignment)</p>
          <p className="font-heading text-2xl font-semibold text-brown">{formatMoney(pkg.priceMinor, pkg.currency)}</p>
          <p className="text-xs text-muted-foreground">{basisLabel(pkg.priceBasis)}</p>
          {summary.waivedMinor > 0 && <p className="text-xs text-muted-foreground">{formatMoney(summary.waivedMinor, pkg.currency)} waived</p>}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Paid (verified, after refunds)</p>
          <p className="font-heading text-2xl font-semibold text-brown">{formatMoney(summary.netPaidMinor, pkg.currency)}</p>
          {summary.pendingMinor > 0 && <p className="text-xs text-muted-foreground">{formatMoney(summary.pendingMinor, pkg.currency)} pending verification</p>}
          {summary.refundedMinor > 0 && <p className="text-xs text-muted-foreground">{formatMoney(summary.refundedMinor, pkg.currency)} refunded</p>}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Balance</p>
          <p className={summary.balanceMinor > 0 ? "font-heading text-2xl font-semibold text-maroon" : "font-heading text-2xl font-semibold text-brown"}>
            {summary.balanceMinor < 0 ? `${formatMoney(-summary.balanceMinor, pkg.currency)} overpaid` : formatMoney(summary.balanceMinor, pkg.currency)}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Classes</p>
          <CreditsMeter used={summary.creditsUsed} total={summary.creditsTotal} label="Classes used" />
          <p className="text-xs text-muted-foreground">
            {detail.availableToSchedule} free to schedule
            {detail.sessionsCarriedForward > 0 ? ` · ${detail.sessionsCarriedForward} cancelled by the academy (carried forward)` : ""}
          </p>
        </div>
        {nextText && <p className="text-sm text-brown sm:col-span-2 lg:col-span-4">{nextText}</p>}
      </section>

      {(pkg.confirmation || pkg.activation || pkg.cancelReason || pkg.notes) && (
        <section aria-label="Notes" className="flex flex-col gap-2 rounded-2xl border border-gold/40 bg-gold-soft/30 p-5 text-sm text-brown">
          {pkg.confirmation && (
            <p>
              <span className="font-semibold">Confirmed fee exception:</span> {pkg.confirmation.reason}
              <span className="block text-xs text-muted-foreground">{pkg.confirmation.question}</span>
            </p>
          )}
          {pkg.activation && (
            <p>
              <span className="font-semibold">Activated before full payment</span> ({formatMoney(pkg.activation.balanceMinor, pkg.currency)} unpaid) by{" "}
              {pkg.activation.byEmail ?? "a teacher"} on {formatDateTime(pkg.activation.at)}: {pkg.activation.reason}
            </p>
          )}
          {pkg.cancelReason && (
            <p>
              <span className="font-semibold">Cancelled</span> {formatDate(pkg.cancelledAt)}: {pkg.cancelReason}
            </p>
          )}
          {pkg.notes && <p className="text-muted-foreground">Notes: {pkg.notes}</p>}
        </section>
      )}

      <section aria-labelledby="pkg-payments" className="flex flex-col gap-3">
        <h2 id="pkg-payments" className="type-h3">Payments</h2>
        {payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {payments.map((p) => {
              const receipt = receiptByPayment.get(p.id);
              return (
                <li key={p.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="font-semibold text-brown">{formatMoney(p.amountMinor, p.currency)}</span>
                    <span className="text-muted-foreground">
                      {" "}· {PAYMENT_METHOD_LABELS[p.method]} · {formatDate(p.paidAt)}
                      {p.reference ? ` · Ref ${p.reference}` : ""}
                      {p.payerName ? ` · Paid by ${p.payerName}` : ""}
                    </span>
                    {p.rejectionReason && <span className="block text-xs text-destructive">Rejected: {p.rejectionReason}</span>}
                    {p.verifiedAt && <span className="block text-xs text-muted-foreground">Verified by {p.verifiedByEmail ?? "a teacher"} · {formatDateTime(p.verifiedAt)}</span>}
                    {receipt && (
                      <Link href={`/receipts/${receipt.id}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-maroon hover:underline">
                        <FileText className="size-3.5" aria-hidden="true" />
                        Receipt {receipt.number}
                        {receipt.status === "refunded" ? " (refunded)" : ""}
                      </Link>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <PaymentStatusBadge status={p.status} verified={p.verified} />
                    <PaymentStatusActions paymentId={p.id} status={p.status} source={p.source} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="pkg-classes" className="flex flex-col gap-3">
        <h2 id="pkg-classes" className="type-h3">Classes ({sessions.length} session{sessions.length === 1 ? "" : "s"})</h2>
        {classes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">
            No classes yet. Schedule them from the Classes page and choose this package.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {classes.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="font-medium text-brown">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatClassTime(c.startAt, c.endAt)} · {learnerName.get(c.studentId) ?? "Learner"}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={c.status === "completed" ? "maroon" : c.status === "scheduled" ? "gold" : "secondary"}>{CLASS_STATUS_LABELS[c.status]}</Badge>
                  {c.status === "completed" && <Badge variant="outline">{c.attendance === "attended" ? "Attended" : "Absent"}</Badge>}
                  {c.status === "cancelled" && <span className="text-xs text-muted-foreground">No credit used</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pkg-adjustments" className="flex flex-col gap-3">
        <h2 id="pkg-adjustments" className="type-h3">Adjustments</h2>
        {adjustments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">No refunds, waivers or credit changes.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {adjustments.map((a) => (
              <li key={a.id} className="px-5 py-3 text-sm">
                <span className="font-semibold text-brown">
                  {a.kind === "credit" ? `${a.credits > 0 ? "+" : ""}${a.credits} class${Math.abs(a.credits) === 1 ? "" : "es"}` : formatMoney(a.amountMinor, pkg.currency)}
                </span>
                <span className="text-muted-foreground"> · {ADJUSTMENT_KIND_LABELS[a.kind]} · {a.reason}</span>
                <span className="block text-xs text-muted-foreground">
                  Approved by {a.approvedByEmail ?? "a teacher"} · {formatDateTime(a.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="rounded-2xl border border-border bg-card p-5 text-sm shadow-soft">
        <summary className="cursor-pointer font-semibold text-maroon">Package history ({pkg.history.length})</summary>
        <ol className="mt-3 flex flex-col gap-1 border-l border-border pl-4 text-muted-foreground">
          {pkg.history.map((h, i) => (
            <li key={i}>
              {formatDateTime(h.at)} · {h.change}
              {h.byEmail ? ` · ${h.byEmail}` : ""}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Assigned by {pkg.createdByEmail ?? "a teacher"} on {formatDateTime(pkg.createdAt)} · {pkg.sessionsIncluded} sessions of {pkg.plan.sessionMinutes} minutes
          {pkg.startDate ? ` · starts ${formatDate(`${pkg.startDate}T12:00:00+05:30`)}` : ""}
        </p>
      </details>
    </div>
  );
}

export default function TeacherPackagePage({ params }: PageProps<"/teacher/packages/[packageId]">) {
  return (
    <Suspense fallback={<LoadingState label="Loading package…" />}>
      <PackageDetail params={params} />
    </Suspense>
  );
}
