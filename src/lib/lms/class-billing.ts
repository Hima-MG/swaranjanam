// Class-based billing (batches and individual sessions) — PURE rules.
//
// No runtime imports: unit-tested with Node's runner and safe in Client
// Components. The server applies these rules inside Firestore transactions
// (lib/lms/server/class-billing.ts); nothing the browser sends is trusted.
// All business dates use India Standard Time (Asia/Kolkata, UTC+05:30, no DST).
// Money is always integer paise.
//
// CONFIRMED BY THE ACADEMY — calendar-month billing (batch and individual)
//   * Billing period: the calendar month in IST (1st 00:00 → last day 23:59:59.999).
//   * One invoice per billing account per month, generated on the LAST calendar
//     day of the month (from 23:00 IST, see MONTHLY_INVOICE_FROM_HOUR), listing the
//     billable classes/sessions actually held and recorded — 4, 5 or any number.
//     A class recorded after its month's invoice was generated goes on the next
//     month's invoice (once). Never future or invented classes.
//   * Rates: batch ₹400 per billable class per student; individual ₹750 per
//     billable session. No course fees or packages.
//   * Initial enrolment payment (batch ₹400 / individual ₹750, stored as the
//     account's advance) covers the FIRST eligible class/session. That class is
//     listed on the monthly invoice it falls in and the payment is deducted there
//     ("Initial enrolment payment") — never invoiced twice, never deducted twice.
//   * Payment deadline: end of the 3rd calendar day after the invoice date, IST
//     (30 Nov invoice → 3 Dec 23:59:59.999 IST). Overdue = unpaid after that instant.
//     No restriction during the 3-day window.
//   * Overdue → reversible suspension: next-class Meet links, lessons and
//     materials, restored after verified payment once no other overdue invoice remains.
//   * Batch: attended and absent are billable; academy cancellation is not; a
//     rescheduled occurrence is not (its replacement is, when held); unknown
//     attendance is not billed.
//   * Individual: attended/absent billable; unknown not billed; academy
//     cancellation and rescheduling not billable; a class cancelled by the student
//     stays billable (confirmed: the academy provides the recording).
// HISTORY (read-only, never deleted): four-week cycle invoices ("cycle") and the
// first monthly model's invoices ("legacy_monthly") keep their stored or derived
// deadlines and still count while unpaid. Per-session charges created before this
// change (sessionCharges) stay payable per session and are never billed again.
// Rates: versioned; a change applies to everyone from the next calendar month.
// Transition: website billing starts with November 2026; earlier fees stay with
// the previous payment method, and an administrator must verify old dues first.

// --- Periods (calendar months in IST) ------------------------------------------------------

const IST_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 86_400_000;

/** First month billed through the website. Classes before it are never charged here. */
export const BILLING_START_PERIOD = "2026-11";

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

// --- First monthly model (history): due dates of its existing invoices only -------------------------

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

// --- Calendar-month invoices (current model) ------------------------------------------------------

/** Days after the invoice date to pay (calendar days, IST). */
export const PAYMENT_WINDOW_DAYS = 3;
/** A month's invoice can be generated from this hour (IST) on its last calendar day. */
export const MONTHLY_INVOICE_FROM_HOUR = 23;

/** Last calendar day of a period, "YYYY-MM-DD" (28–31 days; leap years included). */
export function lastDayOf(period: string): string {
  return new Date(periodStartMs(nextPeriod(period)) - DAY_MS + IST_MS).toISOString().slice(0, 10);
}

/** First instant the month's invoice may be generated: 23:00 IST on its last day. */
export function monthlyInvoiceFromMs(period: string): number {
  return periodStartMs(nextPeriod(period)) - (24 - MONTHLY_INVOICE_FROM_HOUR) * 3_600_000;
}

