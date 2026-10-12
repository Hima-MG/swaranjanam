import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ProgressBar } from "@/components/lms/progress-bar";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { requireRole } from "@/lib/auth/session";
import { formatDate } from "@/lib/format-date";
import { ACTIVE_WINDOW_DAYS, listStudents, parseDirectoryQuery, type DirectoryQuery } from "@/lib/lms/server/admin";

export const metadata: Metadata = { title: "Students · Teacher" };

type SearchParams = PageProps<"/teacher/students">["searchParams"];

const ACTIVITY_BADGE = {
  active: { label: "Active", variant: "gold" },
  inactive: { label: "Inactive", variant: "outline" },
  never: { label: "No activity", variant: "secondary" },
} as const;

function queryString(query: DirectoryQuery, overrides: Partial<DirectoryQuery> = {}) {
  const q = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (q.q) params.set("q", q.q);
  if (q.course) params.set("course", q.course);
  if (q.access !== "any") params.set("access", q.access);
  if (q.activity !== "any") params.set("activity", q.activity);
  if (q.page > 1) params.set("page", String(q.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function Directory({ searchParams }: { searchParams: SearchParams }) {
  const teacher = await requireRole("teacher", "/teacher/students");
  const query = parseDirectoryQuery(await searchParams);
  const result = await listStudents(teacher, query);
  const filtersActive = Boolean(query.q || query.course || query.access !== "any" || query.activity !== "any");

  return (
    <div className="flex flex-col gap-6">
      {/* GET form: filters live in the URL, so results are shareable and work without JavaScript. */}
      <form method="get" className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft md:grid-cols-[2fr_1.5fr_1fr_1fr_auto] md:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor="q" className="text-sm font-medium text-brown">
            Search
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-brown-muted" aria-hidden="true" />
            <Input id="q" name="q" type="search" defaultValue={query.q} placeholder="Name, email or phone" className="pl-10" maxLength={100} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="course" className="text-sm font-medium text-brown">
            Course
          </Label>
          <NativeSelect id="course" name="course" defaultValue={query.course ?? ""}>
            <option value="">All courses</option>
            {result.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="access" className="text-sm font-medium text-brown">
            Access
          </Label>
          <NativeSelect id="access" name="access" defaultValue={query.access}>
            <option value="any">Any</option>
            <option value="active">Active enrollment</option>
            <option value="revoked">Revoked</option>
            <option value="none">Not enrolled</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="activity" className="text-sm font-medium text-brown">
            Activity
          </Label>
          <NativeSelect id="activity" name="activity" defaultValue={query.activity}>
            <option value="any">Any</option>
            <option value="active">Active ({ACTIVE_WINDOW_DAYS} days)</option>
            <option value="inactive">Inactive</option>
            <option value="never">No activity yet</option>
          </NativeSelect>
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          {filtersActive && (
            <Button asChild variant="ghost">
              <Link href="/teacher/students">Reset</Link>
            </Button>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {result.total} {result.total === 1 ? "student" : "students"}
          {filtersActive ? " match these filters" : ""}
        </p>
        {result.total > 0 && (
          <Button asChild variant="outline" size="sm">
            <a href={`/api/teacher/students/export${queryString(query, { page: 1 })}`} download>
              <Download data-icon="inline-start" />
              Export CSV
            </a>
          </Button>
        )}
      </div>

      {result.total === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          {filtersActive
            ? "No students match these filters."
            : "No students have registered yet. Students appear here after creating an account on the website."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <caption className="sr-only">Students</caption>
              <thead className="bg-cream-deep/60 text-xs tracking-wide text-brown-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">Student</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Courses</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Progress</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Last activity</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Joined</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => {
                  const badge = ACTIVITY_BADGE[row.activity];
                  return (
                    <tr key={row.uid} className="border-t border-border align-top">
                      <td className="px-5 py-3">
                        <Link href={`/teacher/students/${row.uid}`} className="font-medium text-brown hover:text-maroon hover:underline">
                          {row.displayName ?? row.email ?? "Unnamed student"}
                        </Link>
                        {row.email && <span className="block text-xs break-all text-muted-foreground">{row.email}</span>}
                      </td>
                      <td className="px-5 py-3">
                        {row.activeCourses.length === 0 ? (
                          <span className="text-muted-foreground">
                            {row.revokedCount > 0 ? `${row.revokedCount} revoked` : "Not enrolled"}
                          </span>
                        ) : (
                          <span className="text-brown">
                            {row.activeCourses.map((c) => c.title).join(", ")}
                            {row.revokedCount > 0 && <span className="text-xs text-muted-foreground"> · {row.revokedCount} revoked</span>}
                          </span>
                        )}
                      </td>
                      <td className="w-40 px-5 py-3">
                        {row.averageCompletion === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">{row.averageCompletion}% average</span>
                            <ProgressBar percent={row.averageCompletion} label={`Progress of ${row.displayName ?? "student"}`} />
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex flex-col items-start gap-1">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          <span className="text-xs text-muted-foreground">{formatDate(row.lastActivity, "Never")}</span>
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{formatDate(row.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {result.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/teacher/students${queryString(query, { page: result.page - 1 })}`}>
                <ChevronLeft data-icon="inline-start" />
                Previous
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/teacher/students${queryString(query, { page: result.page + 1 })}`}>
                Next
                <ChevronRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

export default function TeacherStudentsPage({ searchParams }: PageProps<"/teacher/students">) {
  return (
    <>
      <TeacherPageHeader
        title="Students"
        description="Every registered student, with their courses, progress and activity."
      />
      <Suspense fallback={<LoadingState label="Loading students…" />}>
        <Directory searchParams={searchParams} />
      </Suspense>
    </>
  );
}
