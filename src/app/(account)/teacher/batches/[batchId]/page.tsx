import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AddMemberForm, BatchFormDialog, RemoveMemberDialog, ScheduleBatchClassDialog, TransferMemberDialog } from "@/components/lms/teacher/batch-controls";
import { CancelClassDialog, RecordOutcomeDialog } from "@/components/lms/teacher/class-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { ADVANCE_STATUS_LABELS, CLASS_OUTCOME_LABELS, MAX_BATCH_CAPACITY } from "@/lib/lms/class-billing";
import { CLASS_STATUS_LABELS, formatClassTime } from "@/lib/lms/classes";
import type { LiveClassRecord } from "@/lib/lms/classes";
import { getBatchDetail, listCourseOptions, listTeachers } from "@/lib/lms/server/batches";
import { getAccountsBillingStatus } from "@/lib/lms/server/class-billing";

export const metadata: Metadata = { title: "Batch · Teacher" };

const ROSTER_STATE_LABELS = {
  paid: "Paid up",
  pending: "Invoice pending (not yet due)",
  overdue: "Invoice overdue",
  suspended: "Suspended (unpaid past due date)",
  first_class_unpaid: "First-class payment not received",
} as const;

type Params = PageProps<"/teacher/batches/[batchId]">["params"];

function outcomeLabel(c: LiveClassRecord): string {
  if (c.status === "cancelled") {
    return c.cancelKind === "student" ? CLASS_OUTCOME_LABELS.student_cancelled : c.cancelKind === "rescheduled" ? CLASS_OUTCOME_LABELS.rescheduled : CLASS_OUTCOME_LABELS.academy_cancelled;
  }
  if (c.status === "completed") return CLASS_OUTCOME_LABELS[c.attendance ?? "unknown"];
  return CLASS_STATUS_LABELS[c.status];
}

