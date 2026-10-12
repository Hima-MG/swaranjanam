import { MessageSquare, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ReviewModeration } from "@/components/lms/teacher/feedback-controls";
import { StatCard } from "@/components/lms/teacher/stat-card";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { requireRole } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { listReviews } from "@/lib/lms/server/feedback";
import { REVIEW_STATUSES, type ReviewStatus } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

export const metadata: Metadata = { title: "Reviews · Teacher" };

type SearchParams = PageProps<"/teacher/reviews">["searchParams"];

const STATUS_BADGE = {
  pending: { label: "Awaiting approval", variant: "outline" },
  approved: { label: "Approved", variant: "gold" },
  hidden: { label: "Hidden", variant: "secondary" },
} as const;

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden="true" className={n <= rating ? "size-4 fill-gold text-gold" : "size-4 text-brown-muted/40"} />
      ))}
    </span>
  );
}

async function Reviews({ searchParams }: { searchParams: SearchParams }) {
  const teacher = await requireRole("teacher", "/teacher/reviews");
  const params = await searchParams;
  const statusParam = typeof params.status === "string" ? params.status : "pending";
  const status: ReviewStatus | "any" = statusParam === "any" ? "any" : (REVIEW_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as ReviewStatus) : "pending";
  const course = typeof params.course === "string" && isValidId(params.course) ? params.course : null;
  const { rows, counts, ratings, courses } = await listReviews(teacher, { status, course });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Average rating (approved)"
          value={ratings.averageApproved === null ? "—" : ratings.averageApproved.toFixed(1)}
          detail={`From ${ratings.countApproved} approved review${ratings.countApproved === 1 ? "" : "s"}`}
          icon={Star}
        />
        <StatCard
          label="Average rating (all submitted)"
          value={ratings.averageAll === null ? "—" : ratings.averageAll.toFixed(1)}
          detail={`From ${ratings.countAll} review${ratings.countAll === 1 ? "" : "s"}, including hidden and pending`}
          icon={Star}
        />
        <StatCard label="Awaiting approval" value={counts.pending} detail={`${counts.hidden} hidden`} icon={MessageSquare} />
      </div>

      <form method="get" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor="status" className="text-sm font-medium text-brown">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={status}>
            <option value="pending">Awaiting approval</option>
            <option value="approved">Approved</option>
            <option value="hidden">Hidden</option>
            <option value="any">All</option>
          </NativeSelect>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="course" className="text-sm font-medium text-brown">Course</Label>
          <NativeSelect id="course" name="course" defaultValue={course ?? ""}>
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit">Apply</Button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          {counts.pending + counts.approved + counts.hidden === 0
            ? "No reviews yet. Enrolled students can review a course from their course page."
            : "No reviews match these filters."}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((r) => {
            const badge = STATUS_BADGE[r.status];
            return (
              <li key={r.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <Stars rating={r.rating} />
                    <span className="text-sm text-muted-foreground">
                      <Link href={`/teacher/students/${r.studentId}`} className="font-medium text-brown hover:text-maroon hover:underline">
                        {r.studentName}
                      </Link>
                      {" "}· {r.courseTitle} · {formatDate(r.updatedAt)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <ReviewModeration reviewId={r.id} status={r.status} />
                  </div>
                </div>
                <p className="whitespace-pre-line text-brown">{r.comment}</p>
                {r.moderatedAt && (
                  <p className="text-xs text-muted-foreground">
                    {r.status === "approved" ? "Approved" : r.status === "hidden" ? "Hidden" : "Moderated"} by {r.moderatedByEmail ?? "a teacher"} ·{" "}
                    {formatDateTime(r.moderatedAt)}
                    {r.moderationNote ? ` · ${r.moderationNote}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function TeacherReviewsPage({ searchParams }: PageProps<"/teacher/reviews">) {
  return (
    <>
      <TeacherPageHeader title="Reviews" description="Course reviews submitted by enrolled students. Only approved reviews should be shown publicly." />
      <Suspense fallback={<LoadingState label="Loading reviews…" />}>
        <Reviews searchParams={searchParams} />
      </Suspense>
    </>
  );
}
