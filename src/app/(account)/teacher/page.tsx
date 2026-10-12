import { Activity, AlertCircle, BookOpen, CalendarClock, Clock, GraduationCap, IndianRupee, Mic, Percent, Star, UserCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { RangeFilter, rangeLabel } from "@/components/lms/teacher/range-filter";
import { StatCard } from "@/components/lms/teacher/stat-card";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { PaymentStatusBadge } from "@/components/lms/teacher/payment-status-badge";
import { formatMoney } from "@/lib/format";
import { ACTIVE_WINDOW_DAYS, getOverview, parseRange } from "@/lib/lms/server/admin";
import { getPaymentSummary } from "@/lib/lms/server/payments";
import { getFeedbackSummary } from "@/lib/lms/server/feedback";
import { getTeacherNotifications } from "@/lib/lms/server/notifications";
import { getClassSummary } from "@/lib/lms/server/classes";
import { listAudit } from "@/lib/lms/server/audit";

export const metadata: Metadata = { title: "Overview · Teacher" };

type SearchParams = PageProps<"/teacher">["searchParams"];

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-h3">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const teacher = await requireRole("teacher", "/teacher");
  const range = parseRange((await searchParams).range);
  const [data, activity, money, feedback, notifications, classes] = await Promise.all([
    getOverview(teacher, range),
    listAudit({ limit: 8 }),
    getPaymentSummary(teacher, range),
    getFeedbackSummary(teacher),
    getTeacherNotifications(teacher),
    getClassSummary(teacher),
  ]);
  const { students, courses, enrollments } = data;

  return (
    <div className="flex flex-col gap-8">
      {notifications.unreadCount > 0 && (
        <Link
          href="/teacher/notifications"
          className="flex items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold-soft/50 px-5 py-3 text-sm text-brown outline-none hover:bg-gold-soft focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span>
            <strong className="font-semibold">{notifications.unreadCount}</strong> unread notification
            {notifications.unreadCount === 1 ? "" : "s"}
          </span>
          <span className="font-semibold text-maroon">View</span>
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          “New” figures cover {rangeLabel(range)}. Learner activity uses the last {ACTIVE_WINDOW_DAYS} days.
        </p>
        <RangeFilter value={range} basePath="/teacher" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students"
          value={students.total}
          detail={`${students.newInRange} new · ${students.notEnrolled} not enrolled in any course`}
          icon={Users}
          href="/teacher/students"
        />
        <StatCard
          label="Active learners"
          value={students.active}
          detail={`${students.inactive} inactive · ${students.never} never signed in or studied`}
          icon={UserCheck}
          href="/teacher/students?activity=active"
        />
        <StatCard
          label="Enrollments"
          value={enrollments.active}
          detail={`${enrollments.newInRange} new · ${enrollments.revoked} revoked`}
          icon={GraduationCap}
        />
        <StatCard
          label="Average completion"
          value={data.averageCompletion === null ? "—" : `${data.averageCompletion}%`}
          detail={
            data.completionSample === 0
              ? "No active enrollments in courses with lessons yet"
              : `Across ${data.completionSample} active enrollment${data.completionSample === 1 ? "" : "s"}`
          }
          icon={Percent}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Received (verified)"
          value={formatMoney(money.receivedMinor)}
          detail={`${money.receivedCount} payment${money.receivedCount === 1 ? "" : "s"} in ${rangeLabel(range)}`}
          icon={IndianRupee}
          href="/teacher/payments?status=paid"
        />
        <StatCard
          label="Pending payments"
          value={money.pendingCount}
          detail={money.pendingCount ? `${formatMoney(money.pendingMinor)} awaiting confirmation` : "Nothing awaiting confirmation"}
          icon={Clock}
          href="/teacher/payments?status=pending"
        />
        <StatCard
          label="Outstanding balances"
          value={formatMoney(money.outstandingMinor)}
          detail={`${money.outstandingCount} enrollment${money.outstandingCount === 1 ? "" : "s"} with unpaid agreed fees`}
          icon={AlertCircle}
          href="/teacher/payments"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Live classes today (IST)"
          value={classes.today}
          detail={`${classes.upcoming} scheduled ahead${classes.needsOutcome ? ` · ${classes.needsOutcome} need an outcome recorded` : ""}`}
          icon={CalendarClock}
          href="/teacher/classes"
        />
        <StatCard
          label="Practice submissions to review"
          value={feedback.pendingSubmissions}
          detail={
            feedback.oldestPendingAt
              ? `Oldest waiting since ${formatDateTime(feedback.oldestPendingAt)}`
              : "Nothing waiting for review"
          }
          icon={Mic}
          href="/teacher/submissions"
        />
        <StatCard
          label="Reviews awaiting approval"
          value={feedback.pendingReviews}
          detail="Course reviews from enrolled students"
          icon={Star}
          href="/teacher/reviews"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Published courses" value={courses.published} icon={BookOpen} href="/teacher/courses" />
        <StatCard label="Draft courses" value={courses.draft} icon={BookOpen} href="/teacher/courses" />
        <StatCard label="Archived courses" value={courses.archived} icon={BookOpen} href="/teacher/courses" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Recent enrollments">
          {data.recentEnrollments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No enrollments yet. Enroll a registered student from their profile or from a course’s Students page.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.recentEnrollments.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span className="min-w-0">
                    <Link href={`/teacher/students/${e.studentId}`} className="font-medium text-brown hover:text-maroon">
                      {e.studentName}
                    </Link>
                    <span className="text-muted-foreground"> · {e.courseTitle}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {e.status === "revoked" && <Badge variant="outline">Revoked</Badge>}
                    {formatDate(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent payments">
          {money.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {money.recent.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span className="min-w-0">
                    <Link href={`/teacher/students/${p.studentId}`} className="font-medium text-brown hover:text-maroon">
                      {p.studentName}
                    </Link>
                    <span className="text-muted-foreground"> · {p.courseTitle}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-brown">{formatMoney(p.amountMinor, p.currency)}</span>
                    <PaymentStatusBadge status={p.status} verified={p.verified} />
                    {formatDate(p.paidAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity" action={<Link href="/teacher/activity" className="text-xs font-semibold text-maroon hover:underline">Full log</Link>}>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recorded activity yet. Enrollments, publishing and other management actions appear here.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 py-3 text-sm">
                  <span className="text-brown">{a.summary}</span>
                  <span className="text-xs text-muted-foreground">
                    <Activity className="mr-1 inline size-3" aria-hidden="true" />
                    {a.actorEmail ?? "Teacher"} · {formatDateTime(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export default function TeacherOverviewPage({ searchParams }: PageProps<"/teacher">) {
  return (
    <>
      <TeacherPageHeader title="Overview" description="Live figures from the academy’s records." />
      <Suspense fallback={<LoadingState label="Loading overview…" />}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </>
  );
}
