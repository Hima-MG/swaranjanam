// Public course fees, derived from the academy's billing rates in force
// (settings/classBilling.rateVersions, edited in Teacher → Billing → Rates &
// policy). The website therefore always shows the same per-session rates the
// billing system charges, and a rate change shows up publicly from the month
// it takes effect. No package, bundle or upfront course fee exists.
//
// The sibling / two-learners-on-one-device discount (10%, confirmed by the
// academy) is NOT applied by billing yet, so it stays DISABLED: no discounted
// amount is shown or charged until batch invoices can honour it. Turn
// SIBLING_DISCOUNT_ENABLED on only together with billing support.
//
// PURE module (type-only imports): unit-tested and safe in Server and Client Components.

import type { RateVersion } from "@/lib/lms/class-billing";

export const SIBLING_DISCOUNT_ENABLED = false;
export const SIBLING_DISCOUNT_PERCENT = 10;

export interface PublicCourseFees {
  /** Batch class, per session per student (paise). */
  batchMinor: number;
  /** Individual (one-to-one) class, per session (paise). */
  individualMinor: number;
  /** Batch first-class payment, collected at enrolment; it pays for the first class (paise). */
  batchAdvanceMinor: number;
  /** Null while billing cannot apply the sibling discount. */
  siblingDiscount: { percent: number; batchMinor: number } | null;
}

/** Applies a whole-percent discount, rounded to whole rupees. */
export function discounted(amountMinor: number, percent: number): number {
  return Math.round((amountMinor * (100 - percent)) / 100 / 100) * 100;
}

export function publicFeesFromRate(
  rate: Pick<RateVersion, "batchMinor" | "individualMinor" | "batchAdvanceMinor">,
  siblingDiscountEnabled = SIBLING_DISCOUNT_ENABLED,
): PublicCourseFees {
  return {
    batchMinor: rate.batchMinor,
    individualMinor: rate.individualMinor,
    batchAdvanceMinor: rate.batchAdvanceMinor,
    siblingDiscount: siblingDiscountEnabled
      ? { percent: SIBLING_DISCOUNT_PERCENT, batchMinor: discounted(rate.batchMinor, SIBLING_DISCOUNT_PERCENT) }
      : null,
  };
}

/**
 * How fees work — only policies the academy has CONFIRMED (course details
 * workbook, "Policies" sheet). Policies still marked "suggested" (refunds,
 * academy cancellations, rescheduling, leaving) are deliberately not listed.
 */
export const FEE_TERMS: readonly string[] = [
  "Fees are calculated per session, only for classes that actually take place.",
  "Batch classes: your first class is paid when you enrol and is never invoiced again.",
  "After that you are invoiced every four weeks for the classes held (classes 2–4 first, then four at a time), due by the end of the fourth week — before your next class.",
  "A class that was conducted counts even if you missed it — the recording is shared with you.",
  "Individual classes are paid one session at a time. No registration fee and no fixed course duration.",
];
