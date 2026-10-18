// Billing — fee plans, packages, class credits and receipts.
//
// PURE module: no runtime imports, so it is unit-testable with Node's test
// runner and safe to use in Client Components. The server re-runs every rule
// here before writing anything; nothing the browser sends (prices, balances,
// credits, verification) is trusted.
//
// Money is always an integer number of paise (₹1 = 100 paise).
//
// Source of truth for the published fees: "Swaraanjanam Fee Structure"
// (regular courses, pair plan, Voice Culture). See PUBLISHED_PLANS.

// --- Categories -----------------------------------------------------------------

export const LEARNER_CATEGORIES = ["adult", "student"] as const;
export type LearnerCategory = (typeof LEARNER_CATEGORIES)[number];

export const LEARNER_CATEGORY_LABELS: Record<LearnerCategory, string> = {
  adult: "Adult (16 years and above)",
  student: "Student (15 years and below)",
};

/** Learners aged 16 and above pay the adult fee; 15 and below pay the student fee. */
export const ADULT_MIN_AGE = 16;

/** Category for an age in whole years. The teacher still confirms the category; no date of birth is stored. */
export function categoryForAge(age: unknown): LearnerCategory | null {
  if (typeof age !== "number" || !Number.isInteger(age) || age < 0 || age > 120) return null;
  return age >= ADULT_MIN_AGE ? "adult" : "student";
}

export function isLearnerCategory(value: unknown): value is LearnerCategory {
  return (LEARNER_CATEGORIES as readonly unknown[]).includes(value);
}

// --- Price plans ------------------------------------------------------------------

