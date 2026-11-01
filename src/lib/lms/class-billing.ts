// Class-based billing (batches and individual sessions) — PURE rules.
//
// No runtime imports: unit-tested with Node's runner and safe in Client
// Components. The server applies these rules inside Firestore transactions
// (lib/lms/server/class-billing.ts); nothing the browser sends is trusted.
// All business dates use India Standard Time (Asia/Kolkata, UTC+05:30, no DST).
// Money is always integer paise.
//
// CONFIRMED BY THE ACADEMY
// Batch classes (four-week billing cycles):
//   * ₹400 per student per eligible class.
//   * The ₹400 paid at enrolment (the "first-class payment", stored as the
//     account's advance) pays for the student's FIRST eligible class. That class
//     is never invoiced. Its Meet link is withheld until the payment is verified.
//   * Week 1 starts on the IST date of the student's first eligible class.
//     Cycle k covers weeks 4k−3 … 4k. Its invoice lists the eligible classes
//     actually held (cycle 1: classes 2–4 = ₹1,200; then four classes = ₹1,600),
//     never future or invented classes — a cancelled class gives a smaller invoice.
//   * The invoice is issued once a class in the cycle's final week has been
//     recorded, or at the checkpoint (end of week 4k) at the latest. It is due
//     at the checkpoint; unpaid after it → reversible suspension (Meet links,
//     lessons, materials) until the payment is verified.
//   * Attended and absent are billable. Academy cancellation is not billable.
//     A rescheduled occurrence is not billed; the replacement is billed when held.
//     Unknown attendance is not billed until a billable outcome is recorded.
//   * Monthly invoices (the previous model) are no longer generated; any that
//     exist are kept as read-only history with their original deadlines.
// Individual one-to-one sessions:
//   * ₹750 per session, each paid separately (never on a batch cycle invoice).
//   * Student cancellation ≥ 24 h before the start: no charge; < 24 h: payable.
//   * Academy cancellation: no charge. Rescheduling never creates a second charge.
// Rates: versioned; a change applies to everyone from the next calendar month.
// Transition: website billing starts with November 2026; earlier fees stay with
// the previous payment method, and an administrator must verify old dues first.

// --- Periods (calendar months in IST) ------------------------------------------------------

const IST_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 86_400_000;

/** First month billed through the website. Classes before it are never charged here. */
export const BILLING_START_PERIOD = "2026-11";

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriod(value: unknown): value is string {
  return typeof value === "string" && PERIOD.test(value);
}

