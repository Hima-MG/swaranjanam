"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { refresh, updateTag } from "next/cache";

import { CATALOG_TAG } from "@/lib/catalog/server";
import {
  ADJUSTMENT_KINDS,
  buildPackageDraft,
  countsAsReceived,
  isLearnerCategory,
  PACKAGE_TYPES,
  packageIdFor,
  paiseToRupeesText,
  parsePlanInput,
  parseRupees,
  PUBLISHED_PLANS,
  statusAfterConsumption,
  statusAfterPayment,
  summarizePackage,
  type AdjustmentKind,
  type PackageLearner,
  type PackageType,
} from "@/lib/lms/billing";
import { writeAudit } from "@/lib/lms/server/audit";
import { AccessError, requireActionUser, runAction } from "@/lib/lms/server/access";
import { billingSettingsRef, historyEntry, mapPlan, readPackageInTx } from "@/lib/lms/server/billing";
import { col, db, mapCourse } from "@/lib/lms/server/db";
import { assertStudent } from "@/lib/lms/server/students";
import { enrollmentId, PAYMENT_METHODS, type ActionResult, type PaymentMethod } from "@/lib/lms/types";
import { cleanText, isValidId } from "@/lib/lms/validation";

// Teacher-only billing actions: fee plans, accepted payment methods, packages
// and adjustments. Every action re-verifies the teacher session, validates all
// input, recalculates prices on the server from the stored plan, writes inside
// a transaction where state is read and changed, and is recorded in the audit
// log. Nothing here trusts a price, balance, credit count or status from the
// browser.

const rupees = (minor: number) => `₹${paiseToRupeesText(minor)}`;

// --- Fee plans --------------------------------------------------------------------

/** Creates any published plan that does not exist yet. Never overwrites an existing plan. */
export async function installPublishedPlans(): Promise<ActionResult<{ created: string[] }>> {
  return runAction("installPublishedPlans", async () => {
    const user = await requireActionUser("teacher");
    const created = await db().runTransaction(async (tx) => {
      const refs = PUBLISHED_PLANS.map((p) => col("pricePlans").doc(p.id));
      const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
      const added: string[] = [];
      PUBLISHED_PLANS.forEach((plan, i) => {
        if (snaps[i].exists) return;
        const { id, ...data } = plan;
        void id;
        tx.create(refs[i], {
          ...data,
          pairPricesMinor: { ...plan.pairPricesMinor },
          createdAt: FieldValue.serverTimestamp(),
          createdBy: user.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedByEmail: user.email,
          history: [historyEntry(user, "Created from the published fee structure")],
        });
        added.push(plan.title);
      });
      return added;
    });
    if (created.length) {
      await writeAudit(user, {
        action: "pricing.install",
        targetType: "pricePlan",
        targetId: "published",
        summary: `Set up fee plans: ${created.join(", ")}`,
      });
      // Public course pages show fees from these plans.
      updateTag(CATALOG_TAG);
    }
    refresh();
    return { created };
  });
}

function describePlanChanges(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const money = (v: unknown) => (typeof v === "number" ? rupees(v) : "not offered");
  const changes: string[] = [];
  const fields: [string, string, (v: unknown) => string][] = [
    ["title", "Name", String],
    ["status", "Status", String],
    ["adultPriceMinor", "Adult fee", money],
    ["studentPriceMinor", "Student fee", money],
    ["flatPriceMinor", "Fee", money],
    ["pairEligible", "Pair plan", (v) => (v ? "on" : "off")],
    ["sessionsIncluded", "Sessions", String],
    ["sessionMinutes", "Minutes per session", String],
    ["durationWeeks", "Weeks", (v) => (v === null ? "—" : String(v))],
    ["sessionsPerWeek", "Sessions per week", String],
    ["courseId", "Linked course", (v) => (v ? String(v) : "none")],
    ["level", "Level", String],
    ["audience", "For", String],
  ];
  for (const [key, label, fmt] of fields) {
    if (before[key] !== after[key]) changes.push(`${label}: ${fmt(before[key])} → ${fmt(after[key])}`);
  }
  const bp = (before.pairPricesMinor ?? {}) as Record<string, unknown>;
  const ap = (after.pairPricesMinor ?? {}) as Record<string, unknown>;
  for (const t of ["two_adults", "adult_student", "two_students"]) {
    if (bp[t] !== ap[t]) changes.push(`Pair ${t.replace("_", " ")}: ${money(bp[t])} → ${money(ap[t])}`);
  }
  return changes;
}

