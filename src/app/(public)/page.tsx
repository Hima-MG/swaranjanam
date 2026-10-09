import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { CourseGrid } from "@/components/course/course-grid";
import { Hero } from "@/components/home/hero";
import { LearningPath } from "@/components/home/learning-path";
import { Testimonials } from "@/components/home/testimonials";
import { CtaBanner } from "@/components/shared/cta-banner";
import { FeatureCard } from "@/components/shared/feature-card";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { features } from "@/data/content";
import { getFeaturedCourses } from "@/lib/courses";

export default function HomePage() {
  const featured = getFeaturedCourses(4);

  return (
    <>
      <Hero />

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
        <CourseGrid courses={featured} columns={4} />
      </Section>

      <Section tone="muted" pattern="kolam" spacing="lg">
        <SectionHeader
          eyebrow="Why Swaranjanam"
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
