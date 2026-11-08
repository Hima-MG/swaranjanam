import { ArrowLeft, CheckCircle2, Info, Mail, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { saveGuestRegistrationAction } from "@/app/(public)/enrol/actions";
import { PayOnlineButton } from "@/components/lms/student/pay-online-button";
import { RegistrationForm } from "@/components/lms/student/registration-form";
import { RegistrationSummaryRows } from "@/components/lms/student/registration-summary";
import { PageHero } from "@/components/shared/page-hero";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { Section } from "@/components/ui/section";
import { getSession } from "@/lib/auth/session";
import { getPublishedCourseBySlug } from "@/lib/catalog/server";
import { formatMoney } from "@/lib/format";
import { courseEnrolmentChoices } from "@/lib/lms/enrolment-options";
import { guestCookieName, parseGuestCookie } from "@/lib/lms/guest-cookie";
import { registrationStatusLabel, WEEKDAY_LABELS, WEEKDAYS } from "@/lib/lms/registration";
import { readGuestRegistration } from "@/lib/lms/server/guest-enrolment";
import { onlinePaymentsStatus } from "@/lib/payments/razorpay";

export const metadata: Metadata = { title: "Enrol", robots: { index: false, follow: false } };

type Params = PageProps<"/enrol/[slug]">["params"];
type SearchParams = PageProps<"/enrol/[slug]">["searchParams"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-2.5 last:border-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words text-brown">{children}</dd>
    </div>
  );
}

async function GuestEnrol({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  // Per-request page (checkout cookie, Firestore): never prerendered.
  await connection();
  const { slug } = await params;
  const { edit } = await searchParams;
  // Signed-in students enrol from their dashboard (their account is already known).
  const user = await getSession();
  if (user?.role === "student") redirect(`/dashboard/enrol/${encodeURIComponent(slug)}`);
  if (user?.role === "teacher") {
    return <p className="rounded-2xl border border-border bg-cream-deep/60 p-5 text-sm text-brown">You are signed in as the academy. Students enrol from this page.</p>;
  }
  const result = await getPublishedCourseBySlug(slug);
  if (!result.ok) return <p className="text-sm text-muted-foreground">Courses could not be loaded right now. Please refresh the page in a minute.</p>;
  const course = result.data;
  if (!course) notFound();
  const back = (
    <Link href={`/courses/${course.slug}`} className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to {course.title}
    </Link>
  );
  if (course.availability !== "open" || courseEnrolmentChoices(course).length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {back}
        <p className="rounded-2xl border border-border bg-cream-deep/60 p-5 text-sm text-brown">
          <strong>{course.title}</strong> {course.availability === "closed" ? "is closed for new enrolments." : "is coming soon and is not yet open for enrolment."}
        </p>
      </div>
    );
  }

  const saved = parseGuestCookie((await cookies()).get(guestCookieName(course.slug))?.value);
  const registration = saved ? await readGuestRegistration(saved.registrationId, saved.token) : null;

  const editable = !registration || registration.status === "cancelled" || (registration.status === "pending_payment" && edit === "1");
  if (editable) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        {back}
        <p className="flex items-start gap-2 rounded-2xl border border-border bg-cream-deep/60 p-4 text-sm text-brown">
          <Info className="mt-0.5 size-4 shrink-0 text-maroon" aria-hidden="true" />
          <span>
            Already a student?{" "}
            <Link href={`/login?next=${encodeURIComponent(`/dashboard/enrol/${course.slug}`)}`} className="font-semibold text-maroon hover:underline">
              Sign in
            </Link>{" "}
            to enrol with your account. New students: no account is needed now — we create your login after your payment is verified.
          </span>
        </p>
        <RegistrationForm
          save={saveGuestRegistrationAction}
          reviewPath={`/enrol/${course.slug}`}
          slug={course.slug}
          initial={registration && registration.status === "pending_payment" ? { type: registration.enrolmentType, details: registration.details } : null}
          // Only the enrolment types this course offers, priced on the server again at save time.
          options={courseEnrolmentChoices(course)}
          fixedSchedule={Boolean(course.programme)}
        />
      </div>
    );
  }

  const r = registration!;
  const d = r.details;
  const summary = (
    <dl className="flex flex-col text-sm">
      <Row label="Course">{r.courseTitle}</Row>
      <RegistrationSummaryRows r={r} />
      <Row label="Login email">{d.email}</Row>
      <Row label="Mobile">{d.mobile}</Row>
      <Row label="Preferred days">
        {WEEKDAYS.filter((w) => d.preferredDays.includes(w))
          .map((w) => WEEKDAY_LABELS[w])
          .join(", ")}
      </Row>
      <Row label="Preferred times (IST)">{d.preferredTimes.map((t) => `${t.start}–${t.end}`).join(", ")}</Row>
    </dl>
  );

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
            The initial payment covers your first eligible {r.mode === "batch" ? "class" : "session"}. Future payments are calculated monthly based on billable{" "}
            {r.mode === "batch" ? "classes" : "sessions"}. Your preferred days and times are preferences, not a confirmed class schedule.
          </p>
          )}
          {payOnline ? (
            <PayOnlineButton kind="registration" id={r.id} guestSlug={course.slug} mode={online.mode} statusCheck label={`Pay Now — ${formatMoney(r.initialAmountMinor)}`} />
          ) : (
            <p className="text-sm text-muted-foreground">Online payment is temporarily unavailable. Your registration is saved — please try again later or contact the academy.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Your payment counts only after the academy&apos;s server has verified it with Razorpay. If you paid but closed the page before it was confirmed, use “Check payment status” — do not pay again. If a payment fails or you close the checkout, nothing is lost:
            come back to this page in this browser and try again.
          </p>
          <Button asChild variant="outline" className="self-start">
            <Link href={`/enrol/${course.slug}?edit=1`}>
              <Pencil data-icon="inline-start" />
              Change class type or details
            </Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {back}
      <div role="status" className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-gold-soft/40 p-5 text-sm text-brown">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-maroon" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <p className="font-semibold">{registrationStatusLabel(r.status, r.mode, r.kind)}</p>
          <p>Your payment of {formatMoney(r.initialAmountMinor)} has been verified.</p>
          <p className="flex items-start gap-2">
            <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              If <strong>{d.email}</strong> is new to us, you will receive an email with a secure link to set your password (the link expires). If you already
              have an account, simply sign in with that email. Your enrolment appears on your dashboard.
            </span>
          </p>
          <Button asChild className="self-start">
            <Link href="/login?next=/dashboard">Sign in</Link>
          </Button>
        </div>
      </div>
      <section aria-labelledby="registration" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="registration" className="type-h3">
          Your registration
        </h2>
        {summary}
      </section>
    </div>
  );
}

export default function GuestEnrolPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <>
      <PageHero eyebrow="Enrol" title="Join a course" description="Choose batch or individual classes, tell us about the learner, then pay for the first class to confirm your place." />
      <Section spacing="sm">
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <GuestEnrol params={params} searchParams={searchParams} />
        </Suspense>
      </Section>
    </>
  );
}
