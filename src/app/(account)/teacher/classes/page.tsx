import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ClassFormDialog } from "@/components/lms/teacher/class-controls";
import { ClassListItem } from "@/components/lms/teacher/class-list-item";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { requireRole } from "@/lib/auth/session";
import { listSchedulablePackages } from "@/lib/lms/server/billing";
import { listClassesForTeacher, parseClassFilters, type ClassFilters, type ClassTab } from "@/lib/lms/server/classes";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Classes · Teacher" };

type SearchParams = PageProps<"/teacher/classes">["searchParams"];

const TABS: { key: ClassTab; label: string }[] = [
  { key: "upcoming", label: "Scheduled" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

function href(filters: ClassFilters, overrides: Partial<ClassFilters>) {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams({ tab: f.tab });
  if (f.student) params.set("student", f.student);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  return `/teacher/classes?${params}`;
}

async function Classes({ searchParams }: { searchParams: SearchParams }) {
  const teacher = await requireRole("teacher", "/teacher/classes");
  const filters = parseClassFilters(await searchParams);
  const [{ rows, counts, students }, packages] = await Promise.all([listClassesForTeacher(teacher, filters), listSchedulablePackages(teacher)]);
  const filtered = Boolean(filters.student || filters.from || filters.to);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Class status" className="inline-flex flex-wrap rounded-full border border-border bg-ivory p-1 shadow-soft">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={href(filters, { tab: t.key })}
              aria-current={filters.tab === t.key ? "page" : undefined}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                filters.tab === t.key ? "bg-maroon text-cream" : "text-brown hover:bg-cream-deep",
              )}
            >
              {t.label} ({counts[t.key]})
            </Link>
          ))}
        </nav>
        <ClassFormDialog students={students} packages={packages} />
      </div>
      {students.length === 0 && (
        <p className="text-sm text-muted-foreground">No students have registered yet. Classes can be scheduled once a student creates an account.</p>
      )}
      {counts.needsOutcome > 0 && (
        <p role="status" className="rounded-xl border border-gold/40 bg-gold-soft/50 px-4 py-3 text-sm text-brown">
          {counts.needsOutcome} class{counts.needsOutcome === 1 ? " has" : "es have"} ended without a recorded outcome. Use “Record outcome” on each.
        </p>
      )}

      <form method="get" className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
        <input type="hidden" name="tab" value={filters.tab} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="student" className="text-sm font-medium text-brown">Student</Label>
          <NativeSelect id="student" name="student" defaultValue={filters.student ?? ""}>
            <option value="">All students</option>
            {students.map((s) => (
              <option key={s.uid} value={s.uid}>{s.label}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="from" className="text-sm font-medium text-brown">From (IST date)</Label>
          <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="to" className="text-sm font-medium text-brown">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          {filtered && (
            <Button asChild variant="ghost">
              <Link href={href({ tab: filters.tab, student: null, from: null, to: null }, {})}>Reset</Link>
            </Button>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          {filtered
            ? "No classes match these filters."
            : filters.tab === "upcoming"
              ? "No classes scheduled. Use “Schedule class” to add one."
              : `No ${filters.tab} classes yet.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((c) => (
            <ClassListItem key={c.id} item={c} students={students} packages={packages} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TeacherClassesPage({ searchParams }: PageProps<"/teacher/classes">) {
  return (
    <>
      <TeacherPageHeader
        title="Classes"
        description="Live classes on Google Meet. Classes can use a package credit; all times are India Standard Time."
      />
      <Suspense fallback={<LoadingState label="Loading classes…" />}>
        <Classes searchParams={searchParams} />
      </Suspense>
    </>
  );
}
