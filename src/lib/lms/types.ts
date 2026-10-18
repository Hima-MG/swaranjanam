import type { CourseCategory, CourseFormat, CourseLevel, CourseTag } from "@/types/course";

// LMS data model, shared by server and client code. Contains no secrets.
//
// Firestore collections (all top-level, all written only by the server):
//   users/{uid}                          — see lib/auth/profile.ts
//   courses/{courseId}                   — migrated courses use their slug as id
//   modules/{moduleId}                   — courseId, order
//   lessons/{lessonId}                   — courseId, moduleId, order, resources[]
//   enrollments/{courseId}_{studentId}   — deterministic id: one per student+course
//   lessonProgress/{studentId}_{lessonId}
//   payments/{autoId}                    — payment records (separate from access)
//   submissions/{autoId}                 — student practice recordings + teacher feedback
//   reviews/{courseId}_{studentId}       — one course review per student, moderated
//   auditLogs/{autoId}                   — who did what, for sensitive teacher actions
//   liveClasses/{autoId}                 — Google Meet classes (lib/lms/classes.ts)
//
// Billing (lib/lms/billing.ts — rules; lib/lms/server/billing.ts — data):
//   pricePlans/{planId}                  — configurable fees (published plans use slugs as ids)
//   packages/pkg_{requestKey}            — a purchased package; idempotent id, fixed price snapshot
//   creditLedger/{packageId}_{sessionKey} — one class-credit consumption per package session
//   billingAdjustments/{autoId}          — approved refunds, fee waivers and credit changes
//   receipts/{paymentId}                 — one receipt per verified payment, fixed snapshot
//   paymentReferences/{hash}             — reservation that makes payment references unique
//   settings/billing                     — accepted payment methods
//   settings/receiptCounter              — receipt number sequence (transaction-guarded)
//
// Timestamps are Firestore Timestamps in the database and ISO strings once
// they leave the data layer, so records can be passed to Client Components.

export const LANGUAGES = ["en", "ml"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  ml: "മലയാളം",
};