/** The latest month whose invoice may be generated at this instant. */
export function closablePeriod(nowMs: number): string {
  const current = periodOf(new Date(nowMs).toISOString());
  return nowMs >= monthlyInvoiceFromMs(current) ? current : previousPeriod(current);
}

/**
 * Invoice date: the month's last calendar day; if the invoice is generated
 * later (e.g. the scheduled job was down), the IST date it was generated, so
 * the student always gets the full payment window.
 */
export function monthlyInvoiceDate(period: string, issuedAtIso: string): string {
  const last = lastDayOf(period);
  const issued = istDateOf(issuedAtIso);
  return issued > last ? issued : last;
}

/** Payment deadline: the last instant (IST) of the 3rd calendar day after the invoice date. */
export function monthlyPaymentDeadline(invoiceDate: string): string {
  if (!DATE.test(invoiceDate)) throw new Error("Invalid invoice date");
  const [y, m, d] = invoiceDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + PAYMENT_WINDOW_DAYS + 1) - IST_MS - 1).toISOString();
}

// --- Rates (versioned, next-month changes) ----------------------------------------------------

export const BILLING_MODES = ["batch", "individual"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  batch: "Batch classes (monthly invoice)",
  individual: "Individual sessions (monthly invoice)",
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
  /** Kept for stored settings only: a class cancelled by the student is always billable (confirmed policy). */
  batchStudentCancelled: "not_billable" | "billable";
  /** Must the batch advance be verified before classes are scheduled? (Not specified.) Default: no. */
  advanceBeforeScheduling: boolean;
}

export const DEFAULT_POLICY: BillingPolicy = { batchStudentCancelled: "billable", advanceBeforeScheduling: false };

export const PENDING_DECISIONS: { key: string; question: string }[] = [
  { key: "lateOutcome", question: "A class whose outcome is recorded after its month's invoice was generated goes on the next month's invoice. Is that acceptable? (Current default.)" },
  { key: "firstClassRateChange", question: "If the per-class rate changes, does the initial enrolment payment still cover the whole first class/session? (Currently: yes, no top-up or credit.)" },
  { key: "restoration", question: "Restoration is automatic once every invoice past its deadline is paid. Should any other condition apply?" },
  { key: "rescheduledPaidSession", question: "Individual session paid separately under the earlier per-session method, then cancelled for rescheduling: transfer to the new session or refund? (Flagged for review.)" },
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
    case "student_cancelled": // confirmed: billable (the academy provides the recording)
      void policy;
      return true;
    case "academy_cancelled": // confirmed: not billable
    case "rescheduled": // the replacement occurrence is billed when held
    case "unknown": // no charge until a billable outcome is recorded
      return false;
  }
}

/** Individual session: whether the outcome makes the session billable. */
export function isIndividualBillable(outcome: ClassOutcome, cancelledLate: boolean): boolean {
  switch (outcome) {
    case "attended":
    case "absent":
      return true;
    case "student_cancelled": // confirmed: billable, whatever the notice (the recording is provided)
      return true;
    case "academy_cancelled":
    case "rescheduled":
    case "unknown":
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
  // Confirmed policy: a class cancelled by the student stays payable (the recording is provided); never the academy's.
  return input.kind === "student" ? "payable" : "no_charge";
}

export const SESSION_CHARGE_STATUSES = ["due", "paid", "no_charge"] as const;
export type SessionChargeStatus = (typeof SESSION_CHARGE_STATUSES)[number];

/** Per-session charges (sessionCharges) come only from the earlier per-session method: history, still payable. */
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
  verified: "Paid — covers the first class/session",
  // Deducted on the monthly invoice that lists the first class/session (never deducted twice).
  applied: "Paid — deducted on a monthly invoice",
  // Historical status name: only ever set when a payment recorded in error is reversed.
  refunded: "Reversed (payment error)",
};

