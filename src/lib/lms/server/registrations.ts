import "server-only";

import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { getPublishedCourseBySlug } from "@/lib/catalog/server";
import { accountIdFor } from "@/lib/lms/class-billing";
import {
  CLASS_TYPES,
  classTypeOf,
  enrolmentRates,
  ENROLMENT_TYPE_LABELS,
  ENROLMENT_TYPES,
  isSharedEnrolment,
  istToday,
  learnerNamesLabel,
  parseRegistrationDetails,
  parseWeeklySchedule,
  registrationId,
  REGISTRATION_STATUSES,
  scheduleLabel,
  type ClassType,
  type EnrolmentType,
  type LearnerProfile,
  type RegistrationDetails,
  type RegistrationStatus,
  type WeeklySchedule,
} from "@/lib/lms/registration";
import { AccessError } from "@/lib/lms/server/access";
import { addMemberTx, mapBatch, sharedAccountFields, type BatchRecord } from "@/lib/lms/server/batches";
import { assertLegacyDuesClearedInTx, initialAgreedRates, mapAccount } from "@/lib/lms/server/class-billing";
import { col, db, mapCourse, toIso } from "@/lib/lms/server/db";
import { enrollmentId } from "@/lib/lms/types";
import type { CourseDetail } from "@/types/course";

// Website registration: one record per student and course
// (registrations/{studentId}_{courseSlug}). It holds the class type, the
// student's details and preferred days/times (requests, not bookings) and the
// state of the INITIAL payment, which is paid through the existing Razorpay
// flow (payment target "registration") and recorded only after server-side
// verification. Teachers then assign a batch (addMemberTx) or confirm an
// individual schedule; billing continues with the existing rules.
//
// Privacy: registrations are server-only (Firestore catch-all deny). Students
// read only their own record; the full details are shown only to teachers.

