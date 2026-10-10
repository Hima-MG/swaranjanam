import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { CourseGrid } from "@/components/course/course-grid";
import { AboutFounder } from "@/components/home/about-founder";
import { Hero } from "@/components/home/hero";
import { LearningPath } from "@/components/home/learning-path";
import { Testimonials } from "@/components/home/testimonials";
import { CtaBanner } from "@/components/shared/cta-banner";
import { FeatureCard } from "@/components/shared/feature-card";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { features } from "@/data/content";
import { featuredCourses, getPublishedCourses } from "@/lib/catalog/server";
import { CatalogEmpty, CatalogError } from "@/components/course/catalog-states";
import { CourseGridSkeleton } from "@/components/ui/loading-state";

/** Featured published courses from Firestore (falls back to the first published courses). */
async function FeaturedCourses() {
  const result = await getPublishedCourses();
  if (!result.ok) return <CatalogError />;
  if (result.data.length === 0) return <CatalogEmpty />;
  return <CourseGrid courses={featuredCourses(result.data, 4)} columns={4} />;
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <AboutFounder />

      <Section spacing="lg">
        <SectionHeader
          align="left"
          eyebrow="Featured courses"
          title="Courses crafted for every stage"
          description="Whether you are taking your first steps or preparing for the stage, find a programme that fits your voice and schedule."
          action={
            <Button asChild variant="outline">
              <Link href="/courses">
                View all courses <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          }
        />
        <Suspense fallback={<CourseGridSkeleton count={4} />}>
          <FeaturedCourses />
        </Suspense>
      </Section>

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
      <Testimonials />
      <CtaBanner />
    </>
  );
}