/** Approved policy: the batch enrolment advance is non-refundable, including when a student stops early. */
export const ADVANCE_NON_REFUNDABLE = true;
export const ADVANCE_POLICY_TEXT =
  "The initial enrolment payment is non-refundable, including if the student stops early. It pays for the first class/session and is deducted on the monthly invoice that lists it — never charged twice.";

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
  if (input.appliedMinor > 0) return "This payment has already been deducted on a monthly invoice. Record a debit note on that invoice instead.";
  if (!(ADVANCE_CORRECTION_REASONS as readonly unknown[]).includes(input.reason)) {
    return "The enrolment advance is non-refundable. It can only be reversed to correct a payment mistake — choose which mistake.";
  }
  return null;
}

export interface AdvanceState {
  status: AdvanceStatus;
  amountMinor: number;
  /** Amount deducted on a monthly invoice (0 until the first class/session is invoiced). */
  appliedMinor: number;
  paymentId: string | null;
}

export function initialAdvance(mode: BillingMode, version: RateVersion): AdvanceState {
  return mode === "batch" && paise(version.batchAdvanceMinor)
    ? { status: "awaiting", amountMinor: version.batchAdvanceMinor, appliedMinor: 0, paymentId: null }
    : { status: "not_required", amountMinor: 0, appliedMinor: 0, paymentId: null };
}

// --- Invoices ------------------------------------------------------------------------------------------

export function accountIdFor(studentId: string, courseId: string, mode: BillingMode): string {
  return `ba_${studentId}_${courseId}_${mode}`;
}

/** Deterministic: one invoice per account per calendar month (create-once → retries never duplicate). */
export function monthlyInvoiceId(accountId: string, period: string): string {
  return `${accountId}_m${period}`;
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
  /** The first class/session, paid by the initial enrolment payment (deducted on this invoice). */
  coveredByInitialPayment?: boolean;
}

/** "YYYY-MM-DD" of an instant, in IST. */
export function istDateOf(iso: string): string {
  return new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10);
}

/** Four-week cycle invoices (history only): "weeks 1–4", "weeks 5–8" … */
export function cycleWeeksLabel(cycle: number): string {
  return `weeks ${4 * (cycle - 1) + 1}–${4 * cycle}`;
}

export interface ChargeLike {
  classId: string;
  period: string;
  startAt: string;
  invoiceId: string | null;
  /** "advance" = the first class/session, paid by the initial enrolment payment. */
  coveredBy: "advance" | null;
  rateMinor: number;
}

/**
 * The charges a month's invoice takes: every charge not yet invoiced whose
 * class took place in that month or earlier (a class recorded late is picked
 * up by the next invoice). Includes the first class (deducted). Sorted by time.
 */
export function monthLines<C extends ChargeLike>(charges: readonly C[], period: string): C[] {
  return charges
    .filter((c) => c.invoiceId === null && c.period <= period)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.classId.localeCompare(b.classId));
}