export const COURSE_STATUSES = ["draft", "published", "archived"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/**
 * Statuses in which ENROLLED students may open a course. Archived courses are
 * hidden from the public catalogue and closed to new enrollments, but
 * students who already have access keep it. Drafts are never visible.
 */
export function isOpenToEnrolledStudents(status: CourseStatus): boolean {
  return status === "published" || status === "archived";
}

export const ENROLLMENT_STATUSES = ["active", "revoked"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const RESOURCE_TYPES = ["video", "audio", "pdf", "image"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** Where a resource is hosted. External resources are approved video links only. */
export type ResourceSource = "cloudinary" | "external";

export interface LessonResource {
  id: string;
  title: string;
  type: ResourceType;
  language: Language;
  source: ResourceSource;
  /** Delivery URL (Cloudinary secure URL, or the normalised embed URL for external video). */
  url: string;
  /** Cloudinary public id, for uploaded files. */
  publicId: string | null;
  /** Cloudinary resource type the asset was uploaded as ("image" | "video"). */
  cloudinaryResourceType: "image" | "video" | null;
  fileName: string | null;
  format: string | null;
  bytes: number | null;
  /** PDFs and images only: whether students may download the file. */
  downloadable: boolean;
  order: number;
  createdAt: string | null;
}

/** Public catalogue details, edited in the teacher dashboard ("Catalogue details"). */
export interface CourseCatalogFields {
  subtitle: string;
  subtitleMl: string;
  level: CourseLevel | null;
  category: CourseCategory | null;
  format: CourseFormat | null;
  duration: string;
  ageGroup: string;
  instructor: string;
  price: number | null;
  originalPrice: number | null;
  tag: CourseTag | null;
  featured: boolean;
  outcomes: string[];
  outcomesMl: string[];
}

export interface CourseRecord extends CourseCatalogFields {
  id: string;
  slug: string;
  title: string;
  titleMl: string;
  description: string;
  descriptionMl: string;
  thumbnailUrl: string | null;
  thumbnailPublicId: string | null;
  status: CourseStatus;
  teacherIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ModuleRecord {
  id: string;
  courseId: string;
  title: string;
  titleMl: string;
  description: string;
  descriptionMl: string;
  order: number;
}

export interface LessonRecord {
  id: string;
  courseId: string;
  moduleId: string;
  title: string;
  titleMl: string;
  description: string;
  descriptionMl: string;
  order: number;
  resources: LessonResource[];
}

/** Lesson without resources, for outlines and navigation. */
export type LessonSummary = Omit<LessonRecord, "resources"> & {
  resourceCounts: Record<Language, number>;
};

/** Lesson summary with the signed-in student's completion state. */
export interface StudentLessonSummary extends LessonSummary {
  completed: boolean;
}

export interface ModuleWithLessons<L = LessonSummary> extends ModuleRecord {
  lessons: L[];
}

export interface EnrollmentRecord {
  id: string;
  studentId: string;
  courseId: string;
  status: EnrollmentStatus;
  enrolledAt: string | null;
  enrolledBy: string | null;
  revokedAt: string | null;
  /**
   * Fee agreed for this enrollment, in whole currency units. Snapshot of the
   * course price at enrollment; teachers may adjust it (discounts,
   * scholarships). null = no fee agreed. Independent of access status.
   */
  agreedFee: number | null;
  currency: string;
}

export interface LessonProgressRecord {
  studentId: string;
  courseId: string;
  lessonId: string;
  completed: boolean;
  completedAt: string | null;
  lastAccessedAt: string | null;
}

export const DEFAULT_CURRENCY = "INR";

// --- Payments -------------------------------------------------------------------
//
// Payment status is independent of enrollment/access status. Only records that
// are `paid` AND `verified` count as received revenue. Manual records are
// verified by the teacher who records them (offline payments they have
// confirmed). Gateway records (e.g. Razorpay, future) must only ever be marked
// verified by server-side signature/webhook verification — never by the client.
//
// A payment belongs to EITHER a legacy enrollment fee (enrollmentId set,
// packageId null) OR a package (packageId set, enrollmentId ""). It counts
// towards that one balance only, never both.
//
// Future gateway integration (not implemented): the server creates the order,
// stores it in `gateway` ({ provider, orderId, paymentId }), verifies the
// signature/webhook on the server, processes each webhook event idempotently
// (keyed by the provider's event id) and only then moves the record to
// paid + verified through the same receipt and package-activation code used
// for manual verification. A browser redirect is never proof of payment.

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["upi", "bank_transfer", "cash", "card", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number] | "gateway";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  card: "Card (offline)",
  cheque: "Cheque",
  other: "Other",
  gateway: "Online gateway",
};

/** Allowed manual status changes. Refunds only apply to received payments. */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["paid", "failed"],
  paid: ["refunded"],
  failed: ["pending"],
  refunded: [],
};

export interface PaymentRecord {
  id: string;
  /** Legacy payments: the student. Package payments: the first learner. */
  studentId: string;
  courseId: string;
  /** Legacy enrollment-fee payments only; "" for package payments. */
  enrollmentId: string;
  /** Package payments only. */
  packageId: string | null;
  /** Everyone who may see this payment (package learners, or the student). */
  learnerIds: string[];
  /** Who paid, when not the learner (e.g. a parent). */
  payerName: string | null;
  /** Required when a payment is rejected (status "failed"). */
  rejectionReason: string | null;
  verifiedAt: string | null;
  verifiedByEmail: string | null;
  receiptId: string | null;
  /** Amount in the smallest currency unit (paise for INR). */
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  /** When the payment was made (date supplied by the teacher, or by the gateway). */
  paidAt: string | null;
  status: PaymentStatus;
  verified: boolean;
  source: "manual" | "gateway";
  notes: string | null;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedByEmail: string | null;
  updatedAt: string | null;
  history: { at: string | null; byEmail: string | null; change: string }[];
}

/** Counts towards received revenue. */
export function isReceived(payment: Pick<PaymentRecord, "status" | "verified">): boolean {
  return payment.status === "paid" && payment.verified;
}

// --- Practice submissions ------------------------------------------------------
//
// A student uploads an audio/video recording for a course (optionally a
// specific lesson). Teachers give feedback and mark it reviewed or ask for a
// revision; a resubmission adds a new attempt, keeping the full history.
// Students can only ever read their own submissions (enforced on the server).

export const SUBMISSION_STATUSES = ["pending_review", "reviewed", "needs_revision"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  pending_review: "Pending review",
  reviewed: "Reviewed",
  needs_revision: "Needs revision",
};

export interface SubmissionAttempt {
  number: number;
  kind: "audio" | "video";
  url: string;
  publicId: string;
  format: string | null;
  bytes: number | null;
  fileName: string | null;
  note: string | null;
  submittedAt: string | null;
}

export interface SubmissionFeedback {
  attempt: number;
  status: Exclude<SubmissionStatus, "pending_review">;
  text: string;
  byEmail: string | null;
  byName: string | null;
  at: string | null;
}

export interface SubmissionRecord {
  id: string;
  studentId: string;
  courseId: string;
  moduleId: string | null;
  lessonId: string | null;
  title: string;
  status: SubmissionStatus;
  attempts: SubmissionAttempt[];
  feedback: SubmissionFeedback[];
  createdAt: string | null;
  lastSubmittedAt: string | null;
  reviewedAt: string | null;
}

// --- Course reviews ---------------------------------------------------------------

export const REVIEW_STATUSES = ["pending", "approved", "hidden"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ReviewRecord {
  id: string;
  courseId: string;
  studentId: string;
  /** 1–5, as submitted by the student. */
  rating: number;
  comment: string;
  status: ReviewStatus;
  createdAt: string | null;
  updatedAt: string | null;
  moderatedByEmail: string | null;
  moderatedAt: string | null;
  moderationNote: string | null;
}

export function reviewId(courseId: string, studentId: string): string {
  return `${courseId}_${studentId}`;
}

/** One sensitive teacher action. Never contains secrets, tokens or payment card data. */
export interface AuditEntry {
  id: string;
  action: string;
  actorId: string;
  actorEmail: string | null;
  targetType:
    | "course"
    | "enrollment"
    | "student"
    | "payment"
    | "review"
    | "submission"
    | "announcement"
    | "settings"
    | "package"
    | "pricePlan"
    | "receipt";
  targetId: string;
  summary: string;
  at: string | null;
}

/** Result shape returned by every Server Action. */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function enrollmentId(courseId: string, studentId: string): string {
  return `${courseId}_${studentId}`;
}

export function progressId(studentId: string, lessonId: string): string {
  return `${studentId}_${lessonId}`;
}

/** Picks the requested language's text. Returns null instead of substituting another language. */
export function localized(en: string, ml: string, language: Language): string | null {
  const value = language === "ml" ? ml : en;
  return value.trim() ? value : null;
}
