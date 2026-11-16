// Builds the public course catalogue. PURE: unit-tested, no I/O.
//
// Source: published Firestore courses whose availability a teacher has set
// ("Open for enrolment" / "Coming soon" / "Closed"). There is no hardcoded
// fallback catalogue: with no published courses the public list is empty.
// A published course without an availability setting (e.g. migrated template
// content that nobody has reviewed) is not listed publicly.
//
// Fees: "open" courses get their OWN rates (course pricing, only the class
// types the course offers); a course saved before course pricing existed uses
// the academy's confirmed rates in force.
// "coming_soon" and "closed" courses get null. Nothing student-specific
// (agreed rates, enrolments, payments) is ever included.

import { toPublicProgramme } from "@/lib/lms/programme";
import { publicFeesFromPricing, type PublicCourseFees } from "@/lib/catalog/public-pricing";
import { effectiveCoursePricing } from "@/lib/lms/course-pricing";
import type { CourseRecord } from "@/lib/lms/types";
import type { Course, CourseAvailability, CourseTone } from "@/types/course";

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

/**
 * The enrolment status a course is listed with publicly, or null = not listed.
 * Only published courses are listed. A course whose status was never set is
 * treated as "Open for enrolment" (courses created in the dashboard before the
 * status had a default were otherwise invisible after publishing), except
 * when the teacher chose "Not listed publicly" or the course is an unreviewed
 * import of the old static catalogue.
 */
export function publicAvailability(
  c: Pick<CourseRecord, "status" | "availability" | "hiddenFromPublic" | "importedTemplate">,
): CourseAvailability | null {
  if (c.status !== "published") return null;
  if (c.availability) return c.availability;
  return c.hiddenFromPublic || c.importedTemplate ? null : "open";
}

/** The confirmed rates in force, for courses without their own saved pricing. */
function confirmedRates(fees: PublicCourseFees) {
  return { batchMinor: fees.batchMinor ?? 0, individualMinor: fees.individualMinor ?? 0 };
}

export function fromFirestore(entry: FirestoreCatalogEntry, fees: PublicCourseFees): Course | null {
  const { record: c } = entry;
  const availability = publicAvailability(c);
  if (!availability) return null;
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
    coverUrl: c.coverUrl,
    level: c.level,
    category: c.category,
    format: c.format,
    duration: c.duration,
    ageGroup: c.ageGroup,
    instructor: c.instructor,
    availability,
    fee: availability === "open" && !c.programme ? publicFeesFromPricing(pricing) : null,
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

/** The public catalogue: every listed Firestore course, in display order. */
export function buildPublicCatalog(input: { firestore: readonly FirestoreCatalogEntry[]; fees: PublicCourseFees }): Course[] {
  return sortCatalog(input.firestore.map((e) => fromFirestore(e, input.fees)).filter((c): c is Course => c !== null));
}

/** Open courses first, then featured, then title. */
export function sortCatalog(courses: Course[]): Course[] {
  return [...courses].sort(
    (a, b) =>
      Number(b.availability === "open") - Number(a.availability === "open") ||
      Number(b.featured) - Number(a.featured) ||
      a.title.localeCompare(b.title),
  );
}
