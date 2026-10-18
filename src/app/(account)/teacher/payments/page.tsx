import { AlertCircle, ChevronLeft, ChevronRight, Clock, Download, IndianRupee, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PaymentStatusActions, RecordPaymentDialog } from "@/components/lms/teacher/payment-dialogs";
import { PaymentStatusBadge } from "@/components/lms/teacher/payment-status-badge";
import { StatCard } from "@/components/lms/teacher/stat-card";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { getBillingSettings, getRevenueReport, listPayablePackages } from "@/lib/lms/server/billing";
import { listPayments, parsePaymentFilters, type PaymentFilters } from "@/lib/lms/server/payments";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABELS } from "@/lib/lms/types";

export const metadata: Metadata = { title: "Payments · Teacher" };

type SearchParams = PageProps<"/teacher/payments">["searchParams"];

function queryString(f: PaymentFilters, overrides: Partial<PaymentFilters> = {}) {
  const q = { ...f, ...overrides };
  const params = new URLSearchParams();
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  if (q.status !== "any") params.set("status", q.status);
  if (q.course) params.set("course", q.course);
  if (q.q) params.set("q", q.q);
  if (q.page > 1) params.set("page", String(q.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function Payments({ searchParams }: { searchParams: SearchParams }) {
  const teacher = await requireRole("teacher", "/teacher/payments");
  const params = await searchParams;
  const filters = parsePaymentFilters(params);
  const period = params.period === "week" ? "week" : "month";
  const [result, packageOptions, settings, revenue] = await Promise.all([
    listPayments(teacher, filters),
    listPayablePackages(teacher),
    getBillingSettings(),
    getRevenueReport(teacher, period),
  ]);
  const { totals } = result;
  const filtered = Boolean(filters.from || filters.to || filters.status !== "any" || filters.course || filters.q);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <RecordPaymentDialog enrollmentOptions={result.enrollmentOptions} packageOptions={packageOptions} methods={settings.methods} />
        {result.total > 0 && (
          <Button asChild variant="outline" size="sm">
            <a href={`/api/teacher/payments/export${queryString(filters, { page: 1 })}`} download>
              <Download data-icon="inline-start" />
              Export CSV
            </a>
          </Button>
        )}
      </div>
      {result.enrollmentOptions.length === 0 && packageOptions.length === 0 && (
        <p className="text-sm text-muted-foreground">Payments are recorded against a package or a course enrollment. Assign a package first.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Received (verified)"
          value={formatMoney(totals.receivedMinor)}
          detail={`${totals.receivedCount} payment${totals.receivedCount === 1 ? "" : "s"}${filtered ? " matching filters" : ""}`}
          icon={IndianRupee}
        />
        <StatCard label="Pending" value={formatMoney(totals.pendingMinor)} detail={`${totals.pendingCount} awaiting confirmation`} icon={Clock} />
        <StatCard
          label="Refunded"
          value={formatMoney(totals.refundedMinor + revenue.refundedMinor)}
          detail={`${totals.refundedCount} full refund${totals.refundedCount === 1 ? "" : "s"} + package refund adjustments · ${totals.failedCount} rejected`}
          icon={RotateCcw}
        />
        <StatCard
          label="Outstanding (course fees)"
          value={formatMoney(result.outstandingMinor)}
          detail={`${result.outstanding.length} enrollment${result.outstanding.length === 1 ? "" : "s"} with an unpaid agreed fee`}
          icon={AlertCircle}
        />
      </div>

      <form method="get" className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft md:grid-cols-[1fr_1fr_1fr_1.4fr_1.6fr_auto] md:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor="from" className="text-sm font-medium text-brown">From</Label>
          <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="to" className="text-sm font-medium text-brown">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="status" className="text-sm font-medium text-brown">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={filters.status}>
            <option value="any">Any</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="failed">Rejected / failed</option>
            <option value="refunded">Refunded</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="course" className="text-sm font-medium text-brown">Course</Label>
          <NativeSelect id="course" name="course" defaultValue={filters.course ?? ""}>
            <option value="">All courses</option>
            {result.courses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="q" className="text-sm font-medium text-brown">Student or reference</Label>
          <Input id="q" name="q" type="search" defaultValue={filters.q} maxLength={100} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          {filtered && (
            <Button asChild variant="ghost">
              <Link href="/teacher/payments">Reset</Link>
            </Button>
          )}
        </div>
      </form>

      <section aria-labelledby="payment-list" className="flex flex-col gap-3">
        <h2 id="payment-list" className="type-h3">
          Payments <span className="text-base font-normal text-muted-foreground">({result.total})</span>
        </h2>
        {result.total === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
            {filtered ? "No payments match these filters." : "No payments have been recorded yet."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] text-left text-sm">
                <caption className="sr-only">Payments</caption>
                <thead className="bg-cream-deep/60 text-xs tracking-wide text-brown-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Student · Course</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Method · Reference</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Last change</th>
                    <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((p) => (
                    <tr key={p.id} className="border-t border-border align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-brown">{formatDate(p.paidAt)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/teacher/students/${p.studentId}`} className="font-medium text-brown hover:text-maroon hover:underline">
                          {p.studentName}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{p.courseTitle}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold whitespace-nowrap text-brown">{formatMoney(p.amountMinor, p.currency)}</td>
                      <td className="px-4 py-3">
                        {PAYMENT_METHOD_LABELS[p.method]}
                        <span className="block text-xs break-all text-muted-foreground">{p.reference ?? "No reference"}</span>
                        {p.payerName && <span className="block text-xs text-muted-foreground">Paid by {p.payerName}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge status={p.status} verified={p.verified} />
                        {p.rejectionReason && <span className="mt-1 block max-w-48 text-xs text-destructive">{p.rejectionReason}</span>}
                        {p.receiptId && (
                          <Link href={`/receipts/${p.receiptId}`} className="mt-1 block text-xs font-semibold text-maroon hover:underline">
                            Receipt
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.updatedByEmail ?? p.createdByEmail ?? "—"}
                        <span className="block">{formatDateTime(p.updatedAt ?? p.createdAt)}</span>
                        {p.history.length > 1 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer font-semibold text-maroon">History ({p.history.length})</summary>
                            <ol className="mt-1 flex flex-col gap-0.5">
                              {p.history.map((h, i) => (
                                <li key={i}>{formatDateTime(h.at)} · {h.change}{h.byEmail ? ` · ${h.byEmail}` : ""}</li>
                              ))}
                            </ol>
                          </details>
                        )}
                      </td>
                      <td className="px-4 py-3"><PaymentStatusActions paymentId={p.id} status={p.status} source={p.source} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {result.pageCount > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
            {result.page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/teacher/payments${queryString(filters, { page: result.page - 1 })}`}>
                  <ChevronLeft data-icon="inline-start" />
                  Previous
                </Link>
              </Button>
            ) : (
              <span />
            )}
            <span className="text-sm text-muted-foreground">Page {result.page} of {result.pageCount}</span>
            {result.page < result.pageCount ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/teacher/payments${queryString(filters, { page: result.page + 1 })}`}>
                  Next
                  <ChevronRight data-icon="inline-end" />
                </Link>
              </Button>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>

      <section aria-labelledby="revenue" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="revenue" className="type-h3">Revenue by {period}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Revenue period" className="inline-flex rounded-full border border-border bg-ivory p-1 shadow-soft">
              {(["month", "week"] as const).map((key) => (
                <Link
                  key={key}
                  href={`/teacher/payments?period=${key}#revenue`}
                  aria-current={period === key ? "page" : undefined}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    period === key ? "bg-maroon text-cream" : "text-brown hover:bg-cream-deep",
                  )}
                >
                  {key === "month" ? "Monthly" : "Weekly"}
                </Link>
              ))}
            </nav>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/teacher/reports/revenue?period=${period}`} download>
                <Download data-icon="inline-start" />
                Revenue CSV
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/api/teacher/reports/adjustments" download>
                <Download data-icon="inline-start" />
                Refunds & adjustments CSV
              </a>
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Verified payments by payment date, minus refunds by refund date (India time). Pending and rejected payments are never counted.
        </p>
        {revenue.rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">No verified payments yet.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">Revenue by {period}</caption>
                <thead className="bg-cream-deep/60 text-xs tracking-wide text-brown-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">{period === "month" ? "Month" : "ISO week"}</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Received</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Refunds</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {revenue.rows.slice(0, 24).map((r) => (
                    <tr key={r.period} className="border-t border-border">
                      <td className="px-4 py-3 text-brown">{r.period}</td>
                      <td className="px-4 py-3 text-right text-brown">
                        {formatMoney(r.receivedMinor)} <span className="text-xs text-muted-foreground">({r.receivedCount})</span>
                      </td>
                      <td className="px-4 py-3 text-right text-brown">{formatMoney(r.refundedMinor)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-brown">{formatMoney(r.netMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="outstanding" className="flex flex-col gap-3">
        <h2 id="outstanding" className="type-h3">Outstanding course-fee balances (earlier enrollments)</h2>
        <p className="text-sm text-muted-foreground">
          Agreed fee minus verified payments, per enrollment. Package balances are on the{" "}
          <Link href="/teacher/packages" className="font-semibold text-maroon hover:underline">Packages</Link> page; a payment counts towards one or the other, never both.
        </p>
        {result.outstanding.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">
            No outstanding balances.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {result.outstanding.map((b) => (
              <li key={b.enrollmentId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  <Link href={`/teacher/students/${b.studentId}`} className="font-medium text-brown hover:text-maroon hover:underline">
                    {b.studentName}
                  </Link>
                  <span className="text-muted-foreground"> · {b.courseTitle}{b.access === "revoked" ? " (access revoked)" : ""}</span>
                </span>
                <span className="text-right">
                  <span className="font-semibold text-maroon">{formatMoney(b.balanceMinor ?? 0, b.currency)}</span>
                  <span className="block text-xs text-muted-foreground">
                    of {formatMoney(b.feeMinor ?? 0, b.currency)} · {formatMoney(b.receivedMinor, b.currency)} received
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function TeacherPaymentsPage({ searchParams }: PageProps<"/teacher/payments">) {
  return (
    <>
      <TeacherPageHeader
        title="Payments"
        description="Verified offline payments, pending amounts and balances. Payment status never changes course access."
      />
      <Suspense fallback={<LoadingState label="Loading payments…" />}>
        <Payments searchParams={searchParams} />
      </Suspense>
    </>
  );
}