/**
 * Edits a plan's FUTURE pricing. Existing packages keep the snapshot taken when
 * they were assigned, and payments/receipts are never touched.
 */
export async function updatePricePlan(planId: unknown, input: Record<string, unknown>): Promise<ActionResult> {
  return runAction("updatePricePlan", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(planId)) throw new AccessError("That fee plan could not be found.");
    const ref = col("pricePlans").doc(planId);
    const current = mapPlan(await ref.get());
    if (!current) throw new AccessError("That fee plan could not be found.");
    const { value, errors } = parsePlanInput(current.kind, input ?? {});
    if (!value) throw new AccessError("Please fix the highlighted fields.", errors);
    if (value.courseId) {
      const course = mapCourse(await col("courses").doc(value.courseId).get());
      if (!course) throw new AccessError("Please fix the highlighted fields.", { courseId: "That course no longer exists." });
    }

    const changes = await db().runTransaction(async (tx) => {
      const fresh = mapPlan(await tx.get(ref));
      if (!fresh) throw new AccessError("That fee plan could not be found.");
      const next = { ...value, pairPricesMinor: { ...value.pairPricesMinor } };
      const list = describePlanChanges(fresh as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
      if (list.length === 0) return list;
      tx.update(ref, {
        ...next,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByEmail: user.email,
        history: FieldValue.arrayUnion(historyEntry(user, list.join("; ").slice(0, 500))),
      });
      return list;
    });
    if (changes.length) {
      await writeAudit(user, { action: "pricing.update", targetType: "pricePlan", targetId: planId, summary: `${current.title}: ${changes.join("; ")}` });
      // Public course pages show fees from these plans.
      updateTag(CATALOG_TAG);
      refresh();
    }
    return null;
  });
}

/** Which payment methods the academy accepts. Older payments keep their stored method. */
export async function updatePaymentMethods(methodsInput: unknown): Promise<ActionResult> {
  return runAction("updatePaymentMethods", async () => {
    const user = await requireActionUser("teacher");
    const methods = Array.isArray(methodsInput)
      ? [...new Set(methodsInput.filter((m): m is PaymentMethod => (PAYMENT_METHODS as readonly unknown[]).includes(m)))]
      : [];
    if (methods.length === 0) throw new AccessError("Please fix the highlighted fields.", { methods: "Choose at least one accepted method." });
    await billingSettingsRef().set(
      { enabledMethods: methods, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid, updatedByEmail: user.email },
      { merge: true },
    );
    await writeAudit(user, { action: "settings.paymentMethods", targetType: "settings", targetId: "billing", summary: `Accepted payment methods: ${methods.join(", ")}` });
    refresh();
    return null;
  });
}

// --- Packages ------------------------------------------------------------------------