export interface RegistrationRecord {
  id: string;
  /** "special" = Special Programme (full fee paid once; "paid" means registration confirmed). */
  kind: "regular" | "special";
  studentId: string;
  studentEmail: string | null;
  courseSlug: string;
  courseId: string;
  courseTitle: string;
  mode: ClassType;
  details: RegistrationDetails;
  status: RegistrationStatus;
  /** The student's agreed rate for this course and class type (per class / per session), fixed at registration. */
  rateMinor: number;
  /** The initial payment: one class/session at the agreed rate. */
  initialAmountMinor: number;
  rateVersionId: string;
  paymentId: string | null;
  paidAt: string | null;
  batchId: string | null;
  accountId: string | null;
  /** Individual: the schedule confirmed by the academy. */
  confirmedSchedule: string | null;
  /** Batch – Individual, One-to-One, or Learn Together (shared batch / shared one-to-one). */
  enrolmentType: EnrolmentType;
  /** 1, or 2 for Learn Together (two learners, one login). */
  learnerCount: number;
  /** Per learner per session; rateMinor is the session total (per learner × learners). */
  perLearnerRateMinor: number;
  /** Registered without signing in (the account is created or linked after the verified payment). */
  guest: boolean;
  /** Paid, but an account already existed for the email: waiting for its owner to sign in. */
  linkPending: boolean;
  inviteStatus: "sent" | "not_sent" | null;
  /** Individual: the confirmed weekly schedule and its teacher. */
  weeklySchedule: WeeklySchedule | null;
  scheduleTeacherName: string | null;
  /** Change history (newest last). */
  history: { at: string | null; byEmail: string | null; change: string }[];
  createdAt: string | null;
  updatedAt: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T => ((values as readonly unknown[]).includes(v) ? (v as T) : fallback);

function mapGuardian(g: unknown) {
  const x = g && typeof g === "object" ? (g as Record<string, unknown>) : null;
  return x ? { name: String(x.name ?? ""), relationship: String(x.relationship ?? ""), phone: String(x.phone ?? ""), email: str(x.email) } : null;
}

/** Every learner of the enrolment (older registrations: the single top-level learner). */
function mapLearners(det: Record<string, unknown>): LearnerProfile[] {
  if (Array.isArray(det.learners) && det.learners.length > 0) {
    return det.learners.map((l: Record<string, unknown>) => ({
      fullName: String(l?.fullName ?? ""),
      dateOfBirth: str(l?.dateOfBirth),
      age: typeof l?.age === "number" ? l.age : 0,
      guardian: mapGuardian(l?.guardian),
    }));
  }
  return [{ fullName: String(det.fullName ?? ""), dateOfBirth: str(det.dateOfBirth), age: typeof det.age === "number" ? det.age : 0, guardian: mapGuardian(det.guardian) }];
}

export function mapRegistration(snap: DocumentSnapshot<DocumentData>): RegistrationRecord | null {
  const d = snap.data();
  if (!d) return null;
  const det = (d.details ?? {}) as Record<string, unknown>;
  const g = det.guardian as Record<string, unknown> | null | undefined;
  return {
    id: snap.id,
    studentId: String(d.studentId ?? ""),
    studentEmail: str(d.studentEmail),
    courseSlug: String(d.courseSlug ?? ""),
    courseId: String(d.courseId ?? ""),
    courseTitle: String(d.courseTitle ?? "Course"),
    mode: oneOf(CLASS_TYPES, d.mode, "batch"),
    details: {
      fullName: String(det.fullName ?? ""),
      email: String(det.email ?? ""),
      mobile: String(det.mobile ?? ""),
      dateOfBirth: str(det.dateOfBirth),
      age: typeof det.age === "number" ? det.age : 0,
      address: String(det.address ?? ""),
      guardian: g ? { name: String(g.name ?? ""), relationship: String(g.relationship ?? ""), phone: String(g.phone ?? ""), email: str(g.email) } : null,
      preferredDays: Array.isArray(det.preferredDays) ? (det.preferredDays as RegistrationDetails["preferredDays"]) : [],
      preferredTimes: Array.isArray(det.preferredTimes) ? (det.preferredTimes as RegistrationDetails["preferredTimes"]) : [],
      notes: String(det.notes ?? ""),
      learners: mapLearners(det),
    },
    status: oneOf(REGISTRATION_STATUSES, d.status, "pending_payment"),
    initialAmountMinor: typeof d.initialAmountMinor === "number" ? d.initialAmountMinor : 0,
    // Older registrations: the initial payment equals one class/session at the agreed rate.
    rateMinor: typeof d.rateMinor === "number" ? d.rateMinor : typeof d.initialAmountMinor === "number" ? d.initialAmountMinor : 0,
    rateVersionId: String(d.rateVersionId ?? ""),
    paymentId: str(d.paymentId),
    paidAt: toIso(d.paidAt),
    batchId: str(d.batchId),
    accountId: str(d.accountId),
    confirmedSchedule: str(d.confirmedSchedule),
    // Registrations saved before enrolment types were their class type with one learner.
    enrolmentType: oneOf(ENROLMENT_TYPES, d.enrolmentType, d.mode === "individual" ? "individual" : "batch"),
    learnerCount: d.learnerCount === 2 ? 2 : 1,
    perLearnerRateMinor:
      typeof d.perLearnerRateMinor === "number" ? d.perLearnerRateMinor : typeof d.rateMinor === "number" ? d.rateMinor : typeof d.initialAmountMinor === "number" ? d.initialAmountMinor : 0,
    // Older registrations have no kind: Regular Academy Course.
    kind: d.kind === "special" ? "special" : "regular",
    guest: d.guest === true,
    linkPending: d.linkPending === true,
    inviteStatus: d.inviteStatus === "sent" || d.inviteStatus === "not_sent" ? d.inviteStatus : null,
    weeklySchedule: d.weeklySchedule ? parseWeeklySchedule(d.weeklySchedule as { days: unknown; start: unknown; end: unknown }).value : null,
    scheduleTeacherName: str(d.scheduleTeacherName),
    history: Array.isArray(d.history)
      ? d.history.map((h: Record<string, unknown>) => ({ at: toIso(h.at), byEmail: str(h.byEmail), change: String(h.change ?? "") }))
      : [],
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}

const entry = (actor: SessionUser, change: string) => ({ at: Timestamp.now(), by: actor.uid, byEmail: actor.email, change });

/** The publicly listed course a student may register for, or an AccessError (checked on the server, never from the form). */
export async function openCourseForRegistration(slug: unknown): Promise<CourseDetail> {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)) throw new AccessError("That course could not be found.");
  const result = await getPublishedCourseBySlug(slug);
  if (!result.ok) throw new Error("Course catalogue unavailable");
  if (!result.data) throw new AccessError("That course could not be found.");
  if (result.data.availability === "closed") throw new AccessError(`${result.data.title} is closed for new enrolments.`);
  if (result.data.availability !== "open") throw new AccessError(`${result.data.title} is coming soon and not yet open for enrolment.`);
  return result.data;
}

