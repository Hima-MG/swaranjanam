import "server-only";

import { createHash } from "node:crypto";

import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { siteConfig } from "@/config/site";
import {
  ADJUSTMENT_KINDS,
  canViewLearnerRecord,
  canViewPayment,
  countsAsReceived,
  creditsAvailableToSchedule,
  formatReceiptNumber,
  isLearnerCategory,
  maskReference,
  nextPayment,
  normalizeReference,
  PACKAGE_STATUSES,
  PACKAGE_TYPES,
  PAIR_TYPES,
  PLAN_KINDS,
  PLAN_STATUSES,
  PUBLISHED_PLANS,
  RECEIPT_STATUSES,
  revenueByPeriod,
  summarizePackage,
  toStudentPayment,
  type AdjustmentKind,
  type LearnerCategory,
  type NextPayment,
  type PackageLearner,
  type PackageStatus,
  type PackageSummary,
  type PackageType,
  type PairType,
  type PlanKind,
  type PlanStatus,
  type PriceBasis,
  type PricePlan,
  type ReceiptStatus,
} from "@/lib/lms/billing";
import { mapLiveClass } from "@/lib/lms/server/classes";
import { col, toIso } from "@/lib/lms/server/db";
import { mapPayment } from "@/lib/lms/server/payments";
import { DEFAULT_CURRENCY, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod, type PaymentRecord } from "@/lib/lms/types";
import type { LiveClassRecord } from "@/lib/lms/classes";
import { isValidId } from "@/lib/lms/validation";

// Billing data access. Rules live in lib/lms/billing.ts (pure, tested); this
// module reads and maps Firestore documents and provides the transaction
// helpers shared by the billing and payment Server Actions.
//
// Authorisation: teacher readers assert the teacher role. Student readers use
// ONLY the session uid (never an id from the request) and return student views
// without teacher notes, staff emails, audit details or full references.

export const ACADEMY_NAME = "Swaraanjanam Music Academy";

function assertTeacher(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const int = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isSafeInteger(v) ? v : fallback);
const paise = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);
const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T =>
  (values as readonly unknown[]).includes(v) ? (v as T) : fallback;

interface HistoryEntry {
  at: string | null;
  byEmail: string | null;
  change: string;
}

function mapHistory(value: unknown): HistoryEntry[] {
  return Array.isArray(value)
    ? value.map((h: Record<string, unknown>) => ({ at: toIso(h.at), byEmail: str(h.byEmail), change: String(h.change ?? "") }))
    : [];
}

export function historyEntry(actor: SessionUser, change: string) {
  return { at: Timestamp.now(), by: actor.uid, byEmail: actor.email, change };
}

// --- Price plans ---------------------------------------------------------------------

export interface PricePlanRecord extends PricePlan {
  updatedAt: string | null;
  updatedByEmail: string | null;
  history: HistoryEntry[];
}

function mapPlanData(id: string, d: DocumentData): PricePlan {
  const pair = (d.pairPricesMinor ?? {}) as Record<string, unknown>;
  return {
    id,
    title: String(d.title ?? id),
    kind: oneOf<PlanKind>(PLAN_KINDS, d.kind, "regular"),
    level: String(d.level ?? ""),
    audience: String(d.audience ?? ""),
    courseId: isValidId(d.courseId) ? d.courseId : null,
    adultPriceMinor: paise(d.adultPriceMinor),
    studentPriceMinor: paise(d.studentPriceMinor),
    flatPriceMinor: paise(d.flatPriceMinor),
    pairEligible: d.pairEligible === true,
    pairPricesMinor: Object.fromEntries(PAIR_TYPES.map((t) => [t, paise(pair[t])])) as Record<PairType, number | null>,
    sessionsIncluded: int(d.sessionsIncluded, 0),
    sessionMinutes: int(d.sessionMinutes, 60),
    durationWeeks: typeof d.durationWeeks === "number" && Number.isInteger(d.durationWeeks) ? d.durationWeeks : null,
    sessionsPerWeek: int(d.sessionsPerWeek, 1),
    // Unknown status values are treated as unavailable, never as active.
    status: oneOf<PlanStatus>(PLAN_STATUSES, d.status, "inactive"),
    order: int(d.order, 99),
    currency: str(d.currency) ?? DEFAULT_CURRENCY,
  };
}