export interface CreatePackageInput {
  /** Generated once per dialog opening; retries with the same key return the same package. */
  requestKey: unknown;
  planId: unknown;
  type: unknown;
  learners: unknown;
  startDate: unknown;
  notes: unknown;
  /** Required only when the published table does not cover the combination. */
  confirmationReason: unknown;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function createPackage(
  input: CreatePackageInput,
): Promise<ActionResult<{ packageId: string; duplicate: boolean; accessNotes: string[] }>> {
  return runAction("createPackage", async () => {
    const user = await requireActionUser("teacher");
    const packageId = packageIdFor(input?.requestKey);
    if (!packageId) throw new AccessError("This form has expired. Close it and open it again.");
    if (!isValidId(input?.planId)) throw new AccessError("Please fix the highlighted fields.", { planId: "Choose a course or program." });
    if (!(PACKAGE_TYPES as readonly unknown[]).includes(input?.type)) throw new AccessError("Please fix the highlighted fields.", { type: "Choose a package type." });
    const type = input.type as PackageType;
    const rawLearners = Array.isArray(input?.learners) ? input.learners.slice(0, 3) : [];
    const expected = type === "pair" ? 2 : 1;
    if (rawLearners.length !== expected) throw new AccessError(`Choose ${expected === 2 ? "both learners" : "the learner"}.`);
    const errors: Record<string, string> = {};
    rawLearners.forEach((l: Record<string, unknown>, i: number) => {
      if (!isLearnerCategory(l?.category)) errors[`category${i}`] = "Choose adult or student.";
    });
    const startDate = typeof input?.startDate === "string" && DATE.test(input.startDate) ? input.startDate : null;
    if (input?.startDate && !startDate) errors.startDate = "Enter a valid date, or leave it empty.";
    if (Object.keys(errors).length) throw new AccessError("Please fix the highlighted fields.", errors);

    // Every learner must be a real, enabled student account (never trusted from the form).
    const students = await Promise.all(rawLearners.map((l: Record<string, unknown>, i: number) => assertStudent(l?.studentId, `student${i}`)));
    const learners: PackageLearner[] = students.map((s, i) => ({
      studentId: s.uid,
      category: (rawLearners[i] as Record<string, unknown>).category as PackageLearner["category"],
      name: s.name,
    }));
    const confirmationReason = cleanText(input?.confirmationReason, 300) || null;
    const notes = cleanText(input?.notes, 500) || null;

    const planRef = col("pricePlans").doc(input.planId);
    const ref = col("packages").doc(packageId);
    const outcome = await db().runTransaction(async (tx) => {
      const [existing, planSnap] = await Promise.all([tx.get(ref), tx.get(planRef)]);
      if (existing.exists) {
        // Retried request: same key, same creator and same choice → same package.
        const same =
          existing.get("createdBy") === user.uid &&
          existing.get("planId") === planRef.id &&
          JSON.stringify(existing.get("learnerIds")) === JSON.stringify(learners.map((l) => l.studentId));
        if (!same) throw new AccessError("This form has already been used. Close it and open it again.");
        return { duplicate: true, accessNotes: [] as string[], title: String(existing.get("title") ?? ""), priceMinor: Number(existing.get("priceMinor")) };
      }
      const plan = mapPlan(planSnap);
      if (!plan) throw new AccessError("Please fix the highlighted fields.", { planId: "That course or program could not be found." });
      const built = buildPackageDraft(plan, type, learners, confirmationReason);
      if (!built.ok) {
        throw new AccessError(built.error, built.needsConfirmation ? { confirmationReason: built.needsConfirmation } : { planId: built.error });
      }
      const draft = built.draft;

      // Content access: connect the plan's course without changing payment-independent access rules.
      const accessNotes: string[] = [];
      const course = draft.courseId ? mapCourse(await tx.get(col("courses").doc(draft.courseId))) : null;
      const enrollmentRefs = course ? draft.learners.map((l) => col("enrollments").doc(enrollmentId(course.id, l.studentId))) : [];
      const enrollments = await Promise.all(enrollmentRefs.map((r) => tx.get(r)));

      tx.create(ref, {
        requestKey: input.requestKey,
        type: draft.type,
        planId: draft.planId,
        title: draft.plan.title,
        plan: { ...draft.plan, pairPricesMinor: { ...draft.plan.pairPricesMinor } },
        priceMinor: draft.priceMinor,
        currency: draft.currency,
        priceBasis: draft.priceBasis,
        learners: draft.learners,
        learnerIds: draft.learnerIds,
        courseId: draft.courseId,
        sessionsIncluded: draft.sessionsIncluded,
        creditsUsed: 0,
        creditAdjustment: 0,
        status: "awaiting_payment",
        startDate,
        notes,
        confirmation: draft.confirmation,
        activation: null,
        cancelReason: null,
        cancelledAt: null,
        createdBy: user.uid,
        createdByEmail: user.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        history: [historyEntry(user, `Assigned at ${rupees(draft.priceMinor)} (${draft.priceBasis.replace("_", " ")}), ${draft.sessionsIncluded} sessions`)],
      });

      if (course) {
        draft.learners.forEach((l, i) => {
          const snap = enrollments[i];
          if (!snap.exists) {
            if (course.status === "archived") {
              accessNotes.push(`${l.name}: “${course.title}” is archived, so no new course access was created.`);
              return;
            }
            tx.create(enrollmentRefs[i], {
              id: enrollmentRefs[i].id,
              studentId: l.studentId,
              courseId: course.id,
              status: "active",
              enrolledAt: FieldValue.serverTimestamp(),
              enrolledBy: user.uid,
              revokedAt: null,
              revokedBy: null,
              // Fees for this enrollment are billed through packages, not a legacy agreed fee.
              agreedFee: null,
              currency: draft.currency,
              source: "package",
              packageId,
              history: [{ type: "enrolled", at: Timestamp.now(), by: user.uid }],
            });
            accessNotes.push(`${l.name} now has access to “${course.title}”.`);
          } else if (snap.get("status") === "revoked") {
            // A teacher's decision to revoke access is never overridden automatically.
            accessNotes.push(`${l.name}'s access to “${course.title}” is revoked; restore it on the course page if needed.`);
          }
        });
      }
      return { duplicate: false, accessNotes, title: draft.plan.title, priceMinor: draft.priceMinor, confirmation: draft.confirmation };
    });

    if (!outcome.duplicate) {
      await writeAudit(user, {
        action: "package.create",
        targetType: "package",
        targetId: packageId,
        summary: `Assigned ${type} package “${outcome.title}” (${rupees(outcome.priceMinor)}) to ${learners.map((l) => l.name).join(" + ")}${
          "confirmation" in outcome && outcome.confirmation ? ` — confirmed exception: ${outcome.confirmation.reason}` : ""
        }`,
      });
      refresh();
    }
    return { packageId, duplicate: outcome.duplicate, accessNotes: outcome.accessNotes };
  });
}

/**
 * Activates a package that is not fully paid yet. This is an explicit,
 * traceable exception: the reason and the unpaid balance are stored and audited.
 * (Fully paid packages activate automatically when the payment is verified.)
 */
export async function activatePackage(packageId: unknown, reasonInput: unknown): Promise<ActionResult> {
  return runAction("activatePackage", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(packageId)) throw new AccessError("That package could not be found.");
    const reason = cleanText(reasonInput, 300);
    const summary = await db().runTransaction(async (tx) => {
      const data = await readPackageInTx(tx, packageId);
      if (!data) throw new AccessError("That package could not be found.");
      const { pkg, ref } = data;
      if (pkg.status !== "awaiting_payment") throw new AccessError("Only a package that is awaiting payment can be activated.");
      const s = summarizePackage({ priceMinor: pkg.priceMinor, sessionsIncluded: pkg.sessionsIncluded, creditsUsed: pkg.creditsUsed, payments: data.payments, adjustments: data.adjustments });
      if (s.balanceMinor > 0 && !reason) {
        throw new AccessError("Please fix the highlighted fields.", { reason: "Give the reason for activating before full payment." });
      }
      tx.update(ref, {
        status: "active",
        activation: s.balanceMinor > 0 ? { reason, balanceMinor: s.balanceMinor, by: user.uid, byEmail: user.email, at: Timestamp.now() } : null,
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion(
          historyEntry(user, s.balanceMinor > 0 ? `Activated with ${rupees(s.balanceMinor)} unpaid: ${reason}` : "Activated (fully paid)"),
        ),
      });
      return s;
    });
    await writeAudit(user, {
      action: summary.balanceMinor > 0 ? "package.activate_exception" : "package.activate",
      targetType: "package",
      targetId: packageId,
      summary: summary.balanceMinor > 0 ? `Activated before full payment (${rupees(summary.balanceMinor)} unpaid): ${reason}` : "Activated package",
    });
    refresh();
    return null;
  });
}

