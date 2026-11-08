import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { nextPeriod, periodLabel, periodOf, rateVersionForPeriod } from "@/lib/lms/class-billing";
import { effectiveCoursePricing, existingRateChangeError, MAX_COURSE_PRICE_RUPEES, parseCoursePricing, type CoursePricing } from "@/lib/lms/course-pricing";
import { AccessError } from "@/lib/lms/server/access";
import { getClassBillingConfig, mapAccount } from "@/lib/lms/server/class-billing";
import { col, db, toIso } from "@/lib/lms/server/db";
import type { CourseRecord } from "@/lib/lms/types";
import { cleanText } from "@/lib/lms/validation";

// Course-specific pricing (Teacher → Course → Classes & pricing).
//
// * The course price applies to NEW students: each student's rate is fixed on
//   their billing account when they are placed (their "agreed rate").
// * Changing the rate of students who are ALREADY enrolled is a separate,
//   explicit, approved action: written reason + confirmation, from a future
//   month (classes already held keep their recorded rate; issued invoices are
//   never recalculated), recorded with the approving teacher.
// * Every change is kept in the course's pricingHistory (and the audit log, by the action).

type Actor = Pick<SessionUser, "uid" | "email" | "role">;

function assertTeacher(user: Actor) {
  if (user.role !== "teacher") throw new AccessError("Only the academy can change course prices.");
}

