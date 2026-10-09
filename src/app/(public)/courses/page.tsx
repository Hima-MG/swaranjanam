import type { Metadata } from "next";

import { CourseCatalog } from "@/components/course/course-catalog";
import { CtaBanner } from "@/components/shared/cta-banner";
import { PageHero } from "@/components/shared/page-hero";
import { Section } from "@/components/ui/section";
import { getAllCourses, getCourseCategories } from "@/lib/courses";

export const metadata: Metadata = {
  title: "Courses",
  description:
    "Explore Carnatic vocal courses for beginners, children, intermediate and advanced students, plus devotional singing and weekend workshops.",
};

export default function CoursesPage() {
  return (
    <>
      <PageHero
        eyebrow="Our courses"
        title="Find the course that fits your voice"
        description="Structured programmes from foundational exercises to advanced manodharma — available live online, recorded or hybrid."
      />
      <Section>
        <CourseCatalog courses={getAllCourses()} categories={getCourseCategories()} />
      </Section>
      <CtaBanner
        title="Not sure where to start?"
        description="Tell us about your experience and goals, and we will recommend the right course for you."
      />
    </>
  );
}
