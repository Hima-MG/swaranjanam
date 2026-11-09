// Website registration (enrolment) and weekly schedules — PURE rules.
//
// No runtime imports: unit-tested and safe in Client Components (early form
// feedback). The server re-validates everything (lib/lms/server/registrations.ts).
//
// Flow: a signed-in student picks an OPEN course and a class type, gives their
// details and preferred days/times (requests, not bookings), and pays the
// initial amount through the existing Razorpay flow:
//   * batch:      ₹400 = the first-class payment (pays the first eligible class);
//   * individual: ₹750 = the first individual session.
//   Both are deducted on the monthly invoice that lists that class/session —
//   never charged twice; later classes are invoiced per calendar month.
// After the server has verified the payment, a teacher assigns a batch (batch)
// or confirms the schedule (individual).

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const CLASS_TYPES = ["batch", "individual"] as const;
export type ClassType = (typeof CLASS_TYPES)[number];
export const CLASS_TYPE_LABELS: Record<ClassType, string> = {
  batch: "Batch classes",
  individual: "Individual classes",
};

// --- Enrolment types (fixed academy pricing rules) -----------------------------------------------------
//
//   batch              Batch – Individual          1 learner   the course's batch rate (₹400)
//   individual         One-to-One                  1 learner   the course's individual rate (₹750)
//   shared_batch       Learn Together – Batch      2 learners  ₹360 per learner = ₹720 per session
//   shared_individual  Learn Together – One-to-One 2 learners  ₹700 per learner = ₹1,400 per session
// Learn Together = two learners under ONE student login and dashboard, one enrolment,
// one billing account and one invoice (both names shown). They take two places in a batch.

export const ENROLMENT_TYPES = ["batch", "individual", "shared_batch", "shared_individual"] as const;
export type EnrolmentType = (typeof ENROLMENT_TYPES)[number];
export const ENROLMENT_TYPE_LABELS: Record<EnrolmentType, string> = {
  batch: "Batch – Individual",
  individual: "One-to-One",
  shared_batch: "Learn Together – Batch",
  shared_individual: "Learn Together – One-to-One",
};
export const SHARED_LEARNER_COUNT = 2;
/** Learn Together, per learner per session (paise): the academy's confirmed default; each course can set its own (course pricing). */
export const SHARED_RATES = { batchMinor: 36_000, individualMinor: 70_000 } as const;

export function isSharedEnrolment(type: EnrolmentType): boolean {
  return type === "shared_batch" || type === "shared_individual";
}

/** The class type a teacher schedules: batch classes or one-to-one sessions. */
export function classTypeOf(type: EnrolmentType): ClassType {
  return type === "batch" || type === "shared_batch" ? "batch" : "individual";
}

/**
 * Server-side price of one session for an enrolment type: the per-learner rate
 * and the session total (per-learner × learners). Individual types use the
 * course's own rate; Learn Together the course's own shared rate (per learner),
 * or the academy's confirmed shared rate when the course has none.
 */
export function enrolmentRates(
  type: EnrolmentType,
  courseRateMinor: number,
  sharedRateMinor?: number | null,
): { perLearnerMinor: number; learnerCount: number; sessionMinor: number } {
  const shared = isSharedEnrolment(type);
  const fallback = classTypeOf(type) === "batch" ? SHARED_RATES.batchMinor : SHARED_RATES.individualMinor;
  const perLearnerMinor = shared ? (typeof sharedRateMinor === "number" && sharedRateMinor > 0 ? sharedRateMinor : fallback) : courseRateMinor;
  const learnerCount = shared ? SHARED_LEARNER_COUNT : 1;
  return { perLearnerMinor, learnerCount, sessionMinor: perLearnerMinor * learnerCount };
}

/** "Anu & Balu" (or the single name). */
export function learnerNamesLabel(names: readonly string[]): string {
  return names.filter(Boolean).join(" & ");
}

