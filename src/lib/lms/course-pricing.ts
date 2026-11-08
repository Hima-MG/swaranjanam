// Course-specific pricing, class types and schedule information — PURE rules.
//
// No runtime imports beyond other pure modules: unit-tested and safe in Client
// Components (form feedback). The server re-validates everything.
//
// * Each course has its own prices: batch per class and individual per session
//   (INR, integer paise). A class type can be switched off for a course; at
//   least one type with a price is needed before students can enrol.
// * Courses saved before course pricing existed have no stored pricing: they use
//   the academy's confirmed rates in force (₹400 / ₹750, settings/classBilling)
//   with both class types offered, until a teacher saves prices for the course.
// * A student's rate is fixed when they enrol: the registration stores it, and
//   their billing account keeps it as an immutable, dated rate history. A course
//   price change applies to NEW students. Existing students change only through
//   an explicit, approved change from a future month — charges already recorded
//   and invoices already issued are never recalculated.

import { isPeriod } from "@/lib/lms/class-billing";
import { isTime, minutesOf, WEEKDAYS, type TimeRange, type Weekday } from "@/lib/lms/registration";

export const MAX_COURSE_PRICE_RUPEES = 100_000;
/** Batches are small groups: the academy's limit is 5 students. */
export const DEFAULT_BATCH_CAPACITY = 5;
export const MAX_BATCH_CAPACITY_SETTING = 5;

export interface CoursePricing {
  batchEnabled: boolean;
  individualEnabled: boolean;
  /** Per batch class, per student (paise). Null when batch classes are off. */
  batchMinor: number | null;
  /** Per individual session (paise). Null when individual classes are off. */
  individualMinor: number | null;
  /** Default capacity for new batches of this course. */
  batchCapacity: number;
  currency: "INR";
}

export interface CourseScheduleInfo {
  /** General availability — NOT confirmed student schedules. */
  days: Weekday[];
  timeSlots: TimeRange[];
  frequency: string;
  notes: string;
}

export const EMPTY_SCHEDULE_INFO: CourseScheduleInfo = { days: [], timeSlots: [], frequency: "", notes: "" };

const paise = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/**
 * The pricing in force for a course: what a teacher saved, or — for a course
 * saved before course pricing existed — the academy's confirmed rates with both
 * class types offered.
 */
export function effectiveCoursePricing(stored: unknown, confirmed: { batchMinor: number; individualMinor: number }): CoursePricing {
  const p = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : null;
  if (!p) {
    return { batchEnabled: true, individualEnabled: true, batchMinor: confirmed.batchMinor, individualMinor: confirmed.individualMinor, batchCapacity: DEFAULT_BATCH_CAPACITY, currency: "INR" };
  }
  const batchEnabled = p.batchEnabled === true && paise(p.batchMinor);
  const individualEnabled = p.individualEnabled === true && paise(p.individualMinor);
  const cap = typeof p.batchCapacity === "number" && Number.isInteger(p.batchCapacity) ? p.batchCapacity : DEFAULT_BATCH_CAPACITY;
  return {
    batchEnabled,
    individualEnabled,
    batchMinor: batchEnabled ? (p.batchMinor as number) : null,
    individualMinor: individualEnabled ? (p.individualMinor as number) : null,
    batchCapacity: Math.min(Math.max(cap, 1), MAX_BATCH_CAPACITY_SETTING),
    currency: "INR",
  };
}

/** Whether students can enrol: at least one class type is offered with a price. */
export function hasEnrollableClassType(p: CoursePricing): boolean {
  return (p.batchEnabled && paise(p.batchMinor)) || (p.individualEnabled && paise(p.individualMinor));
}

/** The course's rate for a class type, or null when that type is not offered. */
export function rateFor(p: CoursePricing, mode: "batch" | "individual"): number | null {
  return mode === "batch" ? (p.batchEnabled ? p.batchMinor : null) : p.individualEnabled ? p.individualMinor : null;
}

function rupeesToPaise(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  // Whole rupees or rupees with up to 2 decimals (paise); no signs, no exponents.
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return undefined;
  const minor = Math.round(Number(text) * 100);
  return minor > 0 && minor <= MAX_COURSE_PRICE_RUPEES * 100 ? minor : undefined;
}

