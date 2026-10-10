import {
  COURSE_CATEGORIES,
  COURSE_FORMATS,
  COURSE_LEVELS,
  COURSE_TAGS,
  type CourseCategory,
  type CourseFormat,
  type CourseLevel,
  type CourseTag,
} from "@/types/course";

// Input validation shared by teacher forms (early feedback) and Server Actions
// (authoritative). Everything from the client is treated as untrusted.

export const LIMITS = {
  title: 150,
  description: 5000,
  resourceTitle: 150,
  slug: 80,
  url: 500,
} as const;

export type FieldErrors = Record<string, string>;

export function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  // Normalise line endings and strip control characters other than newline/tab.
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

export interface BilingualTextInput {
  title: string;
  titleMl: string;
  description: string;
  descriptionMl: string;
}

/** English title is required; Malayalam fields and descriptions are optional. */
export function parseBilingualText(input: Record<string, unknown>): {
  value: BilingualTextInput;
  errors: FieldErrors;
} {
  const value = {
    title: cleanText(input.title, LIMITS.title),
    titleMl: cleanText(input.titleMl, LIMITS.title),
    description: cleanText(input.description, LIMITS.description),
    descriptionMl: cleanText(input.descriptionMl, LIMITS.description),
  };
  const errors: FieldErrors = {};
  if (!value.title) errors.title = "Please enter an English title.";
  return { value, errors };
}

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, "");
}

/** Firestore document ids we generate or accept: letters, digits, `_` and `-` only. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

// --- Public catalogue details ----------------------------------------------------

export const CATALOG_LIMITS = {
  subtitle: 200,
  shortText: 60,
  instructor: 100,
  outcome: 200,
  outcomes: 12,
  maxPrice: 10_000_000,
} as const;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CatalogInput {
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
  /** Requested slug; empty means "keep the current one". */
  slug: string;
}

function choice<T extends string>(values: readonly T[], value: unknown): T | null | undefined {
  if (value === "" || value === null || value === undefined) return null;
  return values.includes(value as T) ? (value as T) : undefined;
}

function rupees(value: unknown): number | null | undefined {
  if (value === "" || value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s₹]/g, ""));
  return Number.isInteger(n) && n >= 0 && n <= CATALOG_LIMITS.maxPrice ? n : undefined;
}

/** One outcome per line (or an array). Blank lines are dropped. */
function lines(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [];
  return raw
    .map((line) => cleanText(line, CATALOG_LIMITS.outcome).replace(/^[-•*]\s*/, ""))
    .filter(Boolean);
}

export function parseCatalogInput(input: Record<string, unknown>): { value: CatalogInput; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const level = choice(COURSE_LEVELS, input.level);
  const category = choice(COURSE_CATEGORIES, input.category);
  const format = choice(COURSE_FORMATS, input.format);
  const tag = choice(COURSE_TAGS, input.tag);
  const price = rupees(input.price);
  const originalPrice = rupees(input.originalPrice);
  const outcomes = lines(input.outcomes);
  const outcomesMl = lines(input.outcomesMl);
  const slug = cleanText(input.slug, LIMITS.slug).toLowerCase();

  if (level === undefined) errors.level = "Choose a level from the list.";
  if (category === undefined) errors.category = "Choose a category from the list.";
  if (format === undefined) errors.format = "Choose a format from the list.";
  if (tag === undefined) errors.tag = "Choose a label from the list.";
  if (price === undefined) errors.price = "Enter the fee in whole rupees, or leave it empty.";
  if (originalPrice === undefined) errors.originalPrice = "Enter the original fee in whole rupees, or leave it empty.";
  if (price != null && originalPrice != null && originalPrice <= price) {
    errors.originalPrice = "The original fee must be higher than the current fee.";
  }
  if (originalPrice != null && price == null) errors.originalPrice = "Set the current fee first.";
  if (outcomes.length > CATALOG_LIMITS.outcomes) errors.outcomes = `Use at most ${CATALOG_LIMITS.outcomes} outcomes.`;
  if (outcomesMl.length > CATALOG_LIMITS.outcomes) errors.outcomesMl = `Use at most ${CATALOG_LIMITS.outcomes} outcomes.`;
  if (slug && !SLUG_PATTERN.test(slug)) {
    errors.slug = "Use lowercase letters, numbers and single hyphens only (e.g. sarali-varisai).";
  }

  return {
    value: {
      subtitle: cleanText(input.subtitle, CATALOG_LIMITS.subtitle),
      subtitleMl: cleanText(input.subtitleMl, CATALOG_LIMITS.subtitle),
      level: level ?? null,
      category: category ?? null,
      format: format ?? null,
      duration: cleanText(input.duration, CATALOG_LIMITS.shortText),
      ageGroup: cleanText(input.ageGroup, CATALOG_LIMITS.shortText),
      instructor: cleanText(input.instructor, CATALOG_LIMITS.instructor),
      price: price ?? null,
      originalPrice: originalPrice ?? null,
      tag: tag ?? null,
      featured: input.featured === true || input.featured === "on",
      outcomes: outcomes.slice(0, CATALOG_LIMITS.outcomes),
      outcomesMl: outcomesMl.slice(0, CATALOG_LIMITS.outcomes),
      slug,
    },
    errors,
  };
}
