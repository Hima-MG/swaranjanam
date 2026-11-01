import "server-only";

import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import {
  ADVANCE_STATUSES,
  batchClassBlock,
  BILLING_MODES,
  CLASS_OUTCOMES,
  cycleCheckpoint,
  cycleInvoiceId,
  cycleLines,
  cycleReady,
  cycleStartMs,
  cycleWeeksLabel,
  DEFAULT_POLICY,
  DEFAULT_RATE_VERSION,
  individualCancellationCharge,
  invoiceDueState,
  istDateOf,
  INVOICE_ADJUSTMENT_KINDS,
  INVOICE_STATUSES,
  invoiceDueAt,
  isBatchBillable,
  isPeriod,
  isWebsiteBilledPeriod,
  LEGACY_DUES_STATUSES,
  legacyDuesCleared,
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
import { AccessError } from "@/lib/lms/server/access";
import { col, db, toIso } from "@/lib/lms/server/db";
import { mapPayment } from "@/lib/lms/server/payments";
import type { PaymentRecord } from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Class-based billing: four-week batch cycles and per-session individual charges.
//
// Safeguards (all inside Firestore transactions):
//   * billableClasses/{classId} is created once → a batch class occurrence is
//     charged at most once per student.
//   * The account's first eligible class is marked coveredBy: "advance" — it is
//     paid by the first-class payment and never put on an invoice.
//   * invoices/{accountId}_c{cycle} is created once and account.cyclesIssued
//     only moves forward → re-running the job (or two runs at once) never
//     duplicates an invoice. The charges an invoice takes are marked with its id
//     in the same transaction, so a class can never appear on two invoices.
//   * sessionCharges/sc_{classId} is created once per individual session →
//     rescheduling (editing the time) can never create a second charge.
//   * Issued invoices are never edited; corrections are invoiceAdjustments.
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
  billableCount: number;
  /** IST date of the first eligible class (start of week 1); null until a class is charged. */
  cycleAnchor: string | null;
  firstClassId: string | null;
  firstClassStartAt: string | null;
  /** Highest cycle already invoiced (or found empty); the next invoice is for cyclesIssued + 1. */
  cyclesIssued: number;
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
    billableCount: int(d.billableCount),
    cycleAnchor: typeof d.cycleAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.cycleAnchor) ? d.cycleAnchor : null,
    firstClassId: str(d.firstClassId),
    firstClassStartAt: toIso(d.firstClassStartAt),
    cyclesIssued: int(d.cyclesIssued),
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
  /** "cycle" = four-week cycle; "monthly" = previous model, read-only history. */
  kind: "cycle" | "monthly";
  accountId: string;
  studentId: string;
  courseId: string;
  courseTitle: string;
  studentName: string;
  batchId: string | null;
  /** Monthly invoices only ("YYYY-MM"); "" for cycle invoices. */
  period: string;
  /** Cycle invoices only. */
  cycle: number | null;
  /** E.g. "Cycle 1 · weeks 1–4" or "November 2026 (monthly)". */
  label: string;
  lines: InvoiceLine[];
  subtotalMinor: number;
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
  if (cycle === null && !isPeriod(d.period)) return null;
  const monthly = cycle === null;
  // Monthly deadlines are always derived from the period; cycle deadlines are the stored checkpoint.
  const checkpoint = monthly ? null : toIso(d.dueAt);
  if (!monthly && !checkpoint) return null;
  return {
    id: snapshot.id,
    kind: monthly ? "monthly" : "cycle",
    accountId: String(d.accountId ?? ""),
    studentId: String(d.studentId ?? ""),
    courseId: String(d.courseId ?? ""),
    courseTitle: String(d.courseTitle ?? "Course"),
    studentName: String(d.studentName ?? "Student"),
    batchId: str(d.batchId),
    period: monthly ? d.period : "",
    cycle,
    label: monthly ? `${periodLabel(d.period)} (monthly)` : `Cycle ${cycle} · ${cycleWeeksLabel(cycle!)}`,
    lines: Array.isArray(d.lines)
      ? d.lines.map((l: Record<string, unknown>) => ({
          classId: String(l.classId ?? ""),
          date: String(l.date ?? ""),
          title: String(l.title ?? "Class"),
          outcome: oneOf(CLASS_OUTCOMES, l.outcome, "attended"),
          rateMinor: int(l.rateMinor),
          rateVersionId: String(l.rateVersionId ?? ""),
          period: isPeriod(l.period) ? l.period : monthly ? d.period : "",
        }))
      : [],
    subtotalMinor: int(d.subtotalMinor),
    advanceAppliedMinor: int(d.advanceAppliedMinor),
    amountDueMinor: int(d.amountDueMinor),
    status: oneOf(INVOICE_STATUSES, d.status, "issued"),
    issuedAt: toIso(d.issuedAt),
    dueAt: monthly ? invoiceDueAt(d.period) : checkpoint!,
    deadlineAt: monthly ? paymentDeadline(d.period) : checkpoint!,
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
  /** "advance": the first class, paid by the first-class payment — never invoiced. */
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

/** Reads everything needed to charge one student's batch class. */
export async function prepareClassCharge(tx: Transaction, cls: LiveClassRecord, outcome: ClassOutcome, nowIso: string): Promise<ChargePlan> {
  if (!cls.billingAccountId) return { kind: "none" };
  if (cls.packageId) throw new AccessError("This class uses a prepaid package; it cannot also be billed per class.");
  const ledgerRef = col("billableClasses").doc(cls.id);
  const accountRef = col("billingAccounts").doc(cls.billingAccountId);
  const [ledgerSnap, accountSnap, configSnap] = await Promise.all([tx.get(ledgerRef), tx.get(accountRef), tx.get(classBillingConfigRef())]);
  const account = mapAccount(accountSnap);
  if (!account) throw new AccessError("The billing account for this class could not be found.");
  if (account.studentId !== cls.studentId) throw new AccessError("This class does not belong to that billing account.");
  // Individual sessions are paid per session (sessionCharges), never through this ledger.
  if (account.mode !== "batch") return { kind: "none" };
  const period = periodOf(cls.startAt);
  // Classes before November 2026 stay with the old payment method.
  if (!isWebsiteBilledPeriod(period)) return { kind: "none" };

  const config = mapConfig(configSnap);
  const billable = isBatchBillable(outcome, config.policy);
  if (ledgerSnap.exists) {
    if (billable) return { kind: "already" };
    const billed = mapBillableClass(ledgerSnap);
    throw new AccessError(
      `This class was already charged${billed?.invoiceId ? " and invoiced" : ""}. It cannot be changed to a non-billable outcome; record a credit note on the invoice instead.`,
    );
  }
  if (!billable) return { kind: "none" };
  const version = rateVersionForPeriod(config.rateVersions, period);
  // The earliest eligible class is the first class. A class recorded late that
  // took place earlier takes over — but only while no cycle invoice exists.
  let coversFirst = account.firstClassId === null;
  let previousFirstId: string | null = null;
  if (!coversFirst && account.cyclesIssued === 0 && account.firstClassStartAt && cls.startAt < account.firstClassStartAt && account.firstClassId) {
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
    line: { classId: cls.id, date: cls.date, title: cls.title, outcome, rateMinor: version.batchMinor, rateVersionId: version.id, period },
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
          cycleAnchor: istDateOf(cls.startAt),
          history: FieldValue.arrayUnion(entry(actor, `First class (${cls.date}) paid by the first-class payment; week 1 starts ${istDateOf(cls.startAt)}`)),
        }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// --- Individual session charges ---------------------------------------------------------------------------

/** Writes the charge for a newly scheduled individual session (call after reads). */
export function writeSessionCharge(
  tx: Transaction,
  input: { classId: string; account: BillingAccountRecord; title: string; date: string; startTime: string; startAt: Date; version: RateVersion; actor: Actor },
) {
  tx.create(col("sessionCharges").doc(sessionChargeId(input.classId)), {
    classId: input.classId,
    accountId: input.account.id,
    studentId: input.account.studentId,
    learnerIds: [input.account.studentId],
    courseId: input.account.courseId,
    courseTitle: input.account.courseTitle,
    title: input.title,
    date: input.date,
    startTime: input.startTime,
    startAt: Timestamp.fromDate(input.startAt),
    amountMinor: input.version.individualMinor,
    rateVersionId: input.version.id,
    status: "due",
    paymentId: null,
    cancelKind: null,
    needsReview: null,
    createdAt: FieldValue.serverTimestamp(),
    history: [entry(input.actor, `Session charge created (${input.date} ${input.startTime} IST)`)],
  });
}

export type SessionCancelPlan = { kind: "none" } | { kind: "update"; ref: DocumentReference; charge: SessionChargeRecord; decision: "no_charge" | "payable"; cancelKind: string };

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
      history: FieldValue.arrayUnion(entry(actor, "Cancelled by the student less than 24 hours before the start — the session fee remains payable")),
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

// --- Cycle invoices ---------------------------------------------------------------------------------------

export interface CycleIssueResult {
  created: string[];
  /** Cycles whose checkpoint passed without any new eligible class (nothing to invoice). */
  empty: number[];
}

const MAX_CYCLES_PER_RUN = 60;

/**
 * Issues every cycle invoice that is due for one batch account: cycle k is
 * ready once a class in its final week has been recorded, or its checkpoint
 * has passed. Each invoice lists only charges that actually occurred and are
 * not invoiced yet (never the prepaid first class). Idempotent and safe to
 * run concurrently: invoice ids are deterministic and created once, and
 * cyclesIssued only moves forward inside the same transaction.
 */
export async function issueDueCycleInvoices(accountId: string, actor: Actor, nowIso = new Date().toISOString()): Promise<CycleIssueResult> {
  const accountRef = col("billingAccounts").doc(accountId);
  const nowMs = Date.parse(nowIso);
  return db().runTransaction(async (tx) => {
    // ---- reads ----
    const [accountSnap, ledgerSnap] = await Promise.all([tx.get(accountRef), tx.get(col("billableClasses").where("accountId", "==", accountId))]);
    const account = mapAccount(accountSnap);
    const result: CycleIssueResult = { created: [], empty: [] };
    if (!account || account.mode !== "batch" || !account.cycleAnchor) return result;
    const anchor = account.cycleAnchor;
    const charges = ledgerSnap.docs.map(mapBillableClass).filter((b): b is BillableClassRecord => b !== null && isWebsiteBilledPeriod(b.period));
    const ready: number[] = [];
    for (let k = account.cyclesIssued + 1; ready.length < MAX_CYCLES_PER_RUN; k++) {
      if (!cycleReady({ anchorDate: anchor, cycle: k, nowMs, charges })) break;
      ready.push(k);
    }
    if (ready.length === 0) return result;
    const invoiceRefs = ready.map((k) => col("invoices").doc(cycleInvoiceId(accountId, k)));
    const existing = await tx.getAll(...invoiceRefs);
    const now = Timestamp.fromMillis(nowMs);

    // ---- writes ----
    const taken = new Set<string>();
    ready.forEach((k, i) => {
      if (existing[i].exists) return; // already issued (safety net; cyclesIssued is the primary guard)
      const lines = cycleLines(
        charges.filter((c) => !taken.has(c.classId)),
        anchor,
        k,
      );
      if (lines.length === 0) {
        result.empty.push(k);
        return;
      }
      lines.forEach((l) => taken.add(l.classId));
      const invoiceLines: InvoiceLine[] = lines.map((b) => ({ classId: b.classId, date: b.date, title: b.title, outcome: b.outcome, rateMinor: b.rateMinor, rateVersionId: b.rateVersionId, period: b.period }));
      const subtotalMinor = invoiceLines.reduce((t, l) => t + l.rateMinor, 0);
      const rates = new Set(invoiceLines.map((l) => l.rateMinor));
      const checkpoint = cycleCheckpoint(anchor, k);
      tx.create(invoiceRefs[i], {
        kind: "cycle",
        cycle: k,
        cycleStart: Timestamp.fromMillis(cycleStartMs(anchor, k)),
        accountId,
        studentId: account.studentId,
        learnerIds: [account.studentId],
        courseId: account.courseId,
        courseTitle: account.courseTitle,
        studentName: account.studentName,
        batchId: account.batchId,
        mode: "batch",
        lines: invoiceLines,
        lineCount: invoiceLines.length,
        rateMinor: rates.size === 1 ? invoiceLines[0].rateMinor : null,
        subtotalMinor,
        advanceAppliedMinor: 0,
        amountDueMinor: subtotalMinor,
        currency: "INR",
        status: "issued",
        issuedAt: now,
        dueAt: Timestamp.fromMillis(Date.parse(checkpoint)),
        deadlineAt: Timestamp.fromMillis(Date.parse(checkpoint)),
        createdAt: now,
        createdBy: actor.uid,
        history: [entry(actor, `Cycle ${k} invoice (${cycleWeeksLabel(k)}): ${invoiceLines.length} class(es), due ${checkpoint}`)],
      });
      for (const l of lines) tx.update(col("billableClasses").doc(l.classId), { invoiceId: invoiceRefs[i].id });
      result.created.push(invoiceRefs[i].id);
    });
    tx.update(accountRef, { cyclesIssued: ready[ready.length - 1], updatedAt: FieldValue.serverTimestamp() });
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

/**
 * Suspends (reversibly) when an invoice is unpaid after its payment deadline,
 * and restores as soon as no such invoice remains. Idempotent. Nothing is deleted.
 */
export async function evaluateSuspension(accountId: string, actor: Actor, nowMs = Date.now()): Promise<"suspended" | "restored" | "unchanged"> {
  const accountRef = col("billingAccounts").doc(accountId);
  return db().runTransaction(async (tx) => {
    const [accountSnap, invoices] = await Promise.all([tx.get(accountRef), readAccountInvoicesInTx(tx, accountId)]);
    const account = mapAccount(accountSnap);
    if (!account || account.mode !== "batch") return "unchanged";
    const overdue = invoices.filter((i) => i.status === "issued" && i.summary.balanceMinor > 0 && invoiceDueState(i, nowMs) === "overdue");
    const suspend = shouldSuspend(invoices.map((i) => ({ status: i.status, dueAt: i.dueAt, deadlineAt: i.deadlineAt, balanceMinor: i.summary.balanceMinor })), nowMs);
    if (suspend && !account.suspension.active) {
      tx.update(accountRef, {
        suspension: { active: true, since: Timestamp.fromMillis(nowMs), invoiceIds: overdue.map((i) => i.id), liftedAt: null },
        history: FieldValue.arrayUnion(entry(actor, `Access suspended: ${overdue.map((i) => i.label).join(", ")} unpaid after the due date`)),
      });
      return "suspended";
    }
    if (!suspend && account.suspension.active) {
      tx.update(accountRef, {
        "suspension.active": false,
        "suspension.liftedAt": Timestamp.fromMillis(nowMs),
        history: FieldValue.arrayUnion(entry(actor, "Access restored: no invoice remains unpaid past its due date")),
      });
      return "restored";
    }
    return "unchanged";
  });
}

export interface ScheduledRunSummary {
  invoicesCreated: number;
  emptyCycles: number;
  suspended: number;
  restored: number;
  errors: number;
}

/**
 * The scheduled billing job (Vercel Cron → /api/cron/billing, or "Run billing
 * now" by a teacher). Safe to run any number of times: invoices are
 * create-once, suspension is re-evaluated from the current data.
 */
export async function runScheduledBilling(actor: Actor, nowIso = new Date().toISOString()): Promise<ScheduledRunSummary> {
  const accounts = (await col("billingAccounts").where("mode", "==", "batch").get()).docs.map((d) => d.id);
  const summary: ScheduledRunSummary = { invoicesCreated: 0, emptyCycles: 0, suspended: 0, restored: 0, errors: 0 };
  for (const accountId of accounts) {
    try {
      const r = await issueDueCycleInvoices(accountId, actor, nowIso);
      summary.invoicesCreated += r.created.length;
      summary.emptyCycles += r.empty.length;
    } catch (error) {
      summary.errors += 1;
      console.error("[billing] cycle invoice generation failed:", accountId, (error as Error)?.message);
    }
    try {
      const r = await evaluateSuspension(accountId, actor, Date.parse(nowIso));
      if (r === "suspended") summary.suspended += 1;
      if (r === "restored") summary.restored += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("[billing] suspension evaluation failed:", accountId, (error as Error)?.message);
    }
  }
  return summary;
}

// --- Payment targets --------------------------------------------------------------------------------------

export type PaymentTarget = { kind: "advance"; accountId: string } | { kind: "invoice"; invoiceId: string } | { kind: "session"; chargeId: string };

export interface TargetState {
  target: PaymentTarget;
  account: BillingAccountRecord;
  accountRef: DocumentReference;
  invoice: InvoiceRecord | null;
  summary: InvoiceSummary | null;
  session: SessionChargeRecord | null;
  sessionRef: DocumentReference | null;
  payableMinor: number | null;
  titleSuffix: string;
}

/** Reads a payment target (reads only). */
export async function readPaymentTarget(tx: Transaction, target: PaymentTarget): Promise<TargetState> {
  const base = { invoice: null, summary: null, session: null, sessionRef: null };
  if (target.kind === "advance") {
    const accountRef = col("billingAccounts").doc(target.accountId);
    const account = mapAccount(await tx.get(accountRef));
    if (!account) throw new AccessError("That billing account could not be found.");
    return { ...base, target, account, accountRef, payableMinor: payableAmount({ kind: "advance", advance: account.advance }), titleSuffix: "first-class payment" };
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
    account,
    accountRef,
    invoice,
    summary,
    payableMinor: payableAmount({ kind: "invoice", status: invoice.status, summary }),
    titleSuffix: `invoice: ${invoice.label}`,
  };
}

/** Effects of a payment becoming paid + verified (writes only). Each target changes at most once. */
export function applyVerifiedPayment(tx: Transaction, state: TargetState, paymentId: string, actor: Actor) {
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
  outstandingMinor: number;
  uninvoicedCount: number;
  uninvoicedMinor: number;
  sessionsDueMinor: number;
}

export async function listBillingAccounts(user: SessionUser) {
  assertTeacher(user);
  const nowMs = Date.now();
  const [accountsSnap, invoicesSnap, ledgerSnap, sessionsSnap] = await Promise.all([
    col("billingAccounts").get(),
    col("invoices").get(),
    col("billableClasses").where("invoiceId", "==", null).get(),
    col("sessionCharges").where("status", "==", "due").get(),
  ]);
  const accounts = accountsSnap.docs.map(mapAccount).filter((a): a is BillingAccountRecord => a !== null);
  const invoices = await invoiceViews(invoicesSnap.docs.map(mapInvoice).filter((i): i is InvoiceRecord => i !== null), nowMs);
  const ledger = ledgerSnap.docs.map(mapBillableClass).filter((b): b is BillableClassRecord => b !== null);
  const sessions = sessionsSnap.docs.map(mapSessionCharge).filter((s): s is SessionChargeRecord => s !== null);
  const rows: AccountRow[] = accounts.map((a) => {
    const own = ledger.filter((b) => b.accountId === a.id && b.coveredBy === null);
    return {
      ...a,
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
  /** "paid" = nothing outstanding; "pending" = invoice not yet due; "overdue" = past its due date; "suspended" = access paused. */
  state: "paid" | "pending" | "overdue" | "suspended" | "first_class_unpaid";
  outstandingMinor: number;
  openInvoices: { id: string; label: string; balanceMinor: number; dueAt: string; dueState: DueState; classCount: number }[];
  /** Whether the student may join the next class (server rule used for Meet links). */
  eligibleForNextClass: boolean;
}

/** Teacher roster view: each batch account's billing status and next-class eligibility. */
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
      const block = batchClassBlock(a);
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
  const empty = { accounts: [], invoices: [], sessions: [], uninvoiced: [] as { courseTitle: string; count: number; amountMinor: number }[] };
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
  const pending = ledgerSnap.docs.map(mapBillableClass).filter((b): b is BillableClassRecord => b !== null && b.studentId === user.uid && b.invoiceId === null && b.coveredBy === null);
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      courseTitle: a.courseTitle,
      mode: a.mode,
      status: a.status,
      suspended: a.suspension.active,
      advance: { status: a.advance.status, amountMinor: a.advance.amountMinor },
      blocked: batchClassBlock(a),
    })),
    invoices: invoices
      .sort((a, b) => b.dueAt.localeCompare(a.dueAt))
      .map((i) => ({
        id: i.id,
        courseTitle: i.courseTitle,
        label: i.label,
        kind: i.kind,
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
    uninvoiced: accounts
      .filter((a) => a.mode === "batch")
      .map((a) => {
        const own = pending.filter((b) => b.accountId === a.id);
        return { courseTitle: a.courseTitle, count: own.length, amountMinor: own.reduce((s, b) => s + b.rateMinor, 0) };
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
    .map((a) => ({ id: a.id, studentId: a.studentId, label: `${a.courseTitle} — individual session (paid per session)` }));
}
