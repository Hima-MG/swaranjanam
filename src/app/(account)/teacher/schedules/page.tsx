import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ConfirmScheduleForm } from "@/components/lms/teacher/registration-controls";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { requireRole } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { formatDateTime } from "@/lib/format-date";
import { ENROLMENT_TYPE_LABELS, learnerNamesLabel, registrationStatusLabel, WEEKDAY_LABELS, WEEKDAYS } from "@/lib/lms/registration";
import { listTeachers } from "@/lib/lms/server/batches";
import { listRegistrations, type RegistrationRecord } from "@/lib/lms/server/registrations";

export const metadata: Metadata = { title: "Individual schedules · Teacher" };

const days = (r: RegistrationRecord) =>
  WEEKDAYS.filter((d) => r.details.preferredDays.includes(d))
    .map((d) => WEEKDAY_LABELS[d])
    .join(", ");

function Card({ r, teachers }: { r: RegistrationRecord; teachers: { uid: string; label: string }[] }) {
  const confirmed = r.status === "scheduled";
  const lastChange = [...r.history].reverse().find((h) => /schedule (confirmed|changed)/i.test(h.change));
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-sm shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href={`/teacher/registrations/${r.id}`} className="font-semibold text-brown hover:text-maroon hover:underline">
            {learnerNamesLabel(r.details.learners.map((l) => l.fullName)) || "Student"}
          </Link>
          <p className="text-xs text-muted-foreground">
            {r.courseTitle} · {ENROLMENT_TYPE_LABELS[r.enrolmentType]} ·{" "}
            {r.learnerCount > 1 ? `${formatMoney(r.perLearnerRateMinor)} per person (${formatMoney(r.rateMinor)} per session)` : `${formatMoney(r.rateMinor)} per session`}
          </p>
        </div>
        <Badge variant={confirmed ? "gold" : "destructive"}>{registrationStatusLabel(r.status, r.mode)}</Badge>
      </div>
      <p className="text-muted-foreground">
        Preferences (not bookings): {days(r) || "—"} · {r.details.preferredTimes.map((t) => `${t.start}–${t.end}`).join(", ")} IST
        {r.details.notes ? ` · “${r.details.notes}”` : ""}
      </p>
      {confirmed && (
        <p className="text-brown">
          Confirmed: <strong>{r.confirmedSchedule}</strong>
          {r.scheduleTeacherName ? ` · teacher ${r.scheduleTeacherName}` : ""}
          {lastChange ? <span className="block text-xs text-muted-foreground">Last change {formatDateTime(lastChange.at)}</span> : null}
        </p>
      )}
      {!r.studentId ? (
        <p className="text-xs text-muted-foreground">Waiting for the student&apos;s account to be linked before the schedule can be confirmed.</p>
      ) : (
        <details>
          <summary className="cursor-pointer font-semibold text-maroon">{confirmed ? "Change schedule" : "Confirm schedule"}</summary>
          <div className="mt-3">
            <ConfirmScheduleForm
              registrationId={r.id}
              mode={confirmed ? "update" : "confirm"}
              teachers={teachers}
              defaults={{
                days: r.weeklySchedule?.days ?? r.details.preferredDays,
                start: r.weeklySchedule?.start ?? r.details.preferredTimes[0]?.start ?? "",
                end: r.weeklySchedule?.end ?? r.details.preferredTimes[0]?.end ?? "",
              }}
            />
          </div>
        </details>
      )}
    </li>
  );
}

async function Schedules() {
  const teacher = await requireRole("teacher", "/teacher/schedules");
  const [all, teachers] = await Promise.all([listRegistrations(teacher), listTeachers(teacher)]);
  const individual = all.filter((r) => r.kind !== "special" && r.mode === "individual" && (r.status === "paid" || r.status === "scheduled"));
  const awaiting = individual.filter((r) => r.status === "paid");
  const confirmed = individual.filter((r) => r.status === "scheduled");
  if (individual.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-cream-deep/50 p-8 text-sm text-muted-foreground">
        No paid individual students yet. Individual registrations appear here once their initial payment is verified.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="awaiting" className="flex flex-col gap-3">
        <h2 id="awaiting" className="type-h3">
          Awaiting schedule confirmation ({awaiting.length})
        </h2>
        {awaiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is waiting.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {awaiting.map((r) => (
              <Card key={r.id} r={r} teachers={teachers} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="confirmed" className="flex flex-col gap-3">
        <h2 id="confirmed" className="type-h3">
          Confirmed schedules ({confirmed.length})
        </h2>
        {confirmed.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {confirmed.map((r) => (
              <Card key={r.id} r={r} teachers={teachers} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function SchedulesPage() {
  return (
    <>
      <TeacherPageHeader
        title="Individual schedules"
        description="One-to-one students. Their preferred days and times are requests; confirm the day, time and teacher here. Students see only the confirmed schedule. Sessions themselves are scheduled under Classes & attendance."
      />
      <Suspense fallback={<LoadingState label="Loading schedules…" />}>
        <Schedules />
      </Suspense>
    </>
  );
}
