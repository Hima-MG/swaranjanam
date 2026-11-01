import { ArrowLeft, CheckCircle2, Clock, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EnrolmentRequestForm } from "@/components/lms/student/enrolment-request-form";
import { PayOnlineButton } from "@/components/lms/student/pay-online-button";
import { PageHero } from "@/components/shared/page-hero";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { Section } from "@/components/ui/section";
import { requireRole } from "@/lib/auth/session";
import { FEE_TERMS } from "@/lib/catalog/public-pricing";
import { getPublishedCourseBySlug } from "@/lib/catalog/server";
import { formatMoney } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { ADVANCE_STATUS_LABELS } from "@/lib/lms/class-billing";
import { ENROLMENT_MODE_LABELS, ENROLMENT_REQUEST_STATUS_LABELS, getOwnEnrolmentState } from "@/lib/lms/server/enrolment";
import { onlinePaymentsEnabled } from "@/lib/payments/razorpay";

export const metadata: Metadata = { title: "Enrol" };

type Params = PageProps<"/dashboard/enrol/[slug]">["params"];

function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warning"; children: React.ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "warning" ? Clock : Info;
  const style =
    tone === "success" ? "border-gold/40 bg-gold-soft/40" : tone === "warning" ? "border-destructive/30 bg-destructive/5" : "border-border bg-cream-deep/60";
  return (
    <div role="status" className={`flex items-start gap-3 rounded-2xl border p-5 text-sm text-brown ${style}`}>
      <Icon className="mt-0.5 size-5 shrink-0 text-maroon" aria-hidden="true" />
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

async function Enrol({ params }: { params: Params }) {
  const { slug } = await params;
  // Sign-in (or registration) is required; login returns the student here.
  const user = await requireRole("student", `/dashboard/enrol/${encodeURIComponent(slug)}`);
  const result = await getPublishedCourseBySlug(slug);
  if (!result.ok) return <Notice tone="warning">Courses could not be loaded right now. Please refresh the page in a minute.</Notice>;
  const course = result.data;
  if (!course) notFound();

  if (course.availability !== "open" || !course.fee) {
    return (
      <Notice>
        <p>
          <strong>{course.title}</strong> is coming soon and is not yet open for enrolment. Fees will be announced when it opens.
        </p>
        <Link href="/#courses" className="font-semibold text-maroon hover:underline">
          See the courses open now
        </Link>
      </Notice>
    );
  }

  const fee = course.fee;
  const state = await getOwnEnrolmentState(user, course);
  const payOnline = onlinePaymentsEnabled();
  const batchAdvance = formatMoney(state.batch?.advance.amountMinor || fee.batchAdvanceMinor);

  let next: React.ReactNode;
  if (state.batch?.status === "active") {
    const advance = state.batch.advance;
    next =
      advance.status === "awaiting" ? (
        <Notice>
          <p>
            You have a place in a batch for <strong>{course.title}</strong>. The last step is the non-refundable first-class payment of{" "}
            <strong>{batchAdvance}</strong>. It pays for your first class, which is never invoiced again — it is not an extra fee. Your class link opens once it
            is verified.
          </p>
          {payOnline ? (
            <PayOnlineButton kind="advance" id={state.batch.id} label={`Pay ${batchAdvance} for your first class`} />
          ) : (
            <p className="text-muted-foreground">Online payment is not available yet. The academy will tell you how to pay the advance.</p>
          )}
          <p className="text-xs text-muted-foreground">Your payment is confirmed only after the academy&apos;s server has verified it with Razorpay.</p>
        </Notice>
      ) : (
        <Notice tone="success">
          <p>
            You are enrolled in a batch for <strong>{course.title}</strong>. First-class payment: {ADVANCE_STATUS_LABELS[advance.status]}. Your four-weekly
            invoices and receipts are on your billing page.
          </p>
          {state.batch.suspension.active && (
            <p className="text-destructive">Access is paused because an invoice is unpaid after its payment deadline. It is restored once the payment is verified.</p>
          )}
          <Button asChild variant="outline" className="self-start">
            <Link href="/dashboard/billing">Go to my fees</Link>
          </Button>
        </Notice>
      );
  } else if (state.individual?.status === "active") {
    next = (
      <Notice tone="success">
        <p>
          You are enrolled for individual classes in <strong>{course.title}</strong>. Each session ({formatMoney(fee.individualMinor)}) appears on your billing
          page once it is scheduled, with its own Pay button.
        </p>
        <Button asChild variant="outline" className="self-start">
          <Link href="/dashboard/billing">Go to my fees</Link>
        </Button>
      </Notice>
    );
  } else if (state.request?.status === "pending") {
    next = (
      <Notice>
        <p>
          Your request for <strong>{ENROLMENT_MODE_LABELS[state.request.mode].toLowerCase()}</strong> was sent
          {state.request.createdAt ? ` on ${formatDate(state.request.createdAt)}` : ""}. {ENROLMENT_REQUEST_STATUS_LABELS.pending}: the academy will place
          you {state.request.mode === "batch" ? "in a batch" : "with a teacher"} and open your billing account. Come back to this page to pay
          {state.request.mode === "batch" ? ` the ${batchAdvance} first-class payment online.` : " for each session once it is scheduled."}
        </p>
        <p className="text-muted-foreground">Nothing has been charged.</p>
      </Notice>
    );
  } else {
    next = (
      <div className="flex flex-col gap-4">
        {state.request?.status === "declined" && (
          <Notice tone="warning">
            <p>Your earlier request was declined{state.request.resolvedNote ? `: ${state.request.resolvedNote}` : "."} You can send a new request below.</p>
          </Notice>
        )}
        <EnrolmentRequestForm
          slug={course.slug}
          options={[
            {
              mode: "batch",
              title: "Batch class",
              price: `${formatMoney(fee.batchMinor)} per session`,
              detail: `Up to 5 students. Once you are placed in a batch you pay ${formatMoney(fee.batchAdvanceMinor)} online for your first class (non-refundable). After that you are invoiced every four weeks for the classes held, due before your next class.`,
            },
            {
              mode: "individual",
              title: "Individual class",
              price: `${formatMoney(fee.individualMinor)} per session`,
              detail: "One-to-one. Each session is paid separately once it is scheduled. No first-class payment and no four-weekly invoice.",
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <Link href={`/courses/${course.slug}`} className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to {course.title}
      </Link>
      <section aria-labelledby="fees" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="fees" className="type-h3">
          Fees and how payment works
        </h2>
        <ul className="flex flex-col gap-1.5 text-sm text-brown">
          <li>
            <strong>Batch class:</strong> {formatMoney(fee.batchMinor)} per session, per student. Your first class ({formatMoney(fee.batchAdvanceMinor)},
            non-refundable) is paid online when you are placed in a batch; later classes are invoiced every four weeks.
          </li>
          <li>
            <strong>Individual class:</strong> {formatMoney(fee.individualMinor)} per session, each paid separately.
          </li>
          {FEE_TERMS.map((term) => (
            <li key={term}>{term}</li>
          ))}
          <li>You never pay for a whole course upfront.</li>
        </ul>
      </section>
      {next}
    </div>
  );
}

export default function EnrolPage({ params }: { params: Params }) {
  return (
    <>
      <PageHero eyebrow="Enrol" title="Join a course" description="Choose batch or individual classes. Fees are per session; nothing is charged until the academy has placed you." />
      <Section spacing="sm">
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <Enrol params={params} />
        </Suspense>
      </Section>
    </>
  );
}