export const REGISTRATION_STATUSES = ["pending_payment", "paid", "assigned", "scheduled", "cancelled"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** What the student and the academy see. */
export function registrationStatusLabel(status: RegistrationStatus, mode: ClassType, kind: "regular" | "special" = "regular"): string {
  if (kind === "special") return status === "paid" ? "Paid — Registration confirmed" : status === "pending_payment" ? "Awaiting full payment" : "Cancelled";
  switch (status) {
    case "pending_payment":
      return "Awaiting payment";
    case "paid":
      return mode === "batch" ? "Paid — Awaiting Batch Assignment" : "Paid — Awaiting Schedule Confirmation";
    case "assigned": // batch assigned by the teacher
    case "scheduled": // individual schedule confirmed by the teacher
      return "Active — Schedule Confirmed";
    case "cancelled":
      return "Cancelled";
  }
}

export const registrationId = (studentId: string, courseSlug: string) => `${studentId}_${courseSlug}`;

// --- Times and weekly schedules (IST) -------------------------------------------------------------

const IST_MS = (5 * 60 + 30) * 60 * 1000;

/** Today's date in IST ("YYYY-MM-DD"), from a server timestamp. */
export function istToday(nowIso: string): string {
  return new Date(Date.parse(nowIso) + IST_MS).toISOString().slice(0, 10);
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME.test(value);
}

/** "19:00" → 1140 minutes after midnight. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface WeeklySchedule extends TimeRange {
  days: Weekday[];
}

/** "Tuesday & Saturday, 19:00–20:00 IST". */
export function scheduleLabel(s: WeeklySchedule): string {
  const days = WEEKDAYS.filter((d) => s.days.includes(d)).map((d) => WEEKDAY_LABELS[d]);
  const list = days.length <= 1 ? days.join("") : `${days.slice(0, -1).join(", ")} & ${days[days.length - 1]}`;
  return `${list}, ${s.start}–${s.end} IST`;
}

/** Two weekly schedules clash when they share a day and their times overlap (touching end/start is fine). */
export function schedulesConflict(a: WeeklySchedule, b: WeeklySchedule): boolean {
  if (!a.days.some((d) => b.days.includes(d))) return false;
  return minutesOf(a.start) < minutesOf(b.end) && minutesOf(b.start) < minutesOf(a.end);
}

function days(value: unknown): { days: Weekday[]; ok: boolean } {
  const raw = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  const picked = WEEKDAYS.filter((d) => raw.includes(d));
  return { days: picked, ok: raw.every((v) => (WEEKDAYS as readonly unknown[]).includes(v)) };
}

/** A batch's weekly class days and times (all three required). */
export function parseWeeklySchedule(input: { days: unknown; start: unknown; end: unknown }): { value: WeeklySchedule | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const d = days(input.days);
  if (!d.ok || d.days.length === 0) errors.days = "Choose at least one class day.";
  if (!isTime(input.start)) errors.startTime = "Enter a start time (IST).";
  if (!isTime(input.end)) errors.endTime = "Enter an end time (IST).";
  if (!errors.startTime && !errors.endTime && minutesOf(input.start as string) >= minutesOf(input.end as string)) errors.endTime = "The end time must be after the start time.";
  if (Object.keys(errors).length) return { value: null, errors };
  return { value: { days: d.days, start: input.start as string, end: input.end as string }, errors };
}

// --- Student details --------------------------------------------------------------------------------

export const REGISTRATION_LIMITS = { name: 100, address: 300, notes: 500, phone: 20, email: 200, relationship: 40, maxTimes: 6 } as const;
export const ADULT_AGE = 18;
const MIN_AGE = 3;
const MAX_AGE = 100;

export interface GuardianDetails {
  name: string;
  relationship: string;
  phone: string;
  email: string | null;
}

/** One learner of an enrolment (an individual enrolment has one; Learn Together has two). */
export interface LearnerProfile {
  fullName: string;
  /** "YYYY-MM-DD", or null when only the age was given. */
  dateOfBirth: string | null;
  age: number;
  /** Required for learners under 18. */
  guardian: GuardianDetails | null;
}

export interface RegistrationDetails {
  /** Learner 1 (kept at the top level for every enrolment type). */
  fullName: string;
  /** The login email: the ONE student account (shared by both learners in Learn Together). Lower-case. */
  email: string;
  /** Mobile number with country code, E.164 (e.g. "+919847000000"). */
  mobile: string;
  /** "YYYY-MM-DD", or null when only the age was given. */
  dateOfBirth: string | null;
  /** Age in whole years (given, or computed from the date of birth). */
  age: number;
  address: string;
  /** Required for learners under 18. */
  guardian: GuardianDetails | null;
  preferredDays: Weekday[];
  preferredTimes: TimeRange[];
  notes: string;
  /** Every learner of the enrolment: one, or exactly two for Learn Together (learners[0] = the top-level learner). */
  learners: LearnerProfile[];
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim().slice(0, max) : "";
}

/** Whole years between a date of birth and today ("YYYY-MM-DD", IST date). */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Mobile number → E.164. India (+91) is assumed when no country code is given:
 *   "98470 00000" / "098470 00000" / "91 98470 00000" / "+91 98470-00000" → "+919847000000".
 * Other countries need "+" and their code ("+44 20 7946 0958"; 8–15 digits).
 * An Indian number must be a 10-digit mobile starting 6–9. Null when invalid.
 */
export function normalizeMobile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let compact = value.replace(/[\s\-().]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  if (!compact.startsWith("+")) {
    if (/^0[6-9]\d{9}$/.test(compact)) compact = compact.slice(1);
    if (/^91[6-9]\d{9}$/.test(compact)) compact = compact.slice(2);
    return INDIAN_MOBILE.test(compact) ? `+91${compact}` : null;
  }
  if (compact.startsWith("+91")) return INDIAN_MOBILE.test(compact.slice(3)) ? compact : null;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

const PHONE = /^\+?[0-9][0-9 -]{6,18}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "  Meera  K " → "meera k" (to tell two learners apart). */
function normalizeName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * One learner's name, age (or date of birth) and — under 18 — guardian.
 * Errors are added under `${prefix}field` (prefix "" for the single learner).
 */
function parseLearner(input: Record<string, unknown>, today: string, prefix: string, errors: Record<string, string>): LearnerProfile | null {
  const before = Object.keys(errors).length;
  const fullName = text(input.fullName, REGISTRATION_LIMITS.name);
  if (fullName.length < 2) errors[`${prefix}fullName`] = "Enter the learner's full name.";
  const dobRaw = text(input.dateOfBirth, 10);
  const ageRaw = text(typeof input.age === "number" ? String(input.age) : input.age, 10);
  let dateOfBirth: string | null = null;
  let age: number | null = null;
  if (dobRaw) {
    if (!DATE.test(dobRaw) || Number.isNaN(Date.parse(`${dobRaw}T00:00:00Z`)) || dobRaw > today) errors[`${prefix}dateOfBirth`] = "Enter a valid date of birth.";
    else {
      dateOfBirth = dobRaw;
      age = ageOn(dobRaw, today);
    }
  } else if (ageRaw) {
    if (/^\d{1,3}$/.test(ageRaw)) age = Number(ageRaw);
    else errors[`${prefix}age`] = "Enter the age in whole years.";
  } else {
    errors[`${prefix}age`] = "Enter the age or the date of birth.";
  }
  if (age !== null && (age < MIN_AGE || age > MAX_AGE)) errors[`${prefix}${dateOfBirth ? "dateOfBirth" : "age"}`] = `The learner must be between ${MIN_AGE} and ${MAX_AGE} years old.`;

  let guardian: GuardianDetails | null = null;
  const minor = age !== null && age < ADULT_AGE;
  const gName = text(input.guardianName, REGISTRATION_LIMITS.name);
  const gRel = text(input.guardianRelationship, REGISTRATION_LIMITS.relationship);
  const gPhone = text(input.guardianPhone, REGISTRATION_LIMITS.phone);
  const gEmail = text(input.guardianEmail, REGISTRATION_LIMITS.email);
  if (minor || gName || gPhone) {
    if (gName.length < 2) errors[`${prefix}guardianName`] = "Enter the parent or guardian's name.";
    if (!gRel) errors[`${prefix}guardianRelationship`] = "Enter the relationship (e.g. mother, father).";
    if (!PHONE.test(gPhone)) errors[`${prefix}guardianPhone`] = "Enter a phone number (digits, optional + country code).";
    if (gEmail && !EMAIL.test(gEmail)) errors[`${prefix}guardianEmail`] = "Enter a valid email address, or leave it empty.";
    if (!errors[`${prefix}guardianName`] && !errors[`${prefix}guardianRelationship`] && !errors[`${prefix}guardianPhone`] && !errors[`${prefix}guardianEmail`]) {
      guardian = { name: gName, relationship: gRel, phone: gPhone, email: gEmail || null };
    }
  }

  if (Object.keys(errors).length > before) return null;
  return { fullName, dateOfBirth, age: age!, guardian };
}

/**
 * Validates the student details form. `today` is the IST date (server time),
 * used for the date of birth. Returns field errors keyed by input name.
 * `shared`: Learn Together — `input.learners` must hold exactly two learners.
 */
export function parseRegistrationDetails(
  input: Record<string, unknown>,
  today: string,
  /** fixedSchedule: a Special Programme has set session dates, so no preferred days/times are asked. */
  opts: { shared?: boolean; fixedSchedule?: boolean } = {},
): { value: RegistrationDetails | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const email = text(input.email, REGISTRATION_LIMITS.email).toLowerCase();
  if (!EMAIL.test(email)) errors.email = "Enter a valid email address.";
  const mobile = normalizeMobile(input.mobile);
  if (!mobile) errors.mobile = "Enter a 10-digit Indian mobile number (e.g. 98470 00000). Outside India, start with + and the country code.";

  const address = text(input.address, REGISTRATION_LIMITS.address);
  if (address.length < 5) errors.address = "Enter the address.";

  // Learn Together: exactly two learners (each with their own name, age and, for a child, guardian).
  let learners: LearnerProfile[] = [];
  if (opts.shared) {
    const raw = Array.isArray(input.learners) ? input.learners : [];
    if (raw.length !== SHARED_LEARNER_COUNT) {
      errors.learners = `Learn Together is for exactly ${SHARED_LEARNER_COUNT} learners.`;
    } else {
      raw.forEach((r, i) => {
        const one = parseLearner((r ?? {}) as Record<string, unknown>, today, `learners.${i}.`, errors);
        if (one) learners.push(one);
      });
      if (learners.length === SHARED_LEARNER_COUNT && normalizeName(learners[0].fullName) === normalizeName(learners[1].fullName)) {
        errors["learners.1.fullName"] = "The two learners must be different people.";
      }
    }
  } else {
    const one = parseLearner(input, today, "", errors);
    learners = one ? [one] : [];
  }
  const first = learners[0];

  const d = days(input.preferredDays);
  if (!d.ok || (d.days.length === 0 && !opts.fixedSchedule)) errors.preferredDays = "Choose at least one preferred day.";

  const rawTimes = Array.isArray(input.preferredTimes) ? input.preferredTimes : [];
  const preferredTimes: TimeRange[] = [];
  for (const t of rawTimes.slice(0, REGISTRATION_LIMITS.maxTimes + 1)) {
    const r = (t ?? {}) as Record<string, unknown>;
    if (!r.start && !r.end) continue;
    if (!isTime(r.start) || !isTime(r.end) || minutesOf(r.start) >= minutesOf(r.end)) {
      errors.preferredTimes = "Each preferred time needs a start and a later end time.";
      continue;
    }
    if (!preferredTimes.some((p) => p.start === r.start && p.end === r.end)) preferredTimes.push({ start: r.start, end: r.end });
  }
  if (preferredTimes.length > REGISTRATION_LIMITS.maxTimes) errors.preferredTimes = `Give at most ${REGISTRATION_LIMITS.maxTimes} preferred times.`;
  if (!errors.preferredTimes && preferredTimes.length === 0 && !opts.fixedSchedule) errors.preferredTimes = "Add at least one preferred time.";

  const notes = text(input.notes, REGISTRATION_LIMITS.notes);

  if (Object.keys(errors).length) return { value: null, errors };
  return {
    value: {
      fullName: first.fullName,
      email,
      mobile: mobile!,
      dateOfBirth: first.dateOfBirth,
      age: first.age,
      address,
      guardian: first.guardian,
      preferredDays: d.days,
      preferredTimes: preferredTimes.sort((a, b) => a.start.localeCompare(b.start)),
      notes,
      learners,
    },
    errors,
  };
}
