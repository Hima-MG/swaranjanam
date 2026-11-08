import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PolicyForm, RateVersionForm } from "@/components/lms/teacher/class-billing-controls";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { BILLING_START_PERIOD, nextPeriod, PENDING_DECISIONS, periodLabel, periodOf, rateVersionForPeriod } from "@/lib/lms/class-billing";
import { getClassBillingConfig } from "@/lib/lms/server/class-billing";
import { onlinePaymentsStatus } from "@/lib/payments/razorpay";

export const metadata: Metadata = { title: "Rates & policy · Teacher" };

async function Settings() {
  await requireRole("teacher", "/teacher/billing/settings");
  const config = await getClassBillingConfig();
  const online = onlinePaymentsStatus();
  const nowPeriod = periodOf(new Date().toISOString());
  const current = rateVersionForPeriod(config.rateVersions, nowPeriod);
  const minMonth = nextPeriod(nowPeriod < BILLING_START_PERIOD ? BILLING_START_PERIOD : nowPeriod);
  return (
    <div className="flex flex-col gap-8">
      <Link href="/teacher/billing" className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Billing
      </Link>

      <section aria-labelledby="rules" className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-brown shadow-soft">
        <h2 id="rules" className="type-h3">Confirmed rules</h2>
        <ul className="list-disc pl-5">
          <li>Website billing starts with {periodLabel(BILLING_START_PERIOD)}; earlier fees stay with the previous payment method, and old dues must be verified for each student first.</li>
          <li>Batch classes: per class per student. Attended and absent are billed; academy-cancelled, rescheduled and unknown-attendance classes are not.</li>
          <li>
            Initial enrolment payment (batch ₹400, individual ₹750), collected at enrolment and <strong>non-refundable</strong>: it pays for the student&apos;s first
            eligible class/session, which is listed on its monthly invoice with the payment deducted — never charged twice. The first class&apos;s Meet link is withheld
            until it is verified. It is not refunded if a student stops early.
          </li>
          <li>
            Calendar months (IST). Each invoice is generated on the last calendar day of the month (from 23:00 IST) for the billable classes/sessions actually
            held and recorded that month — 4, 5 or any number. A class recorded after its month&apos;s invoice goes on the next one. The payment deadline is the
            end of the 3rd calendar day after the invoice date (30 Nov → 3 Dec, 23:59 IST); there is no restriction before then. Unpaid after the deadline →
            Meet links, lessons and materials pause until the payment is verified and no other invoice is overdue.
          </li>
          <li>
            Individual sessions: ₹750 per session on the monthly invoice. Attended or absent → billable; cancelled by the student → billable (the academy provides the recording); academy cancellation or rescheduling → no charge; unknown attendance → not billed. Sessions scheduled earlier with their own
            per-session charge are still paid one at a time and never added to a monthly invoice.
          </li>
        </ul>
      </section>

      <section aria-labelledby="online" className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-brown shadow-soft">
        <h2 id="online" className="type-h3">Online payments (Razorpay Test Mode)</h2>
        <p>{online.enabled ? "Enabled for this environment." : `Disabled — ${online.reason}`}</p>
        <p className="text-xs text-muted-foreground">
          Test Mode payments are recorded only in emulator or explicitly listed non-production Firebase projects, never in the production database. Manual payments always work.
        </p>
      </section>

      <section aria-labelledby="rates" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="rates" className="type-h3">Rates</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {[...config.rateVersions]
            .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
            .map((v) => (
              <li key={v.id} className={v.id === current.id ? "font-semibold text-brown" : "text-muted-foreground"}>
                {v.id} · from {periodLabel(v.effectiveFrom)} · batch {formatMoney(v.batchMinor)}/class/student · individual {formatMoney(v.individualMinor)}/session · advance{" "}
                {formatMoney(v.batchAdvanceMinor)}
                {v.id === current.id ? " — in force" : v.effectiveFrom > nowPeriod ? " — scheduled" : ""}
              </li>
            ))}
        </ul>
        <RateVersionForm minMonth={minMonth} />
      </section>

      <section aria-labelledby="policy" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="policy" className="type-h3">Unconfirmed options</h2>
        <PolicyForm policy={config.policy} />
      </section>

      <section aria-labelledby="pending" className="flex flex-col gap-3 rounded-2xl border border-gold/40 bg-gold-soft/30 p-6">
        <h2 id="pending" className="type-h3">Decisions still needed from the academy</h2>
        <ul className="list-disc pl-5 text-sm text-brown">
          {PENDING_DECISIONS.map((d) => (
            <li key={d.key}>{d.question}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function BillingSettingsPage() {
  return (
    <>
      <TeacherPageHeader title="Rates & policy" description="Versioned rates (changes start next month) and the billing rules." />
      <Suspense fallback={<LoadingState label="Loading settings…" />}>
        <Settings />
      </Suspense>
    </>
  );
}
