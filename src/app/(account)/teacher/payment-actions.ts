"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh } from "next/cache";

import { paiseToRupeesText, statusAfterPayment, summarizePackage } from "@/lib/lms/billing";
import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { ADVANCE_CORRECTION_LABELS, type AdvanceCorrectionReason, advanceReversalError } from "@/lib/lms/class-billing";
import { legacyPackageBlock } from "@/lib/lms/legacy-packages";
import {
  getBillingSettings,
  historyEntry,
  paymentReferenceRef,
  readPackageInTx,
  readReceiptContext,
  writeReceipt,
  type PackageRecord,
} from "@/lib/lms/server/billing";
import { applyVerifiedPayment, evaluateSuspension, readPaymentTarget, type PaymentTarget, type TargetState } from "@/lib/lms/server/class-billing";
import { col, db, mapEnrollment } from "@/lib/lms/server/db";
import { mapPayment } from "@/lib/lms/server/payments";
import {
  DEFAULT_CURRENCY,
  PAYMENT_TRANSITIONS,
  type ActionResult,
  type PaymentMethod,
  type PaymentRecord,
  type PaymentStatus,
} from "@/lib/lms/types";
import { parseAmountMinor, parsePaidAt } from "@/lib/lms/payment-input";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Teacher payment actions. Every action re-checks the teacher session.
// Payments are never deleted: mistakes are corrected through status changes,
// and every change is recorded in the payment's history and the audit log.
// Client input is never trusted to mark a payment as received: a manual
// payment counts only when the teacher explicitly confirms they verified it.
//
// A payment is recorded against EITHER a legacy enrollment fee OR a package,
// never both, so it is counted in exactly one balance. When a payment becomes
// paid + verified, its receipt is issued in the same transaction, and a
// package that is now fully paid becomes active.

const MANUAL_STATUSES: PaymentStatus[] = ["pending", "paid", "failed"];

const rupees = (minor: number) => `₹${paiseToRupeesText(minor)}`;

export interface RecordPaymentInput {
  /** Legacy enrollment fee payment. */
  enrollmentId?: unknown;
  /** Package payment. */
  packageId?: unknown;
  /** Class-based billing: the one-time registration advance of this billing account. */
  advanceAccountId?: unknown;
  /** Class-based billing: a monthly batch invoice. */
  invoiceId?: unknown;
  /** Class-based billing: one individual session (₹750, paid separately). Exactly one target in total. */
  sessionChargeId?: unknown;
  amount: unknown;
  method: unknown;
  reference: unknown;
  paidAt: unknown;
  status: unknown;
  notes: unknown;
  /** Who paid, if not the learner (e.g. a parent or guardian). */
  payerName?: unknown;
  /** Required when recording a rejected/failed payment. */
  rejectionReason?: unknown;
  /** Teacher confirms the money was actually received (required for "paid"). */
  verifiedConfirmation: unknown;
}

function packageStatusAfter(pkg: PackageRecord, payments: PaymentRecord[], adjustments: Parameters<typeof summarizePackage>[0]["adjustments"]) {
  const summary = summarizePackage({
    priceMinor: pkg.priceMinor,
    sessionsIncluded: pkg.sessionsIncluded,
    creditsUsed: pkg.creditsUsed,
    payments,
    adjustments,
  });
  return statusAfterPayment(pkg.status, summary);
}

