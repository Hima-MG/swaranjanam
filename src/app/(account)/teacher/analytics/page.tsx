import { CheckCircle2, Download, GraduationCap, Star, UserX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BarList, ColumnChart } from "@/components/lms/teacher/charts";
import { CourseStatusBadge } from "@/components/lms/teacher/course-status-badge";
import { RangeFilter, rangeLabel } from "@/components/lms/teacher/range-filter";
import { StatCard } from "@/components/lms/teacher/stat-card";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatDate } from "@/lib/format-date";
import { ACTIVE_WINDOW_DAYS, getAnalytics, parseRange } from "@/lib/lms/server/admin";

export const metadata: Metadata = { title: "Analytics · Teacher" };

type SearchParams = PageProps<"/teacher/analytics">["searchParams"];

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div>
        <h2 className="type-h3">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

async function Analytics({ searchParams }: { searchParams: SearchParams }) {
  const teacher = await requireRole("teacher", "/teacher/analytics");
  const range = parseRange((await searchParams).range);
  const data = await getAnalytics(teacher, range);
  const withEnrollments = data.courses.filter((c) => c.enrollmentsTotal > 0);
  const withCompletion = data.courses.filter((c) => c.averageCompletion !== null);
  const totalActive = data.courses.reduce((a, c) => a + c.enrollmentsActive, 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">“New” and completion figures cover {rangeLabel(range)}.</p>
        <div className="flex flex-wrap items-center gap-2">
          <RangeFilter value={range} basePath="/teacher/analytics" />
          <Button asChild variant="outline" size="sm">
            <a href={`/api/teacher/analytics/export?range=${range}`} download>
              <Download data-icon="inline-start" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active enrollments" value={totalActive} detail={`Across ${withEnrollments.length} course${withEnrollments.length === 1 ? "" : "s"}`} icon={GraduationCap} />
        <StatCard label="Lessons completed" value={data.totals.lessonCompletionsInRange} detail={`In ${rangeLabel(range)}`} icon={CheckCircle2} />
        <StatCard label="Inactive learners" value={data.inactive.length} detail={`Enrolled, no activity in ${ACTIVE_WINDOW_DAYS} days`} icon={UserX} />
        <StatCard
          label="Average review"
          value={data.totals.approvedReviewAverage === null ? "—" : data.totals.approvedReviewAverage.toFixed(1)}
          detail={`From ${data.totals.approvedReviewCount} approved review${data.totals.approvedReviewCount === 1 ? "" : "s"}`}
          icon={Star}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Active enrollments by course" description="Course popularity from real enrollments.">
          <BarList
            data={withEnrollments
              .filter((c) => c.enrollmentsActive > 0)
              .map((c) => ({ label: c.title, value: c.enrollmentsActive, display: `${c.enrollmentsActive} student${c.enrollmentsActive === 1 ? "" : "s"}` }))}
            emptyText="No active enrollments yet."
          />
        </Panel>
        <Panel title="Average completion by course" description="Mean of each active student’s completed lessons ÷ course lessons.">
          <BarList
            data={withCompletion.map((c) => ({ label: c.title, value: c.averageCompletion ?? 0, display: `${c.averageCompletion}%` }))}
            max={100}
            emptyText="No completion data yet — it appears once enrolled students finish lessons."
          />
        </Panel>
      </div>

      <Panel title="Lesson completions per week" description={`Weeks start on Monday (India time). Up to 26 weeks; ${rangeLabel(range)}.`}>
        <ColumnChart
          data={data.trend.map((p) => ({ label: formatDate(p.weekStart), value: p.completions }))}
          valueLabel="lessons completed"
          emptyText="No lessons were completed in this period."
        />
      </Panel>

      <section aria-labelledby="by-course" className="flex flex-col gap-3">
        <h2 id="by-course" className="type-h3">Course report</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">Per-course report</caption>
              <thead className="bg-cream-deep/60 text-xs tracking-wide text-brown-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Course</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Lessons</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Active</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">New</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Avg. completion</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Finished</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Completions</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Reviews</th>
                </tr>
              </thead>
              <tbody>
                {data.courses.map((c) => (
                  <tr key={c.courseId} className="border-t border-border">
                    <td className="px-4 py-3">
                      <Link href={`/teacher/courses/${c.courseId}`} className="font-medium text-brown hover:text-maroon hover:underline">
                        {c.title}
                      </Link>
                      <span className="ml-2 align-middle"><CourseStatusBadge status={c.status} /></span>
                    </td>
                    <td className="px-4 py-3 text-right">{c.lessons}</td>
                    <td className="px-4 py-3 text-right">{c.enrollmentsActive}</td>
                    <td className="px-4 py-3 text-right">{c.enrollmentsNew}</td>
                    <td className="px-4 py-3 text-right">{c.averageCompletion === null ? "—" : `${c.averageCompletion}%`}</td>
                    <td className="px-4 py-3 text-right">{c.completedStudents}</td>
                    <td className="px-4 py-3 text-right">{c.lessonCompletionsInRange}</td>
                    <td className="px-4 py-3 text-right">{c.reviewAverage === null ? "—" : `${c.reviewAverage.toFixed(1)} (${c.reviewCount})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Finished = active students who completed every lesson. Reviews exclude hidden reviews. “New” and Completions use the selected range.
        </p>
      </section>

      <Panel title="Inactive learners" description={`Students with active access but no sign-in or lesson activity in the last ${ACTIVE_WINDOW_DAYS} days.`}>
        {data.inactive.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every enrolled student has been active recently.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.inactive.map((s) => (
              <li key={s.uid} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <Link href={`/teacher/students/${s.uid}`} className="font-medium text-brown hover:text-maroon hover:underline">
                  {s.name}
                </Link>
                <span className="text-xs text-muted-foreground">Last active: {formatDate(s.lastActivity, "never")}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function TeacherAnalyticsPage({ searchParams }: PageProps<"/teacher/analytics">) {
  return (
    <>
      <TeacherPageHeader title="Analytics" description="Learning reports computed from enrollments, lesson progress and reviews." />
      <Suspense fallback={<LoadingState label="Loading analytics…" />}>
        <Analytics searchParams={searchParams} />
      </Suspense>
    </>
  );
}
