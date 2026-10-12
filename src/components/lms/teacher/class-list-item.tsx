import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { CancelClassDialog, ClassFormDialog, RecordOutcomeDialog } from "@/components/lms/teacher/class-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLASS_STATUS_LABELS, formatClassTime } from "@/lib/lms/classes";
import type { TeacherClassRow } from "@/lib/lms/server/classes";

const ATTENDANCE_LABELS = { attended: "Attended", absent: "Absent", unknown: "Attendance not recorded" } as const;

/** One class in the teacher's Classes list, with its actions. */
export function ClassListItem({ item: c, students }: { item: TeacherClassRow; students: { uid: string; label: string }[] }) {
  const when = formatClassTime(c.startAt, c.endAt);
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-brown">{c.title}</h2>
          <Badge variant={c.status === "scheduled" ? "gold" : c.status === "completed" ? "maroon" : "secondary"}>
            {CLASS_STATUS_LABELS[c.status]}
          </Badge>
          {c.needsOutcome && <Badge variant="outline">Ended — outcome not recorded</Badge>}
        </div>
        <p className="text-sm text-brown">{when}</p>
        <p className="text-sm text-muted-foreground">
          <Link href={`/teacher/students/${c.studentId}`} className="font-medium text-brown hover:text-maroon hover:underline">
            {c.studentName}
          </Link>
          {c.studentEmail ? ` · ${c.studentEmail}` : ""}
        </p>
        {c.notes && <p className="text-sm whitespace-pre-line text-muted-foreground">Notes: {c.notes}</p>}
        {c.status === "cancelled" && c.cancelReason && <p className="text-sm text-muted-foreground">Cancelled: {c.cancelReason}</p>}
        {c.status === "completed" && (
          <p className="text-sm text-muted-foreground">
            {c.attendance ? ATTENDANCE_LABELS[c.attendance] : "Attendance not recorded"}
            {c.outcomeNote ? ` · Private note: ${c.outcomeNote}` : ""}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Last updated by {c.updatedByEmail ?? c.createdByEmail ?? "a teacher"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1 lg:justify-end">
        {c.status === "scheduled" && (
          <>
            <Button asChild variant="ghost" size="sm">
              <a href={c.meetUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink data-icon="inline-start" />
                Open Meet
              </a>
            </Button>
            <ClassFormDialog students={students} existing={c} />
            {c.started && <RecordOutcomeDialog classId={c.id} title={c.title} />}
            <CancelClassDialog classId={c.id} title={c.title} when={when} />
          </>
        )}
      </div>
    </li>
  );
}
