import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EnrolmentRequestActions } from "@/components/lms/teacher/enrolment-request-controls";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format-date";
import { ENROLMENT_MODE_LABELS, ENROLMENT_REQUEST_STATUS_LABELS, listEnrolmentRequests } from "@/lib/lms/server/enrolment";

export const metadata: Metadata = { title: "Enrolment requests · Teacher" };

async function Requests() {
  await requireRole("teacher", "/teacher/enrolment-requests");
  const requests = await listEnrolmentRequests();
  if (requests.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
        No enrolment requests yet. Students send them from “Enrol now” on an open course.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {requests.map((r) => (
        <li key={r.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-sm shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/teacher/students/${r.studentId}`} className="font-semibold text-brown hover:text-maroon hover:underline">
              {r.studentName}
              {r.studentEmail ? ` · ${r.studentEmail}` : ""}
            </Link>
            <Badge variant={r.status === "pending" ? "gold" : r.status === "declined" ? "destructive" : "secondary"}>{ENROLMENT_REQUEST_STATUS_LABELS[r.status]}</Badge>
          </div>
          <p className="text-brown">
            {r.courseTitle} · {ENROLMENT_MODE_LABELS[r.mode]}
            {r.createdAt ? ` · ${formatDateTime(r.createdAt)}` : ""}
          </p>
          {r.note && <p className="rounded-xl bg-cream-deep/60 p-3 text-muted-foreground">“{r.note}”</p>}
          {r.resolvedNote && <p className="text-muted-foreground">Note: {r.resolvedNote}</p>}
          {r.status === "pending" && (
            <>
              <p className="text-xs text-muted-foreground">
                On the student&apos;s profile: verify old dues and enrol them in the course; then {r.mode === "batch" ? "add them to a batch (this opens the enrolment advance, which they pay online)" : "open an individual billing account and schedule sessions (each is paid separately)"}. Then mark the request handled.
              </p>
              <EnrolmentRequestActions requestId={r.id} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function EnrolmentRequestsPage() {
  return (
    <>
      <TeacherPageHeader
        title="Enrolment requests"
        description="Requests sent from the website. Nothing is charged until you place the student; billing uses the existing batch and individual tools."
      />
      <Suspense fallback={<LoadingState label="Loading requests…" />}>
        <Requests />
      </Suspense>
    </>
  );
}
