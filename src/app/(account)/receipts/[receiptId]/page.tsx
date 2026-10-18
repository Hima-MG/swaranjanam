import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PrintButton } from "@/components/lms/print-button";
import { LoadingState } from "@/components/ui/loading-state";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { PACKAGE_TYPE_LABELS } from "@/lib/lms/billing";
import { getReceiptForViewer } from "@/lib/lms/server/billing";

export const metadata: Metadata = { title: "Receipt" };

type Params = PageProps<"/receipts/[receiptId]">["params"];

async function Receipt({ params }: { params: Params }) {
  const { receiptId } = await params;
  const user = await requireUser(`/receipts/${receiptId}`);
  // Ownership is checked on the server: teachers, or a learner named on the receipt.
  const receipt = await getReceiptForViewer(user, receiptId);
  if (!receipt) notFound();
  const back = user.role === "teacher" ? { href: "/teacher/payments", label: "Payments" } : { href: "/dashboard/billing", label: "Packages & payments" };
  const refunded = receipt.status === "refunded";

  const rows: [string, React.ReactNode][] = [
    ["Receipt number", receipt.number],
    ["Payment date", formatDate(receipt.paidAt)],
    ["Issued", formatDateTime(receipt.issuedAt)],
    ["Received from", receipt.payerName],
    [receipt.learnerNames.length > 1 ? "Learners" : "Learner", receipt.learnerNames.join(" & ")],
    ["For", `${receipt.title}${receipt.packageType ? ` — ${PACKAGE_TYPE_LABELS[receipt.packageType]}` : ""}${receipt.sessions ? ` (${receipt.sessions} sessions)` : ""}`],
    ["Payment method", receipt.methodLabel],
    ["Reference", receipt.referenceMasked ?? "—"],
    ["Status", refunded ? "Refunded" : receipt.refundedMinor > 0 ? "Paid — partly refunded" : "Paid"],
  ];

  return (
    <div data-print-root className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={back.href} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-maroon">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {back.label}
        </Link>
        <PrintButton />
      </div>

      <article className="relative flex flex-col gap-6 overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-10 print:rounded-none print:border-0 print:shadow-none">
        {refunded && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-center text-sm font-semibold tracking-wide text-destructive uppercase">
            Refunded — kept for the record
          </p>
        )}
        <header className="flex flex-col gap-1 border-b border-border pb-5 text-center">
          <p className="font-heading text-2xl font-semibold text-maroon">{receipt.academyName}</p>
          <p className="text-sm text-muted-foreground">Payment receipt{receipt.academyEmail ? ` · ${receipt.academyEmail}` : ""}</p>
        </header>

        <div className="flex flex-col items-center gap-1">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Amount received</p>
          <p className="font-heading text-4xl font-semibold text-brown">{formatMoney(receipt.amountMinor, receipt.currency)}</p>
          {receipt.refundedMinor > 0 && <p className="text-sm text-destructive">{formatMoney(receipt.refundedMinor, receipt.currency)} refunded</p>}
        </div>

        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[11rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium break-words text-brown">{value}</dd>
            </div>
          ))}
        </dl>

        {receipt.statusNote && <p className="text-sm text-muted-foreground">{receipt.statusNote}</p>}
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          This receipt was issued after the payment was verified by the academy. It is a record of payment; it is not a tax invoice.
        </p>
      </article>
    </div>
  );
}

export default function ReceiptPage({ params }: PageProps<"/receipts/[receiptId]">) {
  return (
    <Suspense fallback={<LoadingState label="Loading receipt…" />}>
      <Receipt params={params} />
    </Suspense>
  );
}
