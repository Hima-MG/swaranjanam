// Class-based billing (batches and individual sessions) — PURE rules.
//
// No runtime imports: unit-tested with Node's runner and safe in Client
// Components. The server applies these rules inside Firestore transactions
// (lib/lms/server/class-billing.ts); nothing the browser sends is trusted.
// All business dates use India Standard Time (Asia/Kolkata, UTC+05:30, no DST).
// Money is always integer paise.
//
// CONFIRMED BY THE ACADEMY
// Batch classes (monthly billing):
//   * ₹400 per student per billable class; billed per calendar month.
//   * One monthly invoice per student for the classes of that month.
//   * One-time ₹400 enrolment advance, applied (once) to the first monthly
//     invoice issued after it is VERIFIED; any unused part is carried forward.
//   * Attended and absent are billable. Academy cancellation is not billable.
//     A rescheduled occurrence is not billed; the replacement is billed when held.
//     Unknown attendance is not billed until a billable outcome is recorded.
//   * Due at the end of the month, with a 7-calendar-day grace period; unpaid
//     after the grace period → reversible access suspension; restored after
//     verified payment.
// Individual one-to-one sessions:
//   * ₹750 per session, each paid separately (no monthly invoice, no cycles).
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

/** Completed periods from BILLING_START_PERIOD up to (not including) the current IST month. */
export function completedPeriods(nowIso: string): string[] {
  const current = periodOf(nowIso);
  const out: string[] = [];
  for (let p = BILLING_START_PERIOD; p < current; p = nextPeriod(p)) out.push(p);
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11" → "November 2026" (fixed names: identical on server and browser). */
export function periodLabel(period: string): string {
  if (!isPeriod(period)) return period;
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// --- Due dates and the grace period ------------------------------------------------------------

/** Grace period after the due date (calendar days). */
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

/** not_due ≤ due date < grace ≤ deadline < overdue. */
export function dueState(period: string, nowMs: number): DueState {
  if (nowMs <= Date.parse(invoiceDueAt(period))) return "not_due";
  if (nowMs <= Date.parse(paymentDeadline(period))) return "grace";
  return "overdue";
}

// --- Rates (versioned, next-month changes) ----------------------------------------------------

export const BILLING_MODES = ["batch", "individual"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  batch: "Batch classes (monthly)",
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
  { key: "advanceBeforeScheduling", question: "Must the ₹400 advance be verified before a student's first batch class is scheduled? (Default: no.)" },
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
  verified: "Received — not yet used",
  applied: "Fully applied to invoices",
  // Historical status name: only ever set when a payment recorded in error is reversed.
  refunded: "Reversed (payment error)",
};

/** Approved policy: the batch enrolment advance is non-refundable, including when a student stops early. */
export const ADVANCE_NON_REFUNDABLE = true;
export const ADVANCE_POLICY_TEXT = "The enrolment advance is non-refundable, including if the student stops early. It is deducted from the first monthly invoice after it is verified.";

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
  /** Total already applied to invoices (never more than amountMinor). */
  appliedMinor: number;
  paymentId: string | null;
}

/** Unused, VERIFIED advance that may still be applied. Unpaid/unverified → 0. */
export function advanceRemaining(a: AdvanceState): number {
  if (a.status !== "verified") return 0;
  return Math.max(a.amountMinor - Math.max(a.appliedMinor, 0), 0);
}

export function initialAdvance(mode: BillingMode, version: RateVersion): AdvanceState {
  return mode === "batch" && paise(version.batchAdvanceMinor)
    ? { status: "awaiting", amountMinor: version.batchAdvanceMinor, appliedMinor: 0, paymentId: null }
    : { status: "not_required", amountMinor: 0, appliedMinor: 0, paymentId: null };
}

/** Advance after applying `minor` of it. */
export function advanceAfterApplying(a: AdvanceState, minor: number): AdvanceState {
  const appliedMinor = a.appliedMinor + minor;
  return { ...a, appliedMinor, status: appliedMinor >= a.amountMinor ? "applied" : a.status };
}

// --- Monthly invoices ------------------------------------------------------------------------------------

/** Deterministic: one invoice per batch account per month (create-once → retries never duplicate). */
export function monthlyInvoiceId(accountId: string, period: string): string {
  return `${accountId}_${period}`;
}

export function accountIdFor(studentId: string, courseId: string, mode: BillingMode): string {
  return `ba_${studentId}_${courseId}_${mode}`;
}

export interface InvoiceLine {
  classId: string;
  date: string;
  title: string;
  outcome: ClassOutcome;
  rateMinor: number;
  rateVersionId: string;
  /** Month the class took place in (late-recorded classes may be invoiced in a later month). */
  period: string;
}

export interface MonthlyInvoiceDraft {
  subtotalMinor: number;
  advanceAppliedMinor: number;
  amountDueMinor: number;
  advanceAfter: AdvanceState;
}

/**
 * Builds a month's invoice. Only a VERIFIED advance is applied, once, up to
 * the subtotal; any unused part stays on the account for the next invoice.
 * Example: 8 classes × ₹400 = ₹3,200 − ₹400 advance = ₹2,800.
 */
export function buildMonthlyInvoice(input: { lines: readonly InvoiceLine[]; advance: AdvanceState }): MonthlyInvoiceDraft {
  const subtotalMinor = input.lines.reduce((s, l) => s + l.rateMinor, 0);
  const advanceAppliedMinor = Math.min(advanceRemaining(input.advance), subtotalMinor);
  return {
    subtotalMinor,
    advanceAppliedMinor,
    amountDueMinor: subtotalMinor - advanceAppliedMinor,
    advanceAfter: advanceAppliedMinor > 0 ? advanceAfterApplying(input.advance, advanceAppliedMinor) : input.advance,
  };
}

export const INVOICE_STATUSES = ["issued", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_ADJUSTMENT_KINDS = ["credit_note", "debit_note", "advance_applied"] as const;
export type InvoiceAdjustmentKind = (typeof INVOICE_ADJUSTMENT_KINDS)[number];

export const INVOICE_ADJUSTMENT_LABELS: Record<InvoiceAdjustmentKind, string> = {
  credit_note: "Credit note (reduces the amount due)",
  debit_note: "Debit note (increases the amount due)",
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

// --- Suspension (reversible) ---------------------------------------------------------------------------

/** Suspend while any issued invoice is unpaid after its payment deadline. */
export function shouldSuspend(invoices: readonly { status: InvoiceStatus; period: string; balanceMinor: number }[], nowMs: number): boolean {
  return invoices.some((i) => i.status === "issued" && i.balanceMinor > 0 && dueState(i.period, nowMs) === "overdue");
}

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
