import { ArrowLeft, CheckCircle2, Clock, Info, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PayOnlineButton } from "@/components/lms/student/pay-online-button";
import { saveMyRegistration } from "@/app/(account)/dashboard/registration-actions";
import { RegistrationForm } from "@/components/lms/student/registration-form";
import { RegistrationSummaryRows } from "@/components/lms/student/registration-summary";
import { PageHero } from "@/components/shared/page-hero";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { Section } from "@/components/ui/section";
import { requireRole } from "@/lib/auth/session";
import { getPublishedCourseBySlug } from "@/lib/catalog/server";
import { formatMoney } from "@/lib/format";
import { courseEnrolmentChoices } from "@/lib/lms/enrolment-options";
import { formatDate } from "@/lib/format-date";
import { registrationStatusLabel, WEEKDAY_LABELS, WEEKDAYS } from "@/lib/lms/registration";
import { claimGuestRegistrations } from "@/lib/lms/server/guest-enrolment";
import { getOwnRegistration } from "@/lib/lms/server/registrations";
import { onlinePaymentsStatus } from "@/lib/payments/razorpay";

export const metadata: Metadata = { title: "Enrol" };

type Params = PageProps<"/dashboard/enrol/[slug]">["params"];
type SearchParams = PageProps<"/dashboard/enrol/[slug]">["searchParams"];

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-2.5 last:border-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-brown">{children}</dd>
    </div>
  );
}

async function Enrol({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { slug } = await params;
  const { edit } = await searchParams;
  // Sign-in (or registration) is required; login returns the student here.
  const user = await requireRole("student", `/dashboard/enrol/${encodeURIComponent(slug)}`);
  await claimGuestRegistrations(user);
  const result = await getPublishedCourseBySlug(slug);
  if (!result.ok) return <Notice tone="warning">Courses could not be loaded right now. Please refresh the page in a minute.</Notice>;
  const course = result.data;
  if (!course) notFound();

  if (course.availability !== "open" || courseEnrolmentChoices(course).length === 0) {
    return (
      <Notice>
        <p>
          <strong>{course.title}</strong> {course.availability === "closed" ? "is closed for new enrolments." : "is coming soon and is not yet open for enrolment."}
        </p>
        <Link href="/#courses" className="font-semibold text-maroon hover:underline">
          See the courses open now
        </Link>
      </Notice>
    );
  }

  const registration = await getOwnRegistration(user, course.slug);
  const back = (
    <Link href={`/courses/${course.slug}`} className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to {course.title}
    </Link>
  );

  // ---- Steps 1–2: class type and details (new, cancelled, or editing before payment) ----
  const editable = !registration || registration.status === "cancelled" || (registration.status === "pending_payment" && edit === "1");
  if (editable) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        {back}
        <RegistrationForm
          save={saveMyRegistration}
          reviewPath={`/dashboard/enrol/${course.slug}`}
          defaultEmail={user.email ?? ""}
          emailLocked={Boolean(user.email)}
          slug={course.slug}
          initial={registration && registration.status === "pending_payment" ? { type: registration.enrolmentType, details: registration.details } : null}
          // Only the class types this course offers, at this course's own rates.
          // Only the enrolment types this course offers, priced on the server again at save time.
          options={courseEnrolmentChoices(course)}
          fixedSchedule={Boolean(course.programme)}
        />
      </div>
    );
  }

  const r = registration!;
  const details = r.details;
  const summary = (
    <dl className="flex flex-col text-sm">
      <Row label="Course">{r.courseTitle}</Row>
      <RegistrationSummaryRows r={r} />
      <Row label="Preferred days">{WEEKDAYS.filter((d) => details.preferredDays.includes(d)).map((d) => WEEKDAY_LABELS[d]).join(", ")}</Row>
      <Row label="Preferred times (IST)">{details.preferredTimes.map((t) => `${t.start}–${t.end}`).join(", ")}</Row>
    </dl>
  );

  // ---- Step 3: review and pay (also the retry after a failed or cancelled checkout) ----
  if (r.status === "pending_payment") {
    const online = onlinePaymentsStatus();
    const payOnline = online.enabled;
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {back}
        <section aria-labelledby="review" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h2 id="review" className="type-h3">
            Review and pay
          </h2>
          {summary}
          {r.kind === "special" ? (
            <p className="text-sm text-muted-foreground">
              This is the full programme fee, paid once. There is no first-class payment and no monthly invoice. Your registration is confirmed when the payment is verified.
            </p>
          ) : (
          <p className="text-sm text-muted-foreground">
            Your preferred days and times are requests, not a confirmed booking.{" "}
            {r.mode === "batch"
              ? `The ${formatMoney(r.initialAmountMinor)} pays for your first class and is deducted on your first monthly invoice — never charged twice; classes held are invoiced at the end of each calendar month, due within 3 days.`
              : `The ${formatMoney(r.initialAmountMinor)} pays for your first individual session and is deducted on your first monthly invoice; sessions held are invoiced at the end of each calendar month, due within 3 days.`}{" "}
            You never pay for a whole course upfront.
          </p>
          )}
          {payOnline ? (
            <PayOnlineButton kind="registration" id={r.id} mode={online.mode} statusCheck label={`Pay Now — ${formatMoney(r.initialAmountMinor)}`} />
          ) : (
            <p className="text-sm text-muted-foreground">Online payment is temporarily unavailable. Your registration is saved — please try again later or contact the academy.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Your payment counts only after the academy&apos;s server has verified it with Razorpay. If you paid but closed the page before it was confirmed, use “Check payment status” — do not pay again. If a payment fails or you close the checkout, nothing is lost:
            come back to this page and try again.
          </p>
          <Button asChild variant="outline" className="self-start">
            <Link href={`/dashboard/enrol/${course.slug}?edit=1`}>
              <Pencil data-icon="inline-start" />
              Change class type or details
            </Link>
          </Button>
        </section>
      </div>
    );
  }

  // ---- After the verified payment ----
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {back}
      <Notice tone="success">
        <p className="font-semibold">{registrationStatusLabel(r.status, r.mode, r.kind)}</p>
        {r.status === "paid" && (
          <p>
            Your payment of {formatMoney(r.initialAmountMinor)}
            {r.paidAt ? ` was verified on ${formatDate(r.paidAt)}` : " is verified"}.{" "}
            {r.kind === "special"
              ? "Your programme registration is confirmed. The programme appears under My courses on your dashboard."
              : r.mode === "batch"
              ? "The academy will place you in a batch that suits your preferred days and times. Your class schedule appears on your dashboard once you are assigned."
              : "The academy will confirm your session schedule. It appears on your dashboard once confirmed."}
          </p>
        )}
        {r.status === "scheduled" && r.confirmedSchedule && <p>Your schedule: {r.confirmedSchedule}</p>}
        {(r.status === "assigned" || r.status === "scheduled" || (r.kind === "special" && r.status === "paid")) && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/dashboard">My dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/billing">My fees</Link>
            </Button>
          </div>
        )}
      </Notice>
      <section aria-labelledby="registration" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="registration" className="type-h3">
          Your registration
        </h2>
        {summary}
      </section>
    </div>
  );
}

export default function EnrolPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <>
      <PageHero eyebrow="Enrol" title="Join a course" description="Choose batch or individual classes, tell us about the learner, then pay for the first class to confirm your place." />
      <Section spacing="sm">
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <Enrol params={params} searchParams={searchParams} />
        </Suspense>
      </Section>
    </>
  );
}
