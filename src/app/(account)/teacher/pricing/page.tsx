import type { Metadata } from "next";
import { Suspense } from "react";

import { InstallPlansButton, PaymentMethodsForm, PlanEditDialog } from "@/components/lms/teacher/pricing-controls";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDateTime } from "@/lib/format-date";
import { PAIR_TYPE_LABELS, PAIR_TYPES, PLAN_KIND_LABELS, PLAN_STATUS_LABELS, type PricePlan } from "@/lib/lms/billing";
import { getPricingPage } from "@/lib/lms/server/billing";

export const metadata: Metadata = { title: "Fees & pricing · Teacher" };

const fee = (minor: number | null) => (minor === null ? "Not offered" : formatMoney(minor));

function PlanCard({ plan, courses }: { plan: PricePlan & { updatedAt: string | null; updatedByEmail: string | null; history: { at: string | null; byEmail: string | null; change: string }[] }; courses: { id: string; title: string }[] }) {
  const course = courses.find((c) => c.id === plan.courseId);
  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-brown">{plan.title}</h3>
            <Badge variant={plan.status === "active" ? "gold" : plan.status === "coming_soon" ? "outline" : "secondary"}>
              {PLAN_STATUS_LABELS[plan.status]}
            </Badge>
            <Badge variant="cream">{PLAN_KIND_LABELS[plan.kind]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[plan.level, plan.audience].filter(Boolean).join(" · ")}
            {" · "}
            {plan.sessionsIncluded} session{plan.sessionsIncluded === 1 ? "" : "s"} of {plan.sessionMinutes} min
            {plan.durationWeeks ? ` over ${plan.durationWeeks} weeks` : ""}, {plan.sessionsPerWeek}× a week
          </p>
        </div>
        <PlanEditDialog plan={plan} courses={courses} />
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {plan.kind === "regular" ? (
          <>
            <div>
              <dt className="text-xs text-muted-foreground">Adult (16+)</dt>
              <dd className="font-semibold text-brown">{fee(plan.adultPriceMinor)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Student (15 and below)</dt>
              <dd className="font-semibold text-brown">{fee(plan.studentPriceMinor)}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt className="text-xs text-muted-foreground">Fee (all ages, one-time)</dt>
            <dd className="font-semibold text-brown">{fee(plan.flatPriceMinor)}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Course content</dt>
          <dd className="text-brown">{course?.title ?? "Not linked"}</dd>
        </div>
      </dl>

      {plan.kind === "regular" && (
        <div className="text-sm">
          <p className="text-xs text-muted-foreground">Pair plan</p>
          {plan.pairEligible ? (
            <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
              {PAIR_TYPES.map((t) => (
                <li key={t} className="text-brown">
                  {PAIR_TYPE_LABELS[t]}: <span className="font-semibold">{fee(plan.pairPricesMinor[t])}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-brown">Not available</p>
          )}
          {plan.pairEligible && plan.adultPriceMinor === null && (
            <p className="mt-1 text-xs text-muted-foreground">
              No adult fee is published for this course, so a pair that includes an adult needs your explicit confirmation when it is assigned.
            </p>
          )}
        </div>
      )}

      {plan.history.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-maroon">Change history ({plan.history.length})</summary>
          <ol className="mt-1 flex flex-col gap-0.5">
            {[...plan.history].reverse().map((h, i) => (
              <li key={i}>
                {formatDateTime(h.at)} · {h.change}
                {h.byEmail ? ` · ${h.byEmail}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

async function Pricing() {
  const teacher = await requireRole("teacher", "/teacher/pricing");
  const { plans, settings, missingPublished, courses } = await getPricingPage(teacher);
  return (
    <div className="flex flex-col gap-10">
      {missingPublished.length > 0 && <InstallPlansButton missing={missingPublished} />}

      <section aria-labelledby="plans" className="flex flex-col gap-4">
        <h2 id="plans" className="type-h3">Fee plans</h2>
        <p className="text-sm text-muted-foreground">
          Regular packages are paid in advance; the next package is due after the last class of the current one. Changing a fee affects only packages
          assigned afterwards.
        </p>
        {plans.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">No fee plans yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} courses={courses} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="methods" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="methods" className="type-h3">Accepted payment methods</h2>
        <PaymentMethodsForm methods={settings.methods} confirmed={settings.confirmed} />
      </section>
    </div>
  );
}

export default function TeacherPricingPage() {
  return (
    <>
      <TeacherPageHeader title="Fees & pricing" description="Course and program fees, the pair plan, and the payment methods the academy accepts." />
      <Suspense fallback={<LoadingState label="Loading fees…" />}>
        <Pricing />
      </Suspense>
    </>
  );
}
