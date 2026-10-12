import type { Metadata } from "next";
import { Suspense } from "react";

import { AnnouncementDialog, DeleteAnnouncementButton } from "@/components/lms/teacher/operations-controls";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format-date";
import { listAnnouncementsForTeacher } from "@/lib/lms/server/announcements";

export const metadata: Metadata = { title: "Announcements · Teacher" };

async function Announcements() {
  const teacher = await requireRole("teacher", "/teacher/announcements");
  const { announcements, courses } = await listAnnouncementsForTeacher(teacher);
  const courseTitle = new Map(courses.map((c) => [c.id, c.title]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <AnnouncementDialog courses={courses} />
      </div>
      {announcements.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          No announcements yet. Announcements appear on students’ dashboards.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {announcements.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-heading text-xl font-semibold text-brown">{a.title}</h2>
                  {a.titleMl && <p lang="ml" className="text-sm text-brown-muted">{a.titleMl}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={a.published ? "gold" : "outline"}>{a.published ? "Visible" : "Draft"}</Badge>
                    {a.pinned && <Badge variant="maroon">Pinned</Badge>}
                    <span>{a.courseId ? `Students of ${courseTitle.get(a.courseId) ?? "a deleted course"}` : "All students"}</span>
                    <span>· {a.createdByEmail ?? "Teacher"} · {formatDateTime(a.createdAt)}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <AnnouncementDialog courses={courses} existing={a} />
                  <DeleteAnnouncementButton id={a.id} title={a.title} />
                </div>
              </div>
              <p className="whitespace-pre-line text-brown">{a.body}</p>
              {a.bodyMl && <p lang="ml" className="whitespace-pre-line text-brown">{a.bodyMl}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TeacherAnnouncementsPage() {
  return (
    <>
      <TeacherPageHeader title="Announcements" description="Messages for all students or for the students of one course." />
      <Suspense fallback={<LoadingState label="Loading announcements…" />}>
        <Announcements />
      </Suspense>
    </>
  );
}