export const PLAN_KINDS = ["regular", "program"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_KIND_LABELS: Record<PlanKind, string> = {
  regular: "Regular course",
  program: "Short program",
};

export const PLAN_STATUSES = ["active", "coming_soon", "inactive"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  active: "Active",
  coming_soon: "Coming soon",
  inactive: "Inactive",
};

export const PAIR_TYPES = ["two_adults", "adult_student", "two_students"] as const;
export type PairType = (typeof PAIR_TYPES)[number];

export const PAIR_TYPE_LABELS: Record<PairType, string> = {
  two_adults: "2 adults",
  adult_student: "1 adult + 1 student",
  two_students: "2 students",
};

/** A fee plan as configured by the teacher (collection pricePlans/{planId}). */
export interface PricePlan {
  id: string;
  title: string;
  kind: PlanKind;
  level: string;
  /** Who it is for, e.g. "Kids, 5–12" or "All ages". Display only. */
  audience: string;
  /** LMS course whose lessons a learner gets when a package is assigned (optional). */
  courseId: string | null;
  /** Regular plans: price per package for each category; null = not offered. */
  adultPriceMinor: number | null;
  studentPriceMinor: number | null;
  /** Programs: one price for all ages. */
  flatPriceMinor: number | null;
  pairEligible: boolean;
  /** Exact published pair fees for both learners together; null = that pair type is not offered. */
  pairPricesMinor: Record<PairType, number | null>;
  /** Sessions (class credits) included in one package. */
  sessionsIncluded: number;
  sessionMinutes: number;
  /** Programs: length in weeks (Voice Culture: 6). Regular packages: null. */
  durationWeeks: number | null;
  sessionsPerWeek: number;
  status: PlanStatus;
  order: number;
  currency: string;
}

const NO_PAIR: Record<PairType, null> = { two_adults: null, adult_student: null, two_students: null };

/** The published fee structure, used to set up plans the first time. Teachers can edit them afterwards. */
export const PUBLISHED_PLANS: readonly PricePlan[] = [
  {
    id: "swara-foundation",
    title: "Swara Foundation",
    kind: "regular",
    level: "Beginner",
    audience: "All ages",
    courseId: null,
    adultPriceMinor: 160_000,
    studentPriceMinor: 150_000,
    flatPriceMinor: null,
    pairEligible: true,
    pairPricesMinor: { two_adults: 288_000, adult_student: 279_000, two_students: 270_000 },
    sessionsIncluded: 4,
    sessionMinutes: 60,
    durationWeeks: null,
    sessionsPerWeek: 1,
    status: "active",
    order: 1,
    currency: "INR",
  },
  {
    id: "little-swaras",
    title: "Little Swaras",
    kind: "regular",
    level: "Beginner",
    audience: "Kids, 5–12",
    courseId: null,
    // No adult price is published for Little Swaras.
    adultPriceMinor: null,
    studentPriceMinor: 150_000,
    flatPriceMinor: null,
    pairEligible: true,
    pairPricesMinor: { two_adults: 288_000, adult_student: 279_000, two_students: 270_000 },
    sessionsIncluded: 4,
    sessionMinutes: 60,
    durationWeeks: null,
    sessionsPerWeek: 1,
    status: "active",
    order: 2,
    currency: "INR",
  },
  {
    id: "devotional-music",
    title: "Devotional Music",
    kind: "regular",
    level: "All levels",
    audience: "All ages",
    courseId: null,
    adultPriceMinor: 160_000,
    studentPriceMinor: 150_000,
    flatPriceMinor: null,
    pairEligible: true,
    pairPricesMinor: { two_adults: 288_000, adult_student: 279_000, two_students: 270_000 },
    sessionsIncluded: 4,
    sessionMinutes: 60,
    durationWeeks: null,
    sessionsPerWeek: 1,
    status: "active",
    order: 3,
    currency: "INR",
  },
  {
    id: "geetha-pathway",
    title: "Geetha Pathway",
    kind: "regular",
    level: "Elementary",
    audience: "All ages",
    courseId: null,
    adultPriceMinor: 200_000,
    studentPriceMinor: 190_000,
    flatPriceMinor: null,
    pairEligible: false,
    pairPricesMinor: { ...NO_PAIR },
    sessionsIncluded: 4,
    sessionMinutes: 60,
    durationWeeks: null,
    sessionsPerWeek: 1,
    status: "coming_soon",
    order: 4,
    currency: "INR",
  },
  {
    id: "kriti-varnam-pathway",
    title: "Kriti & Varnam Pathway",
    kind: "regular",
    level: "Intermediate",
    audience: "All ages",
    courseId: null,
    adultPriceMinor: 250_000,
    studentPriceMinor: 240_000,
    flatPriceMinor: null,
    pairEligible: false,
    pairPricesMinor: { ...NO_PAIR },
    sessionsIncluded: 4,
    sessionMinutes: 60,
    durationWeeks: null,
    sessionsPerWeek: 1,
    status: "coming_soon",
    order: 5,
    currency: "INR",
  },
  {
    id: "personal-coaching",
    title: "1:1 Personal Coaching",
    kind: "regular",
    level: "Any level",
    audience: "All ages",
    courseId: null,
    adultPriceMinor: 320_000,
    studentPriceMinor: 300_000,
    flatPriceMinor: null,
    pairEligible: false,
    pairPricesMinor: { ...NO_PAIR },
    sessionsIncluded: 4,
    sessionMinutes: 60,
    durationWeeks: null,
    sessionsPerWeek: 1,
    status: "active",
    order: 6,
    currency: "INR",
  },
  {
    id: "voice-culture",
    title: "Voice Culture",
    kind: "program",
    level: "All levels",
    audience: "All ages",
    courseId: null,
    adultPriceMinor: null,
    studentPriceMinor: null,
    flatPriceMinor: 249_900,
    pairEligible: false,
    pairPricesMinor: { ...NO_PAIR },
    sessionsIncluded: 6,
    sessionMinutes: 60,
    durationWeeks: 6,
    sessionsPerWeek: 1,
    status: "active",
    order: 7,
    currency: "INR",
  },
];

export function isPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Deep copy of the plan as it is right now. Stored on a package so later price edits never change it. */
export function snapshotPlan(plan: PricePlan): PricePlan {
  return { ...plan, pairPricesMinor: { ...plan.pairPricesMinor } };
}

// --- Quotes --------------------------------------------------------------------------

export const PACKAGE_TYPES = ["regular", "pair", "program"] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

export const PACKAGE_TYPE_LABELS: Record<PackageType, string> = {
  regular: "Regular package",
  pair: "Pair package",
  program: "Short program",
};

export type PriceBasis = LearnerCategory | "flat" | PairType;

export type Quote =
  | {
      ok: true;
      priceMinor: number;
      sessionsIncluded: number;
      basis: PriceBasis;
      /**
       * Set when the published table does not explicitly cover this combination
       * (an adult in a pair for a plan with no adult price, e.g. a parent learning
       * with a child in Little Swaras). The teacher must confirm it explicitly.
       */
      needsConfirmation: string | null;
    }
  | { ok: false; error: string };

export function pairTypeOf(categories: readonly LearnerCategory[]): PairType {
  const adults = categories.filter((c) => c === "adult").length;
  return adults >= 2 ? "two_adults" : adults === 1 ? "adult_student" : "two_students";
}

/** Server-side price calculation. Prices come only from the plan, never from the request. */
export function quotePackage(plan: PricePlan, type: PackageType, categories: readonly LearnerCategory[]): Quote {
  if (plan.status === "coming_soon") return { ok: false, error: `${plan.title} is coming soon and is not open for enrolment yet.` };
  if (plan.status !== "active") return { ok: false, error: `${plan.title} is not currently offered.` };
  if (!categories.every(isLearnerCategory)) return { ok: false, error: "Choose a fee category for each learner." };
  if (!Number.isInteger(plan.sessionsIncluded) || plan.sessionsIncluded < 1) {
    return { ok: false, error: `${plan.title} has no sessions configured.` };
  }
  const result = (priceMinor: number | null, basis: PriceBasis, needsConfirmation: string | null = null): Quote =>
    isPaise(priceMinor)
      ? { ok: true, priceMinor, sessionsIncluded: plan.sessionsIncluded, basis, needsConfirmation }
      : { ok: false, error: `${plan.title} has no fee configured for this option.` };

  if (plan.kind === "program") {
    if (type !== "program") return { ok: false, error: `${plan.title} is a short program, not a ${PACKAGE_TYPE_LABELS[type].toLowerCase()}.` };
    if (categories.length !== 1) return { ok: false, error: "A program package is for one learner." };
    return result(plan.flatPriceMinor, "flat");
  }

  if (type === "program") return { ok: false, error: `${plan.title} is a regular course, not a short program.` };

  if (type === "regular") {
    if (categories.length !== 1) return { ok: false, error: "A regular package is for one learner." };
    const category = categories[0];
    const price = category === "adult" ? plan.adultPriceMinor : plan.studentPriceMinor;
    if (price === null) {
      return { ok: false, error: `${plan.title} is not offered at the ${category} fee.` };
    }
    return result(price, category);
  }

  // Pair plan.
  if (!plan.pairEligible) return { ok: false, error: `The pair plan does not apply to ${plan.title}.` };
  if (categories.length !== 2) return { ok: false, error: "A pair package is for exactly two learners." };
  const pairType = pairTypeOf(categories);
  const price = plan.pairPricesMinor[pairType];
  if (price === null) return { ok: false, error: `${plan.title} has no published pair fee for ${PAIR_TYPE_LABELS[pairType]}.` };
  const needsConfirmation =
    plan.adultPriceMinor === null && categories.includes("adult")
      ? `The published fee table has no adult fee for ${plan.title}. Confirm that the published “${PAIR_TYPE_LABELS[pairType]}” pair fee applies to this adult learner (for example a parent learning with a child).`
      : null;
  return result(price, pairType, needsConfirmation);
}

// --- Plan editing (teacher input) -----------------------------------------------------

export const PLAN_LIMITS = {
  title: 120,
  shortText: 60,
  maxPriceMinor: 10_000_000 * 100,
  maxSessions: 52,
  minMinutes: 15,
  maxMinutes: 240,
  maxWeeks: 104,
} as const;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max) : "";
}

