import { formatMoney } from "@/lib/format";
import { ENROLMENT_TYPE_LABELS, isSharedEnrolment } from "@/lib/lms/registration";
import type { RegistrationRecord } from "@/lib/lms/server/registrations";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-2.5 last:border-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words text-brown">{children}</dd>
    </div>
  );
}

/** Enrolment type, the server-calculated rates and every learner (both for Learn Together). */
export function RegistrationSummaryRows({ r }: { r: RegistrationRecord }) {
  const unit = r.mode === "batch" ? "class" : "session";
  const shared = isSharedEnrolment(r.enrolmentType);
  if (r.kind === "special") {
    return (
      <>
        <Row label="Course type">Special Programme</Row>
        <Row label="Programme fee">{formatMoney(r.initialAmountMinor)} — full payment, once (no monthly invoice)</Row>
        <Row label="Payment">{r.status === "paid" ? "Paid — registration confirmed" : "Not paid yet"}</Row>
        <Row label="Learner">{r.details.learners[0]?.fullName ?? r.details.fullName}</Row>
      </>
    );
  }
  return (
    <>
      <Row label="Course type">Regular Academy Course</Row>
      <Row label="Enrolment">{ENROLMENT_TYPE_LABELS[r.enrolmentType]}</Row>
      {shared ? (
        <>
          <Row label="Rate per person">
            {formatMoney(r.perLearnerRateMinor)} per {unit}
          </Row>
          <Row label={`Combined rate per ${unit}`}>
            {formatMoney(r.rateMinor)} ({r.learnerCount} learners)
          </Row>
        </>
      ) : (
        <Row label={`Your rate per ${unit}`}>
          {formatMoney(r.rateMinor)} per {unit}
        </Row>
      )}
      <Row label="Initial payment">{formatMoney(r.initialAmountMinor)}</Row>
      {r.details.learners.map((l, i) => (
        <Row key={i} label={shared ? `Learner ${i + 1}` : "Learner"}>
          {l.fullName}
          {l.age ? `, ${l.age} years` : ""}
          {l.guardian ? ` · parent/guardian ${l.guardian.name} (${l.guardian.relationship}), ${l.guardian.phone}` : ""}
        </Row>
      ))}
    </>
  );
}
