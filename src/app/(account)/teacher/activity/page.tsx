import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { RangeFilter, rangeLabel } from "@/components/lms/teacher/range-filter";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format-date";
import { DATE_RANGES, parseRange } from "@/lib/lms/server/admin";
import { listAudit } from "@/lib/lms/server/audit";

export const metadata: Metadata = { title: "Activity log · Teacher" };

type SearchParams = PageProps<"/teacher/activity">["searchParams"];

const AREA_LABELS: Record<string, string> = {
  course: "Course",
  enrollment: "Enrollment",
  student: "Student",
  payment: "Payment",
  review: "Review",
  submission: "Submission",
  announcement: "Announcement",
  settings: "Settings",
};

async function ActivityLog({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("teacher", "/teacher/activity");
  const params = await searchParams;
  const range = parseRange(params.range);
  const area = typeof params.area === "string" && params.area in AREA_LABELS ? params.area : null;
  const days = DATE_RANGES[range];
  const entries = await listAudit({ limit: 300, sinceDays: days });
  const rows = area ? entries.filter((e) => e.targetType === area) : entries;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Filter by area" className="flex flex-wrap gap-1">
          <Link
            href={`/teacher/activity?range=${range}`}
            aria-current={area === null ? "true" : undefined}
            className={area === null ? "rounded-full bg-maroon px-3 py-1.5 text-xs font-semibold text-cream" : "rounded-full px-3 py-1.5 text-xs font-semibold text-brown hover:bg-cream-deep"}
          >
            All
          </Link>
          {Object.entries(AREA_LABELS).map(([key, label]) => (
            <Link
              key={key}
              href={`/teacher/activity?range=${range}&area=${key}`}
              aria-current={area === key ? "true" : undefined}
              className={area === key ? "rounded-full bg-maroon px-3 py-1.5 text-xs font-semibold text-cream" : "rounded-full px-3 py-1.5 text-xs font-semibold text-brown hover:bg-cream-deep"}
            >
              {label}
            </Link>
          ))}
        </nav>
        <RangeFilter value={range} basePath="/teacher/activity" />
      </div>
      <p className="text-sm text-muted-foreground">
        {rows.length} recorded action{rows.length === 1 ? "" : "s"} in {rangeLabel(range)} (newest 300 shown).
      </p>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">No recorded actions in this period.</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
          {rows.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 text-brown">
                <Badge variant="outline" className="mr-2 align-middle">{AREA_LABELS[e.targetType] ?? e.targetType}</Badge>
                {e.summary}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {e.actorEmail ?? "Teacher"} · {formatDateTime(e.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TeacherActivityPage({ searchParams }: PageProps<"/teacher/activity">) {
  return (
    <>
      <TeacherPageHeader title="Activity log" description="Who did what: enrollments, payments, publishing, moderation and other sensitive actions." />
      <Suspense fallback={<LoadingState label="Loading activity…" />}>
        <ActivityLog searchParams={searchParams} />
      </Suspense>
    </>
  );
}
