import "server-only";

import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { notifyInvoiceDueStates, notifyInvoiceIssued } from "@/lib/notifications/events";
import {
  ADVANCE_STATUSES,
  BILLING_MODES,
  BILLING_START_PERIOD,
  CLASS_OUTCOMES,
  classAccessBlock,
  closablePeriod,
  cycleWeeksLabel,
  DEFAULT_POLICY,
  DEFAULT_RATE_VERSION,
  FREE_CANCELLATION_HOURS,
  individualCancellationCharge,
  invoiceDueState,
  INVOICE_ADJUSTMENT_KINDS,
  INVOICE_STATUSES,
  invoiceDueAt,
  isBatchBillable,
  isIndividualBillable,
  isPeriod,
  isWebsiteBilledPeriod,
  LEGACY_DUES_STATUSES,
  legacyDuesCleared,
  monthAmounts,
  monthLines,
  monthlyInvoiceDate,
  monthlyInvoiceId,
  monthlyPaymentDeadline,
  parsePolicy,
  payableAmount,
  paymentDeadline,
  periodLabel,
  periodOf,
  rateVersionForPeriod,
  SESSION_CHARGE_STATUSES,
  sessionChargeId,
  shouldSuspend,
  summarizeInvoice,
  type AdvanceState,
  type BillingMode,
  type BillingPolicy,
  type ClassOutcome,
  type DueState,
  type InvoiceAdjustmentKind,
  type InvoiceLine,
  type InvoiceStatus,
  type InvoiceSummary,
  type LegacyDuesStatus,
  type RateVersion,
  type SessionChargeStatus,
} from "@/lib/lms/class-billing";
import type { LiveClassRecord } from "@/lib/lms/classes";
import { agreedRateForPeriod, effectiveCoursePricing, mapAgreedRates, rateFor, type AgreedRate } from "@/lib/lms/course-pricing";
import { AccessError } from "@/lib/lms/server/access";
import { col, db, toIso } from "@/lib/lms/server/db";
import { mapPayment } from "@/lib/lms/server/payments";
import { enrollmentId, type PaymentRecord } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Class-based billing: calendar-month invoices for batch classes and individual
// sessions (rules: lib/lms/class-billing.ts).
//
// Safeguards (all inside Firestore transactions):
//   * billableClasses/{classId} is created once → a class occurrence is charged
//     at most once per student.
//   * The account's first eligible class/session is marked coveredBy: "advance";
//     the initial enrolment payment is deducted on the invoice that lists it, and
//     the account's advance becomes "applied" in the same transaction — it can
//     never be deducted twice.
//   * invoices/{accountId}_m{YYYY-MM} is created once → re-running the job (or two
//     runs at once) never duplicates an invoice. The charges an invoice takes are
//     marked with its id in the same transaction, so a class can never appear on
//     two invoices.
//   * Issued invoices are never edited; corrections are invoiceAdjustments.
//   * History is kept as it is: four-week cycle invoices, first-model monthly
//     invoices and per-session charges (sessionCharges, still payable per session;
//     a session with such a charge is never billed again on a monthly invoice).
//   * Classes before November 2026 are never charged here (old payment method).

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const int = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isSafeInteger(v) ? v : fallback);
const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T => ((values as readonly unknown[]).includes(v) ? (v as T) : fallback);
type Actor = { uid: string; email: string | null };
const entry = (actor: Actor, change: string) => ({ at: Timestamp.now(), by: actor.uid, byEmail: actor.email, change });

function assertTeacher(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
}

// --- Configuration ----------------------------------------------------------------------------------

export function classBillingConfigRef() {
  return col("settings").doc("classBilling");
}

export interface ClassBillingConfig {
  policy: BillingPolicy;
  rateVersions: RateVersion[];
  saved: boolean;
}

function mapRateVersion(raw: Record<string, unknown>): RateVersion | null {
  const ok = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
  if (!isValidId(raw?.id) || !isPeriod(raw.effectiveFrom)) return null;
  if (!ok(raw.batchMinor) || !ok(raw.individualMinor) || !ok(raw.batchAdvanceMinor)) return null;
  return { id: raw.id, effectiveFrom: raw.effectiveFrom, batchMinor: raw.batchMinor as number, individualMinor: raw.individualMinor as number, batchAdvanceMinor: raw.batchAdvanceMinor as number };
}

export function mapConfig(snapshot: DocumentSnapshot<DocumentData>): ClassBillingConfig {
  const d = snapshot.data();
  if (!d) return { policy: DEFAULT_POLICY, rateVersions: [DEFAULT_RATE_VERSION], saved: false };
  const p = (d.policy ?? {}) as Record<string, unknown>;
  const parsed = parsePolicy({ batchStudentCancelled: p.batchStudentCancelled ?? DEFAULT_POLICY.batchStudentCancelled, advanceBeforeScheduling: p.advanceBeforeScheduling === true });
  const versions = Array.isArray(d.rateVersions) ? d.rateVersions.map(mapRateVersion).filter((v): v is RateVersion => v !== null) : [];
  return { policy: parsed.value ?? DEFAULT_POLICY, rateVersions: versions.length ? versions : [DEFAULT_RATE_VERSION], saved: true };
}

export async function getClassBillingConfig(): Promise<ClassBillingConfig> {
  return mapConfig(await classBillingConfigRef().get());
}

/**
 * The course's current rate for a class type, read inside a transaction (reads
 * only): the course's own pricing, or — for a course saved before course pricing
 * existed — the confirmed rates in force. Throws when the course does not offer
 * that class type. Used once, when a student's billing account is opened: the
 * result is stored on the account as the student's agreed rate.
 */
export async function courseRateInTx(tx: Transaction, courseId: string, mode: BillingMode): Promise<number> {
  const [courseSnap, configSnap] = await Promise.all([tx.get(col("courses").doc(courseId)), tx.get(classBillingConfigRef())]);
  const version = rateVersionForPeriod(mapConfig(configSnap).rateVersions, periodOf(new Date().toISOString()));
  const rate = rateFor(effectiveCoursePricing(courseSnap.get("pricing"), version), mode);
  if (!rate) throw new AccessError(`${mode === "batch" ? "Batch" : "Individual"} classes are not offered for this course.`);
  return rate;
}

/** The immutable starting entry of a student's agreed rate (applies from the start of website billing). */
export function initialAgreedRates(rateMinor: number): AgreedRate[] {
  return [{ effectiveFrom: BILLING_START_PERIOD, rateMinor }];
}

// --- Records ----------------------------------------------------------------------------------------

export interface Suspension {
  active: boolean;
  since: string | null;
  invoiceIds: string[];
  liftedAt: string | null;
}

export interface BillingAccountRecord {
  id: string;
  studentId: string;
  courseId: string;
  mode: BillingMode;
  status: "active" | "closed";
  batchId: string | null;
  advance: AdvanceState;
  suspension: Suspension;
  /**
   * The student's agreed rate history (per class / per session), fixed when the
   * account was opened; changed only by an approved change from a future month.
   * Empty for accounts opened before course pricing (they use the versioned rates).
   */
  agreedRates: AgreedRate[];
  /** 2 for Learn Together (two learners, one login); the agreed rate is then per session for both. */
  learnerCount: number;
  learnerNames: string[];
  /** Learn Together: the per-learner rate (agreedRates holds the session total). Null otherwise. */
  perLearnerRateMinor: number | null;
  billableCount: number;
  /** The first eligible class/session (covered by the initial enrolment payment); null until one is charged. */
  firstClassId: string | null;
  firstClassStartAt: string | null;
  studentName: string;
  courseTitle: string;
  closedReason: string | null;
  createdAt: string | null;
  history: { at: string | null; byEmail: string | null; change: string }[];
}