async function BatchDetail({ params }: { params: Params }) {
  const { batchId } = await params;
  const teacher = await requireRole("teacher", `/teacher/batches/${batchId}`);
  const [detail, courses, teachers] = await Promise.all([getBatchDetail(teacher, batchId), listCourseOptions(teacher), listTeachers(teacher)]);
  if (!detail) notFound();
  const { batch, members, accounts, sessions, candidates, transferTargets } = detail;
  const active = members.filter((m) => m.status === "active");
  const names = new Map(members.map((m) => [m.studentId, m.studentName]));
  const now = detail.nowMs;
  const scheduleBlock = batch.status !== "active" ? "This batch is inactive." : !batch.meetUrl ? "Add a Google Meet link first." : active.length === 0 ? "Add learners first." : null;
  const billing = await getAccountsBillingStatus(teacher, Object.values(accounts));

  return (
    <div className="flex flex-col gap-8">
      <Link href="/teacher/batches" className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All batches
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="type-h2 break-words">{batch.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {batch.courseTitle} · {batch.teacherName} · {batch.schedule}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={batch.status === "active" ? "gold" : "secondary"}>{batch.status === "active" ? "Active" : "Inactive"}</Badge>
            <Badge variant="outline">
              {batch.memberCount}/{batch.capacity} learners
            </Badge>
            {batch.meetUrl ? (
              <Button asChild variant="ghost" size="sm">
                <a href={batch.meetUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink data-icon="inline-start" />
                  Open Meet
                </a>
              </Button>
            ) : (
              <span className="text-xs text-destructive">No Meet link</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ScheduleBatchClassDialog batchId={batch.id} disabledReason={scheduleBlock} />
          <BatchFormDialog
            courses={courses}
            teachers={teachers}
            maxCapacity={MAX_BATCH_CAPACITY}
            existing={{ id: batch.id, name: batch.name, courseId: batch.courseId, teacherId: batch.teacherId, schedule: batch.schedule, weekly: batch.weekly, meetUrl: batch.meetUrl, capacity: batch.capacity, status: batch.status }}
          />
        </div>
      </div>

      <section aria-labelledby="members" className="flex flex-col gap-4">
        <h2 id="members" className="type-h3">Learners</h2>
        <AddMemberForm batchId={batch.id} candidates={candidates} disabled={batch.status !== "active" || batch.memberCount >= batch.capacity} />
        {members.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">No learners yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
            {members.map((m) => {
              const account = accounts[m.accountId];
              return (
                <li key={m.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <Link href={`/teacher/students/${m.studentId}`} className="font-medium text-brown hover:text-maroon hover:underline">
                      {m.studentName}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {m.status === "active" ? `Joined ${formatDate(m.joinedAt)}` : `${m.status === "transferred" ? "Transferred" : "Removed"} ${formatDate(m.leftAt)}`}
                      {account && (
                        <>
                          {" · "}
                          <Link href={`/teacher/billing/${account.id}`} className="font-semibold text-maroon hover:underline">
                            Billing ({account.billableCount} charged class{account.billableCount === 1 ? "" : "es"})
                          </Link>
                          {" · "}First-class payment: {ADVANCE_STATUS_LABELS[account.advance.status]}
                        </>
                      )}
                    </span>
                    {account && billing[account.id] && m.status === "active" && (
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant={billing[account.id].eligibleForNextClass ? "gold" : "destructive"}>
                          {billing[account.id].eligibleForNextClass ? "Eligible for next class" : "Not eligible for next class"}
                        </Badge>
                        <Badge variant={billing[account.id].state === "paid" ? "secondary" : billing[account.id].state === "pending" ? "outline" : "destructive"}>
                          {ROSTER_STATE_LABELS[billing[account.id].state]}
                        </Badge>
                        {billing[account.id].openInvoices.map((i) => (
                          <span key={i.id} className="text-muted-foreground">
                            {i.label}: {formatMoney(i.balanceMinor)} for {i.classCount} class{i.classCount === 1 ? "" : "es"} · due {formatDateTime(i.dueAt)}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  {m.status === "active" ? (
                    <span className="flex flex-wrap gap-1">
                      <TransferMemberDialog batchId={batch.id} studentId={m.studentId} name={m.studentName} targets={transferTargets} />
                      <RemoveMemberDialog batchId={batch.id} studentId={m.studentId} name={m.studentName} />
                    </span>
                  ) : (
                    <Badge variant="secondary">{m.status === "transferred" ? "Transferred" : "Removed"}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="sessions" className="flex flex-col gap-4">
        <h2 id="sessions" className="type-h3">Classes</h2>
        {sessions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-6 text-sm text-muted-foreground">No classes scheduled for this batch yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sessions.map(({ key, records, first }) => (
              <li key={key} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div>
                  <p className="font-semibold text-brown">{first.title}</p>
                  <p className="text-sm text-muted-foreground">{formatClassTime(first.startAt, first.endAt)}</p>
                </div>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {records.map((c) => (
                    <li key={c.id} className="flex flex-col gap-2 px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-brown">{names.get(c.studentId) ?? "Learner"}</span>
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        <Badge variant={c.status === "completed" ? "maroon" : c.status === "scheduled" ? "gold" : "secondary"}>{outcomeLabel(c)}</Badge>
                        {c.status !== "cancelled" && Date.parse(c.startAt) <= now && <RecordOutcomeDialog classId={c.id} title={`${c.title} — ${names.get(c.studentId) ?? "learner"}`} />}
                        {c.status === "scheduled" && <CancelClassDialog classId={c.id} title={c.title} when={formatClassTime(c.startAt, c.endAt)} shared />}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Attended and absent are charged per student and invoiced at the end of each calendar month (due within 3 days). Each student&apos;s first eligible class is paid by the initial enrolment payment, deducted on its monthly invoice. Academy-cancelled, rescheduled and unknown-attendance classes are not charged. A charged class cannot be changed to a non-billable outcome; use a credit note on the invoice instead.
        </p>
      </section>
    </div>
  );
}

export default function TeacherBatchPage({ params }: PageProps<"/teacher/batches/[batchId]">) {
  return (
    <Suspense fallback={<LoadingState label="Loading batch…" />}>
      <BatchDetail params={params} />
    </Suspense>
  );
}