export async function recordPayment(input: RecordPaymentInput): Promise<ActionResult<{ paymentId: string; receiptNumber: string | null }>> {
  return runAction("recordPayment", async () => {
    const user = await requireActionUser("teacher");
    const errors: Record<string, string> = {};

    const enrollmentId = isValidId(input?.enrollmentId) ? input.enrollmentId : null;
    const packageId = isValidId(input?.packageId) ? input.packageId : null;
    const advanceAccountId = isValidId(input?.advanceAccountId) ? input.advanceAccountId : null;
    const invoiceId = isValidId(input?.invoiceId) ? input.invoiceId : null;
    const sessionChargeId = isValidId(input?.sessionChargeId) ? input.sessionChargeId : null;
    const targetCount = [enrollmentId, packageId, advanceAccountId, invoiceId, sessionChargeId].filter(Boolean).length;
    const packageBlocked = packageId ? legacyPackageBlock("record_payment") : null;
    if (packageBlocked) throw new AccessError(packageBlocked, { target: "Legacy package (read-only)." });
    if (targetCount === 0) errors.target = "Choose what this payment is for.";
    if (targetCount > 1) errors.target = "Choose only one target for a payment.";
    const billingTarget: PaymentTarget | null = advanceAccountId
      ? { kind: "advance", accountId: advanceAccountId }
      : invoiceId
        ? { kind: "invoice", invoiceId }
        : sessionChargeId
          ? { kind: "session", chargeId: sessionChargeId }
          : null;
    const amountMinor = parseAmountMinor(input?.amount);
    if (amountMinor === null) errors.amount = "Enter an amount greater than zero (up to 2 decimal places).";
    const settings = await getBillingSettings();
    const method = settings.methods.includes(input?.method as PaymentMethod) ? (input.method as PaymentMethod) : null;
    if (!method) errors.method = "Choose one of the academy's accepted payment methods.";
    const paidAt = parsePaidAt(input?.paidAt);
    if (!paidAt) errors.paidAt = "Enter the payment date (not in the future).";
    const status = MANUAL_STATUSES.includes(input?.status as PaymentStatus) ? (input.status as PaymentStatus) : null;
    if (!status) errors.status = "Choose a status.";
    const reference = cleanText(input?.reference, 100) || null;
    const notes = cleanText(input?.notes, 500) || null;
    const payerName = cleanText(input?.payerName, 120) || null;
    const rejectionReason = cleanText(input?.rejectionReason, 300) || null;
    if (status === "paid" && input?.verifiedConfirmation !== true) {
      errors.verifiedConfirmation = "Confirm that you have verified this payment was received.";
    }
    if (status === "failed" && !rejectionReason) errors.rejectionReason = "Give the reason this payment failed or was rejected.";
    if (Object.keys(errors).length > 0) throw new AccessError("Please fix the highlighted fields.", errors);

    const ref = col("payments").doc();
    const result = await db().runTransaction(async (tx) => {
      // ---- reads (Firestore transactions: all reads before any write) ----
      const reservation = reference ? paymentReferenceRef(method!, reference) : null;
      const [reservationSnap, legacyDuplicate] = await Promise.all([
        reservation ? tx.get(reservation) : Promise.resolve(null),
        // Payments recorded before reference reservations existed.
        reference ? tx.get(col("payments").where("reference", "==", reference).where("method", "==", method).limit(1)) : Promise.resolve(null),
      ]);
      if (reservationSnap?.exists || (legacyDuplicate && !legacyDuplicate.empty)) {
        throw new AccessError("A payment with this reference has already been recorded.", {
          reference: "Already recorded. Check the existing payment instead.",
        });
      }

      let target: { studentId: string; courseId: string; enrollmentId: string; learnerIds: string[]; currency: string; label: string };
      let pkgData: Awaited<ReturnType<typeof readPackageInTx>> = null;
      let billing: TargetState | null = null;
      if (billingTarget) {
        billing = await readPaymentTarget(tx, billingTarget);
        // The amount owed is calculated on the server; the form cannot change it.
        if (status !== "failed") {
          if (billing.payableMinor === null) {
            throw new AccessError(
              billingTarget.kind === "advance"
                ? "No advance is payable on this account (already received, applied or not required)."
                : billingTarget.kind === "session"
                  ? "This session is not payable (already paid, or cancelled without charge)."
                  : "This invoice is not payable (void or already paid).",
              { target: "Nothing payable." },
            );
          }
          if ((billingTarget.kind === "advance" || billingTarget.kind === "session") && amountMinor !== billing.payableMinor) {
            throw new AccessError("Please fix the highlighted fields.", {
              amount: `The ${billingTarget.kind === "advance" ? "advance" : "session fee"} is exactly ₹${paiseToRupeesText(billing.payableMinor)}.`,
            });
          }
          if (billingTarget.kind === "invoice" && amountMinor! > billing.payableMinor) {
            throw new AccessError("Please fix the highlighted fields.", { amount: `At most ₹${paiseToRupeesText(billing.payableMinor)} is outstanding on this invoice.` });
          }
        }
        target = {
          studentId: billing.account.studentId,
          courseId: billing.account.courseId,
          enrollmentId: "",
          learnerIds: [billing.account.studentId],
          currency: "INR",
          label:
            billingTarget.kind === "advance"
              ? `advance for account ${billing.account.id}`
              : billingTarget.kind === "session"
                ? `session charge ${billingTarget.chargeId}`
                : `invoice ${billingTarget.invoiceId}`,
        };
      } else if (packageId) {
        pkgData = await readPackageInTx(tx, packageId);
        if (!pkgData) throw new AccessError("That package could not be found.", { target: "Not found." });
        if (pkgData.pkg.status === "cancelled") throw new AccessError("This package is cancelled.", { target: "Cancelled package." });
        const pkg = pkgData.pkg;
        target = {
          studentId: pkg.learnerIds[0],
          courseId: pkg.courseId ?? "",
          enrollmentId: "",
          learnerIds: pkg.learnerIds,
          currency: pkg.currency,
          label: `package ${pkg.id}`,
        };
      } else {
        const enrollment = mapEnrollment(await tx.get(col("enrollments").doc(enrollmentId!)));
        if (!enrollment) throw new AccessError("That enrollment could not be found.", { target: "Not found." });
        target = {
          studentId: enrollment.studentId,
          courseId: enrollment.courseId,
          enrollmentId: enrollment.id,
          learnerIds: [enrollment.studentId],
          currency: enrollment.currency || DEFAULT_CURRENCY,
          label: `enrollment ${enrollment.id}`,
        };
      }
      const record: PaymentRecord = {
        id: ref.id,
        studentId: target.studentId,
        courseId: target.courseId,
        enrollmentId: target.enrollmentId,
        packageId,
        purpose: billingTarget ? billingTarget.kind : null,
        accountId: billing ? billing.account.id : null,
        invoiceId: billingTarget?.kind === "invoice" ? billingTarget.invoiceId : null,
        sessionChargeId: billingTarget?.kind === "session" ? billingTarget.chargeId : null,
        learnerIds: target.learnerIds,
        payerName,
        rejectionReason: status === "failed" ? rejectionReason : null,
        verifiedAt: null,
        verifiedByEmail: null,
        receiptId: null,
        amountMinor: amountMinor!,
        currency: target.currency,
        method: method!,
        reference,
        paidAt: paidAt!.toISOString(),
        status: status!,
        verified: status === "paid",
        source: "manual",
        notes,
        createdBy: user.uid,
        createdByEmail: user.email,
        createdAt: null,
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: null,
        history: [],
      };
      const receiptCtx = status === "paid" ? await readReceiptContext(tx, record, pkgData?.pkg ?? null, billing?.titleSuffix) : null;

      // ---- writes ----
      if (billing && status === "paid") applyVerifiedPayment(tx, billing, ref.id, user);
      if (reservation) tx.create(reservation, { paymentId: ref.id, method, createdAt: FieldValue.serverTimestamp() });
      const receiptNumber = receiptCtx ? writeReceipt(tx, receiptCtx, record, pkgData?.pkg ?? null) : null;
      tx.create(ref, {
        studentId: record.studentId,
        courseId: record.courseId,
        enrollmentId: record.enrollmentId,
        packageId: record.packageId,
        purpose: record.purpose,
        accountId: record.accountId,
        invoiceId: record.invoiceId,
        sessionChargeId: record.sessionChargeId,
        learnerIds: record.learnerIds,
        payerName,
        amountMinor: record.amountMinor,
        currency: record.currency,
        method: record.method,
        reference,
        paidAt: Timestamp.fromDate(paidAt!),
        status: record.status,
        // Manual records are verified by the teacher's explicit confirmation.
        verified: record.verified,
        verifiedAt: record.verified ? FieldValue.serverTimestamp() : null,
        verifiedBy: record.verified ? user.uid : null,
        verifiedByEmail: record.verified ? user.email : null,
        rejectionReason: record.rejectionReason,
        receiptId: receiptNumber ? ref.id : null,
        source: "manual",
        gateway: null,
        notes,
        createdBy: user.uid,
        createdByEmail: user.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: FieldValue.serverTimestamp(),
        history: [
          {
            at: Timestamp.now(),
            by: user.uid,
            byEmail: user.email,
            change: `Recorded as ${status}${status === "failed" && rejectionReason ? ` (${rejectionReason})` : ""}`,
          },
        ],
      });
      if (pkgData) {
        const nextStatus = packageStatusAfter(pkgData.pkg, [...pkgData.payments, record], pkgData.adjustments);
        tx.update(pkgData.ref, {
          paymentIds: FieldValue.arrayUnion(ref.id),
          ...(nextStatus !== pkgData.pkg.status ? { status: nextStatus } : {}),
          updatedAt: FieldValue.serverTimestamp(),
          history: FieldValue.arrayUnion(
            historyEntry(user, `Payment ${rupees(record.amountMinor)} recorded as ${status}${nextStatus !== pkgData.pkg.status ? " — package is now active" : ""}`),
          ),
        });
      }
      return { label: target.label, receiptNumber, accountId: billing?.account.id ?? null };
    });
    // A verified invoice payment may lift a suspension (idempotent; the scheduled job re-checks too).
    if (result.accountId && status === "paid") await evaluateSuspension(result.accountId, user);
    await writeAudit(user, {
      action: "payment.create",
      targetType: "payment",
      targetId: ref.id,
      summary: `Recorded ${status} payment of ${rupees(amountMinor!)} for ${result.label}${result.receiptNumber ? ` — receipt ${result.receiptNumber}` : ""}`,
    });
    refresh();
    return { paymentId: ref.id, receiptNumber: result.receiptNumber };
  });
}