export function mapPlan(snapshot: DocumentSnapshot<DocumentData>): PricePlanRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  return { ...mapPlanData(snapshot.id, d), updatedAt: toIso(d.updatedAt), updatedByEmail: str(d.updatedByEmail), history: mapHistory(d.history) };
}

export async function listPlans(): Promise<PricePlanRecord[]> {
  const snapshot = await col("pricePlans").get();
  return snapshot.docs
    .map(mapPlan)
    .filter((p): p is PricePlanRecord => p !== null)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export async function getPricingPage(user: SessionUser) {
  assertTeacher(user);
  const [plans, settings, courses] = await Promise.all([
    listPlans(),
    getBillingSettings(),
    col("courses").select("title", "status").get(),
  ]);
  const existing = new Set(plans.map((p) => p.id));
  return {
    plans,
    settings,
    missingPublished: PUBLISHED_PLANS.filter((p) => !existing.has(p.id)).map((p) => p.title),
    courses: courses.docs
      .map((d) => ({ id: d.id, title: String(d.get("title") ?? d.id), status: String(d.get("status") ?? "draft") }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

// --- Billing settings (accepted payment methods) ----------------------------------------

export interface BillingSettings {
  methods: PaymentMethod[];
  /** False until a teacher has saved the accepted methods at least once. */
  confirmed: boolean;
}

export function billingSettingsRef() {
  return col("settings").doc("billing");
}

/**
 * Until a teacher confirms the accepted methods, every existing manual method
 * stays available so the current payment workflow keeps working; the pricing
 * page shows that the list has not been confirmed.
 */
export async function getBillingSettings(): Promise<BillingSettings> {
  const d = (await billingSettingsRef().get()).data();
  const saved = Array.isArray(d?.enabledMethods)
    ? d.enabledMethods.filter((m: unknown): m is PaymentMethod => (PAYMENT_METHODS as readonly unknown[]).includes(m))
    : null;
  return saved ? { methods: saved, confirmed: true } : { methods: [...PAYMENT_METHODS], confirmed: false };
}

// --- Packages ----------------------------------------------------------------------------

export interface PackageRecord {
  id: string;
  type: PackageType;
  planId: string;
  title: string;
  /** Plan exactly as it was when the package was assigned. */
  plan: PricePlan;
  priceMinor: number;
  currency: string;
  priceBasis: PriceBasis;
  learners: PackageLearner[];
  learnerIds: string[];
  courseId: string | null;
  sessionsIncluded: number;
  creditsUsed: number;
  /** Sum of approved credit adjustments (kept in step with billingAdjustments). */
  creditAdjustment: number;
  status: PackageStatus;
  startDate: string | null;
  notes: string | null;
  confirmation: { question: string; reason: string } | null;
  activation: { reason: string; balanceMinor: number; byEmail: string | null; at: string | null } | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  history: HistoryEntry[];
}

export function mapPackage(snapshot: DocumentSnapshot<DocumentData>): PackageRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  const learners: PackageLearner[] = Array.isArray(d.learners)
    ? d.learners
        .filter((l: Record<string, unknown>) => isValidId(l?.studentId))
        .map((l: Record<string, unknown>) => ({
          studentId: String(l.studentId),
          category: (isLearnerCategory(l.category) ? l.category : "student") as LearnerCategory,
          name: String(l.name ?? "Student"),
        }))
    : [];
  const confirmation = d.confirmation && typeof d.confirmation === "object" ? d.confirmation : null;
  const activation = d.activation && typeof d.activation === "object" ? d.activation : null;
  return {
    id: snapshot.id,
    type: oneOf<PackageType>(PACKAGE_TYPES, d.type, "regular"),
    planId: String(d.planId ?? ""),
    title: String(d.title ?? d.plan?.title ?? "Package"),
    plan: mapPlanData(String(d.planId ?? ""), d.plan ?? {}),
    priceMinor: int(d.priceMinor),
    currency: str(d.currency) ?? DEFAULT_CURRENCY,
    priceBasis: (str(d.priceBasis) ?? "student") as PriceBasis,
    learners,
    learnerIds: Array.isArray(d.learnerIds) ? d.learnerIds.filter(isValidId) : learners.map((l) => l.studentId),
    courseId: isValidId(d.courseId) ? d.courseId : null,
    sessionsIncluded: int(d.sessionsIncluded),
    creditsUsed: int(d.creditsUsed),
    creditAdjustment: int(d.creditAdjustment),
    status: oneOf<PackageStatus>(PACKAGE_STATUSES, d.status, "awaiting_payment"),
    startDate: str(d.startDate),
    notes: str(d.notes),
    confirmation: confirmation ? { question: String(confirmation.question ?? ""), reason: String(confirmation.reason ?? "") } : null,
    activation: activation
      ? { reason: String(activation.reason ?? ""), balanceMinor: int(activation.balanceMinor), byEmail: str(activation.byEmail), at: toIso(activation.at) }
      : null,
    cancelReason: str(d.cancelReason),
    cancelledAt: toIso(d.cancelledAt),
    createdBy: str(d.createdBy),
    createdByEmail: str(d.createdByEmail),
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
    history: mapHistory(d.history),
  };
}

export interface AdjustmentRecord {
  id: string;
  packageId: string;
  paymentId: string | null;
  kind: AdjustmentKind;
  amountMinor: number;
  credits: number;
  reason: string;
  approvedByEmail: string | null;
  at: string | null;
}

export function mapAdjustment(snapshot: DocumentSnapshot<DocumentData>): AdjustmentRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  return {
    id: snapshot.id,
    packageId: String(d.packageId ?? ""),
    paymentId: str(d.paymentId),
    kind: oneOf<AdjustmentKind>(ADJUSTMENT_KINDS, d.kind, "waiver"),
    amountMinor: int(d.amountMinor),
    credits: int(d.credits),
    reason: String(d.reason ?? ""),
    approvedByEmail: str(d.approvedByEmail),
    at: toIso(d.at),
  };
}

/** Summary from the package and its own payments/adjustments only (never legacy enrollment payments). */
export function summarize(pkg: PackageRecord, payments: PaymentRecord[], adjustments: AdjustmentRecord[]): PackageSummary {
  return summarizePackage({
    priceMinor: pkg.priceMinor,
    sessionsIncluded: pkg.sessionsIncluded,
    creditsUsed: pkg.creditsUsed,
    payments: payments.filter((p) => p.packageId === pkg.id),
    adjustments: adjustments.filter((a) => a.packageId === pkg.id),
  });
}

export interface PackageRow extends PackageRecord {
  summary: PackageSummary;
  next: NextPayment;
  /** Credits free for new classes (remaining minus already-scheduled sessions). */
  availableToSchedule: number;
  classesCompleted: number;
  sessionsCarriedForward: number;
}

function classStats(pkgId: string, classes: LiveClassRecord[], creditsRemaining: number) {
  const own = classes.filter((c) => c.packageId === pkgId);
  const keyed = own.map((c) => ({ sessionKey: c.sessionKey ?? c.id, status: c.status }));
  return {
    availableToSchedule: creditsAvailableToSchedule(creditsRemaining, keyed),
    classesCompleted: new Set(keyed.filter((c) => c.status === "completed").map((c) => c.sessionKey)).size,
    sessionsCarriedForward: new Set(keyed.filter((c) => c.status === "cancelled").map((c) => c.sessionKey)).size,
  };
}

async function loadBillingData() {
  const [packagesSnap, paymentsSnap, adjustmentsSnap, classesSnap] = await Promise.all([
    col("packages").get(),
    col("payments").where("packageId", "!=", null).get(),
    col("billingAdjustments").get(),
    col("liveClasses").where("packageId", "!=", null).get(),
  ]);
  return {
    packages: packagesSnap.docs.map(mapPackage).filter((p): p is PackageRecord => p !== null),
    payments: paymentsSnap.docs.map(mapPayment).filter((p): p is PaymentRecord => p !== null && p.packageId !== null),
    adjustments: adjustmentsSnap.docs.map(mapAdjustment).filter((a): a is AdjustmentRecord => a !== null),
    classes: classesSnap.docs.map(mapLiveClass).filter((c): c is LiveClassRecord => c !== null && c.packageId !== null),
  };
}

function toRow(pkg: PackageRecord, data: Awaited<ReturnType<typeof loadBillingData>>): PackageRow {
  const summary = summarize(pkg, data.payments, data.adjustments);
  return {
    ...pkg,
    summary,
    next: nextPayment(pkg.type, pkg.status, summary),
    ...classStats(pkg.id, data.classes, summary.creditsRemaining),
  };
}

export interface PackageFilters {
  status: PackageStatus | "any";
  plan: string | null;
  q: string;
}

export function parsePackageFilters(params: Record<string, string | string[] | undefined>): PackageFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(params.status);
  const plan = one(params.plan);
  return {
    status: (PACKAGE_STATUSES as readonly string[]).includes(status) ? (status as PackageStatus) : "any",
    plan: isValidId(plan) ? plan : null,
    q: one(params.q).trim().slice(0, 100),
  };
}

export async function listPackagesForTeacher(user: SessionUser, filters: PackageFilters) {
  assertTeacher(user);
  const [data, plans] = await Promise.all([loadBillingData(), listPlans()]);
  const all = data.packages.map((p) => toRow(p, data));
  const needle = filters.q.toLowerCase();
  const rows = all
    .filter((p) => filters.status === "any" || p.status === filters.status)
    .filter((p) => !filters.plan || p.planId === filters.plan)
    .filter((p) => !needle || `${p.title} ${p.learners.map((l) => l.name).join(" ")}`.toLowerCase().includes(needle))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const open = all.filter((p) => p.status !== "cancelled");
  return {
    rows,
    plans,
    totals: {
      active: all.filter((p) => p.status === "active").length,
      awaitingPayment: all.filter((p) => p.status === "awaiting_payment").length,
      creditsRemaining: open.reduce((s, p) => s + p.summary.creditsRemaining, 0),
      outstandingMinor: open.reduce((s, p) => s + Math.max(p.summary.balanceMinor, 0), 0),
      outstandingCount: open.filter((p) => p.summary.balanceMinor > 0).length,
      renewalsDue: open.filter((p) => p.next.kind === "renewal_due").length,
    },
  };
}

/** Packages that can be chosen for a new class (active, with free credits), for the scheduling form. */
export async function listSchedulablePackages(user: SessionUser) {
  assertTeacher(user);
  const data = await loadBillingData();
  return data.packages
    .filter((p) => p.status === "active")
    .map((p) => toRow(p, data))
    .filter((p) => p.availableToSchedule > 0)
    .map((p) => ({
      id: p.id,
      label: `${p.learners.map((l) => l.name).join(" + ")} — ${p.title} (${p.availableToSchedule} of ${p.summary.creditsTotal} credits free)`,
      learnerIds: p.learnerIds,
      title: p.title,
      sessionMinutes: p.plan.sessionMinutes,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Packages a payment can be recorded against (everything except cancelled). */
export async function listPayablePackages(user: SessionUser) {
  assertTeacher(user);
  const snapshot = await col("packages").get();
  return snapshot.docs
    .map(mapPackage)
    .filter((p): p is PackageRecord => p !== null && p.status !== "cancelled")
    .map((p) => ({ id: p.id, label: `${p.learners.map((l) => l.name).join(" + ")} — ${p.title}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getPackageDetail(user: SessionUser, packageId: string) {
  assertTeacher(user);
  if (!isValidId(packageId)) return null;
  const pkg = mapPackage(await col("packages").doc(packageId).get());
  if (!pkg) return null;
  const [paymentsSnap, adjustmentsSnap, classesSnap, receiptsSnap] = await Promise.all([
    col("payments").where("packageId", "==", pkg.id).get(),
    col("billingAdjustments").where("packageId", "==", pkg.id).get(),
    col("liveClasses").where("packageId", "==", pkg.id).get(),
    col("receipts").where("packageId", "==", pkg.id).get(),
  ]);
  const payments = paymentsSnap.docs.map(mapPayment).filter((p): p is PaymentRecord => p !== null);
  const adjustments = adjustmentsSnap.docs.map(mapAdjustment).filter((a): a is AdjustmentRecord => a !== null);
  const classes = classesSnap.docs.map(mapLiveClass).filter((c): c is LiveClassRecord => c !== null);
  const summary = summarize(pkg, payments, adjustments);
  return {
    pkg,
    summary,
    next: nextPayment(pkg.type, pkg.status, summary),
    ...classStats(pkg.id, classes, summary.creditsRemaining),
    payments: payments.sort((a, b) => (b.paidAt ?? b.createdAt ?? "").localeCompare(a.paidAt ?? a.createdAt ?? "")),
    adjustments: adjustments.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")),
    classes: classes.sort((a, b) => b.startAt.localeCompare(a.startAt)),
    receipts: receiptsSnap.docs.map(mapReceipt).filter((r): r is ReceiptRecord => r !== null),
  };
}

/** Package history of one student, for the teacher's student profile. */
export async function getStudentPackagesForTeacher(user: SessionUser, studentId: string): Promise<PackageRow[]> {
  assertTeacher(user);
  if (!isValidId(studentId)) return [];
  const data = await loadBillingData();
  return data.packages
    .filter((p) => p.learnerIds.includes(studentId))
    .map((p) => toRow(p, data))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

// --- Receipts --------------------------------------------------------------------------------

export interface ReceiptRecord {
  id: string;
  number: string;
  issuedAt: string | null;
  paymentId: string;
  packageId: string | null;
  learnerIds: string[];
  learnerNames: string[];
  payerName: string;
  title: string;
  packageType: PackageType | null;
  sessions: number | null;
  amountMinor: number;
  currency: string;
  methodLabel: string;
  referenceMasked: string | null;
  paidAt: string | null;
  status: ReceiptStatus;
  refundedMinor: number;
  statusNote: string | null;
  academyName: string;
  academyEmail: string | null;
}

export function mapReceipt(snapshot: DocumentSnapshot<DocumentData>): ReceiptRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  return {
    id: snapshot.id,
    number: String(d.number ?? ""),
    issuedAt: toIso(d.issuedAt),
    paymentId: String(d.paymentId ?? snapshot.id),
    packageId: str(d.packageId),
    learnerIds: Array.isArray(d.learnerIds) ? d.learnerIds.filter(isValidId) : [],
    learnerNames: Array.isArray(d.learnerNames) ? d.learnerNames.map(String) : [],
    payerName: String(d.payerName ?? ""),
    title: String(d.title ?? ""),
    packageType: (PACKAGE_TYPES as readonly unknown[]).includes(d.packageType) ? (d.packageType as PackageType) : null,
    sessions: typeof d.sessions === "number" ? d.sessions : null,
    amountMinor: int(d.amountMinor),
    currency: str(d.currency) ?? DEFAULT_CURRENCY,
    methodLabel: String(d.methodLabel ?? ""),
    referenceMasked: str(d.referenceMasked),
    paidAt: toIso(d.paidAt),
    status: oneOf<ReceiptStatus>(RECEIPT_STATUSES, d.status, "valid"),
    refundedMinor: int(d.refundedMinor),
    statusNote: str(d.statusNote),
    academyName: String(d.academyName ?? ACADEMY_NAME),
    academyEmail: str(d.academyEmail),
  };
}

/**
 * Returns a receipt only if the viewer may see it: teachers, or a student who
 * is one of the receipt's learners (both learners of a pair package). Checked
 * on the server for every request.
 */
export async function getReceiptForViewer(user: SessionUser, receiptId: string): Promise<ReceiptRecord | null> {
  if (!isValidId(receiptId)) return null;
  const receipt = mapReceipt(await col("receipts").doc(receiptId).get());
  if (!receipt || !canViewLearnerRecord(user, receipt)) return null;
  return receipt;
}

/** Everything a transaction needs to read before it can issue a receipt (Firestore: reads before writes). */
export interface ReceiptContext {
  receiptRef: DocumentReference;
  counterRef: DocumentReference;
  alreadyIssued: boolean;
  nextSequence: number;
  learnerNames: string[];
  title: string;
}

export function receiptCounterRef() {
  return col("settings").doc("receiptCounter");
}

export async function readReceiptContext(
  tx: Transaction,
  payment: Pick<PaymentRecord, "id" | "studentId" | "courseId">,
  pkg: PackageRecord | null,
): Promise<ReceiptContext> {
  const receiptRef = col("receipts").doc(payment.id);
  const counterRef = receiptCounterRef();
  const [receiptSnap, counterSnap] = await Promise.all([tx.get(receiptRef), tx.get(counterRef)]);
  let learnerNames: string[];
  let title: string;
  if (pkg) {
    learnerNames = pkg.learners.map((l) => l.name);
    title = pkg.title;
  } else {
    // Legacy enrollment payment: the student's and course's names at issue time.
    const [student, course] = await Promise.all([
      tx.get(col("users").doc(payment.studentId)),
      isValidId(payment.courseId) ? tx.get(col("courses").doc(payment.courseId)) : Promise.resolve(null),
    ]);
    learnerNames = [str(student.get("displayName")) ?? str(student.get("email")) ?? "Student"];
    title = str(course?.get("title")) ?? "Course fee";
  }
  const next = counterSnap.get("next");
  return {
    receiptRef,
    counterRef,
    alreadyIssued: receiptSnap.exists,
    nextSequence: Number.isSafeInteger(next) && next > 0 ? next : 1,
    learnerNames,
    title,
  };
}

/**
 * Issues the receipt for a payment that has just become paid + verified.
 * Writes only (call after all reads). The counter update and the receipt are
 * in the same transaction, so two concurrent verifications can never share a
 * number: Firestore retries one of them with the updated counter.
 */
export function writeReceipt(
  tx: Transaction,
  ctx: ReceiptContext,
  payment: Pick<PaymentRecord, "id" | "studentId" | "learnerIds" | "payerName" | "amountMinor" | "currency" | "method" | "reference" | "paidAt">,
  pkg: PackageRecord | null,
): string | null {
  if (ctx.alreadyIssued) return null;
  const now = new Date();
  const number = formatReceiptNumber(ctx.nextSequence, Number(now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 4)));
  tx.set(ctx.counterRef, { next: ctx.nextSequence + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  tx.create(ctx.receiptRef, {
    number,
    sequence: ctx.nextSequence,
    issuedAt: FieldValue.serverTimestamp(),
    paymentId: payment.id,
    packageId: pkg?.id ?? null,
    learnerIds: pkg ? pkg.learnerIds : payment.learnerIds.length ? payment.learnerIds : [payment.studentId],
    learnerNames: ctx.learnerNames,
    payerName: payment.payerName ?? ctx.learnerNames.join(" & "),
    title: ctx.title,
    packageType: pkg?.type ?? null,
    sessions: pkg ? pkg.sessionsIncluded : null,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    method: payment.method,
    methodLabel: PAYMENT_METHOD_LABELS[payment.method] ?? "Other",
    referenceMasked: maskReference(payment.reference),
    paidAt: payment.paidAt ? Timestamp.fromDate(new Date(payment.paidAt)) : null,
    status: "valid",
    refundedMinor: 0,
    statusNote: null,
    academyName: ACADEMY_NAME,
    academyEmail: siteConfig.contact.email,
  });
  return number;
}

// --- Package transaction helpers ---------------------------------------------------------------

/** Reads a package with its payments and adjustments inside a transaction. */
export async function readPackageInTx(tx: Transaction, packageId: string) {
  const ref = col("packages").doc(packageId);
  const [snap, paymentsSnap, adjustmentsSnap] = await Promise.all([
    tx.get(ref),
    tx.get(col("payments").where("packageId", "==", packageId)),
    tx.get(col("billingAdjustments").where("packageId", "==", packageId)),
  ]);
  const pkg = mapPackage(snap);
  if (!pkg) return null;
  const payments = paymentsSnap.docs.map(mapPayment).filter((p): p is PaymentRecord => p !== null);
  const adjustments = adjustmentsSnap.docs.map(mapAdjustment).filter((a): a is AdjustmentRecord => a !== null);
  return { ref, pkg, payments, adjustments };
}

/** Reservation id for a payment reference: the same method+reference can be recorded only once. */
export function paymentReferenceRef(method: PaymentMethod, reference: string) {
  const hash = createHash("sha256").update(`${method}:${normalizeReference(reference)}`).digest("hex");
  return col("paymentReferences").doc(hash);
}

// --- Student views (own records only) -------------------------------------------------------------

export interface StudentPackageView {
  id: string;
  type: PackageType;
  title: string;
  status: PackageStatus;
  priceMinor: number;
  currency: string;
  sessionsIncluded: number;
  sessionMinutes: number;
  durationWeeks: number | null;
  /** Names of BOTH learners of a pair (that is all a student learns about the other learner). */
  learnerNames: string[];
  startDate: string | null;
  createdAt: string | null;
  summary: Pick<PackageSummary, "dueMinor" | "netPaidMinor" | "pendingMinor" | "balanceMinor" | "paymentState" | "creditsTotal" | "creditsUsed" | "creditsRemaining">;
  classesCompleted: number;
  sessionsCarriedForward: number;
  next: NextPayment;
}

/**
 * The signed-in student's packages, payments and receipts. Every query is
 * bound to user.uid; results are re-checked with the same predicates the
 * tests cover before anything is returned.
 */
export async function getOwnBilling(user: SessionUser) {
  if (user.role !== "student") return { packages: [], payments: [], receipts: [] };
  const viewer = { uid: user.uid, role: user.role } as const;
  const [packagesSnap, packagePaymentsSnap, legacyPaymentsSnap, receiptsSnap] = await Promise.all([
    col("packages").where("learnerIds", "array-contains", user.uid).get(),
    col("payments").where("learnerIds", "array-contains", user.uid).get(),
    col("payments").where("studentId", "==", user.uid).get(),
    col("receipts").where("learnerIds", "array-contains", user.uid).get(),
  ]);
  const packages = packagesSnap.docs.map(mapPackage).filter((p): p is PackageRecord => p !== null && canViewLearnerRecord(viewer, p));
  const byId = new Map<string, PaymentRecord>();
  for (const doc of [...packagePaymentsSnap.docs, ...legacyPaymentsSnap.docs]) {
    const p = mapPayment(doc);
    if (p && canViewPayment(viewer, p)) byId.set(p.id, p);
  }
  const payments = [...byId.values()];
  const ids = packages.map((p) => p.id);
  const [adjustments, classes] = await Promise.all([
    ids.length
      ? Promise.all(chunks(ids, 30).map((part) => col("billingAdjustments").where("packageId", "in", part).get())).then((snaps) =>
          snaps.flatMap((s) => s.docs.map(mapAdjustment).filter((a): a is AdjustmentRecord => a !== null)),
        )
      : Promise.resolve([]),
    col("liveClasses").where("studentId", "==", user.uid).get().then((s) => s.docs.map(mapLiveClass).filter((c): c is LiveClassRecord => c !== null)),
  ]);
  const titles = new Map(packages.map((p) => [p.id, p.title]));

  return {
    packages: packages
      .map((pkg): StudentPackageView => {
        const summary = summarize(pkg, payments, adjustments);
        const stats = classStats(pkg.id, classes, summary.creditsRemaining);
        return {
          id: pkg.id,
          type: pkg.type,
          title: pkg.title,
          status: pkg.status,
          priceMinor: pkg.priceMinor,
          currency: pkg.currency,
          sessionsIncluded: pkg.sessionsIncluded,
          sessionMinutes: pkg.plan.sessionMinutes,
          durationWeeks: pkg.plan.durationWeeks,
          learnerNames: pkg.learners.map((l) => l.name),
          startDate: pkg.startDate,
          createdAt: pkg.createdAt,
          summary: {
            dueMinor: summary.dueMinor,
            netPaidMinor: summary.netPaidMinor,
            pendingMinor: summary.pendingMinor,
            balanceMinor: summary.balanceMinor,
            paymentState: summary.paymentState,
            creditsTotal: summary.creditsTotal,
            creditsUsed: summary.creditsUsed,
            creditsRemaining: summary.creditsRemaining,
          },
          classesCompleted: stats.classesCompleted,
          sessionsCarriedForward: stats.sessionsCarriedForward,
          next: nextPayment(pkg.type, pkg.status, summary),
        };
      })
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    payments: payments
      .map((p) => ({ ...toStudentPayment(p), packageTitle: p.packageId ? (titles.get(p.packageId) ?? "Package") : null, receiptId: p.receiptId }))
      .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")),
    receipts: receiptsSnap.docs
      .map(mapReceipt)
      .filter((r): r is ReceiptRecord => r !== null && canViewLearnerRecord(viewer, r))
      .map((r) => ({ id: r.id, number: r.number, issuedAt: r.issuedAt, paidAt: r.paidAt, amountMinor: r.amountMinor, currency: r.currency, title: r.title, status: r.status }))
      .sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? "")),
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// --- Reports (teacher) ----------------------------------------------------------------------------

export async function getRevenueReport(user: SessionUser, period: "month" | "week") {
  assertTeacher(user);
  const [paymentsSnap, refundsSnap] = await Promise.all([
    col("payments").get(),
    col("billingAdjustments").where("kind", "==", "refund").get(),
  ]);
  const payments = paymentsSnap.docs.map(mapPayment).filter((p): p is PaymentRecord => p !== null);
  const refunds = refundsSnap.docs.map(mapAdjustment).filter((a): a is AdjustmentRecord => a !== null);
  return {
    rows: revenueByPeriod(payments, refunds, period),
    receivedMinor: payments.filter(countsAsReceived).reduce((s, p) => s + p.amountMinor, 0),
    refundedMinor: refunds.reduce((s, r) => s + r.amountMinor, 0),
    rejected: payments.filter((p) => p.status === "failed").length,
  };
}

export async function listAdjustmentsForTeacher(user: SessionUser) {
  assertTeacher(user);
  const [adjustmentsSnap, packagesSnap] = await Promise.all([col("billingAdjustments").get(), col("packages").get()]);
  const packages = new Map(
    packagesSnap.docs.map(mapPackage).filter((p): p is PackageRecord => p !== null).map((p) => [p.id, p]),
  );
  return adjustmentsSnap.docs
    .map(mapAdjustment)
    .filter((a): a is AdjustmentRecord => a !== null)
    .map((a) => {
      const pkg = packages.get(a.packageId);
      return { ...a, packageTitle: pkg?.title ?? "Package", learners: pkg?.learners.map((l) => l.name).join(" + ") ?? "" };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
