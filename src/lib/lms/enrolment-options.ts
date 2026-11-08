// The enrolment choices shown on the enrolment pages, with their prices — for
// DISPLAY only. The server calculates every amount again (priceEnrolment);
// nothing here is ever trusted for payment.

import type { PublicCourseFees } from "@/lib/catalog/public-pricing";
import type { PublicProgramme } from "@/lib/lms/programme";
import { formatMoney } from "@/lib/format";
import { enrolmentRates, ENROLMENT_TYPE_LABELS, isSharedEnrolment, type EnrolmentType } from "@/lib/lms/registration";

export interface EnrolmentChoice {
  type: EnrolmentType;
  title: string;
  rate: string;
  initial: string;
  detail: string;
}

/** Only the enrolment types whose class type the course offers. */
export function enrolmentChoices(fee: PublicCourseFees): EnrolmentChoice[] {
  const choices: EnrolmentChoice[] = [];
  const add = (type: EnrolmentType, courseRate: number | null) => {
    if (courseRate === null) return;
    const r = enrolmentRates(type, courseRate);
    const unit = type === "batch" || type === "shared_batch" ? "class" : "session";
    const units = unit === "class" ? "classes" : "sessions";
    const shared = isSharedEnrolment(type);
    choices.push({
      type,
      title: shared ? (type === "shared_batch" ? "Shared batch" : "Shared one-to-one") : ENROLMENT_TYPE_LABELS[type],
      rate: shared ? `${formatMoney(r.perLearnerMinor)} per person · ${formatMoney(r.sessionMinor)} per ${unit}` : `${formatMoney(r.perLearnerMinor)} per ${unit}`,
      initial: `Pay ${formatMoney(r.sessionMinor)} now`,
      detail: `${
        type === "batch" ? "Small group (up to 5 students)." : type === "individual" ? "One-to-one with the teacher." : type === "shared_batch" ? "Two learners in a small group (2 of the 5 places)." : "Two learners together with the teacher."
      } The initial payment covers your first eligible ${unit}. Future payments are calculated monthly based on billable ${units}${
        shared ? ` (${formatMoney(r.sessionMinor)} each, for both learners)` : ` (${formatMoney(r.sessionMinor)} each)`
      }, invoiced on the last day of the month and due within 3 days.`,
    });
  };
  add("batch", fee.batchMinor);
  add("individual", fee.individualMinor);
  add("shared_batch", fee.batchMinor);
  add("shared_individual", fee.individualMinor);
  return choices;
}

/** Special Programme: one choice — the full fee, paid once (no first-class payment, no monthly invoice). */
export function programmeChoice(programme: PublicProgramme): EnrolmentChoice[] {
  return [
    {
      type: "batch",
      title: "Programme registration",
      rate: `${formatMoney(programme.feeMinor)} total`,
      initial: `Pay ${formatMoney(programme.feeMinor)} now (full fee)`,
      detail: "One full payment confirms your registration. There is no first-class payment and no monthly invoice.",
    },
  ];
}

/** The choices for a course: its programme fee, or the regular enrolment types it offers. */
export function courseEnrolmentChoices(course: { fee: PublicCourseFees | null; programme: PublicProgramme | null }): EnrolmentChoice[] {
  if (course.programme) return programmeChoice(course.programme);
  return course.fee ? enrolmentChoices(course.fee) : [];
}