/**
 * Rupees (as typed: "1,600", "2499", "₹ 99.50") → paise.
 * Returns null for empty, undefined for invalid.
 */
export function parseRupees(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/[,\s₹]/g, "") : "";
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const [whole, fraction = ""] = text.split(".");
  // String arithmetic, so no floating-point rounding can creep in.
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return minor > 0 && minor <= PLAN_LIMITS.maxPriceMinor ? minor : undefined;
}

function wholeNumber(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

export type PlanEdit = Omit<PricePlan, "id" | "kind" | "order" | "currency">;

/** Validates a plan edit. The plan's kind (regular/program) never changes. */
export function parsePlanInput(kind: PlanKind, input: Record<string, unknown>): { value: PlanEdit | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = clean(input.title, PLAN_LIMITS.title);
  if (!title) errors.title = "Enter a name.";
  const status = (PLAN_STATUSES as readonly unknown[]).includes(input.status) ? (input.status as PlanStatus) : undefined;
  if (!status) errors.status = "Choose a status.";

  const money = (key: string) => {
    const v = parseRupees(input[key]);
    if (v === undefined) errors[key] = "Enter an amount in rupees (up to 2 decimal places), or leave it empty.";
    return v ?? null;
  };
  const adultPriceMinor = kind === "regular" ? money("adultPrice") : null;
  const studentPriceMinor = kind === "regular" ? money("studentPrice") : null;
  const flatPriceMinor = kind === "program" ? money("flatPrice") : null;
  const pairEligible = kind === "regular" && (input.pairEligible === true || input.pairEligible === "on");
  const pairPricesMinor: Record<PairType, number | null> = { ...NO_PAIR };
  if (kind === "regular") {
    for (const t of PAIR_TYPES) pairPricesMinor[t] = money(`pair_${t}`);
  }

  if (kind === "regular" && !errors.adultPrice && !errors.studentPrice && adultPriceMinor === null && studentPriceMinor === null) {
    errors.studentPrice = "Set at least one of the adult or student fees.";
  }
  if (kind === "program" && !errors.flatPrice && flatPriceMinor === null) errors.flatPrice = "Enter the program fee.";
  if (pairEligible && PAIR_TYPES.every((t) => pairPricesMinor[t] === null) && !PAIR_TYPES.some((t) => errors[`pair_${t}`])) {
    errors.pair_two_students = "Enter at least one pair fee, or turn the pair plan off.";
  }

  const sessionsIncluded = wholeNumber(input.sessionsIncluded, 1, PLAN_LIMITS.maxSessions);
  if (sessionsIncluded === undefined) errors.sessionsIncluded = `Enter a whole number from 1 to ${PLAN_LIMITS.maxSessions}.`;
  const sessionMinutes = wholeNumber(input.sessionMinutes, PLAN_LIMITS.minMinutes, PLAN_LIMITS.maxMinutes);
  if (sessionMinutes === undefined) errors.sessionMinutes = `Enter minutes from ${PLAN_LIMITS.minMinutes} to ${PLAN_LIMITS.maxMinutes}.`;
  const sessionsPerWeek = wholeNumber(input.sessionsPerWeek, 1, 7);
  if (sessionsPerWeek === undefined) errors.sessionsPerWeek = "Enter a number from 1 to 7.";
  let durationWeeks: number | null = null;
  const weeksRaw = typeof input.durationWeeks === "string" ? input.durationWeeks.trim() : input.durationWeeks;
  if (weeksRaw !== "" && weeksRaw !== null && weeksRaw !== undefined) {
    const w = wholeNumber(weeksRaw, 1, PLAN_LIMITS.maxWeeks);
    if (w === undefined) errors.durationWeeks = `Enter weeks from 1 to ${PLAN_LIMITS.maxWeeks}, or leave it empty.`;
    else durationWeeks = w;
  } else if (kind === "program") {
    errors.durationWeeks = "Enter the program length in weeks.";
  }

  const courseIdRaw = clean(input.courseId, 128);
  const courseId = courseIdRaw && /^[A-Za-z0-9_-]{1,128}$/.test(courseIdRaw) ? courseIdRaw : null;
  if (courseIdRaw && !courseId) errors.courseId = "Choose a course from the list.";

  if (Object.keys(errors).length > 0) return { value: null, errors };
  return {
    value: {
      title,
      level: clean(input.level, PLAN_LIMITS.shortText),
      audience: clean(input.audience, PLAN_LIMITS.shortText),
      courseId,
      adultPriceMinor,
      studentPriceMinor,
      flatPriceMinor,
      pairEligible,
      pairPricesMinor,
      sessionsIncluded: sessionsIncluded!,
      sessionMinutes: sessionMinutes!,
      durationWeeks,
      sessionsPerWeek: sessionsPerWeek!,
      status: status!,
    },
    errors,
  };
}

// --- Packages ---------------------------------------------------------------------------

export const PACKAGE_STATUSES = ["awaiting_payment", "active", "credits_used", "cancelled"] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const PACKAGE_STATUS_LABELS: Record<PackageStatus, string> = {
  awaiting_payment: "Awaiting payment",
  active: "Active",
  credits_used: "All classes used",
  cancelled: "Cancelled",
};

export interface PackageLearner {
  studentId: string;
  category: LearnerCategory;
  /** Name/email at assignment time (display only; identity is studentId). */
  name: string;
}

/** Client-generated request key: makes "Assign package" safe to retry (same key → same package). */
const REQUEST_KEY = /^[A-Za-z0-9-]{16,64}$/;

export function packageIdFor(requestKey: unknown): string | null {
  return typeof requestKey === "string" && REQUEST_KEY.test(requestKey) ? `pkg_${requestKey}` : null;
}

export interface PackageDraft {
  type: PackageType;
  planId: string;
  plan: PricePlan;
  priceMinor: number;
  currency: string;
  priceBasis: PriceBasis;
  learners: PackageLearner[];
  learnerIds: string[];
  courseId: string | null;
  sessionsIncluded: number;
  /** Set when the teacher confirmed a combination the published table does not cover. */
  confirmation: { question: string; reason: string } | null;
}

/**
 * Builds a new package from a plan and learners, using quotePackage for the
 * price. Fails instead of guessing whenever the request does not fit the plan.
 */
export function buildPackageDraft(
  plan: PricePlan,
  type: PackageType,
  learners: readonly PackageLearner[],
  confirmationReason: string | null = null,
): { ok: true; draft: PackageDraft } | { ok: false; error: string; needsConfirmation?: string } {
  const ids = learners.map((l) => l.studentId);
  if (ids.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) return { ok: false, error: "Choose a registered student for each learner." };
  if (new Set(ids).size !== ids.length) return { ok: false, error: "The two learners in a pair must be different students." };
  const quote = quotePackage(
    plan,
    type,
    learners.map((l) => l.category),
  );
  if (!quote.ok) return quote;
  if (quote.needsConfirmation && !confirmationReason?.trim()) {
    return { ok: false, error: "This combination needs your explicit confirmation.", needsConfirmation: quote.needsConfirmation };
  }
  return {
    ok: true,
    draft: {
      type,
      planId: plan.id,
      plan: snapshotPlan(plan),
      priceMinor: quote.priceMinor,
      currency: plan.currency,
      priceBasis: quote.basis,
      learners: learners.map((l) => ({ ...l })),
      learnerIds: ids,
      courseId: plan.courseId,
      sessionsIncluded: quote.sessionsIncluded,
      confirmation: quote.needsConfirmation ? { question: quote.needsConfirmation, reason: confirmationReason!.trim() } : null,
    },
  };
}

// --- Balances -----------------------------------------------------------------------------

export interface PaymentLike {
  amountMinor: number;
  status: "pending" | "paid" | "failed" | "refunded";
  verified: boolean;
}

export const ADJUSTMENT_KINDS = ["refund", "waiver", "credit"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_KIND_LABELS: Record<AdjustmentKind, string> = {
  refund: "Refund (money returned)",
  waiver: "Fee waiver / approved discount",
  credit: "Class credit adjustment",
};

export interface AdjustmentLike {
  kind: AdjustmentKind;
  /** refund / waiver: positive paise. */
  amountMinor: number;
  /** credit: whole classes added (positive) or removed (negative). */
  credits: number;
}

/** Paid AND verified. Pending, failed (rejected) and unverified payments never count. */
export function countsAsReceived(p: Pick<PaymentLike, "status" | "verified">): boolean {
  return p.status === "paid" && p.verified;
}

export type PaymentState = "unpaid" | "partial" | "paid";

export interface PackageSummary {
  priceMinor: number;
  waivedMinor: number;
  /** price − waivers. */
  dueMinor: number;
  receivedMinor: number;
  refundedMinor: number;
  /** received − refunds. */
  netPaidMinor: number;
  pendingMinor: number;
  /** due − net paid; negative = overpaid. */
  balanceMinor: number;
  paymentState: PaymentState;
  creditsTotal: number;
  creditsUsed: number;
  creditsRemaining: number;
}

export function summarizePackage(input: {
  priceMinor: number;
  sessionsIncluded: number;
  creditsUsed: number;
  payments: readonly PaymentLike[];
  adjustments: readonly AdjustmentLike[];
}): PackageSummary {
  const sum = (values: number[]) => values.reduce((s, v) => s + (Number.isSafeInteger(v) ? v : 0), 0);
  const receivedMinor = sum(input.payments.filter(countsAsReceived).map((p) => p.amountMinor));
  const pendingMinor = sum(input.payments.filter((p) => p.status === "pending").map((p) => p.amountMinor));
  const refundedMinor = sum(input.adjustments.filter((a) => a.kind === "refund").map((a) => a.amountMinor));
  const waivedMinor = sum(input.adjustments.filter((a) => a.kind === "waiver").map((a) => a.amountMinor));
  const creditAdjustment = sum(input.adjustments.filter((a) => a.kind === "credit").map((a) => a.credits));
  const dueMinor = Math.max(input.priceMinor - waivedMinor, 0);
  const netPaidMinor = receivedMinor - refundedMinor;
  const balanceMinor = dueMinor - netPaidMinor;
  const creditsTotal = Math.max(input.sessionsIncluded + creditAdjustment, 0);
  return {
    priceMinor: input.priceMinor,
    waivedMinor,
    dueMinor,
    receivedMinor,
    refundedMinor,
    netPaidMinor,
    pendingMinor,
    balanceMinor,
    paymentState: balanceMinor <= 0 ? "paid" : netPaidMinor > 0 ? "partial" : "unpaid",
    creditsTotal,
    creditsUsed: input.creditsUsed,
    creditsRemaining: Math.max(creditsTotal - input.creditsUsed, 0),
  };
}

/** A package becomes active automatically only once it is fully paid (verified). */
export function statusAfterPayment(status: PackageStatus, summary: Pick<PackageSummary, "paymentState">): PackageStatus {
  return status === "awaiting_payment" && summary.paymentState === "paid" ? "active" : status;
}

export type NextPayment =
  | { kind: "balance_due"; amountMinor: number }
  | { kind: "renewal_due" }
  | { kind: "renewal_after"; classesLeft: number }
  | { kind: "none" };

/**
 * What the learner owes next. There are no calendar due dates, so nothing is
 * ever reported as overdue. Regular packages: the next package is due after the
 * last class of this one. Programs are one-time.
 */
export function nextPayment(type: PackageType, status: PackageStatus, summary: PackageSummary): NextPayment {
  if (status === "cancelled") return { kind: "none" };
  if (summary.balanceMinor > 0) return { kind: "balance_due", amountMinor: summary.balanceMinor };
  if (type === "program") return { kind: "none" };
  if (summary.creditsRemaining === 0) return { kind: "renewal_due" };
  return { kind: "renewal_after", classesLeft: summary.creditsRemaining };
}

// --- Class credits ------------------------------------------------------------------------

/**
 * Credit rules for one class outcome:
 *   attended → consumes one credit
 *   absent   → consumes one credit (a class missed by the student is counted)
 *   unknown  → consumes nothing; a package class cannot be finalised with it
 *   cancelled by the academy (cancelClass) → consumes nothing, carries forward
 * `ledgerExists` = this package+session was already charged (re-recorded
 * outcome, retried request, or the other learner of a pair session).
 */
export function outcomeCredit(input: {
  packageLinked: boolean;
  attendance: "attended" | "absent" | "unknown";
  ledgerExists: boolean;
}): { ok: true; consume: boolean } | { ok: false; error: string } {
  if (!input.packageLinked) return { ok: true, consume: false };
  if (input.attendance === "unknown") {
    return { ok: false, error: "This class uses a package credit. Choose Attended or Absent before marking it completed." };
  }
  return { ok: true, consume: !input.ledgerExists };
}

/** Ledger document id: one consumption per package and shared session, ever. */
export function creditLedgerId(packageId: string, sessionKey: string): string {
  return `${packageId}_${sessionKey}`;
}

export interface PackageClassLike {
  sessionKey: string;
  status: "scheduled" | "completed" | "cancelled";
}

/**
 * Credits still free for NEW classes: remaining credits minus sessions already
 * scheduled but not yet charged. Pair sessions (two class records, one
 * sessionKey) count once. A session with a completed record is already charged.
 */
export function creditsAvailableToSchedule(creditsRemaining: number, classes: readonly PackageClassLike[]): number {
  const charged = new Set(classes.filter((c) => c.status === "completed").map((c) => c.sessionKey));
  const open = new Set(classes.filter((c) => c.status === "scheduled" && !charged.has(c.sessionKey)).map((c) => c.sessionKey));
  return creditsRemaining - open.size;
}

export function schedulingBlock(status: PackageStatus, available: number): string | null {
  if (status === "awaiting_payment") return "This package is awaiting payment. Record and verify the payment, or activate it with a recorded reason, before scheduling.";
  if (status === "cancelled") return "This package has been cancelled.";
  if (status === "credits_used" || available <= 0) return "This package has no class credits left. Assign the next package first.";
  return null;
}

export function statusAfterConsumption(status: PackageStatus, creditsRemaining: number): PackageStatus {
  return status === "active" && creditsRemaining <= 0 ? "credits_used" : status;
}

// --- Payment references & receipts ------------------------------------------------------------

/** Reference normalised for duplicate detection: case and spaces never make a different payment. */
export function normalizeReference(reference: string): string {
  return reference.replace(/\s+/g, "").toUpperCase();
}

/** "UTR123456789" → "••••6789". Students and reports only ever see this form. */
export function maskReference(reference: string | null | undefined): string | null {
  if (!reference) return null;
  const compact = reference.replace(/\s+/g, "");
  return compact.length <= 4 ? "••••" : `••••${compact.slice(-4)}`;
}

/** SWR-2026-00042. The sequence comes from a transaction-guarded counter, so numbers never repeat. */
export function formatReceiptNumber(sequence: number, year: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Invalid receipt sequence");
  return `SWR-${year}-${String(sequence).padStart(5, "0")}`;
}

export const RECEIPT_STATUSES = ["valid", "refunded"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

// --- Authorisation predicates (used by the server; kept pure for tests) -------------------------

export interface Viewer {
  uid: string;
  role: "teacher" | "student";
}

/** Teachers see everything; a student only records that list them as a learner. */
export function canViewLearnerRecord(viewer: Viewer, record: { learnerIds: readonly string[] }): boolean {
  return viewer.role === "teacher" || (viewer.role === "student" && record.learnerIds.includes(viewer.uid));
}

/** Payments: a student sees their own legacy payments and payments of their own packages. */
export function canViewPayment(viewer: Viewer, payment: { studentId: string; learnerIds: readonly string[] }): boolean {
  if (viewer.role === "teacher") return true;
  return viewer.role === "student" && (payment.studentId === viewer.uid || payment.learnerIds.includes(viewer.uid));
}

/** What a student may see of a payment. No notes, history, staff emails or full reference. */
export function toStudentPayment<
  P extends {
    id: string;
    amountMinor: number;
    currency: string;
    method: string;
    reference: string | null;
    paidAt: string | null;
    status: PaymentLike["status"];
    verified: boolean;
    packageId: string | null;
  },
>(p: P) {
  return {
    id: p.id,
    amountMinor: p.amountMinor,
    currency: p.currency,
    method: p.method,
    referenceMasked: maskReference(p.reference),
    paidAt: p.paidAt,
    status: p.status,
    verified: p.verified,
    packageId: p.packageId,
  };
}

// --- Reports -----------------------------------------------------------------------------------

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Calendar period of an instant in India time: "2026-10" (month) or "2026-W42" (ISO week). */
export function istPeriod(iso: string, period: "month" | "week"): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + IST_OFFSET_MS); // read with getUTC* = IST wall clock
  if (period === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  // ISO-8601 week: the week belongs to the year of its Thursday.
  const day = d.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - day));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface RevenueRow {
  period: string;
  receivedMinor: number;
  receivedCount: number;
  refundedMinor: number;
  netMinor: number;
}

/**
 * Revenue per period: verified payments by payment date, minus refunds by
 * refund date. Pending, rejected and unverified payments are excluded.
 */
export function revenueByPeriod(
  payments: readonly (PaymentLike & { paidAt: string | null })[],
  refunds: readonly { amountMinor: number; at: string | null }[],
  period: "month" | "week",
): RevenueRow[] {
  const rows = new Map<string, RevenueRow>();
  const row = (key: string) => {
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { period: key, receivedMinor: 0, receivedCount: 0, refundedMinor: 0, netMinor: 0 }));
    return r;
  };
  for (const p of payments) {
    const key = countsAsReceived(p) && p.paidAt ? istPeriod(p.paidAt, period) : null;
    if (!key) continue;
    const r = row(key);
    r.receivedMinor += p.amountMinor;
    r.receivedCount += 1;
  }
  for (const f of refunds) {
    const key = f.at ? istPeriod(f.at, period) : null;
    if (!key) continue;
    row(key).refundedMinor += f.amountMinor;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, netMinor: r.receivedMinor - r.refundedMinor }))
    .sort((a, b) => b.period.localeCompare(a.period));
}

