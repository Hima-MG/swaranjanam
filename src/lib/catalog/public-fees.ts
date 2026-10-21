// Public course fees, derived ONLY from the academy's fee plans
// (collection pricePlans, rules in lib/lms/billing.ts). The legacy
// `course.price` / `course.originalPrice` catalogue fields are never shown
// publicly, so the website always matches what a package is charged.
//
// PURE module (type-only imports): unit-tested and safe in Server and Client
// Components. No discounts are derived or displayed.

import type { PairType, PricePlan } from "@/lib/lms/billing";

/** What the public site may show about a course's fees. No ids, history or staff data. */
export interface PublicFee {
  kind: "regular" | "program";
  /** Inactive plans are never published (see publicFeeFromPlan). */
  status: "active" | "coming_soon";
  /** Per package (regular) — null means not offered (e.g. no adult fee for Little Swaras). */
  adultPriceMinor: number | null;
  studentPriceMinor: number | null;
  /** One-time program fee (e.g. Voice Culture). */
  flatPriceMinor: number | null;
  sessionsIncluded: number;
  sessionMinutes: number;
  sessionsPerWeek: number;
  durationWeeks: number | null;
  /** Exact published pair fees, or null when the pair plan does not apply. */
  pairPricesMinor: Partial<Record<PairType, number>> | null;
}

const PAIR_ORDER: PairType[] = ["two_adults", "adult_student", "two_students"];

const isPaise = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Public fee for one plan, or null when nothing may be published (inactive, or no fee configured). */
export function publicFeeFromPlan(plan: PricePlan | null | undefined): PublicFee | null {
  if (!plan || (plan.status !== "active" && plan.status !== "coming_soon")) return null;
  const adult = plan.kind === "regular" && isPaise(plan.adultPriceMinor) ? plan.adultPriceMinor : null;
  const student = plan.kind === "regular" && isPaise(plan.studentPriceMinor) ? plan.studentPriceMinor : null;
  const flat = plan.kind === "program" && isPaise(plan.flatPriceMinor) ? plan.flatPriceMinor : null;
  if (adult === null && student === null && flat === null) return null;
  if (!Number.isInteger(plan.sessionsIncluded) || plan.sessionsIncluded < 1) return null;

  let pair: PublicFee["pairPricesMinor"] = null;
  if (plan.kind === "regular" && plan.pairEligible) {
    const entries = PAIR_ORDER.filter((t) => isPaise(plan.pairPricesMinor[t])).map((t) => [t, plan.pairPricesMinor[t] as number] as const);
    pair = entries.length ? Object.fromEntries(entries) : null;
  }
  return {
    kind: plan.kind,
    status: plan.status,
    adultPriceMinor: adult,
    studentPriceMinor: student,
    flatPriceMinor: flat,
    sessionsIncluded: plan.sessionsIncluded,
    sessionMinutes: plan.sessionMinutes,
    sessionsPerWeek: plan.sessionsPerWeek,
    durationWeeks: plan.durationWeeks,
    pairPricesMinor: pair,
  };
}

/**
 * Fee plan linked to a course (plan.courseId === courseId). Only plans that
 * may be published are considered; if several are linked, the lowest `order`
 * wins so the choice is stable. No plan linked → null ("Fees on request").
 */
export function planForCourse<P extends PricePlan>(plans: readonly P[], courseId: string): P | null {
  const linked = plans
    .filter((p) => p.courseId === courseId && publicFeeFromPlan(p) !== null)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return linked[0] ?? null;
}

/** Headline for course cards: the lowest published individual fee, with its unit. */
export function feeHeadline(fee: PublicFee): { amountMinor: number; from: boolean; unit: string } {
  if (fee.kind === "program") {
    return { amountMinor: fee.flatPriceMinor!, from: false, unit: "one-time" };
  }
  const prices = [fee.adultPriceMinor, fee.studentPriceMinor].filter(isPaise);
  return {
    amountMinor: Math.min(...prices),
    from: prices.length > 1 && fee.adultPriceMinor !== fee.studentPriceMinor,
    unit: `per ${fee.sessionsIncluded} class${fee.sessionsIncluded === 1 ? "" : "es"}`,
  };
}