export function mapAccount(snapshot: DocumentSnapshot<DocumentData>): BillingAccountRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  const a = (d.advance ?? {}) as Record<string, unknown>;
  const s = (d.suspension ?? {}) as Record<string, unknown>;
  return {
    id: snapshot.id,
    studentId: String(d.studentId ?? ""),
    courseId: String(d.courseId ?? ""),
    mode: oneOf(BILLING_MODES, d.mode, "batch"),
    status: d.status === "closed" ? "closed" : "active",
    batchId: isValidId(d.batchId) ? d.batchId : null,
    advance: {
      status: oneOf(ADVANCE_STATUSES, a.status, "awaiting"),
      amountMinor: int(a.amountMinor),
      appliedMinor: int(a.appliedMinor),
      paymentId: str(a.paymentId),
    },
    suspension: {
      active: s.active === true,
      since: toIso(s.since),
      invoiceIds: Array.isArray(s.invoiceIds) ? s.invoiceIds.map(String) : [],
      liftedAt: toIso(s.liftedAt),
    },
    agreedRates: mapAgreedRates(d.agreedRates),
    learnerCount: d.learnerCount === 2 ? 2 : 1,
    learnerNames: Array.isArray(d.learnerNames) && d.learnerNames.length ? d.learnerNames.map(String) : [String(d.studentName ?? "Student")],
    perLearnerRateMinor: typeof d.perLearnerRateMinor === "number" && d.perLearnerRateMinor > 0 ? d.perLearnerRateMinor : null,
    billableCount: int(d.billableCount),
    firstClassId: str(d.firstClassId),
    firstClassStartAt: toIso(d.firstClassStartAt),
    studentName: String(d.studentName ?? "Student"),
    courseTitle: String(d.courseTitle ?? "Course"),
    closedReason: str(d.closedReason),
    createdAt: toIso(d.createdAt),
    history: Array.isArray(d.history)
      ? d.history.map((h: Record<string, unknown>) => ({ at: toIso(h.at), byEmail: str(h.byEmail), change: String(h.change ?? "") }))
      : [],
  };
}

export interface InvoiceRecord {
  id: string;
  /**
   * "month" = calendar-month invoice (current model); "cycle" = four-week cycle
   * and "legacy_monthly" = first monthly model — both read-only history.
   */
  kind: "month" | "cycle" | "legacy_monthly";
  accountId: string;
  studentId: string;
  courseId: string;
  courseTitle: string;
  studentName: string;
  batchId: string | null;
  mode: BillingMode;
  /** Billed month ("YYYY-MM") for monthly invoices; "" for cycle invoices. */
  period: string;
  /** Cycle invoices only. */
  cycle: number | null;
  /** Invoice date ("YYYY-MM-DD", IST) — monthly invoices of the current model only. */
  invoiceDate: string | null;
  /** E.g. "November 2026", "Cycle 1 · weeks 1–4" or "November 2026 (earlier monthly invoice)". */
  label: string;
  lines: InvoiceLine[];
  /** Learn Together: both learners and the per-learner rate (each line is the session total). */
  learnerCount: number;
  learnerNames: string[];
  perLearnerRateMinor: number | null;
  subtotalMinor: number;
  /** Deduction for the initial enrolment payment (first class/session); 0 if none. */
  advanceAppliedMinor: number;
  amountDueMinor: number;
  status: InvoiceStatus;
  issuedAt: string | null;
  dueAt: string;
  deadlineAt: string;
  currency: string;
}

export function mapInvoice(snapshot: DocumentSnapshot<DocumentData>): InvoiceRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  const cycle = Number.isSafeInteger(d.cycle) && d.cycle > 0 ? (d.cycle as number) : null;
  const kind: InvoiceRecord["kind"] | null = d.kind === "month" ? "month" : cycle !== null ? "cycle" : isPeriod(d.period) ? "legacy_monthly" : null;
  if (!kind) return null;
  if (kind === "month" && !isPeriod(d.period)) return null;
  // Current monthly and cycle invoices store their deadline; the first monthly model derives it from the period.
  const stored = kind === "legacy_monthly" ? null : toIso(d.deadlineAt);
  if (kind !== "legacy_monthly" && !stored) return null;
  const invoiceDate = kind === "month" && typeof d.invoiceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.invoiceDate) ? d.invoiceDate : null;
  return {
    id: snapshot.id,
    kind,
    accountId: String(d.accountId ?? ""),
    studentId: String(d.studentId ?? ""),
    courseId: String(d.courseId ?? ""),
    courseTitle: String(d.courseTitle ?? "Course"),
    studentName: String(d.studentName ?? "Student"),
    batchId: str(d.batchId),
    mode: oneOf(BILLING_MODES, d.mode, "batch"),
    period: kind === "cycle" ? "" : d.period,
    cycle,
    invoiceDate,
    label: kind === "month" ? periodLabel(d.period) : kind === "cycle" ? `Cycle ${cycle} · ${cycleWeeksLabel(cycle!)}` : `${periodLabel(d.period)} (earlier monthly invoice)`,
    lines: Array.isArray(d.lines)
      ? d.lines.map((l: Record<string, unknown>) => ({
          classId: String(l.classId ?? ""),
          date: String(l.date ?? ""),
          title: String(l.title ?? "Class"),
          outcome: oneOf(CLASS_OUTCOMES, l.outcome, "attended"),
          rateMinor: int(l.rateMinor),
          rateVersionId: String(l.rateVersionId ?? ""),
          period: isPeriod(l.period) ? l.period : kind === "legacy_monthly" ? d.period : "",
          ...(l.coveredByInitialPayment === true ? { coveredByInitialPayment: true } : {}),
        }))
      : [],
    learnerCount: d.learnerCount === 2 ? 2 : 1,
    learnerNames: Array.isArray(d.learnerNames) && d.learnerNames.length ? d.learnerNames.map(String) : [String(d.studentName ?? "Student")],
    perLearnerRateMinor: typeof d.perLearnerRateMinor === "number" && d.perLearnerRateMinor > 0 ? d.perLearnerRateMinor : null,
    subtotalMinor: int(d.subtotalMinor),
    advanceAppliedMinor: int(d.advanceAppliedMinor),
    amountDueMinor: int(d.amountDueMinor),
    status: oneOf(INVOICE_STATUSES, d.status, "issued"),
    issuedAt: toIso(d.issuedAt),
    // Monthly and cycle invoices: payable until the deadline, overdue after it (dueAt = deadlineAt).
    dueAt: kind === "legacy_monthly" ? invoiceDueAt(d.period) : stored!,
    deadlineAt: kind === "legacy_monthly" ? paymentDeadline(d.period) : stored!,
    currency: str(d.currency) ?? "INR",
  };
}

export interface InvoiceAdjustmentRecord {
  id: string;
  invoiceId: string;
  accountId: string;
  kind: InvoiceAdjustmentKind;
  amountMinor: number;
  reason: string;
  byEmail: string | null;
  at: string | null;
}