/** Subtotal of the lines, the initial-payment deduction (first class/session, once) and the amount due. */
export function monthAmounts(lines: readonly Pick<ChargeLike, "rateMinor" | "coveredBy">[]): { subtotalMinor: number; initialPaymentMinor: number; amountDueMinor: number } {
  const subtotalMinor = lines.reduce((t, l) => t + l.rateMinor, 0);
  const initialPaymentMinor = lines.filter((l) => l.coveredBy === "advance").reduce((t, l) => t + l.rateMinor, 0);
  return { subtotalMinor, initialPaymentMinor, amountDueMinor: Math.max(subtotalMinor - initialPaymentMinor, 0) };
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

/**
 * not_due ≤ dueAt < grace ≤ deadlineAt < overdue. Monthly (and cycle) invoices
 * have dueAt = deadlineAt: payable but not overdue until the deadline has passed.
 */
export function invoiceDueState(input: { dueAt: string; deadlineAt: string }, nowMs: number): DueState {
  if (nowMs <= Date.parse(input.dueAt)) return "not_due";
  if (nowMs <= Date.parse(input.deadlineAt)) return "grace";
  return "overdue";
}

/** Suspend while any issued invoice is unpaid after its payment deadline. */
export function shouldSuspend(invoices: readonly { status: InvoiceStatus; dueAt: string; deadlineAt: string; balanceMinor: number }[], nowMs: number): boolean {
  return invoices.some((i) => i.status === "issued" && i.balanceMinor > 0 && invoiceDueState(i, nowMs) === "overdue");
}

/**
 * Why a student may not join the next class of this billing account (batch or
 * individual), or null. Checked on the server before any Meet link is returned.
 */
export function classAccessBlock(account: { mode: BillingMode; status: string; advance: Pick<AdvanceState, "status">; suspension: { active: boolean } }): "suspended" | "first_class_unpaid" | null {
  if (account.suspension.active) return "suspended";
  if (account.advance.status === "awaiting") return "first_class_unpaid";
  return null;
}

export const CLASS_BLOCK_MESSAGES: Record<"suspended" | "first_class_unpaid", string> = {
  suspended: "Access is paused because an invoice is unpaid after its payment deadline. It is restored once the payment is verified.",
  first_class_unpaid: "The class link opens once your initial enrolment payment has been verified.",
};

// --- Server-calculated amounts ---------------------------------------------------------------------------

export function payableAmount(
  target:
    | { kind: "advance"; advance: AdvanceState }
    | { kind: "invoice"; status: InvoiceStatus; summary: InvoiceSummary }
    | { kind: "session"; status: SessionChargeStatus; amountMinor: number }
    | { kind: "registration"; status: string; amountMinor: number },
): number | null {
  if (target.kind === "advance") return target.advance.status === "awaiting" && paise(target.advance.amountMinor) ? target.advance.amountMinor : null;
  // Website registration: the initial payment, once, while it is still awaited.
  if (target.kind === "registration") return target.status === "pending_payment" && paise(target.amountMinor) ? target.amountMinor : null;
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

/** `seats`: learners joining together (2 for Learn Together — they take two places). */
export function canAddMember(batch: { capacity: number; memberCount: number; status: string }, seats = 1): string | null {
  if (batch.status !== "active") return "This batch is archived.";
  const capacity = Math.min(batch.capacity, MAX_BATCH_CAPACITY);
  if (batch.memberCount + seats > capacity) {
    return batch.memberCount >= capacity ? `This batch is full (${batch.capacity} learners).` : `This batch has ${capacity - batch.memberCount} place(s) left; this enrolment needs ${seats}.`;
  }
  return null;
}

export function batchMemberId(batchId: string, studentId: string): string {
  return `${batchId}_${studentId}`;
}

export function membershipLockId(studentId: string, courseId: string): string {
  return `${studentId}_${courseId}`;
}

// --- Payment history labels ---------------------------------------------------------------------------------

/** What a class-billing payment was for, for payment history ("Invoice — November 2026", …). Null for other payments. */
export function paymentPurposeLabel(p: { purpose: string | null; invoiceId: string | null }): string | null {
  switch (p.purpose) {
    case "registration":
      return "Initial enrolment payment";
    case "advance":
      return "Initial enrolment payment (first class)";
    case "session":
      return "Individual session (paid separately)";
    case "invoice": {
      const month = p.invoiceId?.match(/_m(\d{4}-\d{2})$/)?.[1];
      if (month && isPeriod(month)) return `Invoice — ${periodLabel(month)}`;
      const cycle = p.invoiceId?.match(/_c(\d+)$/)?.[1];
      if (cycle) return `Invoice — cycle ${cycle} (${cycleWeeksLabel(Number(cycle))}, earlier billing)`;
      const legacy = p.invoiceId?.match(/_(\d{4}-\d{2})$/)?.[1];
      return legacy && isPeriod(legacy) ? `Invoice — ${periodLabel(legacy)} (earlier monthly invoice)` : "Invoice";
    }
    default:
      return null;
  }
}
