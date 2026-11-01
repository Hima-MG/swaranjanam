import { Suspense } from "react";

import { AboutFounder } from "@/components/home/about-founder";
import { CoursesAndFees } from "@/components/home/courses-and-fees";
import { Faq } from "@/components/home/faq";
import { Hero } from "@/components/home/hero";
import { LearningPath } from "@/components/home/learning-path";
import { Testimonials } from "@/components/home/testimonials";
import { CtaBanner } from "@/components/shared/cta-banner";
import { FeatureCard } from "@/components/shared/feature-card";
import { CourseGridSkeleton } from "@/components/ui/loading-state";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { features } from "@/data/content";
import { faqItems } from "@/data/faq";
import { getPublicFees, getPublishedCourses } from "@/lib/catalog/server";
import { getPublicTestimonials } from "@/lib/lms/server/testimonials";

/** The one public courses + fees section (cached; refreshed when a teacher changes courses or rates). */
async function CoursesSection() {
  const [catalog, fee] = await Promise.all([getPublishedCourses(), getPublicFees()]);
  return <CoursesAndFees catalog={catalog} fee={fee} />;
}

async function FaqSection() {
  return <Faq items={faqItems(await getPublicFees())} />;
}

/** Approved, consented student testimonials only (cached; refreshed on moderation). */
async function StudentStories() {
  return <Testimonials testimonials={await getPublicTestimonials()} />;
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <AboutFounder />

      <Suspense fallback={<CourseGridSkeleton count={3} />}>
        <CoursesSection />
      </Suspense>

      <Section tone="muted" pattern="kolam" spacing="lg">
        <SectionHeader
          eyebrow="Why Swaraanjanam"
          title="Tradition, taught with care"
          description="We combine the depth of the classical tradition with the structure and flexibility that modern students need."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </div>
      </Section>

      <LearningPath />
      <Suspense fallback={null}>
        <StudentStories />
      </Suspense>
      <Suspense fallback={null}>
        <FaqSection />
      </Suspense>
      <CtaBanner />
    </>
  );
}
