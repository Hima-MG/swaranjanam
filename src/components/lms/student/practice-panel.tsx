"use client";

import { Mic, Upload } from "lucide-react";
import { useState } from "react";

import { createPracticeUpload, resubmitPractice, submitPractice } from "@/app/(account)/dashboard/practice-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { SubmissionMedia, SubmissionStatusBadge } from "@/components/lms/submission-media";
import { UploadProgress } from "@/components/lms/teacher/upload-progress";
import { useMediaUpload } from "@/components/lms/teacher/use-media-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format-date";
import { UPLOAD_RULES } from "@/lib/media/config";
import type { SubmissionRecord } from "@/lib/lms/types";

/** Upload form for a new submission (submissionId absent) or a resubmission. */
function PracticeUploadForm({
  courseId,
  lessonId,
  defaultTitle,
  submissionId,
  onDone,
}: {
  courseId: string;
  lessonId: string;
  defaultTitle: string;
  submissionId?: string;
  onDone?: () => void;
}) {
  const [kind, setKind] = useState<"audio" | "video">("audio");
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { upload, cancel, busy, phase, progress, status, error } = useMediaUpload();
  const rule = UPLOAD_RULES[kind];
  const id = submissionId ?? "new";

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setDone(false);
        const form = event.currentTarget;
        const data = new FormData(form);
        const file = data.get("file");
        const title = String(data.get("title") ?? "").trim();
        if (!(file instanceof File) || file.size === 0) {
          setFormError("Choose a recording to upload.");
          return;
        }
        if (!submissionId && !title) {
          setFormError("Give your recording a title.");
          return;
        }
        setFormError(null);
        const fields = { kind, title, note: data.get("note"), fileName: file.name };
        void upload({
          file,
          kind,
          getTicket: () => createPracticeUpload(courseId, kind),
          save: (receipt) =>
            submissionId
              ? resubmitPractice(submissionId, { ...fields, receipt })
              : submitPractice(courseId, lessonId, { ...fields, receipt }),
          onSuccess: () => {
            form.reset();
            setDone(true);
            onDone?.();
          },
        });
      }}
    >
      <fieldset disabled={busy} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`kind-${id}`} className="text-sm font-medium text-brown">Type</Label>
            <NativeSelect id={`kind-${id}`} value={kind} onChange={(e) => setKind(e.target.value as "audio" | "video")}>
              <option value="audio">Audio</option>
              <option value="video">Video</option>
            </NativeSelect>
          </div>
          {!submissionId && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`title-${id}`} className="text-sm font-medium text-brown">Title</Label>
              <Input id={`title-${id}`} name="title" defaultValue={defaultTitle} maxLength={150} required />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`file-${id}`} className="text-sm font-medium text-brown">Recording</Label>
          <Input id={`file-${id}`} name="file" type="file" accept={rule.accept.join(",")} className="h-auto py-2.5" required />
          <p className="text-xs text-muted-foreground">{rule.label}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`note-${id}`} className="text-sm font-medium text-brown">Message to your teacher (optional)</Label>
          <Textarea id={`note-${id}`} name="note" maxLength={1000} rows={2} className="min-h-16" />
        </div>
      </fieldset>
      {busy && status && <UploadProgress status={status} progress={progress} phase={phase} />}
      {(formError || error) && <FormAlert tone="error">{formError ?? error}</FormAlert>}
      {done && !busy && <FormAlert tone="success">Uploaded. Your teacher will review it and leave feedback here.</FormAlert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner className="size-4 text-cream" /> : <Upload data-icon="inline-start" />}
          {submissionId ? "Upload new attempt" : "Submit recording"}
        </Button>
        {phase === "uploading" && (
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel upload
          </Button>
        )}
      </div>
    </form>
  );
}

function SubmissionCard({ submission, courseId, lessonId }: { submission: SubmissionRecord; courseId: string; lessonId: string }) {
  const [resubmitting, setResubmitting] = useState(false);
  const latest = submission.attempts.at(-1);
  const earlier = submission.attempts.slice(0, -1);
  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-brown">{submission.title}</h4>
        <SubmissionStatusBadge status={submission.status} />
      </div>
      {latest && <SubmissionMedia attempt={latest} />}
      {submission.feedback.length > 0 && (
        <div className="flex flex-col gap-2">
          <h5 className="text-xs font-semibold tracking-wide text-brown-muted uppercase">Teacher feedback</h5>
          <ol className="flex flex-col gap-2">
            {[...submission.feedback].reverse().map((f, i) => (
              <li key={i} className="rounded-xl border border-gold/30 bg-gold-soft/40 p-3 text-sm">
                <p className="whitespace-pre-line text-brown">{f.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {f.byName ?? "Teacher"} · attempt {f.attempt} · {formatDateTime(f.at)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {earlier.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-maroon">Earlier attempts ({earlier.length})</summary>
          <ul className="mt-3 flex flex-col gap-4">
            {earlier.reverse().map((a) => (
              <li key={a.number}>
                <SubmissionMedia attempt={a} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {submission.status !== "pending_review" &&
        (resubmitting ? (
          <div className="rounded-xl border border-border p-4">
            <PracticeUploadForm
              courseId={courseId}
              lessonId={lessonId}
              defaultTitle={submission.title}
              submissionId={submission.id}
              onDone={() => setResubmitting(false)}
            />
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setResubmitting(true)}>
            Upload a new attempt
          </Button>
        ))}
    </li>
  );
}

/** "Practice" section under a lesson: the student's own recordings and feedback. */
export function PracticePanel({
  courseId,
  lessonId,
  lessonTitle,
  submissions,
}: {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  submissions: SubmissionRecord[];
}) {
  return (
    <section aria-labelledby="practice" className="flex flex-col gap-4">
      <h2 id="practice" className="type-h3 flex items-center gap-2">
        <Mic className="size-5 text-gold" aria-hidden="true" />
        Practice
      </h2>
      <p className="text-sm text-muted-foreground">
        Record yourself practising this lesson and upload it for your teacher’s feedback. Only you and your teachers can see
        your recordings here.
      </p>
      {submissions.length > 0 && (
        <ul className="flex flex-col gap-4">
          {submissions.map((s) => (
            <SubmissionCard key={s.id} submission={s} courseId={courseId} lessonId={lessonId} />
          ))}
        </ul>
      )}
      <div className="rounded-2xl border border-dashed border-border bg-cream-deep/40 p-5">
        <h3 className="mb-4 font-semibold text-brown">New recording</h3>
        <PracticeUploadForm courseId={courseId} lessonId={lessonId} defaultTitle={lessonTitle} />
      </div>
    </section>
  );
}
