import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format-date";
import { SUBMISSION_STATUS_LABELS, type SubmissionAttempt, type SubmissionStatus } from "@/lib/lms/types";

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const variant = status === "reviewed" ? "gold" : status === "needs_revision" ? "maroon" : "outline";
  return <Badge variant={variant}>{SUBMISSION_STATUS_LABELS[status]}</Badge>;
}

/** Player for one practice attempt (audio or video). */
export function SubmissionMedia({ attempt }: { attempt: SubmissionAttempt }) {
  return (
    <div className="flex flex-col gap-2">
      {attempt.kind === "video" ? (
        <video controls preload="metadata" playsInline className="aspect-video w-full rounded-xl bg-brown" src={attempt.url}>
          Your browser cannot play this video.
        </video>
      ) : (
        <audio controls preload="metadata" className="w-full" src={attempt.url}>
          Your browser cannot play this audio.
        </audio>
      )}
      <p className="text-xs text-muted-foreground">
        Attempt {attempt.number} · {formatDateTime(attempt.submittedAt)}
        {attempt.fileName ? ` · ${attempt.fileName}` : ""}
      </p>
      {attempt.note && <p className="text-sm whitespace-pre-line text-brown">“{attempt.note}”</p>}
    </div>
  );
}