/**
 * Verify (pending → paid), reject (pending → failed, reason required), reopen
 * (failed → pending) or refund in full (paid → refunded, note required).
 * The enrolment advance is non-refundable: an advance payment can only be
 * reversed to correct a payment mistake (correctionReason required).
 */
export async function updatePaymentStatus(
  paymentId: unknown,
  nextStatus: unknown,
  noteInput: unknown,
  verifiedConfirmation: unknown,
  correctionReason?: unknown,
): Promise<ActionResult> {
  return runAction("updatePaymentStatus", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(paymentId)) throw new AccessError("That payment could not be found.");
    const ref = col("payments").doc(paymentId);
    const note = cleanText(noteInput, 300);

    const summary = await db().runTransaction(async (tx) => {
      // ---- reads ----
      const payment = mapPayment(await tx.get(ref));
      if (!payment) throw new AccessError("That payment could not be found.");
      const target = nextStatus as PaymentStatus;
      if (!PAYMENT_TRANSITIONS[payment.status]?.includes(target)) {
        throw new AccessError(`A ${payment.status} payment cannot be changed to ${String(nextStatus)}.`);
      }
      if (payment.source === "gateway") {
        // Gateway payments change state only through verified gateway events.
        throw new AccessError("Online gateway payments are updated automatically and cannot be changed by hand.");
      }
      if (target === "paid" && verifiedConfirmation !== true) {
        throw new AccessError("Confirm that you have verified this payment was received.");
      }
      if (target === "refunded" && !note) {
        throw new AccessError("Add a short note explaining the refund.", { note: "Required for refunds." });
      }
      if (target === "failed" && !note) {
        throw new AccessError("Give the reason this payment is rejected.", { note: "Required when rejecting a payment." });
      }
      const pkgData = payment.packageId ? await readPackageInTx(tx, payment.packageId) : null;
      const billing =
        payment.purpose === "advance" && payment.accountId
          ? await readPaymentTarget(tx, { kind: "advance", accountId: payment.accountId })
          : payment.purpose === "invoice" && payment.invoiceId
            ? await readPaymentTarget(tx, { kind: "invoice", invoiceId: payment.invoiceId })
            : payment.purpose === "session" && payment.sessionChargeId
              ? await readPaymentTarget(tx, { kind: "session", chargeId: payment.sessionChargeId })
              : null;
      if (billing && target === "paid" && billing.target.kind === "invoice") {
        if (billing.payableMinor === null || payment.amountMinor > billing.payableMinor) {
          throw new AccessError("Verifying this payment would exceed the invoice's outstanding balance. Check the invoice first.");
        }
      }
      const advanceCorrection = billing?.target.kind === "advance" && target === "refunded";
      if (advanceCorrection) {
        const appliedMinor = billing.account.advance.paymentId === payment.id ? billing.account.advance.appliedMinor : 0;
        const blocked = advanceReversalError({ reason: correctionReason, appliedMinor });
        if (blocked) throw new AccessError(blocked, { correctionReason: blocked });
      }
      const correctionLabel = advanceCorrection ? ADVANCE_CORRECTION_LABELS[correctionReason as AdvanceCorrectionReason] : null;
      if (target === "refunded" && pkgData?.adjustments.some((a) => a.kind === "refund" && a.paymentId === payment.id)) {
        throw new AccessError("Part of this payment has already been refunded. Record the rest as a refund adjustment on the package.");
      }
      const updated: PaymentRecord = {
        ...payment,
        status: target,
        verified: target === "paid" ? true : target === "refunded" ? payment.verified : false,
      };
      const receiptCtx = target === "paid" ? await readReceiptContext(tx, updated, pkgData?.pkg ?? null, billing?.titleSuffix) : null;
      const receiptRef = target === "refunded" ? col("receipts").doc(payment.id) : null;
      const receiptSnap = receiptRef ? await tx.get(receiptRef) : null;

      // ---- writes ----
      const change = correctionLabel
        ? `Advance payment reversed — payment error: ${correctionLabel} (${note})`
        : `${payment.status} → ${target}${note ? ` (${note})` : ""}`;
      if (billing && target === "paid") applyVerifiedPayment(tx, billing, payment.id, user);
      if (billing?.session && billing.sessionRef && target === "refunded" && billing.session.paymentId === payment.id) {
        // Refunded: a payable session becomes due again; a no-charge session's review is resolved.
        tx.update(billing.sessionRef, {
          ...(billing.session.status === "paid" ? { status: "due" } : {}),
          paymentId: null,
          needsReview: null,
          history: FieldValue.arrayUnion(historyEntry(user, `Session payment refunded: ${note}`)),
        });
      }
      if (billing && billing.target.kind === "advance" && target === "refunded" && billing.account.advance.paymentId === payment.id) {
        // The advance is no longer received; the account goes back to awaiting it.
        tx.update(billing.accountRef, {
          "advance.status": "awaiting",
          "advance.paymentId": null,
          history: FieldValue.arrayUnion(historyEntry(user, `Advance payment reversed (payment error: ${correctionLabel}): ${note}. The advance is owed again.`)),
        });
        tx.create(col("advanceLedger").doc(), {
          accountId: billing.account.id,
          studentId: billing.account.studentId,
          kind: "reversed",
          reason: correctionReason,
          amountMinor: payment.amountMinor,
          paymentId: payment.id,
          at: FieldValue.serverTimestamp(),
          by: user.uid,
        });
      }
      const receiptNumber = receiptCtx ? writeReceipt(tx, receiptCtx, updated, pkgData?.pkg ?? null) : null;
      if (receiptRef && receiptSnap?.exists) {
        // The original receipt is kept for the audit trail and marked refunded.
        tx.update(receiptRef, {
          status: "refunded",
          refundedMinor: payment.amountMinor,
          statusNote: correctionLabel ? `Reversed — payment error: ${correctionLabel} (${note})` : `Refunded: ${note}`,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      tx.update(ref, {
        status: target,
        verified: updated.verified,
        ...(target === "paid" ? { verifiedAt: FieldValue.serverTimestamp(), verifiedBy: user.uid, verifiedByEmail: user.email } : {}),
        ...(target === "failed" ? { rejectionReason: note } : {}),
        ...(target === "pending" ? { rejectionReason: null } : {}),
        ...(receiptNumber ? { receiptId: payment.id } : {}),
        updatedBy: user.uid,
        updatedByEmail: user.email,
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion({ at: Timestamp.now(), by: user.uid, byEmail: user.email, change }),
      });
      if (pkgData) {
        const payments = pkgData.payments.map((p) => (p.id === payment.id ? updated : p));
        const nextPkgStatus = packageStatusAfter(pkgData.pkg, payments, pkgData.adjustments);
        tx.update(pkgData.ref, {
          ...(nextPkgStatus !== pkgData.pkg.status ? { status: nextPkgStatus } : {}),
          updatedAt: FieldValue.serverTimestamp(),
          history: FieldValue.arrayUnion(
            historyEntry(user, `Payment ${rupees(payment.amountMinor)}: ${change}${nextPkgStatus !== pkgData.pkg.status ? " — package is now active" : ""}`),
          ),
        });
      }
      return { text: `Payment ${ref.id}: ${change}${receiptNumber ? ` — receipt ${receiptNumber}` : ""}`, accountId: billing?.account.id ?? null };
    });
    if (summary.accountId) await evaluateSuspension(summary.accountId, user);

    await writeAudit(user, { action: "payment.status", targetType: "payment", targetId: ref.id, summary: summary.text });
    refresh();
    return null;
  });
}

/** Sets the agreed fee for one enrollment (discounts, scholarships). null clears it. */
export async function updateEnrollmentFee(enrollmentId: unknown, feeInput: unknown, reasonInput: unknown): Promise<ActionResult> {
  return runAction("updateEnrollmentFee", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(enrollmentId)) throw new AccessError("That enrollment could not be found.");
    const raw = typeof feeInput === "string" ? feeInput.trim().replace(/[,\s₹]/g, "") : feeInput;
    let fee: number | null;
    if (raw === "" || raw === null || raw === undefined) fee = null;
    else if (typeof raw === "number" || /^\d+$/.test(String(raw))) fee = Number(raw);
    else throw new AccessError("Please fix the highlighted fields.", { fee: "Enter the fee in whole rupees, or leave it empty." });
    if (fee !== null && (!Number.isSafeInteger(fee) || fee < 0 || fee > 10_000_000)) {
      throw new AccessError("Please fix the highlighted fields.", { fee: "Enter a fee between ₹0 and ₹1,00,00,000." });
    }
    const reason = cleanText(reasonInput, 200);
    if (!reason) throw new AccessError("Please fix the highlighted fields.", { reason: "Give a short reason for the change." });

    const ref = col("enrollments").doc(enrollmentId);
    const before = mapEnrollment(await ref.get());
    if (!before) throw new AccessError("That enrollment could not be found.");
    if (before.agreedFee === fee) return null;
    await ref.update({
      agreedFee: fee,
      feeUpdatedAt: FieldValue.serverTimestamp(),
      feeUpdatedBy: user.uid,
      history: FieldValue.arrayUnion({
        type: "fee",
        at: Timestamp.now(),
        by: user.uid,
        note: `Fee ${before.agreedFee ?? "not set"} → ${fee ?? "not set"}: ${reason}`,
      }),
    });
    await writeAudit(user, {
      action: "enrollment.fee",
      targetType: "enrollment",
      targetId: enrollmentId,
      summary: `Agreed fee ₹${before.agreedFee ?? "—"} → ₹${fee ?? "—"} (${reason})`,
    });
    refresh();
    return null;
  });
}
