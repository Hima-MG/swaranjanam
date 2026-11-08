import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { RecordPaymentDialog } from "@/components/lms/teacher/payment-dialogs";
import { AssignBatchForm, ConfirmScheduleForm } from "@/components/lms/teacher/registration-controls";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDateTime } from "@/lib/format-date";
import { ENROLMENT_TYPE_LABELS, learnerNamesLabel, registrationStatusLabel, WEEKDAY_LABELS, WEEKDAYS } from "@/lib/lms/registration";
import { getBillingSettings } from "@/lib/lms/server/billing";
import { getRegistrationDetail } from "@/lib/lms/server/registrations";

export const metadata: Metadata = { title: "Registration · Teacher" };

type Params = PageProps<"/teacher/registrations/[registrationId]">["params"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-2.5 last:border-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words text-brown">{children}</dd>
    </div>
  );
}

async function Registration({ params }: { params: Params }) {
  const { registrationId } = await params;
  const teacher = await requireRole("teacher", `/teacher/registrations/${encodeURIComponent(registrationId)}`);
  const [detail, settings] = await Promise.all([getRegistrationDetail(teacher, registrationId), getBillingSettings()]);
  if (!detail) notFound();
  const { registration: r, batches, batch, courseInDashboard } = detail;
  const d = r.details;
  const paid = r.status !== "pending_payment" && r.status !== "cancelled";

  return (
    <div className="flex flex-col gap-8">
      <Link href="/teacher/registrations" className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Registered students
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-h2">{learnerNamesLabel(r.details.learners.map((l) => l.fullName)) || "Student"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {r.kind === "special" ? (
              `${r.courseTitle} · Special Programme · full fee ${formatMoney(r.initialAmountMinor)} (no monthly invoice)`
            ) : (
              <>
                {r.courseTitle} · Regular · {ENROLMENT_TYPE_LABELS[r.enrolmentType]} · agreed rate{" "}
                {r.learnerCount > 1 ? `${formatMoney(r.perLearnerRateMinor)} per person (${formatMoney(r.rateMinor)} combined)` : formatMoney(r.rateMinor)} per{" "}
                {r.mode === "batch" ? "class" : "session"}
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={r.status === "paid" ? "destructive" : "gold"}>{registrationStatusLabel(r.status, r.mode, r.kind)}</Badge>
            <Badge variant="outline">
              Initial payment {formatMoney(r.initialAmountMinor)}: {paid ? "verified" : "not paid"}
            </Badge>
          </div>
        </div>
        {r.status === "pending_payment" && (
          <RecordPaymentDialog
            enrollmentOptions={[]}
            billingOptions={[{ value: `registration:${r.id}`, label: `Initial payment — ${formatMoney(r.initialAmountMinor)}` }]}
            methods={settings.methods}
            defaultTarget={`registration:${r.id}`}
          />
        )}
      </div>

      <section aria-labelledby="details" className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="details" className="type-h3">
          Student details
        </h2>
        <dl className="flex flex-col text-sm">
          <Row label="Student account">
            {r.studentId ? (
              <Link href={`/teacher/students/${r.studentId}`} className="text-maroon hover:underline">
                {r.studentEmail ?? "View profile"}
              </Link>
            ) : r.linkPending ? (
              "Paid as a guest — an account already exists for this email; it is linked when its owner signs in (verified email)."
            ) : (
              "Guest registration — the account is created after the verified payment."
            )}
            {r.guest && r.inviteStatus === "sent" ? " · Password-setup email sent" : r.guest && r.inviteStatus === "not_sent" ? " · Invitation email could not be sent (student can use Forgot password)" : ""}
          </Row>
          <Row label="Email">{r.details.email || r.studentEmail || "—"}</Row>
          <Row label="Mobile">{r.details.mobile || "—"}</Row>
          {r.details.learners.map((l, idx) => (
            <Row key={idx} label={r.learnerCount > 1 ? `Learner ${idx + 1}` : "Learner"}>
              {l.fullName} · {l.age} years{l.dateOfBirth ? ` (date of birth ${l.dateOfBirth})` : ""}
              {l.guardian ? ` · parent/guardian ${l.guardian.name} (${l.guardian.relationship}) · ${l.guardian.phone}${l.guardian.email ? ` · ${l.guardian.email}` : ""}` : ""}
            </Row>
          ))}
          <Row label="Address">
            <span className="whitespace-pre-line">{d.address}</span>
          </Row>
          <Row label="Preferred days">
            {WEEKDAYS.filter((w) => d.preferredDays.includes(w))
              .map((w) => WEEKDAY_LABELS[w])
              .join(", ")}
          </Row>
          <Row label="Preferred times (IST)">{d.preferredTimes.map((t) => `${t.start}–${t.end}`).join(", ")}</Row>
          {d.notes && (
            <Row label="Notes">
              <span className="whitespace-pre-line">{d.notes}</span>
            </Row>
          )}
          <Row label="Registered">{formatDateTime(r.createdAt)}</Row>
          {r.paidAt && <Row label="Payment verified">{formatDateTime(r.paidAt)}</Row>}
          {batch && (
            <Row label="Batch">
              <Link href={`/teacher/batches/${batch.id}`} className="text-maroon hover:underline">
                {batch.name}
              </Link>{" "}
              · {batch.schedule}
            </Row>
          )}
          {r.confirmedSchedule && (
            <Row label="Confirmed schedule">
              {r.confirmedSchedule}
              {r.scheduleTeacherName ? ` · teacher ${r.scheduleTeacherName}` : ""} ·{" "}
              <Link href="/teacher/schedules" className="text-maroon hover:underline">
                Change
              </Link>
            </Row>
          )}
          {r.accountId && (
            <Row label="Billing">
              <Link href={`/teacher/billing/${r.accountId}`} className="text-maroon hover:underline">
                Open billing account
              </Link>
            </Row>
          )}
        </dl>
      </section>

      {r.status === "pending_payment" && (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-5 text-sm text-muted-foreground">
          Waiting for the initial payment. The student pays online from their enrolment page; it counts only after the server has verified it. An offline
          payment can be recorded above.
        </p>
      )}

      {r.status === "paid" && r.kind !== "special" && (
        <section aria-labelledby="place" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h2 id="place" className="type-h3">
            {r.mode === "batch" ? "Assign to a batch" : "Confirm the individual schedule"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Verify the student&apos;s old dues on their{" "}
            <Link href={`/teacher/students/${r.studentId}`} className="text-maroon hover:underline">
              profile
            </Link>{" "}
            first. The {formatMoney(r.initialAmountMinor)} initial payment becomes the first {r.mode === "batch" ? "class" : "session"}&apos;s payment and is
            never charged again.
          </p>
          {!courseInDashboard ? (
            <p className="text-sm text-destructive">This course is not in the dashboard yet. Create it (with the same web address) before placing the student.</p>
          ) : r.mode === "batch" ? (
            batches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active batches for this course.{" "}
                <Link href="/teacher/batches" className="text-maroon hover:underline">
                  Create a batch
                </Link>{" "}
                first.
              </p>
            ) : (
              <AssignBatchForm
                registrationId={r.id}
                batches={batches.map((b) => ({
                  id: b.id,
                  disabled: b.full,
                  label: `${b.name} — ${b.schedule || "no schedule"} — ${b.memberCount}/${b.capacity}${b.full ? " (full)" : ""}${
                    b.weekly && b.weekly.days.some((w) => d.preferredDays.includes(w)) ? " — matches preferred days" : ""
                  }`,
                }))}
              />
            )
          ) : (
            <ConfirmScheduleForm
              registrationId={r.id}
              defaults={{ days: d.preferredDays, start: d.preferredTimes[0]?.start ?? "", end: d.preferredTimes[0]?.end ?? "" }}
            />
          )}
        </section>
      )}
    </div>
  );
}

export default function RegistrationPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<LoadingState label="Loading registration…" />}>
      <Registration params={params} />
    </Suspense>
  );
}
