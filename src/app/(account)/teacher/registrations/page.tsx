import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { ENROLMENT_TYPE_LABELS, learnerNamesLabel, REGISTRATION_STATUSES, registrationStatusLabel, WEEKDAY_LABELS, WEEKDAYS, type RegistrationStatus } from "@/lib/lms/registration";
import { listRegistrations, type RegistrationRecord } from "@/lib/lms/server/registrations";

export const metadata: Metadata = { title: "Registered students · Teacher" };

type SearchParams = PageProps<"/teacher/registrations">["searchParams"];

const STATUS_FILTER_LABELS: Record<RegistrationStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid — awaiting placement",
  assigned: "Active — batch",
  scheduled: "Active — individual",
  cancelled: "Cancelled",
};

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const isPaid = (r: RegistrationRecord) => r.status !== "pending_payment" && r.status !== "cancelled";

/** Server-side filtering (the teacher's own query; nothing else leaves the server). */
function applyFilters(rows: RegistrationRecord[], f: { q: string; course: string; type: string; payment: string; status: string }) {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!q || [r.details.fullName, r.details.email, r.studentEmail ?? "", r.details.mobile].some((v) => v.toLowerCase().includes(q))) &&
      (!f.course || r.courseSlug === f.course) &&
      (!f.type || r.mode === f.type) &&
      (!f.payment || (f.payment === "paid" ? isPaid(r) : !isPaid(r))) &&
      (!f.status || r.status === f.status),
  );
}

async function Registrations({ searchParams }: { searchParams: SearchParams }) {
  const teacher = await requireRole("teacher", "/teacher/registrations");
  const params = await searchParams;
  const filters = { q: one(params.q), course: one(params.course), type: one(params.type), payment: one(params.payment), status: one(params.status) };
  const all = await listRegistrations(teacher);
  const courses = [...new Map(all.map((r) => [r.courseSlug, r.courseTitle])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const rows = applyFilters(all, filters);

  return (
    <div className="flex flex-col gap-6">
      <form method="get" className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Filter registered students">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input name="q" defaultValue={filters.q} placeholder="Search name, email or mobile" aria-label="Search" className="pl-9" />
        </div>
        <NativeSelect name="course" defaultValue={filters.course} aria-label="Course">
          <option value="">All courses</option>
          {courses.map(([slug, title]) => (
            <option key={slug} value={slug}>
              {title}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="type" defaultValue={filters.type} aria-label="Class type">
          <option value="">Batch and individual</option>
          <option value="batch">Batch</option>
          <option value="individual">Individual</option>
        </NativeSelect>
        <NativeSelect name="payment" defaultValue={filters.payment} aria-label="Initial payment">
          <option value="">Any payment status</option>
          <option value="paid">Verified</option>
          <option value="unpaid">Not paid</option>
        </NativeSelect>
        <NativeSelect name="status" defaultValue={filters.status} aria-label="Enrolment status">
          <option value="">Any enrolment status</option>
          {REGISTRATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_FILTER_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
        <div className="flex gap-2 lg:col-span-6">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          <Button asChild type="button" size="sm" variant="ghost">
            <Link href="/teacher/registrations">Clear</Link>
          </Button>
          <span className="ml-auto self-center text-xs text-muted-foreground">
            {rows.length} of {all.length} registration{all.length === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      {all.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
          No registrations yet. Students register from “Enrol Now” on an open course&apos;s page.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">No registrations match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[68rem] text-left text-sm">
            <thead className="border-b border-border bg-cream-deep/60 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                {["Student", "Course", "Class type · agreed rate", "Preferred days and times (IST)", "Initial payment", "Registered", "Enrolment / schedule"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/teacher/registrations/${r.id}`} className="font-semibold text-brown hover:text-maroon hover:underline">
                      {learnerNamesLabel(r.details.learners.map((l) => l.fullName)) || "Student"}
                    </Link>
                    <p className="text-xs text-muted-foreground">{r.details.email || r.studentEmail}</p>
                    {r.details.mobile && <p className="text-xs text-muted-foreground">{r.details.mobile}</p>}
                  </td>
                  <td className="px-4 py-3 text-brown">{r.courseTitle}</td>
                  <td className="px-4 py-3 text-brown">
                    {r.kind === "special" ? "Special Programme" : ENROLMENT_TYPE_LABELS[r.enrolmentType]}
                    <p className="text-xs text-muted-foreground">
                      {r.learnerCount > 1 ? `${formatMoney(r.perLearnerRateMinor)} per person · ` : ""}
                      {r.kind === "special" ? `${formatMoney(r.initialAmountMinor)} full fee` : `${formatMoney(r.rateMinor)} per ${r.mode === "batch" ? "class" : "session"}`}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-brown">
                    {WEEKDAYS.filter((d) => r.details.preferredDays.includes(d))
                      .map((d) => WEEKDAY_LABELS[d].slice(0, 3))
                      .join(", ")}
                    <p className="text-xs text-muted-foreground">{r.details.preferredTimes.map((t) => `${t.start}–${t.end}`).join(", ")}</p>
                  </td>
                  <td className="px-4 py-3">{isPaid(r) ? <Badge variant="gold">Verified</Badge> : <Badge variant="secondary">Not paid</Badge>}</td>
                  <td className="px-4 py-3 text-brown">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={r.status === "paid" && r.kind !== "special" ? "destructive" : "outline"}>{registrationStatusLabel(r.status, r.mode, r.kind)}</Badge>
                    {r.guest && !r.studentId && isPaid(r) && <p className="mt-1 text-xs text-muted-foreground">Account not linked yet</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RegistrationsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <TeacherPageHeader
        title="Registered students"
        description="Website registrations. A payment shows as verified only after the server has verified it. Assign paid batch students under Manage batches; confirm individual students under Individual schedules."
      />
      <Suspense fallback={<LoadingState label="Loading registrations…" />}>
        <Registrations searchParams={searchParams} />
      </Suspense>
    </>
  );
}
