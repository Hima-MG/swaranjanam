"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh, updateTag } from "next/cache";

import { CATALOG_TAG } from "@/lib/catalog/server";
import { paiseToRupeesText, parseRupees } from "@/lib/lms/billing";
import {
  accountIdFor,
  initialAdvance,
  LEGACY_DUES_STATUSES,
  membershipLockId,
  parsePolicy,
  periodLabel,
  periodOf,
  rateChangeError,
  rateVersionForPeriod,
  type LegacyDuesStatus,
} from "@/lib/lms/class-billing";
import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, getActiveEnrollment, requireActionUser, runAction } from "@/lib/lms/server/access";
import {
  assertLegacyDuesClearedInTx,
  classBillingConfigRef,
  evaluateSuspension,
  legacyDuesRef,
  mapAccount,
  mapConfig,
  mapLegacyDues,
  readPaymentTarget,
  runScheduledBilling,
} from "@/lib/lms/server/class-billing";
import { col, db, mapCourse } from "@/lib/lms/server/db";
import { assertStudent } from "@/lib/lms/server/students";
import type { ActionResult } from "@/lib/lms/types";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Teacher (academy administrator) actions for class-based billing. Every
// action re-verifies the teacher session, validates input, reads and writes
// inside a transaction, and is audited. Issued invoices are never edited.

const rupees = (minor: number) => `₹${paiseToRupeesText(minor)}`;
const entry = (user: { uid: string; email: string | null }, change: string) => ({ at: Timestamp.now(), by: user.uid, byEmail: user.email, change });

/**
 * Runs the billing job now (same code as the scheduled job): issues every
 * cycle invoice that is due and re-evaluates suspensions.
 * Idempotent — running it again changes nothing.
 */
export async function runBillingNow(): Promise<ActionResult<{ created: number; emptyCycles: number; suspended: number; restored: number; errors: number }>> {
  return runAction("runBillingNow", async () => {
    const user = await requireActionUser("teacher");
    const r = await runScheduledBilling(user);
    await writeAudit(user, {
      action: "billing.run",
      targetType: "settings",
      targetId: "classBilling",
      summary: `Billing run: ${r.invoicesCreated} invoice(s) created, ${r.suspended} suspended, ${r.restored} restored, ${r.errors} error(s)`,
    });
    refresh();
    return { created: r.invoicesCreated, emptyCycles: r.emptyCycles, suspended: r.suspended, restored: r.restored, errors: r.errors };
  });
}

/** Credit or debit note: the only way to correct an issued invoice. */
export async function recordInvoiceAdjustment(invoiceId: unknown, kindInput: unknown, amountInput: unknown, reasonInput: unknown): Promise<ActionResult> {
  return runAction("recordInvoiceAdjustment", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(invoiceId)) throw new AccessError("That invoice could not be found.");
    if (kindInput !== "credit_note" && kindInput !== "debit_note") throw new AccessError("Please fix the highlighted fields.", { kind: "Choose credit or debit." });
    const parsedAmount = parseRupees(amountInput);
    const amountMinor = typeof parsedAmount === "number" ? parsedAmount : NaN;
    const reason = cleanText(reasonInput, 300);
    const errors: Record<string, string> = {};
    if (!Number.isSafeInteger(amountMinor)) errors.amount = "Enter an amount greater than zero.";
    if (!reason) errors.reason = "Give the reason and who approved it.";
    if (Object.keys(errors).length) throw new AccessError("Please fix the highlighted fields.", errors);
    const result = await db().runTransaction(async (tx) => {
      const state = await readPaymentTarget(tx, { kind: "invoice", invoiceId });
      if (kindInput === "credit_note" && amountMinor > state.summary!.totalDueMinor) {
        throw new AccessError("Please fix the highlighted fields.", { amount: `A credit cannot exceed ${rupees(state.summary!.totalDueMinor)}.` });
      }
      tx.create(col("invoiceAdjustments").doc(), {
        invoiceId,
        accountId: state.account.id,
        studentId: state.account.studentId,
        kind: kindInput,
        amountMinor,
        reason,
        by: user.uid,
        byEmail: user.email,
        at: FieldValue.serverTimestamp(),
      });
      return { accountId: state.account.id, summary: `${kindInput === "credit_note" ? "Credit" : "Debit"} note ${rupees(amountMinor)} on the ${periodLabel(state.invoice!.period)} invoice: ${reason}` };
    });
    await evaluateSuspension(result.accountId, user);
    await writeAudit(user, { action: `invoice.${kindInput}`, targetType: "invoice", targetId: invoiceId, summary: result.summary });
    refresh();
    return null;
  });
}

