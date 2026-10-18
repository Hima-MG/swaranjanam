import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { TestimonialModeration } from "@/components/lms/teacher/testimonial-controls";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { listTestimonialsForTeacher } from "@/lib/lms/server/testimonials";
import { isStatus, NAME_DISPLAY_LABELS, TESTIMONIAL_STATUS_LABELS, type TestimonialStatus } from "@/lib/lms/testimonials";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Testimonials · Teacher" };

const TABS: { key: TestimonialStatus; label: string }[] = [
  { key: "pending", label: "Awaiting review" },
  { key: "approved", label: "Published" },
  { key: "rejected", label: "Rejected" },
  { key: "unpublished", label: "Unpublished" },
  { key: "withdrawn", label: "Withdrawn" },
];

async function Testimonials({ searchParams }: { searchParams: PageProps<"/teacher/testimonials">["searchParams"] }) {
  const teacher = await requireRole("teacher", "/teacher/testimonials");
  const raw = (await searchParams).status;
  const status = typeof raw === "string" && isStatus(raw) ? raw : "pending";
  const { rows, counts } = await listTestimonialsForTeacher(teacher, status);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Testimonial status" className="inline-flex flex-wrap self-start rounded-full border border-border bg-ivory p-1 shadow-soft">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/teacher/testimonials?status=${t.key}`}
            aria-current={status === t.key ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              status === t.key ? "bg-maroon text-cream" : "text-brown hover:bg-cream-deep",
            )}
          >
            {t.label} ({counts[t.key]})
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          No {TESTIMONIAL_STATUS_LABELS[status].toLowerCase()} testimonials.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((t) => (
            <li key={t.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <Link href={`/teacher/students/${t.studentId}`} className="font-semibold text-brown hover:text-maroon hover:underline">
                    {t.studentName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {t.courseTitle ?? "The academy in general"} · submitted {formatDate(t.createdAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Public name: “{t.publicName}” ({NAME_DISPLAY_LABELS[t.nameDisplay].toLowerCase()})
                  </p>
                </div>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={t.consent ? "gold" : "secondary"}>{t.consent ? "Consent to publish given" : "No consent"}</Badge>
                  <TestimonialModeration id={t.id} status={t.status} consent={t.consent} />
                </span>
              </div>
              <blockquote className="border-l-2 border-gold/60 pl-4 text-sm whitespace-pre-line text-brown">{t.text}</blockquote>
              {(t.moderatedAt || t.moderationNote) && (
                <p className="text-xs text-muted-foreground">
                  {t.moderatedAt ? `Last moderated ${formatDateTime(t.moderatedAt)}` : ""}
                  {t.moderationNote ? ` · Note: ${t.moderationNote}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TeacherTestimonialsPage({ searchParams }: PageProps<"/teacher/testimonials">) {
  return (
    <>
      <TeacherPageHeader
        title="Testimonials"
        description="Student testimonials appear on the website only after you approve them, and only with the student's consent."
      />
      <Suspense fallback={<LoadingState label="Loading testimonials…" />}>
        <Testimonials searchParams={searchParams} />
      </Suspense>
    </>
  );
}
