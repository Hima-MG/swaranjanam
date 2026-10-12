import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SubmissionMedia, SubmissionStatusBadge } from "@/components/lms/submission-media";
import { SubmissionFeedbackForm } from "@/components/lms/teacher/feedback-controls";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format-date";
import { getSubmissionForTeacher } from "@/lib/lms/server/feedback";
import { SUBMISSION_STATUS_LABELS } from "@/lib/lms/types";

export const metadata: Metadata = { title: "Submission · Teacher" };

type Params = PageProps<"/teacher/submissions/[submissionId]">["params"];

async function SubmissionDetail({ params }: { params: Params }) {
  const { submissionId } = await params;
  const teacher = await requireRole("teacher", `/teacher/submissions/${submissionId}`);
  const data = await getSubmissionForTeacher(teacher, submissionId);
  if (!data) notFound();
  const { submission, studentName, studentEmail, courseTitle, lessonTitle } = data;
  const attempts = [...submission.attempts].reverse();

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <Link href="/teacher/submissions" className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-maroon">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All submissions
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="type-h2 break-words">{submission.title}</h1>
        <p className="text-sm text-muted-foreground">
          <Link href={`/teacher/students/${submission.studentId}`} className="font-medium text-brown hover:text-maroon hover:underline">
            {studentName}
          </Link>
          {studentEmail ? ` (${studentEmail})` : ""} · {courseTitle}
          {lessonTitle ? ` · ${lessonTitle}` : ""}
        </p>
        <div>
          <SubmissionStatusBadge status={submission.status} />
        </div>
      </div>

      <section aria-labelledby="attempts" className="flex flex-col gap-4">
        <h2 id="attempts" className="type-h3">Recordings ({attempts.length})</h2>
        <ol className="flex flex-col gap-4">
          {attempts.map((a, i) => (
            <li key={a.number} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              {i === 0 && <p className="mb-2 text-xs font-semibold tracking-wide text-gold uppercase">Latest</p>}
              <SubmissionMedia attempt={a} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="give-feedback" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 id="give-feedback" className="type-h3">Your feedback on attempt {submission.attempts.length}</h2>
        <SubmissionFeedbackForm submissionId={submission.id} />
      </section>

      {submission.feedback.length > 0 && (
        <section aria-labelledby="history" className="flex flex-col gap-3">
          <h2 id="history" className="type-h3">Feedback history</h2>
          <ol className="flex flex-col gap-3">
            {[...submission.feedback].reverse().map((f, i) => (
              <li key={i} className="rounded-xl border border-gold/30 bg-gold-soft/40 p-4 text-sm">
                <p className="whitespace-pre-line text-brown">{f.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {SUBMISSION_STATUS_LABELS[f.status]} · attempt {f.attempt} · {f.byEmail ?? "Teacher"} · {formatDateTime(f.at)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export default function TeacherSubmissionPage({ params }: PageProps<"/teacher/submissions/[submissionId]">) {
  return (
    <Suspense fallback={<LoadingState label="Loading submission…" />}>
      <SubmissionDetail params={params} />
    </Suspense>
  );
}
