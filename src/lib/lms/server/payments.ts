import "server-only";

import type { DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import { cache } from "react";

import type { SessionUser } from "@/lib/auth/session";
import { DATE_RANGES, type DateRange } from "@/lib/lms/server/admin";
import { col, mapEnrollment, toIso } from "@/lib/lms/server/db";
import {
  DEFAULT_CURRENCY,
  isReceived,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type EnrollmentRecord,
  type PaymentMethod,
  type PaymentRecord,
  type PaymentStatus,
} from "@/lib/lms/types";
import { isValidId } from "@/lib/lms/validation";

// Payment read models for the teacher dashboard. Figures come only from
// payment records; nothing is estimated. Received revenue = paid AND verified.

function assertTeacher(user: SessionUser) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
}

export function mapPayment(snapshot: DocumentSnapshot<DocumentData>): PaymentRecord | null {
  const d = snapshot.data();
  if (!d) return null;
  const history = Array.isArray(d.history)
    ? d.history.map((h: Record<string, unknown>) => ({
        at: toIso(h.at),
        byEmail: typeof h.byEmail === "string" ? h.byEmail : null,
        change: String(h.change ?? ""),
      }))
    : [];
  return {
    id: snapshot.id,
    studentId: String(d.studentId ?? ""),
    courseId: String(d.courseId ?? ""),
    enrollmentId: String(d.enrollmentId ?? ""),
    packageId: isValidId(d.packageId) ? d.packageId : null,
    learnerIds: Array.isArray(d.learnerIds)
      ? d.learnerIds.filter(isValidId)
      : isValidId(d.studentId)
        ? [d.studentId]
        : [],
    payerName: typeof d.payerName === "string" && d.payerName ? d.payerName : null,
    rejectionReason: typeof d.rejectionReason === "string" && d.rejectionReason ? d.rejectionReason : null,
    verifiedAt: toIso(d.verifiedAt),
    verifiedByEmail: typeof d.verifiedByEmail === "string" ? d.verifiedByEmail : null,
    receiptId: typeof d.receiptId === "string" && d.receiptId ? d.receiptId : null,
    amountMinor: Number.isSafeInteger(d.amountMinor) ? d.amountMinor : 0,
    currency: typeof d.currency === "string" ? d.currency : DEFAULT_CURRENCY,
    method: (d.method === "gateway" || (PAYMENT_METHODS as readonly string[]).includes(d.method) ? d.method : "other") as PaymentMethod,
    reference: typeof d.reference === "string" && d.reference ? d.reference : null,
    paidAt: toIso(d.paidAt),
    status: ((PAYMENT_STATUSES as readonly string[]).includes(d.status) ? d.status : "pending") as PaymentStatus,
    verified: d.verified === true,
    source: d.source === "gateway" ? "gateway" : "manual",
    notes: typeof d.notes === "string" && d.notes ? d.notes : null,
    createdBy: typeof d.createdBy === "string" ? d.createdBy : null,
    createdByEmail: typeof d.createdByEmail === "string" ? d.createdByEmail : null,
    createdAt: toIso(d.createdAt),
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : null,
    updatedByEmail: typeof d.updatedByEmail === "string" ? d.updatedByEmail : null,
    updatedAt: toIso(d.updatedAt),
    history,
  };
}

const loadPaymentData = cache(async () => {
  const [paymentsSnap, enrollmentsSnap, coursesSnap, studentsSnap, packagesSnap] = await Promise.all([
    col("payments").get(),
    col("enrollments").get(),
    col("courses").select("title", "slug", "status", "price").get(),
    col("users").where("role", "==", "student").select("displayName", "email").get(),
    col("packages").select("title").get(),
  ]);
  const packageTitles = new Map(packagesSnap.docs.map((d) => [d.id, String(d.get("title") ?? "Package")]));
  const payments = paymentsSnap.docs.map(mapPayment).filter((p): p is PaymentRecord => p !== null);
  const enrollments = enrollmentsSnap.docs.map(mapEnrollment).filter((e): e is EnrollmentRecord => e !== null);
  const courses = new Map(
    coursesSnap.docs.map((d) => [d.id, { id: d.id, title: String(d.get("title") ?? "Untitled course") }]),
  );
  const students = new Map(
    studentsSnap.docs.map((d) => [
      d.id,
      {
        uid: d.id,
        name: typeof d.get("displayName") === "string" ? (d.get("displayName") as string) : null,
        email: typeof d.get("email") === "string" ? (d.get("email") as string) : null,
      },
    ]),
  );
  return { payments, enrollments, courses, students, packageTitles };
});

