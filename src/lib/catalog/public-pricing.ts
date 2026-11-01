// Public course fees, derived from the academy's billing rates in force
// (settings/classBilling.rateVersions, edited in Teacher → Billing → Rates &
// policy). The website therefore always shows the same per-session rates the
// billing system charges, and a rate change shows up publicly from the month
// it takes effect. No package, bundle or upfront course fee exists.
//
// The sibling / two-learners-on-one-device discount is the academy's
// confirmed 10% (course details workbook). It is DISPLAY ONLY: monthly
// invoices do not apply it automatically, so a teacher records it on the
// invoice (credit note) until billing supports it.
//
// PURE module (type-only imports): unit-tested and safe in Server and Client Components.

import type { RateVersion } from "@/lib/lms/class-billing";

export const SIBLING_DISCOUNT_PERCENT = 10;

export interface PublicCourseFees {
  /** Batch class, per session per student (paise). */
  batchMinor: number;
  /** Individual (one-to-one) class, per session (paise). */
  individualMinor: number;
  /** Batch class for siblings / two learners on one device, per learner per session (paise). */
  siblingBatchMinor: number;
  siblingDiscountPercent: number;
}

/** Applies a whole-percent discount, rounded to whole rupees. */
export function discounted(amountMinor: number, percent: number): number {
  return Math.round((amountMinor * (100 - percent)) / 100 / 100) * 100;
}

export function publicFeesFromRate(rate: Pick<RateVersion, "batchMinor" | "individualMinor">): PublicCourseFees {
  return {
    batchMinor: rate.batchMinor,
    individualMinor: rate.individualMinor,
    siblingBatchMinor: discounted(rate.batchMinor, SIBLING_DISCOUNT_PERCENT),
    siblingDiscountPercent: SIBLING_DISCOUNT_PERCENT,
  };
}

/**
 * How fees work — only policies the academy has CONFIRMED (course details
 * workbook, "Policies" sheet). Policies still marked "suggested" (refunds,
 * academy cancellations, rescheduling, leaving) are deliberately not listed.
 */
export const FEE_TERMS: readonly string[] = [
  "Fees are calculated per session, for the classes actually conducted.",
  "Payment is collected at the end of each month for that month's classes, with one week to pay.",
  "A class that was conducted counts even if you missed it — the recording is shared with you.",
  "No registration fee, and no fixed course duration: you progress at your own pace.",
];