/** Rupee string for CSV cells: 279000 → "2790.00". */
export function paiseToRupeesText(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// --- CSV report rows ---------------------------------------------------------------------------
//
// Reports are teacher-only, but they still leave out private details: no
// student emails or phone numbers, no teacher notes, and payment references
// only in masked form.

export const PACKAGE_REPORT_HEADERS = [
  "Assigned", "Package", "Type", "Learners", "Categories", "Status", "Price", "Paid (verified, net)", "Pending",
  "Balance", "Payment state", "Classes included", "Classes used", "Classes left", "Sessions completed", "Cancelled by academy (carried forward)",
];

export function packageReportRow(p: {
  createdAt: string | null;
  title: string;
  type: PackageType;
  status: PackageStatus;
  priceMinor: number;
  learners: readonly { name: string; category: LearnerCategory }[];
  summary: PackageSummary;
  classesCompleted: number;
  sessionsCarriedForward: number;
}): (string | number)[] {
  return [
    p.createdAt?.slice(0, 10) ?? "",
    p.title,
    PACKAGE_TYPE_LABELS[p.type],
    p.learners.map((l) => l.name).join(" + "),
    p.learners.map((l) => l.category).join(" + "),
    PACKAGE_STATUS_LABELS[p.status],
    paiseToRupeesText(p.priceMinor),
    paiseToRupeesText(p.summary.netPaidMinor),
    paiseToRupeesText(p.summary.pendingMinor),
    paiseToRupeesText(p.summary.balanceMinor),
    p.summary.paymentState,
    p.summary.creditsTotal,
    p.summary.creditsUsed,
    p.summary.creditsRemaining,
    p.classesCompleted,
    p.sessionsCarriedForward,
  ];
}

export const PAYMENT_REPORT_HEADERS = [
  "Payment date", "Student", "For", "Amount", "Currency", "Method", "Reference (masked)", "Paid by", "Status", "Verified",
  "Counts as received", "Rejection reason", "Source", "Receipt",
];

export function paymentReportRow(p: {
  paidAt: string | null;
  studentName: string;
  courseTitle: string;
  amountMinor: number;
  currency: string;
  methodLabel: string;
  reference: string | null;
  payerName: string | null;
  status: PaymentLike["status"];
  verified: boolean;
  rejectionReason: string | null;
  source: string;
  receiptId: string | null;
}): (string | number)[] {
  return [
    p.paidAt?.slice(0, 10) ?? "",
    p.studentName,
    p.courseTitle,
    paiseToRupeesText(p.amountMinor),
    p.currency,
    p.methodLabel,
    maskReference(p.reference) ?? "",
    p.payerName ?? "",
    p.status === "failed" ? "rejected/failed" : p.status,
    p.verified ? "yes" : "no",
    countsAsReceived(p) ? "yes" : "no",
    p.rejectionReason ?? "",
    p.source,
    p.receiptId ? "issued" : "",
  ];
}