/**
 * Marks a billing account as closed (left the course). Keeps all history.
 * Charges already recorded are still invoiced by the cycle job. No refund
 * of an unused advance is made automatically (decision pending).
 */
export async function closeBillingAccount(accountId: unknown, reasonInput: unknown): Promise<ActionResult> {
  return runAction("closeBillingAccount", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(accountId)) throw new AccessError("That billing account could not be found.");
    const reason = cleanText(reasonInput, 300);
    if (!reason) throw new AccessError("Please fix the highlighted fields.", { reason: "Give a reason." });
    const ref = col("billingAccounts").doc(accountId);
    const account = await db().runTransaction(async (tx) => {
      const a = mapAccount(await tx.get(ref));
      if (!a) throw new AccessError("That billing account could not be found.");
      if (a.status === "closed") throw new AccessError("This account is already closed.");
      const [lock, classes] = await Promise.all([
        tx.get(col("batchMembershipLocks").doc(membershipLockId(a.studentId, a.courseId))),
        tx.get(col("liveClasses").where("billingAccountId", "==", a.id)),
      ]);
      if (a.mode === "batch" && lock.exists) throw new AccessError("Remove the learner from their batch first.");
      if (classes.docs.some((d) => d.get("status") === "scheduled")) throw new AccessError("Cancel or complete the learner's scheduled classes first.");
      tx.update(ref, {
        status: "closed",
        closedReason: reason,
        closedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion(entry(user, `Closed: ${reason}`)),
      });
      return a;
    });
    await writeAudit(user, {
      action: "billingAccount.close",
      targetType: "billingAccount",
      targetId: accountId,
      summary: `Closed ${account.studentName}'s ${account.mode} account for ${account.courseTitle}: ${reason}`,
    });
    refresh();
    return null;
  });
}

/** Individual one-to-one sessions: ₹750 per session, each paid separately. Requires verified old dues. */
export async function openIndividualAccount(studentIdInput: unknown, courseIdInput: unknown): Promise<ActionResult<{ accountId: string }>> {
  return runAction("openIndividualAccount", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(courseIdInput)) throw new AccessError("Please fix the highlighted fields.", { courseId: "Choose a course." });
    const student = await assertStudent(studentIdInput);
    const [enrollment, course] = await Promise.all([getActiveEnrollment(student.uid, courseIdInput), col("courses").doc(courseIdInput).get().then(mapCourse)]);
    if (!course || !enrollment) throw new AccessError("The student must be actively enrolled in this course.", { courseId: "Not enrolled." });
    const accountId = accountIdFor(student.uid, course.id, "individual");
    const ref = col("billingAccounts").doc(accountId);
    await db().runTransaction(async (tx) => {
      await assertLegacyDuesClearedInTx(tx, student.uid);
      const [snap, configSnap] = await Promise.all([tx.get(ref), tx.get(classBillingConfigRef())]);
      if (snap.exists) throw new AccessError("This student already has an individual billing account for this course.");
      const version = rateVersionForPeriod(mapConfig(configSnap).rateVersions, periodOf(new Date().toISOString()));
      tx.create(ref, {
        studentId: student.uid,
        courseId: course.id,
        mode: "individual",
        status: "active",
        batchId: null,
        studentName: student.name,
        courseTitle: course.title,
        advance: initialAdvance("individual", version),
        suspension: { active: false, since: null, invoiceIds: [], liftedAt: null },
        billableCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: user.uid,
        history: [entry(user, "Individual-session account opened (₹750 per session, paid per session)")],
      });
    });
    await writeAudit(user, { action: "billingAccount.open", targetType: "billingAccount", targetId: accountId, summary: `Opened individual sessions for ${student.label} (${course.title})` });
    refresh();
    return { accountId };
  });
}

/** Saves the remaining (unconfirmed) policy options. */
export async function updateClassBillingPolicy(input: Record<string, unknown>): Promise<ActionResult> {
  return runAction("updateClassBillingPolicy", async () => {
    const user = await requireActionUser("teacher");
    const { value, errors } = parsePolicy(input ?? {});
    if (!value) throw new AccessError("Please fix the highlighted fields.", errors);
    await db().runTransaction(async (tx) => {
      const config = mapConfig(await tx.get(classBillingConfigRef()));
      tx.set(
        classBillingConfigRef(),
        {
          policy: value,
          rateVersions: config.rateVersions,
          updatedAt: FieldValue.serverTimestamp(),
          updatedByEmail: user.email,
          history: FieldValue.arrayUnion(entry(user, `Policy saved: batch student cancellation ${value.batchStudentCancelled}; advance before scheduling ${value.advanceBeforeScheduling}`)),
        },
        { merge: true },
      );
    });
    await writeAudit(user, { action: "billing.policy", targetType: "settings", targetId: "classBilling", summary: "Updated class billing policy" });
    refresh();
    return null;
  });
}