/**
 * Creates or updates the signed-in student's registration while its initial
 * payment is still awaited. One record per student and course: once paid, the
 * class type and details cannot change (no duplicate enrolment or payment).
 */
export async function saveRegistration(
  user: SessionUser,
  input: { slug: unknown; mode: unknown; details: unknown },
  nowIso = new Date().toISOString(),
): Promise<{ registrationId: string; outcome: "created" | "updated"; initialAmountMinor: number }> {
  if (user.role !== "student") throw new AccessError("Only student accounts can enrol in a course.");
  const course = await openCourseForRegistration(input?.slug);
  const priced = priceEnrolment(course, input?.mode);
  // The login email is always the signed-in account's (one login, also for Learn Together).
  const raw = { ...((input?.details ?? {}) as Record<string, unknown>), ...(user.email ? { email: user.email } : {}) };
  const { value: details, errors } = parseRegistrationDetails(raw, istToday(nowIso), { shared: isSharedEnrolment(priced.enrolmentType), fixedSchedule: priced.special });
  if (!details) throw new AccessError("Please fix the highlighted fields.", errors);
  const ref = col("registrations").doc(registrationId(user.uid, course.slug));
  if (priced.special) await assertProgrammePlace(course, ref.id);
  const accountRefs = (["batch", "individual"] as const).map((m) => col("billingAccounts").doc(accountIdFor(user.uid, course.id, m)));

  // A paid guest registration already linked to this account counts too (no duplicate enrolment).
  const linkedPaid = (await col("registrations").where("studentId", "==", user.uid).get()).docs
    .map(mapRegistration)
    .some((x) => x !== null && x.id !== ref.id && x.courseSlug === course.slug && x.status !== "pending_payment" && x.status !== "cancelled");
  if (linkedPaid) throw new AccessError("You have already registered and paid for this course. Your registration status is on your dashboard.");
  return db().runTransaction(async (tx) => {
    const [existing, ...accounts] = await Promise.all([tx.get(ref), ...accountRefs.map((r) => tx.get(r))]);
    if (accounts.map(mapAccount).some((a) => a && a.status === "active")) {
      throw new AccessError("You are already enrolled in this course. Your classes and fees are on your dashboard.");
    }
    const current = mapRegistration(existing);
    if (current && current.status !== "pending_payment" && current.status !== "cancelled") {
      throw new AccessError("You have already registered and paid for this course. Your registration status is on your dashboard.");
    }
    const fields = { studentId: user.uid, studentEmail: user.email ?? null, ...registrationPricingFields(course, priced), details, status: "pending_payment" satisfies RegistrationStatus, paymentId: null, paidAt: null, batchId: null, accountId: null, confirmedSchedule: null, updatedAt: FieldValue.serverTimestamp() };
    const change = priced.special
      ? `${current ? "Updated" : "Submitted"} programme registration; full fee ₹${priced.sessionMinor / 100} awaited`
      : `${current ? "Updated" : "Submitted"} registration (${ENROLMENT_TYPE_LABELS[priced.enrolmentType]}); initial payment ₹${priced.sessionMinor / 100} awaited`;
    if (current) {
      tx.update(ref, { ...fields, history: FieldValue.arrayUnion(entry(user, change)) });
      return { registrationId: ref.id, outcome: "updated" as const, initialAmountMinor: priced.sessionMinor };
    }
    tx.create(ref, { ...fields, createdAt: FieldValue.serverTimestamp(), history: [entry(user, change)] });
    return { registrationId: ref.id, outcome: "created" as const, initialAmountMinor: priced.sessionMinor };
  });
}

