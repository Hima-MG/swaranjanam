import { ArrowLeft, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CreditsMeter, nextPaymentText, PackageStatusBadge, PaymentStateBadge } from "@/components/lms/billing-display";
import { UpcomingClasses } from "@/components/lms/student/upcoming-classes";
import { PageHero } from "@/components/shared/page-hero";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { Section } from "@/components/ui/section";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { PACKAGE_TYPE_LABELS } from "@/lib/lms/billing";
import { CLASS_STATUS_LABELS, formatClassTime } from "@/lib/lms/classes";
import { getOwnBilling } from "@/lib/lms/server/billing";
import { listOwnClasses, listOwnClassHistory } from "@/lib/lms/server/classes";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/lms/types";

export const metadata: Metadata = { title: "Packages & payments" };

const PAYMENT_LABEL = { pending: "Awaiting verification", paid: "Received", failed: "Not received", refunded: "Refunded" } as const;

async function StudentBilling() {
  // Every reader below derives the student from this session; no ids come from the URL.
  const user = await requireRole("student", "/dashboard/billing");
  const [billing, upcoming, history] = await Promise.all([getOwnBilling(user), listOwnClasses(user), listOwnClassHistory(user)]);
  const { packages, payments, receipts } = billing;
  const upcomingOnly = upcoming.classes.filter((c) => Date.parse(c.endAt) >= upcoming.nowMs && c.status === "scheduled");

  return (
    <div className="flex flex-col gap-10">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to dashboard
      </Link>

      <section aria-labelledby="packages" className="flex flex-col gap-4">
        <h2 id="packages" className="type-h3">My packages</h2>
        {packages.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">
            No packages yet. Your teacher sets up your class package when you enrol.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {packages.map((p) => {
              const next = nextPaymentText(p.next, p.currency);
              return (
                <li key={p.id} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-brown">{p.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {PACKAGE_TYPE_LABELS[p.type]}
                        {p.type === "pair" ? ` · ${p.learnerNames.join(" + ")}` : ""}
                        {" · "}
                        {p.sessionsIncluded} session{p.sessionsIncluded === 1 ? "" : "s"} of {p.sessionMinutes} minutes
                        {p.durationWeeks ? ` over ${p.durationWeeks} weeks` : ""}
                      </p>
                    </div>
                    <span className="flex flex-wrap gap-2">
                      <PackageStatusBadge status={p.status} />
                      <PaymentStateBadge state={p.summary.paymentState} />
                    </span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Package price</p>
                      <p className="font-semibold text-brown">{formatMoney(p.priceMinor, p.currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Paid</p>
                      <p className="font-semibold text-brown">{formatMoney(p.summary.netPaidMinor, p.currency)}</p>
                      {p.summary.pendingMinor > 0 && (
                        <p className="text-xs text-muted-foreground">{formatMoney(p.summary.pendingMinor, p.currency)} awaiting verification</p>
                      )}
                      {p.summary.balanceMinor > 0 && (
                        <p className="text-xs font-semibold text-maroon">{formatMoney(p.summary.balanceMinor, p.currency)} still to pay</p>
                      )}
                    </div>
                    <CreditsMeter used={p.summary.creditsUsed} total={p.summary.creditsTotal} label={`${p.title} classes used`} />
                  </div>
                  {p.sessionsCarriedForward > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {p.sessionsCarriedForward} class{p.sessionsCarriedForward === 1 ? " was" : "es were"} cancelled by the academy and carried forward — you
                      still get every class you paid for.
                    </p>
                  )}
                  {next && <p className="text-sm text-brown">{next}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="payments" className="flex flex-col gap-4">
        <h2 id="payments" className="type-h3">My payments</h2>
        {payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="font-semibold text-brown">{formatMoney(p.amountMinor, p.currency)}</span>
                  <span className="text-muted-foreground">
                    {" "}· {formatDate(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? "Other"}
                    {p.referenceMasked ? ` · Ref ${p.referenceMasked}` : ""}
                  </span>
                  {p.packageTitle && <span className="block text-xs text-muted-foreground">{p.packageTitle}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={p.status === "paid" && p.verified ? "gold" : p.status === "pending" ? "outline" : "secondary"}>
                    {p.status === "paid" && !p.verified ? "Awaiting verification" : PAYMENT_LABEL[p.status]}
                  </Badge>
                  {p.receiptId && (
                    <Link href={`/receipts/${p.receiptId}`} className="text-xs font-semibold text-maroon hover:underline">
                      Receipt
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="receipts" className="flex flex-col gap-4">
        <h2 id="receipts" className="type-h3">My receipts</h2>
        {receipts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">
            Receipts appear here once your teacher has verified a payment.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {receipts.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-brown">{r.number}</span>
                  <span className="text-muted-foreground">
                    {" "}· {r.title} · {formatMoney(r.amountMinor, r.currency)} · {formatDate(r.paidAt ?? r.issuedAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {r.status === "refunded" && <Badge variant="secondary">Refunded</Badge>}
                  <Link href={`/receipts/${r.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-maroon hover:underline">
                    <FileText className="size-3.5" aria-hidden="true" />
                    View / save as PDF
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="classes" className="flex flex-col gap-4">
        <h2 id="classes" className="type-h3">My classes</h2>
        <UpcomingClasses classes={upcomingOnly} serverNow={upcoming.nowMs} />
        <h3 className="mt-2 font-semibold text-brown">Past classes</h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No past classes yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {history.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="font-medium text-brown">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatClassTime(c.startAt, c.endAt)}
                    {c.packageLinked ? " · package class" : ""}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={c.status === "completed" ? "maroon" : "secondary"}>
                    {c.status === "scheduled" ? "Awaiting outcome" : CLASS_STATUS_LABELS[c.status]}
                  </Badge>
                  {c.attendance && <Badge variant="outline">{c.attendance === "attended" ? "Attended" : "Absent (counted as a class)"}</Badge>}
                  {c.status === "cancelled" && c.packageLinked && <span className="text-xs text-muted-foreground">Carried forward</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function StudentBillingPage() {
  return (
    <>
      <PageHero eyebrow="Student dashboard" title="Packages & payments" description="Your class packages, payments, receipts and class history." />
      <Section spacing="sm">
        <Suspense fallback={<LoadingState label="Loading your packages…" />}>
          <StudentBilling />
        </Suspense>
      </Section>
    </>
  );
}