/** "Course" column for a payment: the package title for package payments. */
function paymentTitle(data: Awaited<ReturnType<typeof loadPaymentData>>, p: PaymentRecord): string {
  if (p.packageId) return `Package: ${data.packageTitles.get(p.packageId) ?? "Package"}`;
  return data.courses.get(p.courseId)?.title ?? "Deleted course";
}

export interface EnrollmentBalance {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseTitle: string;
  access: EnrollmentRecord["status"];
  currency: string;
  /** Agreed fee in paise; null when no fee has been agreed. */
  feeMinor: number | null;
  receivedMinor: number;
  /** fee − received; null without an agreed fee. Negative means overpaid. */
  balanceMinor: number | null;
}

function balancesFrom(data: Awaited<ReturnType<typeof loadPaymentData>>): EnrollmentBalance[] {
  return data.enrollments
    .filter((e) => data.students.has(e.studentId))
    .map((e) => {
      const student = data.students.get(e.studentId)!;
      const receivedMinor = data.payments
        .filter((p) => p.enrollmentId === e.id && p.packageId === null && isReceived(p))
        .reduce((sum, p) => sum + p.amountMinor, 0);
      const feeMinor = e.agreedFee === null ? null : Math.round(e.agreedFee * 100);
      return {
        enrollmentId: e.id,
        studentId: e.studentId,
        studentName: student.name ?? student.email ?? "Student",
        courseId: e.courseId,
        courseTitle: data.courses.get(e.courseId)?.title ?? "Deleted course",
        access: e.status,
        currency: e.currency,
        feeMinor,
        receivedMinor,
        balanceMinor: feeMinor === null ? null : feeMinor - receivedMinor,
      };
    });
}

// --- Payment list -------------------------------------------------------------------

