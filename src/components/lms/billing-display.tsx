import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { PACKAGE_STATUS_LABELS, type NextPayment, type PackageStatus, type PaymentState } from "@/lib/lms/billing";

// Small display pieces shared by the teacher and student billing pages.

export function PackageStatusBadge({ status }: { status: PackageStatus }) {
  const variant = status === "active" ? "gold" : status === "awaiting_payment" ? "outline" : status === "credits_used" ? "maroon" : "secondary";
  return <Badge variant={variant}>{PACKAGE_STATUS_LABELS[status]}</Badge>;
}

const PAYMENT_STATE_LABELS: Record<PaymentState, string> = { unpaid: "Not paid", partial: "Partly paid", paid: "Paid" };

export function PaymentStateBadge({ state }: { state: PaymentState }) {
  return <Badge variant={state === "paid" ? "gold" : state === "partial" ? "outline" : "secondary"}>{PAYMENT_STATE_LABELS[state]}</Badge>;
}

/** Plain-language next payment requirement. There are no due dates, so nothing is ever called overdue. */
export function nextPaymentText(next: NextPayment, currency = "INR"): string | null {
  switch (next.kind) {
    case "balance_due":
      return `${formatMoney(next.amountMinor, currency)} to pay before classes continue (fees are paid in advance).`;
    case "renewal_due":
      return "All classes in this package are used. The next package is due before the next class.";
    case "renewal_after":
      return `Next package due after the last class (${next.classesLeft} class${next.classesLeft === 1 ? "" : "es"} left).`;
    default:
      return null;
  }
}

export function CreditsMeter({ used, total, label }: { used: number; total: number; label: string }) {
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-2 overflow-hidden rounded-full bg-cream-deep"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
      >
        <div className="h-full rounded-full bg-maroon" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">
        {used} of {total} class{total === 1 ? "" : "es"} used · {Math.max(total - used, 0)} left
      </span>
    </div>
  );
}