export interface PricedEnrolment {
  enrolmentType: EnrolmentType;
  mode: ClassType;
  perLearnerMinor: number;
  learnerCount: number;
  /** One session for the whole enrolment (= the initial payment); Special Programme: the full fee. */
  sessionMinor: number;
  /** Special Programme: one full payment, no billing account and no monthly invoice. */
  special: boolean;
}

/**
 * The server-side price of an enrolment type for a course (never from the
 * browser). The class type must be offered by the course; individual types use
 * the course's own rate, Learn Together the fixed shared rates.
 */
export function priceEnrolment(course: CourseDetail, typeInput: unknown): PricedEnrolment {
  // Special Programme: the full programme fee, one payment, one learner (the enrolment type is not used).
  if (course.programme) {
    const fee = course.programme.feeMinor;
    if (!Number.isSafeInteger(fee) || fee <= 0) throw new AccessError("This programme has no fee set yet.");
    return { enrolmentType: "batch", mode: "batch", perLearnerMinor: fee, learnerCount: 1, sessionMinor: fee, special: true };
  }
  // "batch" / "individual" (older callers) are the individual enrolment types.
  if (!(ENROLMENT_TYPES as readonly unknown[]).includes(typeInput)) {
    throw new AccessError("Please fix the highlighted fields.", { mode: "Choose Batch – Individual, One-to-One or Learn Together." });
  }
  const enrolmentType = typeInput as EnrolmentType;
  const mode = classTypeOf(enrolmentType);
  const courseRate = mode === "batch" ? course.fee?.batchMinor : course.fee?.individualMinor;
  if (typeof courseRate !== "number" || courseRate <= 0) {
    throw new AccessError("Please fix the highlighted fields.", { mode: `${mode === "batch" ? "Batch" : "One-to-one"} classes are not offered for this course.` });
  }
  return { enrolmentType, mode, ...enrolmentRates(enrolmentType, courseRate), special: false };
}

/** The pricing fields stored on a registration (the agreed rate is per SESSION for the whole enrolment). */
export function registrationPricingFields(course: CourseDetail, priced: PricedEnrolment) {
  return {
    courseSlug: course.slug,
    courseId: course.id,
    courseTitle: course.title,
    mode: priced.mode,
    enrolmentType: priced.enrolmentType,
    learnerCount: priced.learnerCount,
    perLearnerRateMinor: priced.perLearnerMinor,
    rateMinor: priced.sessionMinor,
    initialAmountMinor: priced.sessionMinor,
    rateVersionId: priced.special ? "programme" : isSharedEnrolment(priced.enrolmentType) ? "shared" : `course:${course.id}`,
    kind: priced.special ? "special" : "regular",
    ...(priced.special ? { programmeFeeMinor: priced.sessionMinor } : {}),
  };
}

/**
 * Special Programme with a participant limit: refuses a new registration once the
 * confirmed (paid) registrations reach it. Checked when registering (a payment
 * already made is never refused).
 */
export async function assertProgrammePlace(course: CourseDetail, ownRegistrationId: string): Promise<void> {
  const max = course.programme?.maxParticipants ?? null;
  if (max === null) return;
  const paid = await col("registrations").where("courseId", "==", course.id).where("status", "==", "paid").get();
  const taken = paid.docs.filter((d) => d.id !== ownRegistrationId).length;
  if (taken >= max) throw new AccessError(`${course.title} is full.`);
}