export interface PaymentFilters {
  from: string | null;
  to: string | null;
  status: PaymentStatus | "any";
  course: string | null;
  q: string;
  page: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parsePaymentFilters(params: Record<string, string | string[] | undefined>): PaymentFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(params.status);
  const course = one(params.course);
  const page = Number.parseInt(one(params.page), 10);
  const date = (v: string) => (DATE_PATTERN.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  return {
    from: date(one(params.from)),
    to: date(one(params.to)),
    status: (PAYMENT_STATUSES as readonly string[]).includes(status) ? (status as PaymentStatus) : "any",
    course: isValidId(course) ? course : null,
    q: one(params.q).trim().slice(0, 100),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

export const PAYMENT_PAGE_SIZE = 25;

export interface PaymentRow extends PaymentRecord {
  studentName: string;
  studentEmail: string | null;
  courseTitle: string;
}

export async function listPayments(user: SessionUser, filters: PaymentFilters) {
  assertTeacher(user);
  const data = await loadPaymentData();
  // Dates are interpreted in India time (IST, UTC+05:30), the academy's time zone.
  const fromMs = filters.from ? Date.parse(`${filters.from}T00:00:00+05:30`) : null;
  const toMs = filters.to ? Date.parse(`${filters.to}T23:59:59.999+05:30`) : null;
  const needle = filters.q.toLowerCase();

  const rows: PaymentRow[] = data.payments
    .map((p) => {
      const student = data.students.get(p.studentId);
      return {
        ...p,
        studentName: student?.name ?? student?.email ?? "Unknown student",
        studentEmail: student?.email ?? null,
        courseTitle: paymentTitle(data, p),
      };
    })
    .filter((p) => {
      const when = p.paidAt ? Date.parse(p.paidAt) : null;
      if (fromMs !== null && (when === null || when < fromMs)) return false;
      if (toMs !== null && (when === null || when > toMs)) return false;
      if (filters.status !== "any" && p.status !== filters.status) return false;
      if (filters.course && p.courseId !== filters.course) return false;
      if (needle && !`${p.studentName} ${p.studentEmail ?? ""} ${p.reference ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    })
    .sort((a, b) => (b.paidAt ?? b.createdAt ?? "").localeCompare(a.paidAt ?? a.createdAt ?? ""));

  const sum = (list: PaymentRow[]) => list.reduce((s, p) => s + p.amountMinor, 0);
  const received = rows.filter(isReceived);
  const pending = rows.filter((p) => p.status === "pending");
  const refunded = rows.filter((p) => p.status === "refunded");
  const balances = balancesFrom(data);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAYMENT_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  return {
    rows: rows.slice((page - 1) * PAYMENT_PAGE_SIZE, page * PAYMENT_PAGE_SIZE),
    allRows: rows,
    total: rows.length,
    page,
    pageCount,
    totals: {
      receivedMinor: sum(received),
      receivedCount: received.length,
      pendingMinor: sum(pending),
      pendingCount: pending.length,
      refundedMinor: sum(refunded),
      refundedCount: refunded.length,
      failedCount: rows.filter((p) => p.status === "failed").length,
    },
    // Outstanding balances are a current position, not date-filtered.
    outstanding: balances
      .filter((b) => b.balanceMinor !== null && b.balanceMinor > 0)
      .sort((a, b) => (b.balanceMinor ?? 0) - (a.balanceMinor ?? 0)),
    outstandingMinor: balances.reduce((s, b) => s + Math.max(b.balanceMinor ?? 0, 0), 0),
    courses: [...data.courses.values()].sort((a, b) => a.title.localeCompare(b.title)),
    enrollmentOptions: balances
      .map((b) => ({ id: b.enrollmentId, label: `${b.studentName} — ${b.courseTitle}${b.access === "revoked" ? " (revoked)" : ""}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** Payments and balances of one student (student profile page). */
export async function getStudentPayments(user: SessionUser, studentId: string) {
  assertTeacher(user);
  const data = await loadPaymentData();
  const payments = data.payments
    .filter((p) => p.studentId === studentId || p.learnerIds.includes(studentId))
    .map((p) => ({ ...p, courseTitle: paymentTitle(data, p) }))
    .sort((a, b) => (b.paidAt ?? b.createdAt ?? "").localeCompare(a.paidAt ?? a.createdAt ?? ""));
  const balances = balancesFrom(data).filter((b) => b.studentId === studentId);
  return { payments, balances };
}

/** Overview figures for a date window (by payment date). */
export async function getPaymentSummary(user: SessionUser, range: DateRange) {
  assertTeacher(user);
  const days = DATE_RANGES[range];
  const sinceMs = days === null ? null : Date.now() - days * 24 * 60 * 60 * 1000;
  const data = await loadPaymentData();
  const inWindow = data.payments.filter((p) => sinceMs === null || (p.paidAt !== null && Date.parse(p.paidAt) >= sinceMs));
  const received = inWindow.filter(isReceived);
  const pending = data.payments.filter((p) => p.status === "pending");
  const balances = balancesFrom(data);
  const recent = [...data.payments]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 6)
    .map((p) => {
      const student = data.students.get(p.studentId);
      return {
        ...p,
        studentName: student?.name ?? student?.email ?? "Unknown student",
        courseTitle: paymentTitle(data, p),
      };
    });
  return {
    receivedMinor: received.reduce((s, p) => s + p.amountMinor, 0),
    receivedCount: received.length,
    pendingCount: pending.length,
    pendingMinor: pending.reduce((s, p) => s + p.amountMinor, 0),
    outstandingMinor: balances.reduce((s, b) => s + Math.max(b.balanceMinor ?? 0, 0), 0),
    outstandingCount: balances.filter((b) => (b.balanceMinor ?? 0) > 0).length,
    recent,
  };
}