/** "YYYY-MM" of an instant, in IST. */
export function periodOf(iso: string): string {
  const d = new Date(Date.parse(iso) + IST_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Instant (ms) at which a period starts: 00:00:00.000 IST on the 1st. */
export function periodStartMs(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return Date.UTC(y, m - 1, 1) - IST_MS;
}

/** Whether classes of this period are billed by the website (from November 2026). */
export function isWebsiteBilledPeriod(period: string): boolean {
  return isPeriod(period) && period >= BILLING_START_PERIOD;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11" → "November 2026" (fixed names: identical on server and browser). */
export function periodLabel(period: string): string {
  if (!isPeriod(period)) return period;
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// --- Previous monthly model: due dates (only to show existing monthly invoices) -------------------

/** Grace period after a monthly invoice's due date (calendar days). */
export const GRACE_DAYS = 7;

/**
 * Due date: the last instant of the billed month in IST (e.g. November 2026 →
 * 30 Nov 2026 23:59:59.999 IST = 2026-11-30T18:29:59.999Z).
 */
export function invoiceDueAt(period: string): string {
  return new Date(periodStartMs(nextPeriod(period)) - 1).toISOString();
}

/**
 * Payment deadline: end of the 7th calendar day after the due date, IST
 * (November 2026 → 7 Dec 2026 23:59:59.999 IST = 2026-12-07T18:29:59.999Z).
 * A payment verified at or before this instant is on time.
 */
export function paymentDeadline(period: string): string {
  return new Date(periodStartMs(nextPeriod(period)) + GRACE_DAYS * DAY_MS - 1).toISOString();
}

export type DueState = "not_due" | "grace" | "overdue";

// --- Rates (versioned, next-month changes) ----------------------------------------------------

export const BILLING_MODES = ["batch", "individual"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  batch: "Batch classes (four-week cycles)",
  individual: "Individual sessions (pay per session)",
};

export interface RateVersion {
  /** Stable id stored on every charge. */
  id: string;
  /** First month ("YYYY-MM") this version applies to, for every student. */
  effectiveFrom: string;
  /** Per student per billable batch class. */
  batchMinor: number;
  /** Per individual session. */
  individualMinor: number;
  /** One-time enrolment advance for batch students. */
  batchAdvanceMinor: number;
}

export const DEFAULT_RATE_VERSION: RateVersion = {
  id: "v1",
  effectiveFrom: BILLING_START_PERIOD,
  batchMinor: 40_000,
  individualMinor: 75_000,
  batchAdvanceMinor: 40_000,
};

const paise = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Version in force for a billing month: the latest effectiveFrom ≤ period. */
export function rateVersionForPeriod(versions: readonly RateVersion[], period: string): RateVersion {
  const valid = versions
    .filter((v) => isPeriod(v.effectiveFrom) && paise(v.batchMinor) && paise(v.individualMinor) && paise(v.batchAdvanceMinor) && v.effectiveFrom <= period)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return valid[0] ?? DEFAULT_RATE_VERSION;
}

/**
 * A rate change applies from the NEXT calendar month at the earliest, so a
 * month that has started is never repriced. Returns an error message or null.
 */
export function rateChangeError(effectiveFrom: string, nowIso: string, versions: readonly RateVersion[]): string | null {
  if (!isPeriod(effectiveFrom)) return "Choose a month.";
  if (effectiveFrom <= periodOf(nowIso)) return "A new rate can start from next month at the earliest.";
  if (versions.some((v) => v.effectiveFrom === effectiveFrom)) return "A rate change already starts that month.";
  return null;
}

// --- Policy (only genuinely unconfirmed items remain configurable) ---------------------------------

export interface BillingPolicy {
  /** Batch class cancelled by the STUDENT (not specified by the academy). Default: not billable. */
  batchStudentCancelled: "not_billable" | "billable";
  /** Must the batch advance be verified before classes are scheduled? (Not specified.) Default: no. */
  advanceBeforeScheduling: boolean;
}

export const DEFAULT_POLICY: BillingPolicy = { batchStudentCancelled: "not_billable", advanceBeforeScheduling: false };

export const PENDING_DECISIONS: { key: string; question: string }[] = [
  { key: "batchStudentCancelled", question: "Batch classes: is a class cancelled by the student billable? (Default: not billed.)" },
  { key: "noFinalWeekClass", question: "If no class takes place in a cycle's final week, the invoice is issued at the checkpoint and is due at once (access pauses until paid). Should a grace period apply in that case?" },
  { key: "firstClassRateChange", question: "If the per-class rate changes, does the ₹400 first-class payment still cover the whole first class? (Currently: yes, no top-up or credit.)" },
  { key: "restoration", question: "Restoration is automatic once every invoice past its deadline is paid. Should any other condition apply?" },
  { key: "rescheduledPaidSession", question: "Individual session paid and then cancelled for rescheduling: transfer to the new session or refund? (Flagged for review.)" },
];

export function parsePolicy(input: Record<string, unknown>): { value: BillingPolicy | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const v = input.batchStudentCancelled;
  if (v !== "not_billable" && v !== "billable") errors.batchStudentCancelled = "Choose an option.";
  if (Object.keys(errors).length) return { value: null, errors };
  return {
    value: {
      batchStudentCancelled: v as BillingPolicy["batchStudentCancelled"],
      advanceBeforeScheduling: input.advanceBeforeScheduling === true || input.advanceBeforeScheduling === "on",
    },
    errors,
  };
}

// --- Outcomes ----------------------------------------------------------------------------------------

export const CLASS_OUTCOMES = ["attended", "absent", "unknown", "academy_cancelled", "student_cancelled", "rescheduled"] as const;
export type ClassOutcome = (typeof CLASS_OUTCOMES)[number];

export const CLASS_OUTCOME_LABELS: Record<ClassOutcome, string> = {
  attended: "Attended",
  absent: "Student absent",
  unknown: "Attendance unknown",
  academy_cancelled: "Cancelled by the academy",
  student_cancelled: "Cancelled by the student",
  rescheduled: "Rescheduled (moved)",
};

/** Batch class: whether one student's outcome creates a charge. */
export function isBatchBillable(outcome: ClassOutcome, policy: BillingPolicy): boolean {
  switch (outcome) {
    case "attended":
    case "absent":
      return true;
    case "student_cancelled":
      return policy.batchStudentCancelled === "billable";
    case "academy_cancelled": // confirmed: not billable
    case "rescheduled": // the replacement occurrence is billed when held
    case "unknown": // no charge until a billable outcome is recorded
      return false;
  }
}

// --- Individual sessions -------------------------------------------------------------------------------

export const FREE_CANCELLATION_HOURS = 24;

/**
 * Charge after an individual session is cancelled. Uses the SERVER time of
 * the cancellation. Exactly 24 hours before the start counts as "at least 24 hours".
 */
export function individualCancellationCharge(input: {
  kind: "academy" | "student" | "rescheduled";
  startAtMs: number;
  cancelledAtMs: number;
}): "no_charge" | "payable" {
  if (input.kind !== "student") return "no_charge";
  return input.startAtMs - input.cancelledAtMs >= FREE_CANCELLATION_HOURS * 3_600_000 ? "no_charge" : "payable";
}

export const SESSION_CHARGE_STATUSES = ["due", "paid", "no_charge"] as const;
export type SessionChargeStatus = (typeof SESSION_CHARGE_STATUSES)[number];

export const SESSION_CHARGE_LABELS: Record<SessionChargeStatus, string> = {
  due: "Payment due",
  paid: "Paid",
  no_charge: "No charge",
};

export function sessionChargeId(classId: string): string {
  return `sc_${classId}`;
}

// --- Advance ledger -------------------------------------------------------------------------------------

export const ADVANCE_STATUSES = ["not_required", "awaiting", "verified", "applied", "refunded"] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  not_required: "Not required",
  awaiting: "Awaiting payment",
  verified: "Paid — covers the first class",
  // Previous monthly model only: the advance was credited to a monthly invoice.
  applied: "Applied to a monthly invoice",
  // Historical status name: only ever set when a payment recorded in error is reversed.
  refunded: "Reversed (payment error)",
};

/** Approved policy: the batch enrolment advance is non-refundable, including when a student stops early. */
export const ADVANCE_NON_REFUNDABLE = true;
export const ADVANCE_POLICY_TEXT = "The first-class payment is non-refundable, including if the student stops early. It pays for the first class, which is never invoiced again.";

/**
 * The only way to undo a recorded advance payment: correcting a payment
 * mistake. It is never a refund for leaving; the advance becomes owed again.
 */
export const ADVANCE_CORRECTION_REASONS = ["duplicate_payment", "wrong_student", "wrong_amount", "not_received"] as const;
export type AdvanceCorrectionReason = (typeof ADVANCE_CORRECTION_REASONS)[number];
export const ADVANCE_CORRECTION_LABELS: Record<AdvanceCorrectionReason, string> = {
  duplicate_payment: "Duplicate payment (paid twice)",
  wrong_student: "Recorded for the wrong student",
  wrong_amount: "Wrong amount recorded",
  not_received: "Money was not actually received",
};

/** Null when an advance payment may be reversed, otherwise why not. */
export function advanceReversalError(input: { reason: unknown; appliedMinor: number }): string | null {
  if (input.appliedMinor > 0) return "This advance has already been applied to an invoice. Record a debit note on that invoice instead.";
  if (!(ADVANCE_CORRECTION_REASONS as readonly unknown[]).includes(input.reason)) {
    return "The enrolment advance is non-refundable. It can only be reversed to correct a payment mistake — choose which mistake.";
  }
  return null;
}

export interface AdvanceState {
  status: AdvanceStatus;
  amountMinor: number;
  /** Previous monthly model only: amount credited to monthly invoices. Always 0 for cycle billing. */
  appliedMinor: number;
  paymentId: string | null;
}

export function initialAdvance(mode: BillingMode, version: RateVersion): AdvanceState {
  return mode === "batch" && paise(version.batchAdvanceMinor)
    ? { status: "awaiting", amountMinor: version.batchAdvanceMinor, appliedMinor: 0, paymentId: null }
    : { status: "not_required", amountMinor: 0, appliedMinor: 0, paymentId: null };
}

// --- Invoices: four-week cycles ------------------------------------------------------------------------

export function accountIdFor(studentId: string, courseId: string, mode: BillingMode): string {
  return `ba_${studentId}_${courseId}_${mode}`;
}

/** Previous monthly model (read-only history): `${accountId}_${YYYY-MM}`. */
export function monthlyInvoiceId(accountId: string, period: string): string {
  return `${accountId}_${period}`;
}

/** Deterministic: one invoice per batch account per cycle (create-once → retries never duplicate). */
export function cycleInvoiceId(accountId: string, cycle: number): string {
  return `${accountId}_c${cycle}`;
}

export interface InvoiceLine {
  classId: string;
  date: string;
  title: string;
  outcome: ClassOutcome;
  rateMinor: number;
  rateVersionId: string;
  /** Month the class took place in (the rate in force that month applies). */
  period: string;
}

export const CYCLE_WEEKS = 4;
const WEEK_MS = 7 * DAY_MS;
const CYCLE_MS = CYCLE_WEEKS * WEEK_MS;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" of an instant, in IST. */
export function istDateOf(iso: string): string {
  return new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10);
}

/** 00:00 IST on the anchor date = the start of the student's week 1. */
export function cycleStartMs(anchorDate: string, cycle = 1): number {
  if (!DATE.test(anchorDate)) throw new Error("Invalid cycle anchor date");
  const [y, m, d] = anchorDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - IST_MS + (cycle - 1) * CYCLE_MS;
}

/** The checkpoint (= due date) of cycle k: the last instant of week 4k, IST. */
export function cycleCheckpoint(anchorDate: string, cycle: number): string {
  return new Date(cycleStartMs(anchorDate, cycle + 1) - 1).toISOString();
}

/** Start of cycle k's final week (week 4k). */
export function cycleFinalWeekStartMs(anchorDate: string, cycle: number): number {
  return cycleStartMs(anchorDate, cycle + 1) - WEEK_MS;
}

/** Cycle (1-based) an instant falls in; anything before week 1 counts as cycle 1. */
export function cycleOf(anchorDate: string, iso: string): number {
  return Math.max(1, Math.floor((Date.parse(iso) - cycleStartMs(anchorDate)) / CYCLE_MS) + 1);
}

/** "Weeks 1–4" for cycle 1, "weeks 5–8" for cycle 2 … */
export function cycleWeeksLabel(cycle: number): string {
  return `weeks ${CYCLE_WEEKS * (cycle - 1) + 1}–${CYCLE_WEEKS * cycle}`;
}

export interface ChargeLike {
  classId: string;
  startAt: string;
  invoiceId: string | null;
  /** "advance" = the first class, paid by the first-class payment; never invoiced. */
  coveredBy: "advance" | null;
}

/**
 * Whether cycle k's invoice may be issued: its checkpoint has passed, or a
 * class in its final week has been charged. Future classes never count.
 */
export function cycleReady(input: { anchorDate: string; cycle: number; nowMs: number; charges: readonly Pick<ChargeLike, "startAt">[] }): boolean {
  const end = cycleStartMs(input.anchorDate, input.cycle + 1);
  if (input.nowMs >= end) return true;
  const finalWeek = end - WEEK_MS;
  return input.charges.some((c) => {
    const t = Date.parse(c.startAt);
    return t >= finalWeek && t < end && t <= input.nowMs;
  });
}

/**
 * The charges cycle k's invoice covers: every charge that took place before the
 * cycle ends and is not invoiced yet and not the prepaid first class (a class
 * recorded late is picked up by the next invoice). Sorted by time.
 */
export function cycleLines<C extends ChargeLike>(charges: readonly C[], anchorDate: string, cycle: number): C[] {
  const end = cycleStartMs(anchorDate, cycle + 1);
  return charges
    .filter((c) => c.invoiceId === null && c.coveredBy === null && Date.parse(c.startAt) < end)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.classId.localeCompare(b.classId));
}

/** Which of an account's charges is the first eligible class (earliest), paid by the first-class payment. */
export function firstClassOf<C extends Pick<ChargeLike, "classId" | "startAt">>(charges: readonly C[]): C | null {
  return [...charges].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.classId.localeCompare(b.classId))[0] ?? null;
}

