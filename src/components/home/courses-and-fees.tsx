import { MessageCircle } from "lucide-react";

import { CatalogEmpty, CatalogError } from "@/components/course/catalog-states";
import { CourseGrid } from "@/components/course/course-grid";
import { FeeSummary } from "@/components/course/course-fees";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { CLASS_DETAILS } from "@/data/approved-courses";
import { siteConfig } from "@/config/site";
import type { PublicCourseFees } from "@/lib/catalog/public-pricing";
import type { CatalogResult } from "@/lib/catalog/server";
import type { Course } from "@/types/course";

export const COURSES_SECTION_ID = "courses";

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
        description="One-hour live classes on Google Meet, once a week, in small batches. Fees are per session and paid at the end of each month — never a course fee upfront."
        action={
          <Button asChild>
            <a href={siteConfig.contact.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle data-icon="inline-start" />
              Enrol on WhatsApp
            </a>
          </Button>
        }
      />

      {fee && <FeeSummary fee={fee} className="mb-12" />}

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