export function mapInvoiceAdjustment(snapshot: DocumentSnapshot<DocumentData>): InvoiceAdjustmentRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  return {
    id: snapshot.id,
    invoiceId: String(d.invoiceId ?? ""),
    accountId: String(d.accountId ?? ""),
    kind: oneOf(INVOICE_ADJUSTMENT_KINDS, d.kind, "credit_note"),
    amountMinor: int(d.amountMinor),
    reason: String(d.reason ?? ""),
    byEmail: str(d.byEmail),
    at: toIso(d.at),
  };
}

export interface BillableClassRecord {
  classId: string;
  accountId: string;
  studentId: string;
  date: string;
  title: string;
  outcome: ClassOutcome;
  rateMinor: number;
  rateVersionId: string;
  period: string;
  invoiceId: string | null;
  startAt: string;
  /** "advance": the first class/session, paid by the initial enrolment payment — listed on its monthly invoice with that payment deducted. */
  coveredBy: "advance" | null;
}

export function mapBillableClass(snapshot: DocumentSnapshot<DocumentData>): BillableClassRecord | null {
  const d = snapshot.data();
  if (!d || !isPeriod(d.period)) return null;
  return {
    classId: snapshot.id,
    accountId: String(d.accountId ?? ""),
    studentId: String(d.studentId ?? ""),
    date: String(d.date ?? ""),
    title: String(d.title ?? "Class"),
    outcome: oneOf(CLASS_OUTCOMES, d.outcome, "attended"),
    rateMinor: int(d.rateMinor),
    rateVersionId: String(d.rateVersionId ?? ""),
    period: d.period,
    invoiceId: str(d.invoiceId),
    // Older charges without a start time fall back to the class date at 00:00 IST.
    startAt: toIso(d.startAt) ?? new Date(Date.parse(`${String(d.date ?? "")}T00:00:00+05:30`) || 0).toISOString(),
    coveredBy: d.coveredBy === "advance" ? "advance" : null,
  };
}

export interface SessionChargeRecord {
  id: string;
  classId: string;
  accountId: string;
  studentId: string;
  courseId: string;
  courseTitle: string;
  title: string;
  date: string;
  startTime: string;
  startAt: string | null;
  amountMinor: number;
  rateVersionId: string;
  status: SessionChargeStatus;
  paymentId: string | null;
  cancelKind: string | null;
  needsReview: string | null;
}

export function mapSessionCharge(snapshot: DocumentSnapshot<DocumentData>): SessionChargeRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  return {
    id: snapshot.id,
    classId: String(d.classId ?? ""),
    accountId: String(d.accountId ?? ""),
    studentId: String(d.studentId ?? ""),
    courseId: String(d.courseId ?? ""),
    courseTitle: String(d.courseTitle ?? "Course"),
    title: String(d.title ?? "Session"),
    date: String(d.date ?? ""),
    startTime: String(d.startTime ?? ""),
    startAt: toIso(d.startAt),
    amountMinor: int(d.amountMinor),
    rateVersionId: String(d.rateVersionId ?? ""),
    status: oneOf(SESSION_CHARGE_STATUSES, d.status, "due"),
    paymentId: str(d.paymentId),
    cancelKind: str(d.cancelKind),
    needsReview: str(d.needsReview),
  };
}

// --- Old dues (before November 2026) -----------------------------------------------------------------

export interface LegacyDuesRecord {
  studentId: string;
  status: LegacyDuesStatus;
  note: string | null;
  verifiedBy: string | null;
  verifiedByEmail: string | null;
  verifiedAt: string | null;
}

export function legacyDuesRef(studentId: string) {
  return col("legacyDues").doc(studentId);
}

export function mapLegacyDues(snapshot: DocumentSnapshot<DocumentData>): LegacyDuesRecord | null {
  const d = snapshot.data();
  if (!d || !(LEGACY_DUES_STATUSES as readonly unknown[]).includes(d.status)) return null;
  return {
    studentId: snapshot.id,
    status: d.status,
    note: str(d.note),
    verifiedBy: str(d.verifiedBy),
    verifiedByEmail: str(d.verifiedByEmail),
    verifiedAt: toIso(d.verifiedAt),
  };
}

/** Throws unless an administrator has verified this student's old dues. Use inside a transaction. */
export async function assertLegacyDuesClearedInTx(tx: Transaction, studentId: string) {
  const record = mapLegacyDues(await tx.get(legacyDuesRef(studentId)));
  if (!legacyDuesCleared(record)) {
    throw new AccessError("This student's fees before November 2026 have not been verified as cleared. An administrator must verify old dues first (student profile → Old dues).");
  }
}

// --- Batch class charges (two phases: reads, then writes) ----------------------------------------------

export type ChargePlan =
  | { kind: "none" }
  | { kind: "already" }
  | {
      kind: "charge";
      cls: LiveClassRecord;
      account: BillingAccountRecord;
      line: InvoiceLine;
      nowIso: string;
      /** This class becomes the first class (paid by the first-class payment). */
      coversFirst: boolean;
      /** A later class that was the first class until now (only before any invoice exists). */
      previousFirstId: string | null;
    };

/**
 * Reads everything needed to charge one student's class (batch) or session
 * (individual) for a recorded outcome or a cancellation. `nowIso` is the server
 * time of the outcome/cancellation (the 24-hour rule for individual sessions).
 */
export async function prepareClassCharge(tx: Transaction, cls: LiveClassRecord, outcome: ClassOutcome, nowIso: string): Promise<ChargePlan> {
  if (!cls.billingAccountId) return { kind: "none" };
  if (cls.packageId) throw new AccessError("This class uses a prepaid package; it cannot also be billed per class.");
  const ledgerRef = col("billableClasses").doc(cls.id);
  const accountRef = col("billingAccounts").doc(cls.billingAccountId);
  const sessionChargeRef = col("sessionCharges").doc(sessionChargeId(cls.id));
  const [ledgerSnap, accountSnap, configSnap, sessionChargeSnap] = await Promise.all([
    tx.get(ledgerRef),
    tx.get(accountRef),
    tx.get(classBillingConfigRef()),
    tx.get(sessionChargeRef),
  ]);
  const account = mapAccount(accountSnap);
  if (!account) throw new AccessError("The billing account for this class could not be found.");
  if (account.studentId !== cls.studentId) throw new AccessError("This class does not belong to that billing account.");
  // A session scheduled under the earlier per-session method keeps its own charge (paid separately): never billed again.
  if (sessionChargeSnap.exists) return { kind: "none" };
  const period = periodOf(cls.startAt);
  // Classes before November 2026 stay with the old payment method.
  if (!isWebsiteBilledPeriod(period)) return { kind: "none" };

  const config = mapConfig(configSnap);
  const cancelledLate = Date.parse(cls.startAt) - Date.parse(nowIso) < FREE_CANCELLATION_HOURS * 3_600_000;
  const billable = account.mode === "batch" ? isBatchBillable(outcome, config.policy) : isIndividualBillable(outcome, cancelledLate);
  if (ledgerSnap.exists) {
    if (billable) return { kind: "already" };
    const billed = mapBillableClass(ledgerSnap);
    throw new AccessError(
      `This class was already charged${billed?.invoiceId ? " and invoiced" : ""}. It cannot be changed to a non-billable outcome; record a credit note on the invoice instead.`,
    );
  }
  if (!billable) return { kind: "none" };
  const version = rateVersionForPeriod(config.rateVersions, period);
  // The student's agreed rate for the month the class took place (immutable history on the account);
  // accounts opened before course pricing use the versioned rates. Never the course's latest price.
  const agreed = agreedRateForPeriod(account.agreedRates, period);
  // The initial enrolment payment covers the first eligible class/session — only once it has been received.
  const prepaid = account.advance.status === "verified" || account.advance.status === "applied";
  // The earliest eligible class is the first class. A class recorded late that
  // took place earlier takes over — but only while neither has been invoiced.
  let coversFirst = account.firstClassId === null && (account.mode === "batch" || prepaid);
  let previousFirstId: string | null = null;
  if (!coversFirst && account.firstClassStartAt && cls.startAt < account.firstClassStartAt && account.firstClassId && account.advance.status !== "applied") {
    const previous = mapBillableClass(await tx.get(col("billableClasses").doc(account.firstClassId)));
    if (previous && previous.invoiceId === null) {
      coversFirst = true;
      previousFirstId = previous.classId;
    }
  }
  return {
    kind: "charge",
    cls,
    account,
    nowIso,
    coversFirst,
    previousFirstId,
    line: {
      classId: cls.id,
      date: cls.date,
      title: cls.title,
      outcome,
      rateMinor: agreed ?? (account.mode === "batch" ? version.batchMinor : version.individualMinor),
      rateVersionId: agreed !== null ? "agreed" : version.id,
      period,
    },
  };
}