export const INVOICE_STATUSES = ["issued", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_ADJUSTMENT_KINDS = ["credit_note", "debit_note", "advance_applied"] as const;
export type InvoiceAdjustmentKind = (typeof INVOICE_ADJUSTMENT_KINDS)[number];

export const INVOICE_ADJUSTMENT_LABELS: Record<InvoiceAdjustmentKind, string> = {
  credit_note: "Credit note (reduces the amount due)",
  debit_note: "Debit note (increases the amount due)",
  // Previous monthly model only (kept so its history still reads correctly).
  advance_applied: "Enrolment advance applied",
};

export interface InvoicePaymentLike {
  amountMinor: number;
  status: "pending" | "paid" | "failed" | "refunded";
  verified: boolean;
}

export interface InvoiceSummary {
  amountDueMinor: number;
  creditsMinor: number;
  debitsMinor: number;
  totalDueMinor: number;
  paidMinor: number;
  pendingMinor: number;
  balanceMinor: number;
  state: "unpaid" | "partial" | "paid";
}

/** Only paid AND verified payments count. Adjustments never edit the invoice itself. */
export function summarizeInvoice(input: {
  amountDueMinor: number;
  payments: readonly InvoicePaymentLike[];
  adjustments: readonly { kind: InvoiceAdjustmentKind; amountMinor: number }[];
}): InvoiceSummary {
  const sum = (xs: number[]) => xs.reduce((s, v) => s + (Number.isSafeInteger(v) ? v : 0), 0);
  const creditsMinor = sum(input.adjustments.filter((a) => a.kind !== "debit_note").map((a) => a.amountMinor));
  const debitsMinor = sum(input.adjustments.filter((a) => a.kind === "debit_note").map((a) => a.amountMinor));
  const totalDueMinor = Math.max(input.amountDueMinor - creditsMinor + debitsMinor, 0);
  const paidMinor = sum(input.payments.filter((p) => p.status === "paid" && p.verified).map((p) => p.amountMinor));
  const pendingMinor = sum(input.payments.filter((p) => p.status === "pending").map((p) => p.amountMinor));
  const balanceMinor = totalDueMinor - paidMinor;
  return { amountDueMinor: input.amountDueMinor, creditsMinor, debitsMinor, totalDueMinor, paidMinor, pendingMinor, balanceMinor, state: balanceMinor <= 0 ? "paid" : paidMinor > 0 ? "partial" : "unpaid" };
}

// --- Due states and suspension (reversible) --------------------------------------------------------------

/** not_due ≤ dueAt < grace ≤ deadlineAt < overdue. Cycle invoices have no grace (dueAt = deadlineAt). */
export function invoiceDueState(input: { dueAt: string; deadlineAt: string }, nowMs: number): DueState {
  if (nowMs <= Date.parse(input.dueAt)) return "not_due";
  if (nowMs <= Date.parse(input.deadlineAt)) return "grace";
  return "overdue";
}

/** Suspend while any issued invoice is unpaid after its payment deadline. */
export function shouldSuspend(invoices: readonly { status: InvoiceStatus; dueAt: string; deadlineAt: string; balanceMinor: number }[], nowMs: number): boolean {
  return invoices.some((i) => i.status === "issued" && i.balanceMinor > 0 && invoiceDueState(i, nowMs) === "overdue");
}

/** Why a batch student may not join the next class, or null. Checked on the server before any Meet link is returned. */
export function batchClassBlock(account: { mode: BillingMode; status: string; advance: Pick<AdvanceState, "status">; suspension: { active: boolean } }): "suspended" | "first_class_unpaid" | null {
  if (account.mode !== "batch") return null;
  if (account.suspension.active) return "suspended";
  if (account.advance.status === "awaiting") return "first_class_unpaid";
  return null;
}

export const BATCH_BLOCK_MESSAGES: Record<"suspended" | "first_class_unpaid", string> = {
  suspended: "Access is paused because an invoice is unpaid after its due date. It is restored once the payment is verified.",
  first_class_unpaid: "The class link opens once your ₹400 first-class payment has been verified.",
};

// --- Server-calculated amounts ---------------------------------------------------------------------------

export function payableAmount(
  target:
    | { kind: "advance"; advance: AdvanceState }
    | { kind: "invoice"; status: InvoiceStatus; summary: InvoiceSummary }
    | { kind: "session"; status: SessionChargeStatus; amountMinor: number },
): number | null {
  if (target.kind === "advance") return target.advance.status === "awaiting" && paise(target.advance.amountMinor) ? target.advance.amountMinor : null;
  if (target.kind === "session") return target.status === "due" && paise(target.amountMinor) ? target.amountMinor : null;
  if (target.status !== "issued") return null;
  return target.summary.balanceMinor > 0 ? target.summary.balanceMinor : null;
}

// --- Old dues (before November 2026) ----------------------------------------------------------------------

export const LEGACY_DUES_STATUSES = ["cleared", "no_previous_dues"] as const;
export type LegacyDuesStatus = (typeof LEGACY_DUES_STATUSES)[number];

export const LEGACY_DUES_LABELS: Record<LegacyDuesStatus | "not_verified", string> = {
  cleared: "Old dues cleared (verified)",
  no_previous_dues: "No dues before November 2026 (verified)",
  not_verified: "Not verified yet",
};

/** Only an explicit, administrator-verified record counts. Absence is never "cleared". */
export function legacyDuesCleared(record: { status: string; verifiedBy: string | null; verifiedAt: string | null } | null): boolean {
  return Boolean(record && (LEGACY_DUES_STATUSES as readonly string[]).includes(record.status) && record.verifiedBy && record.verifiedAt);
}

// --- Batches ------------------------------------------------------------------------------------------------

export const MAX_BATCH_CAPACITY = 5;

export function parseCapacity(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_BATCH_CAPACITY ? n : null;
}

export function canAddMember(batch: { capacity: number; memberCount: number; status: string }): string | null {
  if (batch.status !== "active") return "This batch is archived.";
  if (batch.memberCount >= Math.min(batch.capacity, MAX_BATCH_CAPACITY)) return `This batch is full (${batch.capacity} learners).`;
  return null;
}

export function batchMemberId(batchId: string, studentId: string): string {
  return `${batchId}_${studentId}`;
}

export function membershipLockId(studentId: string, courseId: string): string {
  return `${studentId}_${courseId}`;
}
