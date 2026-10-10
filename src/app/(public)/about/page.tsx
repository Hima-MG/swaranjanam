import type { Metadata } from "next";

import { AboutFounder } from "@/components/home/about-founder";
import { CtaBanner } from "@/components/shared/cta-banner";
import { FeatureCard } from "@/components/shared/feature-card";
import { PageHero } from "@/components/shared/page-hero";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { learningModes, values } from "@/data/content";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "About",
  description: `Learn about ${siteConfig.fullName}, our teaching philosophy and how we bring the Carnatic tradition to students worldwide.`,
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About the academy"
        title="Preserving a living tradition"
        description={`${siteConfig.fullName} is dedicated to teaching Carnatic vocal music with authenticity, patience and care.`}
      />

      {/* Supplied About + Founder Notes text, with one English / Malayalam switch. */}
      <AboutFounder />

      <Section pattern="kolam">
        <SectionHeader
          eyebrow="Our values"
          title="What guides our teaching"
        />
        <div className="grid gap-6 md:grid-cols-3">
          {values.map((value) => (
            <FeatureCard key={value.title} feature={value} />
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeader
          eyebrow="Ways to learn"
          title="Learn the way that suits you"
          description="Choose the format that fits your schedule — every format follows the same structured syllabus."
        />
        <div className="grid gap-6 md:grid-cols-3">
          {learningModes.map((mode) => (
            <FeatureCard key={mode.title} feature={mode} />
          ))}
        </div>
      </Section>

      <CtaBanner />
    </>
  );
}
