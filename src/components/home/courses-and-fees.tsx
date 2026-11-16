import { CatalogEmpty, CatalogError } from "@/components/course/catalog-states";
import { CourseGrid } from "@/components/course/course-grid";
import { FeeSummary } from "@/components/course/course-fees";
import { FEE_TERMS } from "@/lib/catalog/public-pricing";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { CLASS_DETAILS } from "@/data/content";
import type { PublicCourseFees } from "@/lib/catalog/public-pricing";
import type { CatalogResult } from "@/lib/catalog/server";
import type { Course } from "@/types/course";

export const COURSES_SECTION_ID = "courses";
export const FEES_SECTION_ID = "fees";

/**
 * The single public "Courses & fees" section (homepage, /#courses): every
 * listed course with its availability and fee, and one fee summary. There is
 * no separate public pricing page.
 */
export function CoursesAndFees({ catalog, fee }: { catalog: CatalogResult<Course[]>; fee: PublicCourseFees | null }) {
  return (
    <Section id={COURSES_SECTION_ID} spacing="lg" className="scroll-mt-24">
      <SectionHeader
        align="left"
        eyebrow="Courses & fees"
        title="Learn at your own pace, pay per class"
        description="One-hour live classes on Google Meet, once a week, in small batches. Fees are per session: your first class is paid when you enrol (and deducted on your first invoice), then you are invoiced at the end of each calendar month for the classes held — never a course fee upfront. Open a course to see what it covers and select “Enrol Now”."
      />

      {/* "/#fees" target: always present, so the Fees buttons work even before courses are listed. */}
      <div id={FEES_SECTION_ID} className="mb-12 scroll-mt-24">
        {fee ? (
          <FeeSummary fee={fee} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="How fees work">
            {FEE_TERMS.map((term) => (
              <li key={term} className="text-sm text-brown before:mr-2 before:text-gold before:content-['•']">
                {term}
              </li>
            ))}
          </ul>
        )}
      </div>

      <h3 className="sr-only">Courses</h3>
      {!catalog.ok ? (
        <CatalogError />
      ) : catalog.data.length === 0 ? (
        <CatalogEmpty />
      ) : (
        <CourseGrid courses={catalog.data} />
      )}

      <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground" aria-label="Class details">
        {CLASS_DETAILS.map((detail) => (
          <li key={detail} className="before:mr-2 before:text-gold before:content-['•']">
            {detail}
          </li>
        ))}
      </ul>
    </Section>
  );
}
