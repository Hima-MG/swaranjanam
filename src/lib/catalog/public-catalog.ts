// Builds the public course catalogue. PURE: unit-tested, no I/O.
//
// Sources, in order of authority:
//  1. Published Firestore courses whose availability a teacher has set
//     ("Open for enrolment" / "Coming soon").
//  2. The academy's approved catalogue (data/approved-courses.ts), but ONLY
//     for a slug that does not exist in Firestore at all. Once a teacher
//     creates that course, Firestore decides (draft = not shown).
// A published course without an availability setting (e.g. migrated template
// content that nobody has reviewed) is not listed publicly.
//
// Fees: "open" courses get their OWN rates (course pricing, only the class
// types the course offers); a course saved before course pricing existed, and
// an approved-catalogue course, uses the academy's confirmed rates in force.
// "coming_soon" and "closed" courses get null. Nothing student-specific
// (agreed rates, enrolments, payments) is ever included.

import { toPublicProgramme } from "@/lib/lms/programme";
import type { ApprovedCourse } from "@/data/approved-courses";
import { publicFeesFromPricing, type PublicCourseFees } from "@/lib/catalog/public-pricing";
import { effectiveCoursePricing } from "@/lib/lms/course-pricing";
import type { CourseRecord } from "@/lib/lms/types";
import type { Course, CourseTone } from "@/types/course";

const TONES: CourseTone[] = ["maroon", "gold", "brown", "rose"];

/** Stable placeholder colour per course (no stored styling needed). */
export function toneFor(id: string): CourseTone {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

export interface FirestoreCatalogEntry {
  record: CourseRecord;
  moduleCount: number;
  lessonCount: number;
}

/** The confirmed rates in force, for courses without their own saved pricing. */
function confirmedRates(fees: PublicCourseFees) {
  return { batchMinor: fees.batchMinor ?? 0, individualMinor: fees.individualMinor ?? 0 };
}

export function fromFirestore(entry: FirestoreCatalogEntry, fees: PublicCourseFees): Course | null {
  const { record: c } = entry;
  if (c.status !== "published" || !c.availability) return null;
  const pricing = effectiveCoursePricing(c.storedPricing, confirmedRates(fees));
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    titleMl: c.titleMl,
    subtitle: c.subtitle,
    subtitleMl: c.subtitleMl,
    description: c.description,
    descriptionMl: c.descriptionMl,
    thumbnailUrl: c.thumbnailUrl,
    level: c.level,
    category: c.category,
    format: c.format,
    duration: c.duration,
    ageGroup: c.ageGroup,
    instructor: c.instructor,
    availability: c.availability,
    fee: c.availability === "open" && !c.programme ? publicFeesFromPricing(pricing) : null,
    programme: c.programme ? toPublicProgramme(c.programme) : null,
    prerequisites: c.prerequisites,
    source: "firestore",
    tag: c.tag,
    featured: c.featured,
    outcomes: c.outcomes,
    outcomesMl: c.outcomesMl,
    moduleCount: entry.moduleCount,
    lessonCount: entry.lessonCount,
    tone: toneFor(c.id),
  };
}

export function fromApproved(a: ApprovedCourse, fees: PublicCourseFees): Course {
  return {
    id: a.slug,
    slug: a.slug,
    title: a.title,
    titleMl: "",
    subtitle: a.subtitle,
    subtitleMl: "",
    description: a.description,
    descriptionMl: "",
    thumbnailUrl: null,
    level: a.level,
    category: a.category,
    format: "Live Online",
    duration: "",
    ageGroup: a.audience,
    instructor: "",
    availability: a.availability,
    fee: a.availability === "open" ? publicFeesFromPricing(effectiveCoursePricing(null, confirmedRates(fees))) : null,
    programme: null,
    prerequisites: [],
    source: "approved",
    tag: null,
    featured: a.featured,
    outcomes: a.content,
    outcomesMl: [],
    moduleCount: 0,
    lessonCount: 0,
    tone: toneFor(a.slug),
  };
}

/**
 * The public catalogue. `knownSlugs` is every course slug in Firestore,
 * whatever its status, so a draft or unpublished course is never replaced by
 * its approved fallback.
 */
export function buildPublicCatalog(input: {
  firestore: readonly FirestoreCatalogEntry[];
  knownSlugs: ReadonlySet<string>;
  approved: readonly ApprovedCourse[];
  fees: PublicCourseFees;
}): Course[] {
  const fromDb = input.firestore.map((e) => fromFirestore(e, input.fees)).filter((c): c is Course => c !== null);
  const fallback = input.approved.filter((a) => !input.knownSlugs.has(a.slug)).map((a) => fromApproved(a, input.fees));
  return sortCatalog([...fromDb, ...fallback], input.approved.map((a) => a.slug));
}

/** Open courses first, then featured, then the approved catalogue order, then title. */
export function sortCatalog(courses: Course[], approvedOrder: readonly string[] = []): Course[] {
  const rank = (slug: string) => {
    const i = approvedOrder.indexOf(slug);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...courses].sort(
    (a, b) =>
      Number(b.availability === "open") - Number(a.availability === "open") ||
      Number(b.featured) - Number(a.featured) ||
      rank(a.slug) - rank(b.slug) ||
      a.title.localeCompare(b.title),
  );
}
