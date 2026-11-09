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
import type { CoursePricing } from "@/lib/lms/course-pricing";
import { SHARED_RATES } from "@/lib/lms/registration";

export const SIBLING_DISCOUNT_ENABLED = false;
export const SIBLING_DISCOUNT_PERCENT = 10;

export interface PublicCourseFees {
  /** Batch class, per session per student (paise); null when the course does not offer batch classes. */
  batchMinor: number | null;
  /** Individual (one-to-one) class, per session (paise); null when not offered. */
  individualMinor: number | null;
  /** Learn Together batch, per person per session (paise); null when batch classes are not offered. */
  sharedBatchMinor: number | null;
  /** Learn Together one-to-one, per person per session (paise); null when one-to-one is not offered. */
  sharedIndividualMinor: number | null;
  /** Batch initial payment (= one batch class), collected at enrolment; it pays for the first class (paise). */
  batchAdvanceMinor: number | null;
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
    sharedBatchMinor: SHARED_RATES.batchMinor,
    sharedIndividualMinor: SHARED_RATES.individualMinor,
    batchAdvanceMinor: rate.batchAdvanceMinor,
    siblingDiscount: siblingDiscountEnabled
      ? { percent: SIBLING_DISCOUNT_PERCENT, batchMinor: discounted(rate.batchMinor, SIBLING_DISCOUNT_PERCENT) }
      : null,
  };
}

/** The public fees of one course, from its own pricing (only the class types it offers). */
export function publicFeesFromPricing(pricing: CoursePricing, siblingDiscountEnabled = SIBLING_DISCOUNT_ENABLED): PublicCourseFees {
  const batch = pricing.batchEnabled ? pricing.batchMinor : null;
  return {
    batchMinor: batch,
    individualMinor: pricing.individualEnabled ? pricing.individualMinor : null,
    sharedBatchMinor: batch ? pricing.sharedBatchMinor : null,
    sharedIndividualMinor: pricing.individualEnabled ? pricing.sharedIndividualMinor : null,
    batchAdvanceMinor: batch,
    siblingDiscount: siblingDiscountEnabled && batch ? { percent: SIBLING_DISCOUNT_PERCENT, batchMinor: discounted(batch, SIBLING_DISCOUNT_PERCENT) } : null,
  };
}

/**
 * How fees work — only policies the academy has CONFIRMED (course details
 * workbook, "Policies" sheet). Policies still marked "suggested" (refunds,
 * academy cancellations, rescheduling, leaving) are deliberately not listed.
 */
export const FEE_TERMS: readonly string[] = [
  "Fees are calculated per session, only for classes that actually take place.",
  "Your first class or session is paid when you enrol; that payment is deducted on your first monthly invoice, so it is never charged twice.",
  "You are invoiced on the last day of each calendar month for the classes held that month, and pay within 3 days of the invoice date.",
  "A class that was conducted counts even if you missed it — the recording is shared with you.",
  "Individual classes are invoiced monthly in the same way, per session. No registration fee and no fixed course duration.",
];