/** Cancels a package. No refund is implied: any refund is recorded separately as an approved adjustment. */
export async function cancelPackage(packageId: unknown, reasonInput: unknown): Promise<ActionResult> {
  return runAction("cancelPackage", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(packageId)) throw new AccessError("That package could not be found.");
    const reason = cleanText(reasonInput, 300);
    if (!reason) throw new AccessError("Please fix the highlighted fields.", { reason: "Give the reason for cancelling." });
    const ref = col("packages").doc(packageId);
    const title = await db().runTransaction(async (tx) => {
      const [snap, open] = await Promise.all([
        tx.get(ref),
        tx.get(col("liveClasses").where("packageId", "==", packageId)),
      ]);
      if (!snap.exists) throw new AccessError("That package could not be found.");
      if (snap.get("status") === "cancelled") throw new AccessError("This package is already cancelled.");
      if (open.docs.some((d) => d.get("status") === "scheduled")) throw new AccessError("This package still has scheduled classes. Cancel or complete them first.");
      tx.update(ref, {
        status: "cancelled",
        cancelReason: reason,
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: user.uid,
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion(historyEntry(user, `Cancelled: ${reason}`)),
      });
      return String(snap.get("title") ?? "Package");
    });
    await writeAudit(user, { action: "package.cancel", targetType: "package", targetId: packageId, summary: `Cancelled “${title}”: ${reason}` });
    refresh();
    return null;
  });
}

