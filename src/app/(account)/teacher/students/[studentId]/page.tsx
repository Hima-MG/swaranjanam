import { ArrowLeft, CalendarDays, Clock, LogIn, Mail, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ProgressBar } from "@/components/lms/progress-bar";
import { CourseStatusBadge } from "@/components/lms/teacher/course-status-badge";
import { EditFeeDialog, PaymentStatusActions, RecordPaymentDialog } from "@/components/lms/teacher/payment-dialogs";
import { PaymentStatusBadge } from "@/components/lms/teacher/payment-status-badge";
import { EnrollInCourseForm, EnrollmentAccessControl } from "@/components/lms/teacher/student-enrollment-controls";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { getStudentDetail } from "@/lib/lms/server/admin";
import { getStudentPayments } from "@/lib/lms/server/payments";
import { PAYMENT_METHOD_LABELS } from "@/lib/lms/types";

export const metadata: Metadata = { title: "Student · Teacher" };

type Params = PageProps<"/teacher/students/[studentId]">["params"];

const HISTORY_LABELS: Record<string, string> = { enrolled: "Enrolled", revoked: "Access revoked", restored: "Access restored", fee: "Fee changed" };

function BalanceLine({ balance }: { balance?: { balanceMinor: number | null; currency: string } }) {
  if (!balance || balance.balanceMinor === null) return null;
  const { balanceMinor, currency } = balance;
  if (balanceMinor > 0) {
    return <span className="text-xs font-semibold text-maroon">{formatMoney(balanceMinor, currency)} outstanding</span>;
  }
  return (
    <span className="text-xs text-muted-foreground">
      {balanceMinor < 0 ? `${formatMoney(-balanceMinor, currency)} overpaid` : "Fully paid"}
    </span>
  );
}

async function StudentProfile({ params }: { params: Params }) {
  const { studentId } = await params;
  const teacher = await requireRole("teacher", `/teacher/students/${studentId}`);
  const [data, money] = await Promise.all([getStudentDetail(teacher, studentId), getStudentPayments(teacher, studentId)]);
  if (!data) notFound();
  const { student, enrollments, availableCourses } = data;
  const balanceByEnrollment = new Map(money.balances.map((b) => [b.enrollmentId, b]));
  const name = student.displayName ?? student.email ?? "Unnamed student";

  const facts = [
    { icon: Mail, label: "Email", value: student.email ?? "—" },
    { icon: Phone, label: "Phone", value: student.phone ?? "—" },
    { icon: CalendarDays, label: "Joined", value: formatDate(student.createdAt) },
    { icon: LogIn, label: "Last sign-in", value: formatDateTime(student.lastLoginAt, "Not recorded") },
    { icon: Clock, label: "Last studied", value: formatDateTime(student.lastActiveAt, "Not yet") },
  ];

  return (
    <div className="flex flex-col gap-8">
      <Link
        href="/teacher/students"
        className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All students
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="type-h2 break-words">{name}</h1>
        <div>
          <Badge variant={student.activity === "active" ? "gold" : "outline"}>
            {student.activity === "active" ? "Active learner" : student.activity === "inactive" ? "Inactive" : "No activity yet"}
          </Badge>
        </div>
      </div>

      <section aria-label="Profile" className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft sm:grid-cols-2 xl:grid-cols-5">
        {facts.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-maroon-soft text-maroon">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-sm font-medium break-all text-brown">{value}</span>
            </span>
          </div>
        ))}
      </section>

      <section aria-labelledby="enrollments" className="flex flex-col gap-4">
        <h2 id="enrollments" className="type-h3">
          Courses and progress
        </h2>
        {enrollments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">
            Not enrolled in any course yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {enrollments.map((e) => (
              <li key={e.id} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <Link href={`/teacher/courses/${e.courseId}`} className="font-heading text-xl font-semibold text-brown hover:text-maroon">
                      {e.courseTitle}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={e.status === "active" ? "gold" : "outline"}>
                        {e.status === "active" ? "Access active" : "Access revoked"}
                      </Badge>
                      {e.courseStatus && <CourseStatusBadge status={e.courseStatus} />}
                      <span>Enrolled {formatDate(e.enrolledAt)}</span>
                      {e.status === "revoked" && <span>· Revoked {formatDate(e.revokedAt)}</span>}
                    </div>
                  </div>
                  <EnrollmentAccessControl
                    courseId={e.courseId}
                    studentId={student.uid}
                    courseTitle={e.courseTitle}
                    active={e.status === "active"}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">Lesson progress</span>
                    {e.completion.total === 0 ? (
                      <span className="text-sm text-muted-foreground">Course has no lessons yet</span>
                    ) : (
                      <>
                        <span className="text-sm text-brown">
                          {e.completion.completed} of {e.completion.total} lessons · {e.completion.percent}%
                        </span>
                        <ProgressBar percent={e.completion.percent ?? 0} label={`${e.courseTitle} progress`} />
                      </>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">Last opened a lesson</span>
                    <span className="text-sm text-brown">{formatDateTime(e.lastAccessedAt, "Not yet")}</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">Agreed fee · balance</span>
                    <span className="flex items-center gap-1 text-sm text-brown">
                      {e.agreedFee === null ? "Not set" : formatMoney(e.agreedFee * 100, e.currency)}
                      <EditFeeDialog enrollmentId={e.id} feeRupees={e.agreedFee} courseTitle={e.courseTitle} />
                    </span>
                    <BalanceLine balance={balanceByEnrollment.get(e.id)} />
                  </div>
                </div>

                {e.history.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs font-semibold text-maroon">Enrollment history ({e.history.length})</summary>
                    <ol className="mt-2 flex flex-col gap-1 border-l border-border pl-4 text-muted-foreground">
                      {e.history.map((h, i) => (
                        <li key={i}>
                          {HISTORY_LABELS[h.type] ?? h.type} · {formatDateTime(h.at)}
                          {h.note ? ` · ${h.note}` : ""}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="payments" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="payments" className="type-h3">
            Payments
          </h2>
          <RecordPaymentDialog
            enrollmentOptions={enrollments.map((e) => ({ id: e.id, label: `${e.courseTitle}${e.status === "revoked" ? " (revoked)" : ""}` }))}
            defaultEnrollmentId={enrollments.length === 1 ? enrollments[0].id : undefined}
          />
        </div>
        {money.payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">
            {enrollments.length === 0 ? "Enroll the student in a course before recording payments." : "No payments recorded for this student."}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {money.payments.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="font-semibold text-brown">{formatMoney(p.amountMinor, p.currency)}</span>
                  <span className="text-muted-foreground">
                    {" "}· {p.courseTitle} · {PAYMENT_METHOD_LABELS[p.method]} · {formatDate(p.paidAt)}
                    {p.reference ? ` · Ref ${p.reference}` : ""}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Recorded by {p.createdByEmail ?? "—"} · {formatDateTime(p.createdAt)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <PaymentStatusBadge status={p.status} verified={p.verified} />
                  <PaymentStatusActions paymentId={p.id} status={p.status} source={p.source} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="enroll" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 id="enroll" className="type-h3">
          Enroll in a course
        </h2>
        <EnrollInCourseForm studentId={student.uid} courses={availableCourses} />
      </section>
    </div>
  );
}

export default function TeacherStudentPage({ params }: PageProps<"/teacher/students/[studentId]">) {
  return (
    <Suspense fallback={<LoadingState label="Loading student…" />}>
      <StudentProfile params={params} />
    </Suspense>
  );
}