/**
 * Adds a NEW rate version starting on the 1st of a future month (never the
 * current month). It applies to all students from that month; charges and
 * invoices already recorded keep their rates.
 */
export async function addRateVersion(input: Record<string, unknown>): Promise<ActionResult> {
  return runAction("addRateVersion", async () => {
    const user = await requireActionUser("teacher");
    const money = (v: unknown) => {
      const t = typeof v === "string" ? v.trim().replace(/[,\s₹]/g, "") : "";
      return /^\d+$/.test(t) && Number(t) > 0 && Number(t) <= 100_000 ? Number(t) * 100 : null;
    };
    const batchMinor = money(input?.batch);
    const individualMinor = money(input?.individual);
    const batchAdvanceMinor = money(input?.advance);
    const effectiveFrom = typeof input?.effectiveFrom === "string" ? input.effectiveFrom.trim() : "";
    const errors: Record<string, string> = {};
    if (batchMinor === null) errors.batch = "Enter whole rupees.";
    if (individualMinor === null) errors.individual = "Enter whole rupees.";
    if (batchAdvanceMinor === null) errors.advance = "Enter whole rupees.";
    if (Object.keys(errors).length) throw new AccessError("Please fix the highlighted fields.", errors);
    const id = await db().runTransaction(async (tx) => {
      const config = mapConfig(await tx.get(classBillingConfigRef()));
      const problem = rateChangeError(effectiveFrom, new Date().toISOString(), config.rateVersions);
      if (problem) throw new AccessError("Please fix the highlighted fields.", { effectiveFrom: problem });
      const nextId = `v${config.rateVersions.length + 1}`;
      tx.set(
        classBillingConfigRef(),
        {
          policy: config.policy,
          rateVersions: [...config.rateVersions, { id: nextId, effectiveFrom, batchMinor, individualMinor, batchAdvanceMinor }],
          updatedAt: FieldValue.serverTimestamp(),
          updatedByEmail: user.email,
          history: FieldValue.arrayUnion(entry(user, `Rate version ${nextId} from ${periodLabel(effectiveFrom)}: batch ${rupees(batchMinor!)}, individual ${rupees(individualMinor!)}, advance ${rupees(batchAdvanceMinor!)}`)),
        },
        { merge: true },
      );
      return nextId;
    });
    await writeAudit(user, { action: "billing.rate", targetType: "settings", targetId: "classBilling", summary: `Added rate version ${id} from ${periodLabel(effectiveFrom)}` });
    // Public course fees are derived from the rates in force.
    updateTag(CATALOG_TAG);
    refresh();
    return null;
  });
}

/**
 * Records an administrator's verification of fees before November 2026
 * (paid outside the website). Required before website billing starts for the
 * student. The verifier and time are recorded; earlier entries stay in history.
 */
export async function verifyLegacyDues(studentIdInput: unknown, statusInput: unknown, noteInput: unknown): Promise<ActionResult> {
  return runAction("verifyLegacyDues", async () => {
    const user = await requireActionUser("teacher");
    const student = await assertStudent(studentIdInput);
    if (!(LEGACY_DUES_STATUSES as readonly unknown[]).includes(statusInput)) throw new AccessError("Please fix the highlighted fields.", { status: "Choose an option." });
    const status = statusInput as LegacyDuesStatus;
    const note = cleanText(noteInput, 300);
    if (!note) throw new AccessError("Please fix the highlighted fields.", { note: "Describe how the old dues were checked (e.g. receipt or ledger reference)." });
    const ref = legacyDuesRef(student.uid);
    await db().runTransaction(async (tx) => {
      const before = mapLegacyDues(await tx.get(ref));
      tx.set(
        ref,
        {
          studentId: student.uid,
          status,
          note,
          verifiedBy: user.uid,
          verifiedByEmail: user.email,
          verifiedAt: FieldValue.serverTimestamp(),
          history: FieldValue.arrayUnion(entry(user, `${before ? `Changed from ${before.status} to` : "Verified as"} ${status}: ${note}`)),
        },
        { merge: true },
      );
    });
    await writeAudit(user, { action: "billing.legacyDues", targetType: "student", targetId: student.uid, summary: `Old dues for ${student.label}: ${status} — ${note}` });
    refresh();
    return null;
  });
}