/** Saves a course's class types and prices for NEW students. Returns the parsed pricing and whether prices existed before. */
export async function saveCoursePricing(user: Actor, courseId: string, input: Record<string, unknown>) {
  assertTeacher(user);
  const { value, errors } = parseCoursePricing(input ?? {});
  if (!value) throw new AccessError("Please fix the highlighted fields.", errors);
  const ref = col("courses").doc(courseId);
  const hadPricing = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AccessError("That course could not be found.");
    const old = (snap.get("pricing") ?? null) as Record<string, unknown> | null;
    tx.update(ref, {
      pricing: { ...value, updatedAt: Timestamp.now(), updatedBy: user.uid },
      pricingHistory: FieldValue.arrayUnion({
        at: Timestamp.now(),
        by: user.uid,
        byEmail: user.email,
        scope: "new_students",
        from: old ? { batchMinor: old.batchEnabled ? (old.batchMinor ?? null) : null, individualMinor: old.individualEnabled ? (old.individualMinor ?? null) : null } : null,
        to: { batchMinor: value.batchMinor, individualMinor: value.individualMinor },
        effectiveFrom: new Date().toISOString(),
        note: "Applies to students who enrol from now on. Enrolled students keep their agreed rate.",
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return old !== null;
  });
  return { pricing: value, hadPricing };
}

/**
 * An approved rate change for students ALREADY enrolled in a course (one class
 * type), from a future month: each active account gets a new dated entry in its
 * agreed-rate history. Charges already recorded and invoices already issued keep
 * their amounts.
 */
export async function changeEnrolledRates(
  user: Actor,
  courseId: string,
  input: { mode: unknown; rate: unknown; effectiveFrom: unknown; reason: unknown; confirm: unknown },
  nowIso = new Date().toISOString(),
): Promise<{ accounts: number; mode: "batch" | "individual"; rateMinor: number; effectiveFrom: string; reason: string }> {
  assertTeacher(user);
  const errors: Record<string, string> = {};
  const mode = input?.mode === "batch" || input?.mode === "individual" ? input.mode : null;
  if (!mode) errors.mode = "Choose batch or individual.";
  const text = typeof input?.rate === "number" ? String(input.rate) : typeof input?.rate === "string" ? input.rate.trim() : "";
  const rateMinor = /^\d{1,6}(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : 0;
  if (!(rateMinor > 0 && rateMinor <= MAX_COURSE_PRICE_RUPEES * 100)) errors.rate = "Enter the new rate in rupees (more than ₹0).";
  const reason = cleanText(input?.reason, 300);
  if (reason.length < 5) errors.reason = "Give the reason for changing enrolled students' rate.";
  if (input?.confirm !== true && input?.confirm !== "on") errors.confirm = "Confirm that you approve this change for enrolled students.";
  const currentPeriod = periodOf(nowIso);
  const periodError = existingRateChangeError(input?.effectiveFrom, currentPeriod, []);
  if (periodError) errors.effectiveFrom = periodError;
  if (Object.keys(errors).length || !mode) throw new AccessError("Please fix the highlighted fields.", errors);
  const effectiveFrom = input.effectiveFrom as string;

  const accountRefs = (await col("billingAccounts").where("courseId", "==", courseId).get()).docs
    .map(mapAccount)
    .filter((a) => a !== null && a.mode === mode && a.status === "active")
    .map((a) => col("billingAccounts").doc(a!.id));
  if (accountRefs.length === 0) throw new AccessError(`No student is enrolled for ${mode} classes in this course.`);

  const accounts = await db().runTransaction(async (tx) => {
    const list = (await tx.getAll(...accountRefs)).map(mapAccount).filter((a) => a !== null);
    for (const a of list) {
      const problem = existingRateChangeError(effectiveFrom, currentPeriod, a!.agreedRates);
      if (problem) throw new AccessError(`${a!.studentName}: ${problem}`);
    }
    const at = Timestamp.now();
    for (const a of list) {
      tx.update(col("billingAccounts").doc(a!.id), {
        agreedRates: FieldValue.arrayUnion({ effectiveFrom, rateMinor, approvedBy: user.uid, approvedByEmail: user.email, at, reason }),
        history: FieldValue.arrayUnion({ at, by: user.uid, byEmail: user.email, change: `Agreed rate ₹${rateMinor / 100} from ${periodLabel(effectiveFrom)} (approved: ${reason})` }),
      });
    }
    tx.update(col("courses").doc(courseId), {
      pricingHistory: FieldValue.arrayUnion({
        at,
        by: user.uid,
        byEmail: user.email,
        approvedBy: user.uid,
        approvedByEmail: user.email,
        scope: "existing_students",
        mode,
        to: { rateMinor },
        effectiveFrom,
        accounts: list.length,
        note: reason,
      }),
    });
    return list.length;
  });
  return { accounts, mode, rateMinor, effectiveFrom, reason };
}

export interface PricingHistoryEntry {
  at: string | null;
  byEmail: string | null;
  scope: "new_students" | "existing_students";
  mode: "batch" | "individual" | null;
  batchMinor: number | null;
  individualMinor: number | null;
  rateMinor: number | null;
  effectiveFrom: string;
  note: string;
}

const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/** Teacher view of a course's pricing: effective prices, enrolled counts and the change history. */
export async function getCoursePricingOverview(user: SessionUser, course: CourseRecord) {
  if (user.role !== "teacher") throw new Error("Teacher role required");
  const nowIso = new Date().toISOString();
  const [config, snap, accountsSnap] = await Promise.all([
    getClassBillingConfig(),
    col("courses").doc(course.id).get(),
    col("billingAccounts").where("courseId", "==", course.id).get(),
  ]);
  const version = rateVersionForPeriod(config.rateVersions, periodOf(nowIso));
  const pricing: CoursePricing = effectiveCoursePricing(course.storedPricing, version);
  const accounts = accountsSnap.docs.map(mapAccount).filter((a) => a !== null && a.status === "active");
  const raw = snap.get("pricingHistory");
  const history: PricingHistoryEntry[] = (Array.isArray(raw) ? raw : [])
    .map((h: Record<string, unknown>) => {
      const to = (h.to ?? {}) as Record<string, unknown>;
      return {
        at: toIso(h.at),
        byEmail: typeof h.byEmail === "string" ? h.byEmail : null,
        scope: h.scope === "existing_students" ? ("existing_students" as const) : ("new_students" as const),
        mode: h.mode === "batch" || h.mode === "individual" ? (h.mode as "batch" | "individual") : null,
        batchMinor: num(to.batchMinor),
        individualMinor: num(to.individualMinor),
        rateMinor: num(to.rateMinor),
        effectiveFrom: typeof h.effectiveFrom === "string" ? h.effectiveFrom : "",
        note: typeof h.note === "string" ? h.note : "",
      };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  // A change for enrolled students may start from next month at the earliest.
  let m = periodOf(nowIso);
  const months = Array.from({ length: 6 }, () => {
    m = nextPeriod(m);
    return { value: m, label: periodLabel(m) };
  });
  return {
    pricing,
    saved: course.storedPricing !== null,
    enrolled: { batch: accounts.filter((a) => a!.mode === "batch").length, individual: accounts.filter((a) => a!.mode === "individual").length },
    history,
    months,
  };
}
