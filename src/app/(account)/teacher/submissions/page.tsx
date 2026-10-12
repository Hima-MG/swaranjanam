import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SubmissionStatusBadge } from "@/components/lms/submission-media";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format-date";
import { listSubmissions, parseSubmissionFilters } from "@/lib/lms/server/feedback";

export const metadata: Metadata = { title: "Submissions · Teacher" };

type SearchParams = PageProps<"/teacher/submissions">["searchParams"];

async function SubmissionQueue({ searchParams }: { searchParams: SearchParams }) {
  const teacher = await requireRole("teacher", "/teacher/submissions");
  const filters = parseSubmissionFilters(await searchParams);
  const { rows, counts, courses } = await listSubmissions(teacher, filters);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {counts.pending_review} waiting for review · {counts.needs_revision} waiting for the student to revise · {counts.reviewed} reviewed
      </p>

      <form method="get" className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft md:grid-cols-[1fr_1.4fr_1.6fr_auto] md:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor="status" className="text-sm font-medium text-brown">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={filters.status}>
            <option value="pending_review">Pending review</option>
            <option value="needs_revision">Needs revision</option>
            <option value="reviewed">Reviewed</option>
            <option value="any">All</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="course" className="text-sm font-medium text-brown">Course</Label>
          <NativeSelect id="course" name="course" defaultValue={filters.course ?? ""}>
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="q" className="text-sm font-medium text-brown">Student, title or lesson</Label>
          <Input id="q" name="q" type="search" defaultValue={filters.q} maxLength={100} />
        </div>
        <Button type="submit">Apply</Button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          {filters.status === "pending_review" ? "Nothing waiting for review. Well done!" : "No submissions match these filters."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                href={`/teacher/submissions/${s.id}`}
                className="flex flex-col gap-1 px-5 py-4 transition-colors outline-none hover:bg-cream-deep/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-brown">{s.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {s.studentName} · {s.courseTitle}
                    {s.lessonTitle ? ` · ${s.lessonTitle}` : ""}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {s.attempts.length > 1 && <span>Attempt {s.attempts.length}</span>}
                  <SubmissionStatusBadge status={s.status} />
                  {formatDateTime(s.lastSubmittedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TeacherSubmissionsPage({ searchParams }: PageProps<"/teacher/submissions">) {
  return (
    <>
      <TeacherPageHeader title="Practice submissions" description="Students’ practice recordings. Oldest waiting first." />
      <Suspense fallback={<LoadingState label="Loading submissions…" />}>
        <SubmissionQueue searchParams={searchParams} />
      </Suspense>
    </>
  );
}
