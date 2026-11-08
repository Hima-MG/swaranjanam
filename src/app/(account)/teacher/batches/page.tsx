import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BatchFormDialog } from "@/components/lms/teacher/batch-controls";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { MAX_BATCH_CAPACITY } from "@/lib/lms/class-billing";
import { listBatches, listCourseOptions, listTeachers } from "@/lib/lms/server/batches";

export const metadata: Metadata = { title: "Batches · Teacher" };

async function Batches() {
  const teacher = await requireRole("teacher", "/teacher/batches");
  const [batches, courses, teachers] = await Promise.all([listBatches(teacher), listCourseOptions(teacher), listTeachers(teacher)]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <BatchFormDialog courses={courses} teachers={teachers} maxCapacity={MAX_BATCH_CAPACITY} />
      </div>
      {batches.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          No batches yet. Create one, then add students who are enrolled in its course.
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {batches.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/teacher/batches/${b.id}`} className="font-semibold text-brown hover:text-maroon hover:underline">
                  {b.name}
                </Link>
                <Badge variant={b.status === "active" ? (b.memberCount >= b.capacity ? "outline" : "gold") : "secondary"}>
                  {b.status === "archived" ? "Inactive" : `${b.memberCount}/${b.capacity} learners`}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {b.courseTitle} · {b.teacherName}
              </p>
              <p className="text-sm text-brown">{b.schedule}</p>
              {!b.meetUrl && <p className="text-xs text-destructive">No Google Meet link yet — classes cannot be scheduled.</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TeacherBatchesPage() {
  return (
    <>
      <TeacherPageHeader
        title="Manage batches"
        description={`Small groups of up to ${MAX_BATCH_CAPACITY} learners with a shared schedule and Google Meet link. Attendance and billing stay individual.`}
      />
      <Suspense fallback={<LoadingState label="Loading batches…" />}>
        <Batches />
      </Suspense>
    </>
  );
}
