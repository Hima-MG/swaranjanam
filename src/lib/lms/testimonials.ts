// Student testimonials — shared types and PURE rules (no runtime imports, so
// they are unit-testable and safe in Client Components).
//
// Collection: testimonials/{autoId}, written only by the server.
//  * A student submits their own words, chooses how their name is shown and
//    must explicitly consent to public publication.
//  * Only a teacher can approve, reject or unpublish (server-side).
//  * The public site shows a testimonial only when it is approved AND the
//    consent is still in place. Nothing else about the student is published.

export const TESTIMONIAL_STATUSES = ["pending", "approved", "rejected", "unpublished", "withdrawn"] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

export const TESTIMONIAL_STATUS_LABELS: Record<TestimonialStatus, string> = {
  pending: "Awaiting review",
  approved: "Published",
  rejected: "Not published",
  unpublished: "Unpublished",
  withdrawn: "Withdrawn by you",
};

/** How the student's name appears publicly. Chosen by the student. */
export const NAME_DISPLAYS = ["full", "short", "anonymous"] as const;
export type NameDisplay = (typeof NAME_DISPLAYS)[number];

export const NAME_DISPLAY_LABELS: Record<NameDisplay, string> = {
  full: "My full name",
  short: "First name and initial",
  anonymous: "Don't show my name",
};

export const TESTIMONIAL_LIMITS = { minLength: 20, maxLength: 1000, maxOpen: 3 } as const;

export const ANONYMOUS_NAME = "A Swaraanjanam student";

export interface TestimonialRecord {
  id: string;
  studentId: string;
  /** null = about the academy in general. */
  courseId: string | null;
  /** Course title when submitted (display only). */
  courseTitle: string | null;
  text: string;
  nameDisplay: NameDisplay;
  /** Name as it will be published, derived on the server from the student's account. */
  publicName: string;
  consent: boolean;
  status: TestimonialStatus;
  /** Teacher's reason when rejecting/unpublishing; shown to the student who wrote it. */
  moderationNote: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  moderatedAt: string | null;
  publishedAt: string | null;
}

/** The ONLY fields that ever reach the public site. */
export interface PublicTestimonial {
  id: string;
  quote: string;
  name: string;
  courseTitle: string | null;
}

/** Normalises line endings and strips control characters; trims and limits length. */
export function cleanTestimonialText(value: unknown, maxLength: number = TESTIMONIAL_LIMITS.maxLength): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

/** Public form of the student's own account name. Never an email address. */
export function publicNameFor(displayName: string | null | undefined, mode: NameDisplay): string {
  const name = (displayName ?? "").replace(/\s+/g, " ").trim();
  if (mode === "anonymous" || !name || name.includes("@")) return ANONYMOUS_NAME;
  if (mode === "full") return name.slice(0, 80);
  const [first, ...rest] = name.split(" ");
  const initial = rest.length ? ` ${rest[rest.length - 1].charAt(0).toUpperCase()}.` : "";
  return `${first.slice(0, 40)}${initial}`;
}

export function parseTestimonialInput(input: Record<string, unknown> | null | undefined): {
  value: { text: string; courseId: string | null; nameDisplay: NameDisplay } | null;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const raw = typeof input?.text === "string" ? input.text : "";
  const text = cleanTestimonialText(raw);
  if (text.length < TESTIMONIAL_LIMITS.minLength) errors.text = `Please write at least ${TESTIMONIAL_LIMITS.minLength} characters.`;
  else if (cleanTestimonialText(raw, Infinity).length > TESTIMONIAL_LIMITS.maxLength) errors.text = `Please keep it under ${TESTIMONIAL_LIMITS.maxLength} characters.`;
  const courseRaw = input?.courseId;
  const courseId = courseRaw === "" || courseRaw === null || courseRaw === undefined ? null : courseRaw;
  if (courseId !== null && (typeof courseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(courseId))) errors.courseId = "Choose one of your courses.";
  const nameDisplay = (NAME_DISPLAYS as readonly unknown[]).includes(input?.nameDisplay) ? (input!.nameDisplay as NameDisplay) : null;
  if (!nameDisplay) errors.nameDisplay = "Choose how your name is shown.";
  // Consent must be an explicit "yes" from the form, never assumed.
  if (input?.consent !== true) errors.consent = "Please confirm that the academy may publish your testimonial.";
  if (Object.keys(errors).length) return { value: null, errors };
  return { value: { text, courseId: courseId as string | null, nameDisplay: nameDisplay! }, errors };
}

/** Published only when approved AND the student's consent is still in place. */
export function isPublishable(t: Pick<TestimonialRecord, "status" | "consent">): boolean {
  return t.status === "approved" && t.consent === true;
}

export function toPublicTestimonial(t: TestimonialRecord): PublicTestimonial {
  return { id: t.id, quote: t.text, name: t.publicName, courseTitle: t.courseTitle };
}

export const MODERATION_ACTIONS = ["approve", "reject", "unpublish"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** Allowed teacher moderation steps. Withdrawn testimonials can never be republished by a teacher. */
export function moderationTarget(current: TestimonialStatus, action: ModerationAction, consent: boolean): TestimonialStatus | string {
  if (current === "withdrawn") return "The student withdrew this testimonial; it cannot be published.";
  if (action === "approve") {
    if (!consent) return "This testimonial has no publication consent, so it cannot be published.";
    return current === "pending" || current === "rejected" || current === "unpublished" ? "approved" : "It is already published.";
  }
  if (action === "reject") return current === "pending" ? "rejected" : "Only a testimonial awaiting review can be rejected.";
  return current === "approved" ? "unpublished" : "Only a published testimonial can be unpublished.";
}

export function isStatus(value: string): value is TestimonialStatus {
  return (TESTIMONIAL_STATUSES as readonly string[]).includes(value);
}