export function applyClassCharge(tx: Transaction, plan: ChargePlan, actor: Actor): void {
  if (plan.kind !== "charge") return;
  const { cls, account, line } = plan;
  // create() fails if a concurrent transaction charged this class first.
  tx.create(col("billableClasses").doc(cls.id), {
    ...line,
    accountId: account.id,
    studentId: account.studentId,
    courseId: account.courseId,
    sessionKey: cls.sessionKey ?? cls.id,
    batchId: cls.batchId,
    startAt: Timestamp.fromMillis(Date.parse(cls.startAt)),
    coveredBy: plan.coversFirst ? "advance" : null,
    invoiceId: null,
    billedAt: Timestamp.fromMillis(Date.parse(plan.nowIso)),
    billedBy: actor.uid,
  });
  if (plan.previousFirstId) tx.update(col("billableClasses").doc(plan.previousFirstId), { coveredBy: null });
  tx.update(col("billingAccounts").doc(account.id), {
    billableCount: FieldValue.increment(1),
    ...(plan.coversFirst
      ? {
          firstClassId: cls.id,
          firstClassStartAt: Timestamp.fromMillis(Date.parse(cls.startAt)),
          history: FieldValue.arrayUnion(entry(actor, `First ${account.mode === "batch" ? "class" : "session"} (${cls.date}) paid by the initial enrolment payment`)),
        }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// --- Per-session charges (earlier individual method; history, still payable) ---------------------------------
//
// New individual sessions are billed on the monthly invoice from their recorded
// outcome (prepareClassCharge). Sessions that already have a per-session charge
// keep it: cancellation and rescheduling follow the same 24-hour rule.

export type SessionCancelPlan =
  | { kind: "none" }
  | { kind: "update"; ref: DocumentReference; charge: SessionChargeRecord; decision: "no_charge" | "payable"; cancelKind: string };

/** Reads the charge of an individual session being cancelled and decides the outcome on the server. */
export async function prepareSessionCancel(tx: Transaction, cls: LiveClassRecord, kind: "academy" | "student" | "rescheduled", nowMs: number): Promise<SessionCancelPlan> {
  if (!cls.billingAccountId) return { kind: "none" };
  const ref = col("sessionCharges").doc(sessionChargeId(cls.id));
  const charge = mapSessionCharge(await tx.get(ref));
  if (!charge) return { kind: "none" };
  const decision = individualCancellationCharge({ kind, startAtMs: Date.parse(cls.startAt), cancelledAtMs: nowMs });
  return { kind: "update", ref, charge, decision, cancelKind: kind };
}

export function applySessionCancel(tx: Transaction, plan: SessionCancelPlan, actor: Actor) {
  if (plan.kind !== "update") return;
  const { charge, decision } = plan;
  if (decision === "payable") {
    tx.update(plan.ref, {
      cancelKind: plan.cancelKind,
      history: FieldValue.arrayUnion(entry(actor, "Cancelled by the student — the session fee remains payable (recording provided)")),
    });
    return;
  }
  // No charge. If it was already paid, keep the payment and flag it (no automatic refund).
  tx.update(plan.ref, {
    status: "no_charge",
    cancelKind: plan.cancelKind,
    needsReview: charge.status === "paid" ? "Paid, then cancelled without charge — transfer the payment to the replacement session or refund (decision pending)." : null,
    history: FieldValue.arrayUnion(entry(actor, `Cancelled (${plan.cancelKind}) — no charge`)),
  });
}

/** Rescheduling by editing the time: the SAME charge moves with the session (never a second charge). */
export async function readSessionCharge(tx: Transaction, classId: string) {
  const ref = col("sessionCharges").doc(sessionChargeId(classId));
  return { ref, charge: mapSessionCharge(await tx.get(ref)) };
}

// --- Monthly invoices ------------------------------------------------------------------------------------

export interface MonthlyIssueResult {
  /** Invoice ids created by this call. */
  created: string[];
  /** The month that was closable at this time (null before the first billing month). */
  period: string | null;
}

/**
 * Issues the monthly invoice of one account (batch or individual) for the
 * latest month that may be closed now (from 23:00 IST on its last calendar
 * day). It lists every billable class/session not yet invoiced up to that month,
 * including the first class/session with the initial enrolment payment deducted.
 * Idempotent and safe to run concurrently: the invoice id is deterministic and
 * created once; the charges and the advance are marked in the same transaction.
 */
export async function issueDueMonthlyInvoices(accountId: string, actor: Actor, nowIso = new Date().toISOString()): Promise<MonthlyIssueResult> {
  const accountRef = col("billingAccounts").doc(accountId);
  const nowMs = Date.parse(nowIso);
  const period = closablePeriod(nowMs);
  if (!isWebsiteBilledPeriod(period)) return { created: [], period: null };
  const invoiceRef = col("invoices").doc(monthlyInvoiceId(accountId, period));
  return db().runTransaction(async (tx) => {
    // ---- reads ----
    const [accountSnap, ledgerSnap, invoiceSnap] = await Promise.all([
      tx.get(accountRef),
      tx.get(col("billableClasses").where("accountId", "==", accountId)),
      tx.get(invoiceRef),
    ]);
    const account = mapAccount(accountSnap);
    const result: MonthlyIssueResult = { created: [], period };
    // Already issued: classes recorded since then wait for next month's invoice.
    if (!account || invoiceSnap.exists) return result;
    // The first class/session is listed (and the initial payment deducted) only once that payment has been
    // verified; while it is still awaited the class waits for a later invoice — it is never charged twice.
    const charges = ledgerSnap.docs
      .map(mapBillableClass)
      .filter((b): b is BillableClassRecord => b !== null && isWebsiteBilledPeriod(b.period) && (b.coveredBy !== "advance" || account?.advance.status === "verified"));
    const lines = monthLines(charges, period);
    if (lines.length === 0) return result;
    const { subtotalMinor, initialPaymentMinor, amountDueMinor } = monthAmounts(lines);
    const deduct = initialPaymentMinor > 0;
    const invoiceDate = monthlyInvoiceDate(period, nowIso);
    const deadline = monthlyPaymentDeadline(invoiceDate);
    const invoiceLines: InvoiceLine[] = lines.map((b) => ({
      classId: b.classId,
      date: b.date,
      title: b.title,
      outcome: b.outcome,
      rateMinor: b.rateMinor,
      rateVersionId: b.rateVersionId,
      period: b.period,
      ...(b.coveredBy === "advance" && deduct ? { coveredByInitialPayment: true } : {}),
    }));
    const rates = new Set(invoiceLines.map((l) => l.rateMinor));
    const now = Timestamp.fromMillis(nowMs);

    // ---- writes ----
    tx.create(invoiceRef, {
      kind: "month",
      period,
      invoiceDate,
      accountId,
      studentId: account.studentId,
      learnerIds: [account.studentId],
      courseId: account.courseId,
      courseTitle: account.courseTitle,
      studentName: account.studentName,
      batchId: account.batchId,
      mode: account.mode,
      // Learn Together: one invoice for the shared enrolment, both names, per-learner and per-session rates.
      learnerCount: account.learnerCount,
      learnerNames: account.learnerNames,
      perLearnerRateMinor: account.perLearnerRateMinor,
      lines: invoiceLines,
      lineCount: invoiceLines.length,
      rateMinor: rates.size === 1 ? invoiceLines[0].rateMinor : null,
      subtotalMinor,
      advanceAppliedMinor: initialPaymentMinor,
      amountDueMinor,
      currency: "INR",
      status: "issued",
      issuedAt: now,
      dueAt: Timestamp.fromMillis(Date.parse(deadline)),
      deadlineAt: Timestamp.fromMillis(Date.parse(deadline)),
      createdAt: now,
      createdBy: actor.uid,
      history: [
        entry(
          actor,
          `${periodLabel(period)} invoice dated ${invoiceDate}: ${invoiceLines.length} ${account.mode === "batch" ? "class(es)" : "session(s)"}${
            initialPaymentMinor ? `, initial enrolment payment deducted ₹${initialPaymentMinor / 100}` : ""
          }; payment deadline ${deadline}`,
        ),
      ],
    });
    for (const l of lines) tx.update(col("billableClasses").doc(l.classId), { invoiceId: invoiceRef.id });
    tx.update(accountRef, {
      ...(deduct
        ? {
            "advance.status": "applied",
            "advance.appliedMinor": initialPaymentMinor,
            history: FieldValue.arrayUnion(entry(actor, `Initial enrolment payment deducted on the ${periodLabel(period)} invoice`)),
          }
        : {}),
      lastInvoicedPeriod: period,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (deduct) {
      tx.create(col("advanceLedger").doc(), {
        accountId,
        studentId: account.studentId,
        kind: "applied",
        amountMinor: initialPaymentMinor,
        invoiceId: invoiceRef.id,
        paymentId: account.advance.paymentId,
        at: now,
        by: actor.uid,
      });
    }
    result.created.push(invoiceRef.id);
    return result;
  });
}

/** Reads one account's invoices with their payments and adjustments (no writes). */
async function readAccountInvoicesInTx(tx: Transaction, accountId: string) {
  const [invoicesSnap, paymentsSnap, adjustmentsSnap] = await Promise.all([
    tx.get(col("invoices").where("accountId", "==", accountId)),
    tx.get(col("payments").where("accountId", "==", accountId)),
    tx.get(col("invoiceAdjustments").where("accountId", "==", accountId)),
  ]);
  const payments = paymentsSnap.docs.map(mapPayment).filter((p): p is PaymentRecord => p !== null);
  const adjustments = adjustmentsSnap.docs.map(mapInvoiceAdjustment).filter((a): a is InvoiceAdjustmentRecord => a !== null);
  return invoicesSnap.docs
    .map(mapInvoice)
    .filter((i): i is InvoiceRecord => i !== null)
    .map((i) => ({
      ...i,
      summary: summarizeInvoice({
        amountDueMinor: i.amountDueMinor,
        payments: payments.filter((p) => p.invoiceId === i.id),
        adjustments: adjustments.filter((a) => a.invoiceId === i.id),
      }),
    }));
}

/** One account's invoices with their balances (read-only; used for payment reminders). */
export async function readAccountInvoices(accountId: string) {
  return db().runTransaction((tx) => readAccountInvoicesInTx(tx, accountId), { readOnly: true });
}

/**
 * Suspends (reversibly) when an invoice is unpaid after its payment deadline,
 * and restores as soon as no such invoice remains. Idempotent. Nothing is deleted.
 */
export async function evaluateSuspension(accountId: string, actor: Actor, nowMs = Date.now()): Promise<"suspended" | "restored" | "unchanged"> {
  const accountRef = col("billingAccounts").doc(accountId);
  return db().runTransaction(async (tx) => {
    const [accountSnap, invoices] = await Promise.all([tx.get(accountRef), readAccountInvoicesInTx(tx, accountId)]);
    const account = mapAccount(accountSnap);
    if (!account) return "unchanged";
    const overdue = invoices.filter((i) => i.status === "issued" && i.summary.balanceMinor > 0 && invoiceDueState(i, nowMs) === "overdue");
    const suspend = shouldSuspend(invoices.map((i) => ({ status: i.status, dueAt: i.dueAt, deadlineAt: i.deadlineAt, balanceMinor: i.summary.balanceMinor })), nowMs);
    if (suspend && !account.suspension.active) {
      tx.update(accountRef, {
        suspension: { active: true, since: Timestamp.fromMillis(nowMs), invoiceIds: overdue.map((i) => i.id), liftedAt: null },
        history: FieldValue.arrayUnion(entry(actor, `Access suspended: ${overdue.map((i) => i.label).join(", ")} unpaid after the payment deadline`)),
      });
      return "suspended";
    }
    if (!suspend && account.suspension.active) {
      tx.update(accountRef, {
        "suspension.active": false,
        "suspension.liftedAt": Timestamp.fromMillis(nowMs),
        history: FieldValue.arrayUnion(entry(actor, "Access restored: no invoice remains unpaid past its payment deadline")),
      });
      return "restored";
    }
    return "unchanged";
  });
}

export interface ScheduledRunSummary {
  invoicesCreated: number;
  suspended: number;
  restored: number;
  errors: number;
}

/**
 * The scheduled billing job (Vercel Cron → /api/cron/billing, daily 23:30 IST,
 * or "Run billing now" by a teacher). On the last calendar day of a month it
 * generates that month's invoices; every run re-evaluates suspensions. Safe to
 * run any number of times: invoices are create-once, suspension is re-derived
 * from the current data.
 */
export async function runScheduledBilling(actor: Actor, nowIso = new Date().toISOString()): Promise<ScheduledRunSummary> {
  const accounts = (await col("billingAccounts").get()).docs.map((d) => d.id);
  const summary: ScheduledRunSummary = { invoicesCreated: 0, suspended: 0, restored: 0, errors: 0 };
  for (const accountId of accounts) {
    try {
      const r = await issueDueMonthlyInvoices(accountId, actor, nowIso);
      summary.invoicesCreated += r.created.length;
      // After the invoice is committed; never fails the run (see lib/notifications).
      for (const invoiceId of r.created) await notifyInvoiceIssued(invoiceId);
    } catch (error) {
      summary.errors += 1;
      console.error("[billing] monthly invoice generation failed:", accountId, (error as Error)?.message);
    }
    try {
      const r = await evaluateSuspension(accountId, actor, Date.parse(nowIso));
      if (r === "suspended") summary.suspended += 1;
      if (r === "restored") summary.restored += 1;
      // Payment-due reminder / overdue notice, once per invoice each.
      await notifyInvoiceDueStates(accountId, Date.parse(nowIso));
    } catch (error) {
      summary.errors += 1;
      console.error("[billing] suspension evaluation failed:", accountId, (error as Error)?.message);
    }
  }
  return summary;
}

/**
 * Deadline-precise enforcement between scheduled runs: if one of the student's
 * accounts has an invoice unpaid past its payment deadline but is not yet
 * suspended, suspend it now (same idempotent evaluation as the job). Called
 * before Meet links or protected course content are served.
 */
export async function enforceOverdueForStudent(studentId: string, nowMs = Date.now()): Promise<void> {
  if (!isValidId(studentId)) return;
  const [invoicesSnap, accountsSnap] = await Promise.all([
    col("invoices").where("studentId", "==", studentId).where("status", "==", "issued").get(),
    col("billingAccounts").where("studentId", "==", studentId).get(),
  ]);
  const suspended = new Set(accountsSnap.docs.filter((d) => d.get("suspension.active") === true).map((d) => d.id));
  const pastDeadline = new Set(
    invoicesSnap.docs
      .map(mapInvoice)
      .filter((i): i is InvoiceRecord => i !== null && Date.parse(i.deadlineAt) < nowMs && !suspended.has(i.accountId))
      .map((i) => i.accountId),
  );
  // evaluateSuspension checks the balance (paid / partly paid) inside its transaction.
  for (const accountId of pastDeadline) await evaluateSuspension(accountId, { uid: "access-check", email: null }, nowMs);
}

// --- Payment targets --------------------------------------------------------------------------------------

export type PaymentTarget =
  | { kind: "advance"; accountId: string }
  | { kind: "invoice"; invoiceId: string }
  | { kind: "session"; chargeId: string }
  | { kind: "registration"; registrationId: string };

export interface TargetState {
  target: PaymentTarget;
  /** Who and what the payment is for (every target). accountId is null for a registration not yet placed. */
  owner: { studentId: string; courseId: string; accountId: string | null };
  /** The billing account (null only for a website registration's initial payment). */
  account: BillingAccountRecord | null;
  accountRef: DocumentReference | null;
  registration: { id: string; status: string; mode: string; amountMinor: number; ref: DocumentReference; learnerName: string; special: boolean } | null;
  invoice: InvoiceRecord | null;
  summary: InvoiceSummary | null;
  session: SessionChargeRecord | null;
  sessionRef: DocumentReference | null;
  payableMinor: number | null;
  titleSuffix: string;
}

/** Reads a payment target (reads only). */
export async function readPaymentTarget(tx: Transaction, target: PaymentTarget): Promise<TargetState> {
  const base = { invoice: null, summary: null, session: null, sessionRef: null, registration: null };
  const ownerOf = (a: BillingAccountRecord) => ({ studentId: a.studentId, courseId: a.courseId, accountId: a.id });
  if (target.kind === "registration") {
    const ref = col("registrations").doc(target.registrationId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AccessError("That registration could not be found.");
    const status = String(snap.get("status") ?? "");
    const mode = String(snap.get("mode") ?? "");
    const amountMinor = int(snap.get("initialAmountMinor"));
    const special = snap.get("kind") === "special";
    return {
      ...base,
      target,
      owner: { studentId: String(snap.get("studentId") ?? ""), courseId: String(snap.get("courseId") ?? ""), accountId: str(snap.get("accountId")) },
      account: null,
      accountRef: null,
      registration: { id: ref.id, status, mode, amountMinor, ref, learnerName: String(snap.get("details.fullName") ?? "") || "Student", special },
      payableMinor: payableAmount({ kind: "registration", status, amountMinor }),
      titleSuffix: `${special ? "programme fee (full payment)" : mode === "individual" ? "first individual session" : "first-class payment"} — ${String(snap.get("courseTitle") ?? "course")} registration`,
    };
  }
  if (target.kind === "advance") {
    const accountRef = col("billingAccounts").doc(target.accountId);
    const account = mapAccount(await tx.get(accountRef));
    if (!account) throw new AccessError("That billing account could not be found.");
    return { ...base, target, owner: ownerOf(account), account, accountRef, payableMinor: payableAmount({ kind: "advance", advance: account.advance }), titleSuffix: "first-class payment" };
  }
  if (target.kind === "session") {
    const sessionRef = col("sessionCharges").doc(target.chargeId);
    const session = mapSessionCharge(await tx.get(sessionRef));
    if (!session) throw new AccessError("That session could not be found.");
    const accountRef = col("billingAccounts").doc(session.accountId);
    const account = mapAccount(await tx.get(accountRef));
    if (!account) throw new AccessError("The billing account for this session could not be found.");
    return {
      ...base,
      target,
      owner: ownerOf(account),
      account,
      accountRef,
      session,
      sessionRef,
      payableMinor: payableAmount({ kind: "session", status: session.status, amountMinor: session.amountMinor }),
      titleSuffix: `individual session on ${session.date} ${session.startTime} IST`,
    };
  }
  const invoice = mapInvoice(await tx.get(col("invoices").doc(target.invoiceId)));
  if (!invoice) throw new AccessError("That invoice could not be found.");
  const accountRef = col("billingAccounts").doc(invoice.accountId);
  const [accountSnap, paymentsSnap, adjustmentsSnap] = await Promise.all([
    tx.get(accountRef),
    tx.get(col("payments").where("invoiceId", "==", invoice.id)),
    tx.get(col("invoiceAdjustments").where("invoiceId", "==", invoice.id)),
  ]);
  const account = mapAccount(accountSnap);
  if (!account) throw new AccessError("The billing account for this invoice could not be found.");
  const summary = summarizeInvoice({
    amountDueMinor: invoice.amountDueMinor,
    payments: paymentsSnap.docs.map(mapPayment).filter((p): p is PaymentRecord => p !== null),
    adjustments: adjustmentsSnap.docs.map(mapInvoiceAdjustment).filter((a): a is InvoiceAdjustmentRecord => a !== null),
  });
  return {
    ...base,
    target,
    owner: ownerOf(account),
    account,
    accountRef,
    invoice,
    summary,
    payableMinor: payableAmount({ kind: "invoice", status: invoice.status, summary }),
    titleSuffix: `invoice: ${invoice.label}`,
  };
}

/**
 * Active enrolment for a confirmed Special Programme registration (writes only; merge keeps
 * any earlier enrolment history). Idempotent: repeating it changes nothing that matters.
 */
export function grantProgrammeAccess(tx: Transaction, input: { courseId: string; studentId: string; registrationId: string; by: string }) {
  if (!input.courseId || !input.studentId) return;
  const ref = col("enrollments").doc(enrollmentId(input.courseId, input.studentId));
  tx.set(
    ref,
    {
      id: ref.id,
      studentId: input.studentId,
      courseId: input.courseId,
      status: "active",
      enrolledAt: FieldValue.serverTimestamp(),
      enrolledBy: input.by,
      revokedAt: null,
      revokedBy: null,
      agreedFee: null,
      currency: "INR",
      registrationId: input.registrationId,
      source: "programme",
      history: FieldValue.arrayUnion({ type: "enrolled", at: Timestamp.now(), by: input.by }),
    },
    { merge: true },
  );
}

/** Effects of a payment becoming paid + verified (writes only). Each target changes at most once. */
export function applyVerifiedPayment(tx: Transaction, state: TargetState, paymentId: string, actor: Actor) {
  if (state.target.kind === "registration") {
    // The registration becomes paid; the batch/individual account is created when the academy places the student.
    if (!state.registration || state.registration.status !== "pending_payment") throw new AccessError("This registration has already been paid.");
    tx.update(state.registration.ref, {
      status: "paid",
      paymentId,
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion(
        entry(actor, state.registration.special ? "Full programme fee received (verified) — registration confirmed" : "Initial payment received (verified)"),
      ),
    });
    // Special Programme: the verified full payment grants access at once (no billing account,
    // no monthly invoice). A guest registration gets it when its account is linked.
    if (state.registration.special && state.owner.studentId) {
      grantProgrammeAccess(tx, { courseId: state.owner.courseId, studentId: state.owner.studentId, registrationId: state.registration.id, by: actor.uid });
    }
    return;
  }
  if (!state.account || !state.accountRef) throw new AccessError("The billing account for this payment could not be found.");
  if (state.target.kind === "advance") {
    if (state.account.advance.status !== "awaiting") throw new AccessError("The advance for this account has already been received.");
    tx.update(state.accountRef, {
      "advance.status": "verified",
      "advance.paymentId": paymentId,
      history: FieldValue.arrayUnion(entry(actor, "First-class payment received (verified)")),
    });
    tx.create(col("advanceLedger").doc(), {
      accountId: state.account.id,
      studentId: state.account.studentId,
      kind: "received",
      amountMinor: state.account.advance.amountMinor,
      paymentId,
      at: FieldValue.serverTimestamp(),
      by: actor.uid,
    });
    return;
  }
  if (state.target.kind === "session") {
    if (!state.session || !state.sessionRef || state.session.status !== "due") throw new AccessError("This session has already been paid or has no charge.");
    tx.update(state.sessionRef, { status: "paid", paymentId, paidAt: FieldValue.serverTimestamp(), history: FieldValue.arrayUnion(entry(actor, "Session paid (verified)")) });
  }
  // Invoices: the balance is always derived from verified payments.
}

// --- Readers ---------------------------------------------------------------------------------------------

export interface InvoiceView extends InvoiceRecord {
  summary: InvoiceSummary;
  dueState: DueState;
  payments: PaymentRecord[];
  adjustments: InvoiceAdjustmentRecord[];
}

async function invoiceViews(invoices: InvoiceRecord[], nowMs: number): Promise<InvoiceView[]> {
  if (invoices.length === 0) return [];
  const ids = invoices.map((i) => i.id);
  const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const [payments, adjustments] = await Promise.all([
    Promise.all(chunk(ids, 30).map((part) => col("payments").where("invoiceId", "in", part).get())).then((s) =>
      s.flatMap((x) => x.docs.map(mapPayment).filter((p): p is PaymentRecord => p !== null)),
    ),
    Promise.all(chunk(ids, 30).map((part) => col("invoiceAdjustments").where("invoiceId", "in", part).get())).then((s) =>
      s.flatMap((x) => x.docs.map(mapInvoiceAdjustment).filter((a): a is InvoiceAdjustmentRecord => a !== null)),
    ),
  ]);
  return invoices.map((inv) => {
    const own = { payments: payments.filter((p) => p.invoiceId === inv.id), adjustments: adjustments.filter((a) => a.invoiceId === inv.id) };
    const summary = summarizeInvoice({ amountDueMinor: inv.amountDueMinor, ...own });
    return { ...inv, ...own, summary, dueState: summary.balanceMinor > 0 ? invoiceDueState(inv, nowMs) : "not_due" };
  });
}

export interface AccountRow extends BillingAccountRecord {
  /** The student's agreed rate this month (per class / per session); null for accounts without one (versioned rates). */
  agreedRateMinor: number | null;
  outstandingMinor: number;
  uninvoicedCount: number;
  uninvoicedMinor: number;
  sessionsDueMinor: number;
}

export async function listBillingAccounts(user: SessionUser) {
  assertTeacher(user);
  const nowMs = Date.now();
  const [accountsSnap, invoicesSnap, ledgerSnap, sessionsSnap, reviewSnap, failedSnap] = await Promise.all([
    col("billingAccounts").get(),
    col("invoices").get(),
    col("billableClasses").where("invoiceId", "==", null).get(),
    col("sessionCharges").where("status", "==", "due").get(),
    // Online payments received but not applied automatically (e.g. stale or short amounts): a teacher decides.
    col("payments").where("needsReview", "==", true).get(),
    col("payments").where("status", "==", "failed").get(),
  ]);
  const accounts = accountsSnap.docs.map(mapAccount).filter((a): a is BillingAccountRecord => a !== null);
  const invoices = await invoiceViews(invoicesSnap.docs.map(mapInvoice).filter((i): i is InvoiceRecord => i !== null), nowMs);
  const ledger = ledgerSnap.docs.map(mapBillableClass).filter((b): b is BillableClassRecord => b !== null);
  const sessions = sessionsSnap.docs.map(mapSessionCharge).filter((s): s is SessionChargeRecord => s !== null);
  const rows: AccountRow[] = accounts.map((a) => {
    const own = ledger.filter((b) => b.accountId === a.id && b.coveredBy === null);
    // (The first class/session — coveredBy "advance" — is deducted on its invoice and adds nothing.)
    return {
      ...a,
      agreedRateMinor: agreedRateForPeriod(a.agreedRates, periodOf(new Date(nowMs).toISOString())),
      outstandingMinor: invoices.filter((i) => i.accountId === a.id && i.status === "issued").reduce((s, i) => s + Math.max(i.summary.balanceMinor, 0), 0),
      uninvoicedCount: own.length,
      uninvoicedMinor: own.reduce((s, b) => s + b.rateMinor, 0),
      sessionsDueMinor: sessions.filter((s) => s.accountId === a.id).reduce((t, s) => t + s.amountMinor, 0),
    };
  });
  return {
    rows: rows.sort((a, b) => a.studentName.localeCompare(b.studentName)),
    unpaid: invoices.filter((i) => i.status === "issued" && i.summary.balanceMinor > 0).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    suspended: rows.filter((r) => r.suspension.active),
    paymentsToReview: [...reviewSnap.docs, ...failedSnap.docs]
      .map(mapPayment)
      .filter((p): p is PaymentRecord => p !== null && p.purpose !== null)
      .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")),
    sessionsDue: sessions.sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? "")),
    sessionsNeedingReview: (await col("sessionCharges").where("status", "==", "no_charge").get()).docs
      .map(mapSessionCharge)
      .filter((s): s is SessionChargeRecord => s !== null && s.needsReview !== null),
  };
}

export async function getBillingAccountDetail(user: SessionUser, accountId: string) {
  assertTeacher(user);
  if (!isValidId(accountId)) return null;
  const account = mapAccount(await col("billingAccounts").doc(accountId).get());
  if (!account) return null;
  const [invoicesSnap, ledgerSnap, paymentsSnap, sessionsSnap, advanceSnap, legacy] = await Promise.all([
    col("invoices").where("accountId", "==", accountId).get(),
    col("billableClasses").where("accountId", "==", accountId).get(),
    col("payments").where("accountId", "==", accountId).get(),
    col("sessionCharges").where("accountId", "==", accountId).get(),
    col("advanceLedger").where("accountId", "==", accountId).get(),
    legacyDuesRef(account.studentId).get().then(mapLegacyDues),
  ]);
  return {
    account,
    legacy,
    invoices: (await invoiceViews(invoicesSnap.docs.map(mapInvoice).filter((i): i is InvoiceRecord => i !== null), Date.now())).sort((a, b) => b.dueAt.localeCompare(a.dueAt)),
    billable: ledgerSnap.docs
      .map(mapBillableClass)
      .filter((b): b is BillableClassRecord => b !== null)
      .sort((a, b) => b.date.localeCompare(a.date)),
    payments: paymentsSnap.docs
      .map(mapPayment)
      .filter((p): p is PaymentRecord => p !== null)
      .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")),
    sessions: sessionsSnap.docs
      .map(mapSessionCharge)
      .filter((s): s is SessionChargeRecord => s !== null)
      .sort((a, b) => (b.startAt ?? "").localeCompare(a.startAt ?? "")),
    advanceLedger: advanceSnap.docs
      .map((d) => ({ id: d.id, kind: String(d.get("kind") ?? ""), amountMinor: int(d.get("amountMinor")), invoiceId: str(d.get("invoiceId")), at: toIso(d.get("at")) }))
      .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "")),
  };
}

export interface AccountBillingStatus {
  /** "paid" = nothing outstanding; "pending" = within the payment window; "overdue" = past its deadline; "suspended" = access paused. */
  state: "paid" | "pending" | "overdue" | "suspended" | "first_class_unpaid";
  outstandingMinor: number;
  openInvoices: { id: string; label: string; balanceMinor: number; dueAt: string; dueState: DueState; classCount: number }[];
  /** Whether the student may join the next class (server rule used for Meet links). */
  eligibleForNextClass: boolean;
}

/** Teacher roster view: each account's billing status and next-class eligibility. */
export async function getAccountsBillingStatus(user: SessionUser, accounts: readonly BillingAccountRecord[]): Promise<Record<string, AccountBillingStatus>> {
  assertTeacher(user);
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0) return {};
  const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const snaps = await Promise.all(chunk(ids, 30).map((part) => col("invoices").where("accountId", "in", part).get()));
  const invoices = await invoiceViews(
    snaps.flatMap((x) => x.docs.map(mapInvoice).filter((i): i is InvoiceRecord => i !== null)),
    Date.now(),
  );
  return Object.fromEntries(
    accounts.map((a) => {
      const open = invoices.filter((i) => i.accountId === a.id && i.status === "issued" && i.summary.balanceMinor > 0).sort((x, y) => x.dueAt.localeCompare(y.dueAt));
      const block = classAccessBlock(a);
      const state: AccountBillingStatus["state"] =
        block === "suspended" ? "suspended" : block === "first_class_unpaid" ? "first_class_unpaid" : open.some((i) => i.dueState === "overdue") ? "overdue" : open.length ? "pending" : "paid";
      return [
        a.id,
        {
          state,
          outstandingMinor: open.reduce((t, i) => t + i.summary.balanceMinor, 0),
          openInvoices: open.map((i) => ({ id: i.id, label: i.label, balanceMinor: i.summary.balanceMinor, dueAt: i.deadlineAt, dueState: i.dueState, classCount: i.lines.length })),
          eligibleForNextClass: block === null,
        },
      ];
    }),
  );
}

/** The signed-in student's own billing (bound to user.uid). */
export async function getOwnClassBilling(user: SessionUser) {
  const empty = { accounts: [], invoices: [], sessions: [], uninvoiced: [] as { courseTitle: string; mode: BillingMode; count: number; amountMinor: number }[] };
  if (user.role !== "student") return empty;
  const nowMs = Date.now();
  const [accountsSnap, invoicesSnap, sessionsSnap, ledgerSnap] = await Promise.all([
    col("billingAccounts").where("studentId", "==", user.uid).get(),
    col("invoices").where("studentId", "==", user.uid).get(),
    col("sessionCharges").where("studentId", "==", user.uid).get(),
    col("billableClasses").where("studentId", "==", user.uid).get(),
  ]);
  const accounts = accountsSnap.docs.map(mapAccount).filter((a): a is BillingAccountRecord => a !== null && a.studentId === user.uid);
  const invoices = await invoiceViews(invoicesSnap.docs.map(mapInvoice).filter((i): i is InvoiceRecord => i !== null && i.studentId === user.uid && i.status === "issued"), nowMs);
  // The first class/session is listed with the initial payment deducted, so it is shown at no cost here.
  const pending = ledgerSnap.docs
    .map(mapBillableClass)
    .filter((b): b is BillableClassRecord => b !== null && b.studentId === user.uid && b.invoiceId === null)
    .map((b) => (b.coveredBy === "advance" ? { ...b, rateMinor: 0 } : b));
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      courseTitle: a.courseTitle,
      mode: a.mode,
      learnerNames: a.learnerNames,
      learnerCount: a.learnerCount,
      perLearnerRateMinor: a.perLearnerRateMinor,
      status: a.status,
      suspended: a.suspension.active,
      advance: { status: a.advance.status, amountMinor: a.advance.amountMinor },
      blocked: classAccessBlock(a),
    })),
    invoices: invoices
      .sort((a, b) => b.dueAt.localeCompare(a.dueAt))
      .map((i) => ({
        id: i.id,
        courseTitle: i.courseTitle,
        label: i.label,
        kind: i.kind,
        period: i.period,
        invoiceDate: i.invoiceDate,
        learnerCount: i.learnerCount,
        learnerNames: i.learnerNames,
        perLearnerRateMinor: i.perLearnerRateMinor,
        lines: i.lines,
        subtotalMinor: i.subtotalMinor,
        advanceAppliedMinor: i.advanceAppliedMinor,
        summary: i.summary,
        dueAt: i.dueAt,
        deadlineAt: i.deadlineAt,
        dueState: i.dueState,
      })),
    sessions: sessionsSnap.docs
      .map(mapSessionCharge)
      .filter((s): s is SessionChargeRecord => s !== null && s.studentId === user.uid)
      .sort((a, b) => (b.startAt ?? "").localeCompare(a.startAt ?? ""))
      .map((s) => ({ id: s.id, courseTitle: s.courseTitle, title: s.title, date: s.date, startTime: s.startTime, amountMinor: s.amountMinor, status: s.status, cancelKind: s.cancelKind })),
    // Billable classes/sessions held and recorded but not on an invoice yet (next monthly invoice).
    uninvoiced: accounts
      .map((a) => {
        const own = pending.filter((b) => b.accountId === a.id);
        return { courseTitle: a.courseTitle, mode: a.mode, count: own.length, amountMinor: own.reduce((s, b) => s + b.rateMinor, 0) };
      })
      .filter((u) => u.count > 0),
  };
}


/** Active individual-session accounts, for the class scheduling form (teacher). */
export async function listIndividualAccounts(user: SessionUser) {
  assertTeacher(user);
  const snap = await col("billingAccounts").where("mode", "==", "individual").get();
  return snap.docs
    .map(mapAccount)
    .filter((a): a is BillingAccountRecord => a !== null && a.status === "active")
    .map((a) => ({ id: a.id, studentId: a.studentId, label: `${a.courseTitle} — individual sessions (monthly invoice)` }));
}