export interface AdjustmentInput {
  kind: unknown;
  amount: unknown;
  credits: unknown;
  paymentId: unknown;
  reason: unknown;
}

/**
 * Records an approved refund, fee waiver or class-credit change. Adjustments
 * are never edited or deleted; a mistake is corrected with another adjustment.
 * No unused-class refund policy is assumed: the teacher records only what was approved.
 */
export async function recordAdjustment(packageId: unknown, input: AdjustmentInput): Promise<ActionResult> {
  return runAction("recordAdjustment", async () => {
    const user = await requireActionUser("teacher");
    if (!isValidId(packageId)) throw new AccessError("That package could not be found.");
    if (!(ADJUSTMENT_KINDS as readonly unknown[]).includes(input?.kind)) throw new AccessError("Please fix the highlighted fields.", { kind: "Choose a type." });
    const kind = input.kind as AdjustmentKind;
    const reason = cleanText(input?.reason, 300);
    const errors: Record<string, string> = {};
    if (!reason) errors.reason = "Give the reason and who approved it.";
    let amountMinor = 0;
    let credits = 0;
    if (kind === "credit") {
      const n = typeof input?.credits === "string" && /^-?\d+$/.test(input.credits.trim()) ? Number(input.credits.trim()) : NaN;
      if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 52) errors.credits = "Enter a whole number of classes to add (e.g. 1) or remove (e.g. -1).";
      else credits = n;
    } else {
      const v = parseRupees(input?.amount);
      if (typeof v !== "number") errors.amount = "Enter an amount greater than zero (up to 2 decimal places).";
      else amountMinor = v;
    }
    const paymentId = kind === "refund" ? (isValidId(input?.paymentId) ? input.paymentId : null) : null;
    if (kind === "refund" && !paymentId) errors.paymentId = "Choose the verified payment being refunded.";
    if (Object.keys(errors).length) throw new AccessError("Please fix the highlighted fields.", errors);

    const summary = await db().runTransaction(async (tx) => {
      const data = await readPackageInTx(tx, packageId);
      if (!data) throw new AccessError("That package could not be found.");
      const { pkg, ref } = data;
      const receiptRef = paymentId ? col("receipts").doc(paymentId) : null;
      const receiptSnap = receiptRef ? await tx.get(receiptRef) : null;

      if (kind === "refund") {
        const payment = data.payments.find((p) => p.id === paymentId);
        if (!payment || !countsAsReceived(payment)) throw new AccessError("Choose a verified, received payment of this package.", { paymentId: "Not a received payment of this package." });
        const alreadyRefunded = data.adjustments.filter((a) => a.kind === "refund" && a.paymentId === paymentId).reduce((s, a) => s + a.amountMinor, 0);
        if (alreadyRefunded + amountMinor > payment.amountMinor) {
          throw new AccessError("Please fix the highlighted fields.", {
            amount: `At most ${rupees(payment.amountMinor - alreadyRefunded)} of this payment can still be refunded.`,
          });
        }
        if (receiptRef && receiptSnap?.exists) {
          const refunded = alreadyRefunded + amountMinor;
          tx.update(receiptRef, {
            refundedMinor: refunded,
            // The receipt is kept for the audit trail and marked, never deleted.
            ...(refunded >= payment.amountMinor ? { status: "refunded" } : {}),
            statusNote: refunded >= payment.amountMinor ? `Refunded in full: ${reason}` : `Partly refunded (${rupees(refunded)}): ${reason}`,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      if (kind === "waiver") {
        const waived = data.adjustments.filter((a) => a.kind === "waiver").reduce((s, a) => s + a.amountMinor, 0);
        if (waived + amountMinor > pkg.priceMinor) throw new AccessError("Please fix the highlighted fields.", { amount: "Waivers cannot exceed the package price." });
      }
      if (kind === "credit" && pkg.sessionsIncluded + pkg.creditAdjustment + credits < pkg.creditsUsed) {
        throw new AccessError("Please fix the highlighted fields.", { credits: "You cannot remove classes that have already been used." });
      }

      const adjustment = { kind, amountMinor, credits, paymentId, reason };
      const after = summarizePackage({
        priceMinor: pkg.priceMinor,
        sessionsIncluded: pkg.sessionsIncluded,
        creditsUsed: pkg.creditsUsed,
        payments: data.payments,
        adjustments: [...data.adjustments, adjustment],
      });
      let status = pkg.status;
      if (status !== "cancelled") {
        status = statusAfterPayment(status, after);
        if (status === "credits_used" && after.creditsRemaining > 0) status = "active";
        status = statusAfterConsumption(status, after.creditsRemaining);
      }

      tx.create(col("billingAdjustments").doc(), {
        packageId,
        paymentId,
        learnerIds: pkg.learnerIds,
        kind,
        amountMinor,
        credits,
        reason,
        approvedBy: user.uid,
        approvedByEmail: user.email,
        at: FieldValue.serverTimestamp(),
      });
      tx.update(ref, {
        ...(kind === "credit" ? { creditAdjustment: FieldValue.increment(credits) } : {}),
        ...(status !== pkg.status ? { status } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        history: FieldValue.arrayUnion(
          historyEntry(user, kind === "credit" ? `Credits ${credits > 0 ? "+" : ""}${credits}: ${reason}` : `${kind === "refund" ? "Refund" : "Waiver"} ${rupees(amountMinor)}: ${reason}`),
        ),
      });
      return { title: pkg.title };
    });
    await writeAudit(user, {
      action: `package.${kind}`,
      targetType: "package",
      targetId: packageId,
      summary: `“${summary.title}”: ${kind === "credit" ? `${credits > 0 ? "+" : ""}${credits} class credit(s)` : `${kind} of ${rupees(amountMinor)}`} — ${reason}`,
    });
    refresh();
    return null;
  });
}