/** Validates the teacher's "Classes & pricing" form. Prices arrive in rupees. */
export function parseCoursePricing(input: Record<string, unknown>): { value: CoursePricing | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const on = (v: unknown) => v === true || v === "on" || v === "true";
  const batchEnabled = on(input.batchEnabled);
  const individualEnabled = on(input.individualEnabled);
  const batch = rupeesToPaise(input.batchPrice);
  const individual = rupeesToPaise(input.individualPrice);
  const capText = typeof input.batchCapacity === "number" ? String(input.batchCapacity) : typeof input.batchCapacity === "string" ? input.batchCapacity.trim() : "";
  const cap = capText === "" ? DEFAULT_BATCH_CAPACITY : /^\d{1,2}$/.test(capText) ? Number(capText) : NaN;

  if (!batchEnabled && !individualEnabled) errors.classTypes = "Offer at least one class type (batch or individual).";
  if (batchEnabled) {
    if (batch === undefined || batch === null) errors.batchPrice = `Enter the batch price per class in rupees (more than ₹0, at most ₹${MAX_COURSE_PRICE_RUPEES.toLocaleString("en-IN")}).`;
    if (!(Number.isInteger(cap) && cap >= 1 && cap <= MAX_BATCH_CAPACITY_SETTING)) errors.batchCapacity = `Enter a capacity from 1 to ${MAX_BATCH_CAPACITY_SETTING}.`;
  } else if (batch === undefined) {
    errors.batchPrice = "Enter a valid amount, or leave it empty.";
  }
  if (individualEnabled) {
    if (individual === undefined || individual === null) errors.individualPrice = `Enter the individual price per session in rupees (more than ₹0, at most ₹${MAX_COURSE_PRICE_RUPEES.toLocaleString("en-IN")}).`;
  } else if (individual === undefined) {
    errors.individualPrice = "Enter a valid amount, or leave it empty.";
  }
  if (Object.keys(errors).length) return { value: null, errors };
  return {
    value: {
      batchEnabled,
      individualEnabled,
      batchMinor: batchEnabled ? (batch as number) : null,
      individualMinor: individualEnabled ? (individual as number) : null,
      batchCapacity: batchEnabled ? cap : DEFAULT_BATCH_CAPACITY,
      currency: "INR",
    },
    errors,
  };
}

/** Validates the general schedule information (not confirmed bookings). */
export function parseScheduleInfo(input: Record<string, unknown>): { value: CourseScheduleInfo | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const rawDays = Array.isArray(input.days) ? input.days : [];
  if (!rawDays.every((d) => (WEEKDAYS as readonly unknown[]).includes(d))) errors.days = "Choose days from the list.";
  const days = WEEKDAYS.filter((d) => rawDays.includes(d));
  const slots: TimeRange[] = [];
  for (const t of (Array.isArray(input.timeSlots) ? input.timeSlots : []).slice(0, 13)) {
    const r = (t ?? {}) as Record<string, unknown>;
    if (!r.start && !r.end) continue;
    if (!isTime(r.start) || !isTime(r.end) || minutesOf(r.start) >= minutesOf(r.end)) {
      errors.timeSlots = "Each time slot needs a start and a later end time.";
      continue;
    }
    if (!slots.some((s) => s.start === r.start && s.end === r.end)) slots.push({ start: r.start, end: r.end });
  }
  if (slots.length > 12) errors.timeSlots = "Give at most 12 time slots.";
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max) : "");
  if (Object.keys(errors).length) return { value: null, errors };
  return {
    value: { days, timeSlots: slots.sort((a, b) => a.start.localeCompare(b.start)), frequency: text(input.frequency, 120), notes: text(input.notes, 500) },
    errors,
  };
}

export function mapScheduleInfo(raw: unknown): CourseScheduleInfo {
  const parsed = raw && typeof raw === "object" ? parseScheduleInfo(raw as Record<string, unknown>).value : null;
  return parsed ?? EMPTY_SCHEDULE_INFO;
}

// --- A student's agreed rate (immutable, dated history on the billing account) ---------------------------------

export interface AgreedRate {
  /** First billing month ("YYYY-MM") this rate applies to. */
  effectiveFrom: string;
  rateMinor: number;
}

/** The student's agreed rate for a class in `period`: the latest entry that has started. Null = none recorded. */
export function agreedRateForPeriod(rates: readonly AgreedRate[], period: string): number | null {
  const valid = rates.filter((r) => isPeriod(r.effectiveFrom) && paise(r.rateMinor) && r.effectiveFrom <= period).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return valid[0]?.rateMinor ?? null;
}

export function mapAgreedRates(raw: unknown): AgreedRate[] {
  return Array.isArray(raw)
    ? raw
        .map((r) => (r ?? {}) as Record<string, unknown>)
        .filter((r) => isPeriod(r.effectiveFrom) && paise(r.rateMinor))
        .map((r) => ({ effectiveFrom: r.effectiveFrom as string, rateMinor: r.rateMinor as number }))
    : [];
}

/**
 * A rate change for students who already enrolled starts from a FUTURE month
 * (classes already held keep their recorded rate), once per month.
 */
export function existingRateChangeError(effectiveFrom: unknown, currentPeriod: string, rates: readonly AgreedRate[]): string | null {
  if (!isPeriod(effectiveFrom)) return "Choose the first month the new rate applies to.";
  if (effectiveFrom <= currentPeriod) return "A rate change for enrolled students can start from next month at the earliest.";
  if (rates.some((r) => r.effectiveFrom === effectiveFrom)) return "A rate change already starts that month.";
  return null;
}
