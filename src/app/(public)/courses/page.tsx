import type { Metadata } from "next";
import { Suspense } from "react";

import { CatalogEmpty, CatalogError } from "@/components/course/catalog-states";
import { CourseCatalog } from "@/components/course/course-catalog";
import { CtaBanner } from "@/components/shared/cta-banner";
import { PageHero } from "@/components/shared/page-hero";
import { CourseGridSkeleton } from "@/components/ui/loading-state";
import { Section } from "@/components/ui/section";
import { categoriesOf, getPublishedCourses } from "@/lib/catalog/server";

export const metadata: Metadata = {
  title: "Courses",
  description:
    "Explore Carnatic vocal courses for beginners, children, intermediate and advanced students, plus devotional singing and weekend workshops.",
};

/** Published courses from Firestore (cached; refreshed when a teacher makes changes). */
async function Catalog() {
  const result = await getPublishedCourses();
  if (!result.ok) return <CatalogError />;
  if (result.data.length === 0) return <CatalogEmpty />;
  return <CourseCatalog courses={result.data} categories={categoriesOf(result.data)} />;
}

export default function CoursesPage() {
  return (
    <>
      <PageHero
        eyebrow="Our courses"
        title="Find the course that fits your voice"
        description="Structured programmes from foundational exercises to advanced manodharma — available live online, recorded or hybrid."
      />
      <Section>
        <Suspense fallback={<CourseGridSkeleton />}>
          <Catalog />
        </Suspense>
      </Section>
      <CtaBanner
        title="Not sure where to start?"
        description="Tell us about your experience and goals, and we will recommend the right course for you."
      />
    </>
  );
}
