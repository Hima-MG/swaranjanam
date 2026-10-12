import "server-only";

import type { SessionUser } from "@/lib/auth/session";
import { col, toIso } from "@/lib/lms/server/db";
import { mapSubmission } from "@/lib/lms/server/feedback";
import type { SubmissionRecord } from "@/lib/lms/types";

// Teacher notifications, derived from real records rather than a separate
// store that could drift: enrollments and payment changes (audit log, made
// by OTHER teachers) and student practice submissions waiting for review.

export type NotificationKind = "enrollment" | "payment" | "submission";

export interface TeacherNotification {
  id: string;
  kind: NotificationKind;
  text: string;
  href: string;
  at: string | null;
  unread: boolean;
}

const WINDOW_DAYS = 60;
const ACTIONS: Record<string, NotificationKind> = {
  "enrollment.create": "enrollment",
  "enrollment.restore": "enrollment",
  "payment.create": "payment",
  "payment.status": "payment",
};

export async function getTeacherNotifications(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [profile, audit, pending] = await Promise.all([
    col("users").doc(user.uid).get(),
    col("auditLogs").where("at", ">=", since).orderBy("at", "desc").limit(200).get(),
    col("submissions").where("status", "==", "pending_review").get(),
  ]);
  const seenAt = toIso(profile.get("notificationsSeenAt"));

  const fromAudit: TeacherNotification[] = audit.docs
    .filter((d) => d.get("action") in ACTIONS && d.get("actorId") !== user.uid)
    .map((d) => {
      const kind = ACTIONS[d.get("action") as string];
      const at = toIso(d.get("at"));
      return {
        id: `audit-${d.id}`,
        kind,
        text: `${String(d.get("summary") ?? "")}${d.get("actorEmail") ? ` — ${d.get("actorEmail")}` : ""}`,
        href: kind === "payment" ? "/teacher/payments" : "/teacher/students",
        at,
        unread: !seenAt || (at !== null && at > seenAt),
      };
    });

  const fromSubmissions: TeacherNotification[] = pending.docs
    .map(mapSubmission)
    .filter((s): s is SubmissionRecord => s !== null)
    .map((s) => ({
      id: `submission-${s.id}`,
      kind: "submission" as const,
      text: `Practice recording waiting for review: “${s.title}”${s.attempts.length > 1 ? ` (attempt ${s.attempts.length})` : ""}`,
      href: `/teacher/submissions/${s.id}`,
      at: s.lastSubmittedAt,
      unread: !seenAt || (s.lastSubmittedAt !== null && s.lastSubmittedAt > seenAt),
    }));

  const items = [...fromAudit, ...fromSubmissions].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 100);
  return { items, unreadCount: items.filter((i) => i.unread).length, seenAt };
}
