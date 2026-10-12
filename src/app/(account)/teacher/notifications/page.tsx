import { GraduationCap, IndianRupee, Mic } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { MarkNotificationsReadButton } from "@/components/lms/teacher/operations-controls";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format-date";
import { getTeacherNotifications } from "@/lib/lms/server/notifications";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications · Teacher" };

const ICONS = { enrollment: GraduationCap, payment: IndianRupee, submission: Mic } as const;

async function Notifications() {
  const teacher = await requireRole("teacher", "/teacher/notifications");
  const { items, unreadCount } = await getTeacherNotifications(teacher);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {unreadCount} unread · last 60 days. Your own actions are not listed.
        </p>
        <MarkNotificationsReadButton disabled={unreadCount === 0} />
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          No notifications. New enrollments, payments recorded by other teachers and practice recordings waiting for review appear here.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-soft">
          {items.map((n) => {
            const Icon = ICONS[n.kind];
            return (
              <li key={n.id}>
                <Link
                  href={n.href}
                  className={cn(
                    "flex items-start gap-3 px-5 py-4 text-sm outline-none hover:bg-cream-deep/50 focus-visible:ring-3 focus-visible:ring-ring/50",
                    n.unread && "bg-gold-soft/30",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-maroon-soft text-maroon">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-brown", n.unread && "font-semibold")}>
                      {n.unread && <span className="sr-only">Unread: </span>}
                      {n.text}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(n.at)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function TeacherNotificationsPage() {
  return (
    <>
      <TeacherPageHeader title="Notifications" description="Enrollments, payments and practice recordings that need your attention." />
      <Suspense fallback={<LoadingState label="Loading notifications…" />}>
        <Notifications />
      </Suspense>
    </>
  );
}
