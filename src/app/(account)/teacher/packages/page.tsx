import { AlertCircle, CalendarClock, Download, Package, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CreditsMeter, nextPaymentText, PackageStatusBadge, PaymentStateBadge } from "@/components/lms/billing-display";
import { AssignPackageDialog } from "@/components/lms/teacher/package-controls";
import { StatCard } from "@/components/lms/teacher/stat-card";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { PACKAGE_STATUS_LABELS, PACKAGE_STATUSES, PACKAGE_TYPE_LABELS } from "@/lib/lms/billing";
import { listPackagesForTeacher, parsePackageFilters } from "@/lib/lms/server/billing";
import { listStudentOptions } from "@/lib/lms/server/classes";

export const metadata: Metadata = { title: "Packages · Teacher" };

type SearchParams = PageProps<"/teacher/packages">["searchParams"];

async function Packages({ searchParams }: { searchParams: SearchParams }) {
  const teacher = await requireRole("teacher", "/teacher/packages");
  const filters = parsePackageFilters(await searchParams);
  const [{ rows, plans, totals }, students] = await Promise.all([listPackagesForTeacher(teacher, filters), listStudentOptions(teacher)]);
  const filtered = Boolean(filters.status !== "any" || filters.plan || filters.q);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {plans.length === 0 ? (
          <Button asChild size="sm">
            <Link href="/teacher/pricing">Set up fee plans first</Link>
          </Button>
        ) : (
          <AssignPackageDialog plans={plans} students={students} />
        )}
        <Button asChild variant="outline" size="sm">
          <a href="/api/teacher/packages/export" download>
            <Download data-icon="inline-start" />
            Export packages CSV
          </a>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active packages" value={totals.active} detail={`${totals.awaitingPayment} awaiting payment`} icon={Package} />
        <StatCard label="Class credits left" value={totals.creditsRemaining} detail="Across all packages that are not cancelled" icon={CalendarClock} />
        <StatCard
          label="Outstanding on packages"
          value={formatMoney(totals.outstandingMinor)}
          detail={`${totals.outstandingCount} package${totals.outstandingCount === 1 ? "" : "s"} not fully paid`}
          icon={AlertCircle}
        />
        <StatCard label="Renewals due" value={totals.renewalsDue} detail="All classes used; next package due" icon={RefreshCw} />
      </div>

      <form method="get" className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft md:grid-cols-[1fr_1fr_1.6fr_auto] md:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor="status" className="text-sm font-medium text-brown">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={filters.status}>
            <option value="any">Any</option>
            {PACKAGE_STATUSES.map((s) => (
              <option key={s} value={s}>{PACKAGE_STATUS_LABELS[s]}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="plan" className="text-sm font-medium text-brown">Course / program</Label>
          <NativeSelect id="plan" name="plan" defaultValue={filters.plan ?? ""}>
            <option value="">All</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="q" className="text-sm font-medium text-brown">Learner</Label>
          <Input id="q" name="q" type="search" defaultValue={filters.q} maxLength={100} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          {filtered && (
            <Button asChild variant="ghost">
              <Link href="/teacher/packages">Reset</Link>
            </Button>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          {filtered ? "No packages match these filters." : "No packages yet. Use “Assign package” to create one."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((p) => {
            const next = nextPaymentText(p.next, p.currency);
            return (
              <li key={p.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/teacher/packages/${p.id}`} className="font-semibold text-brown hover:text-maroon hover:underline">
                      {p.learners.map((l) => l.name).join(" + ")} — {p.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {PACKAGE_TYPE_LABELS[p.type]} · {formatMoney(p.priceMinor, p.currency)} · assigned {formatDate(p.createdAt)}
                    </p>
                  </div>
                  <span className="flex flex-wrap gap-2">
                    <PackageStatusBadge status={p.status} />
                    <PaymentStateBadge state={p.summary.paymentState} />
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <CreditsMeter used={p.summary.creditsUsed} total={p.summary.creditsTotal} label={`${p.title} classes used`} />
                  <p className="text-sm text-brown">
                    {formatMoney(p.summary.netPaidMinor, p.currency)} paid of {formatMoney(p.summary.dueMinor, p.currency)}
                    {p.summary.pendingMinor > 0 && (
                      <span className="block text-xs text-muted-foreground">{formatMoney(p.summary.pendingMinor, p.currency)} pending verification</span>
                    )}
                  </p>
                </div>
                {next && <p className="text-xs text-muted-foreground">{next}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function TeacherPackagesPage({ searchParams }: PageProps<"/teacher/packages">) {
  return (
    <>
      <TeacherPageHeader
        title="Packages"
        description="Prepaid class packages, pair packages and short programs: payments, balances and class credits."
      />
      <Suspense fallback={<LoadingState label="Loading packages…" />}>
        <Packages searchParams={searchParams} />
      </Suspense>
    </>
  );
}