/**
 * The signed-in student's own registration for one course (bound to user.uid):
 * the one made while signed in, else a guest registration linked to this account.
 */
export async function getOwnRegistration(user: SessionUser, slug: string): Promise<RegistrationRecord | null> {
  if (user.role !== "student" || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const r = mapRegistration(await col("registrations").doc(registrationId(user.uid, slug)).get());
  if (r && r.studentId === user.uid) return r;
  const linked = (await col("registrations").where("studentId", "==", user.uid).get()).docs
    .map(mapRegistration)
    .filter((x): x is RegistrationRecord => x !== null && x.studentId === user.uid && x.courseSlug === slug && x.status !== "cancelled");
  return linked[0] ?? null;
}

export async function listOwnRegistrations(user: SessionUser): Promise<RegistrationRecord[]> {
  if (user.role !== "student") return [];
  const snap = await col("registrations").where("studentId", "==", user.uid).get();
  return snap.docs
    .map(mapRegistration)
    .filter((r): r is RegistrationRecord => r !== null && r.studentId === user.uid)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

// --- Teacher / administrator -------------------------------------------------------------------------------

function assertTeacher(user: SessionUser) {
  if (user.role !== "teacher") throw new AccessError("Only the academy can view registrations.");
}

export async function listRegistrations(user: SessionUser): Promise<RegistrationRecord[]> {
  assertTeacher(user);
  const rank: Record<RegistrationStatus, number> = { paid: 0, pending_payment: 1, assigned: 2, scheduled: 2, cancelled: 3 };
  return (await col("registrations").get()).docs
    .map(mapRegistration)
    .filter((r): r is RegistrationRecord => r !== null)
    .sort((a, b) => rank[a.status] - rank[b.status] || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export interface RegistrationDetail {
  registration: RegistrationRecord;
  /** Active batches of the registration's course with room (assignment candidates). */
  batches: (BatchRecord & { full: boolean })[];
  batch: BatchRecord | null;
  /** Whether the course exists in the dashboard (needed to place the student). */
  courseInDashboard: boolean;
}

export async function getRegistrationDetail(user: SessionUser, id: string): Promise<RegistrationDetail | null> {
  assertTeacher(user);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return null;
  const registration = mapRegistration(await col("registrations").doc(id).get());
  if (!registration) return null;
  const courseSnap = await col("courses").where("slug", "==", registration.courseSlug).limit(1).get();
  const courseId = courseSnap.empty ? null : courseSnap.docs[0].id;
  const batchesSnap = courseId ? await col("batches").where("courseId", "==", courseId).get() : null;
  const batches = (batchesSnap?.docs ?? [])
    .map(mapBatch)
    .filter((b): b is BatchRecord => b !== null && b.status === "active")
    .map((b) => ({ ...b, full: b.memberCount >= b.capacity }));
  const batch = registration.batchId ? mapBatch(await col("batches").doc(registration.batchId).get()) : null;
  return { registration, batches, batch, courseInDashboard: courseId !== null };
}

/** Assigns a paid batch registration to a batch (all checks in one transaction: see addMemberTx). */
export async function assignRegistrationToBatch(user: SessionUser, id: unknown, batchId: unknown) {
  assertTeacher(user);
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new AccessError("That registration could not be found.");
  if (typeof batchId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(batchId)) throw new AccessError("Please fix the highlighted fields.", { batchId: "Choose a batch." });
  const registration = mapRegistration(await col("registrations").doc(id).get());
  if (!registration) throw new AccessError("That registration could not be found.");
  if (!registration.studentId) throw new AccessError("The student's account is not linked yet (a guest registration waiting for the student to sign in). Try again once it is linked.");
  return addMemberTx(user, batchId, { uid: registration.studentId, name: learnerNamesLabel(registration.details.learners.map((l) => l.fullName)) || "Student" }, { registrationId: id });
}

/**
 * Confirms an individual registration's weekly schedule: creates (or restores)
 * the course enrolment and the individual billing account, whose verified
 * initial payment pays the first scheduled session. Individual students are
 * never put in a batch.
 */
/** The teacher an individual schedule is assigned to (must be an academy account). */
async function resolveScheduleTeacher(user: SessionUser, teacherId: unknown): Promise<{ uid: string; name: string }> {
  if (teacherId === undefined || teacherId === null || teacherId === "") return { uid: user.uid, name: user.name ?? user.email ?? "Teacher" };
  if (typeof teacherId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(teacherId)) throw new AccessError("Please fix the highlighted fields.", { teacherId: "Choose a teacher." });
  const snap = await col("users").doc(teacherId).get();
  if (!snap.exists || snap.get("role") !== "teacher") throw new AccessError("Please fix the highlighted fields.", { teacherId: "Choose a teacher from the list." });
  return { uid: snap.id, name: String(snap.get("displayName") ?? snap.get("email") ?? "Teacher") };
}

export async function confirmIndividualSchedule(user: SessionUser, id: unknown, input: { days: unknown; start: unknown; end: unknown; note: unknown; teacherId?: unknown }) {
  assertTeacher(user);
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new AccessError("That registration could not be found.");
  const { value: weekly, errors } = parseWeeklySchedule(input);
  if (!weekly) throw new AccessError("Please fix the highlighted fields.", errors);
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";
  const scheduleTeacher = await resolveScheduleTeacher(user, input.teacherId);
  const ref = col("registrations").doc(id);
  return db().runTransaction(async (tx) => {
    // ---- reads ----
    const registration = mapRegistration(await tx.get(ref));
    if (!registration) throw new AccessError("That registration could not be found.");
    if (registration.kind === "special") throw new AccessError("This is a Special Programme registration: it is confirmed by its payment and needs no schedule.");
    if (registration.mode !== "individual") throw new AccessError("This is a batch registration. Assign it to a batch instead.");
    if (!registration.studentId) throw new AccessError("The student's account is not linked yet (a guest registration waiting for the student to sign in). Try again once it is linked.");
    if (registration.status !== "paid") {
      throw new AccessError(registration.status === "pending_payment" ? "The initial payment has not been verified yet." : "This registration has already been scheduled.");
    }
    const courseSnap = await tx.get(col("courses").where("slug", "==", registration.courseSlug).limit(1));
    const course = courseSnap.empty ? null : mapCourse(courseSnap.docs[0]);
    if (!course) throw new AccessError("Create this course in the dashboard (same web address) before confirming the schedule.");
    await assertLegacyDuesClearedInTx(tx, registration.studentId);
    const enrollmentRef = col("enrollments").doc(enrollmentId(course.id, registration.studentId));
    const accountRef = col("billingAccounts").doc(accountIdFor(registration.studentId, course.id, "individual"));
    const paymentRef = registration.paymentId ? col("payments").doc(registration.paymentId) : null;
    const [enrollmentSnap, accountSnap, paymentSnap] = await Promise.all([tx.get(enrollmentRef), tx.get(accountRef), paymentRef ? tx.get(paymentRef) : Promise.resolve(null)]);
    const account = mapAccount(accountSnap);
    if (account?.status === "closed") throw new AccessError("This student's individual billing account for the course is closed.");

    // ---- writes ----
    const now = FieldValue.serverTimestamp();
    const prepaid = { status: "verified" as const, amountMinor: registration.initialAmountMinor, appliedMinor: 0, paymentId: registration.paymentId };
    if (!enrollmentSnap.exists || enrollmentSnap.get("status") !== "active") {
      tx.set(
        enrollmentRef,
        {
          id: enrollmentRef.id,
          studentId: registration.studentId,
          courseId: course.id,
          status: "active",
          enrolledAt: enrollmentSnap.exists ? enrollmentSnap.get("enrolledAt") ?? now : now,
          enrolledBy: user.uid,
          revokedAt: null,
          revokedBy: null,
          agreedFee: null,
          currency: "INR",
          registrationId: id,
          history: FieldValue.arrayUnion({ type: enrollmentSnap.exists ? "restored" : "enrolled", at: Timestamp.now(), by: user.uid }),
        },
        { merge: true },
      );
    }
    if (!account) {
      tx.create(accountRef, {
        studentId: registration.studentId,
        courseId: course.id,
        mode: "individual",
        status: "active",
        batchId: null,
        studentName: learnerNamesLabel(registration.details.learners.map((l) => l.fullName)) || registration.details.fullName || "Student",
        courseTitle: course.title,
        advance: prepaid,
        // The rate agreed at registration, fixed from now on (course price changes never alter it).
        agreedRates: initialAgreedRates(registration.rateMinor || registration.initialAmountMinor),
        // Learn Together: one account for both learners (names and per-learner rate shown on invoices).
        ...sharedAccountFields(registration as unknown as Record<string, unknown>, registration.details.learners.map((l) => l.fullName)),
        suspension: { active: false, since: null, invoiceIds: [], liftedAt: null },
        billableCount: 0,
        createdAt: now,
        createdBy: user.uid,
        history: [entry(user, "Individual account opened from the website registration (initial payment covers the first session)")],
      });
    } else if (account.advance.status === "not_required" || account.advance.status === "awaiting") {
      // Never overwrite an initial payment already received or deducted on an invoice.
      tx.update(accountRef, { advance: prepaid, history: FieldValue.arrayUnion(entry(user, "Initial payment from the website registration covers the first session")) });
    }
    if (paymentSnap?.exists) tx.update(paymentRef!, { accountId: accountRef.id, courseId: course.id, updatedAt: now });
    const confirmed = `${scheduleLabel(weekly as WeeklySchedule)}${note ? ` — ${note}` : ""}`;
    tx.update(ref, {
      status: "scheduled",
      courseId: course.id,
      accountId: accountRef.id,
      confirmedSchedule: confirmed,
      weeklySchedule: weekly,
      scheduleTeacherId: scheduleTeacher.uid,
      scheduleTeacherName: scheduleTeacher.name,
      scheduledAt: now,
      updatedAt: now,
      history: FieldValue.arrayUnion(entry(user, `Individual schedule confirmed: ${confirmed} (teacher ${scheduleTeacher.name})`)),
    });
    return { accountId: accountRef.id, schedule: confirmed };
  });
}

/**
 * Changes a confirmed individual schedule (day, time or teacher). The change is
 * recorded in the registration history; billing is unaffected (sessions are
 * billed from what is actually held).
 */
export async function updateIndividualSchedule(user: SessionUser, id: unknown, input: { days: unknown; start: unknown; end: unknown; note: unknown; teacherId?: unknown }) {
  assertTeacher(user);
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new AccessError("That registration could not be found.");
  const { value: weekly, errors } = parseWeeklySchedule(input);
  if (!weekly) throw new AccessError("Please fix the highlighted fields.", errors);
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";
  const scheduleTeacher = await resolveScheduleTeacher(user, input.teacherId);
  const ref = col("registrations").doc(id);
  return db().runTransaction(async (tx) => {
    const registration = mapRegistration(await tx.get(ref));
    if (!registration) throw new AccessError("That registration could not be found.");
    if (registration.mode !== "individual" || registration.status !== "scheduled") throw new AccessError("Only a confirmed individual schedule can be changed.");
    const confirmed = `${scheduleLabel(weekly)}${note ? ` — ${note}` : ""}`;
    tx.update(ref, {
      confirmedSchedule: confirmed,
      weeklySchedule: weekly,
      scheduleTeacherId: scheduleTeacher.uid,
      scheduleTeacherName: scheduleTeacher.name,
      updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion(entry(user, `Schedule changed from "${registration.confirmedSchedule ?? "—"}" to "${confirmed}" (teacher ${scheduleTeacher.name})`)),
    });
    return { schedule: confirmed, previous: registration.confirmedSchedule };
  });
}
