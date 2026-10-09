import type { Metadata } from "next";

import { Mandala } from "@/components/decor/mandala";
import { Ornament } from "@/components/decor/ornament";
import { CtaBanner } from "@/components/shared/cta-banner";
import { FeatureCard } from "@/components/shared/feature-card";
import { PageHero } from "@/components/shared/page-hero";
import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { learningModes, stats, values } from "@/data/content";
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

      <Section spacing="lg">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="relative mx-auto aspect-square w-full max-w-md">
            <div className="absolute inset-0 rounded-full bg-maroon-deep pattern-kolam-light shadow-lifted" />
            <Mandala className="absolute inset-6 text-gold-light/50" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <span className="font-heading text-6xl font-semibold text-gold-light italic">Nada</span>
              <span className="type-eyebrow text-cream/80">The essence of sound</span>
            </div>
          </div>
          <div className="flex flex-col gap-5">
            <p className="type-eyebrow text-gold">Our story</p>
            <h2 className="type-h2">Music as sadhana, taught with heart</h2>
            <Ornament className="-ml-1" />
            <p className="type-lead text-muted-foreground">
              Swaranjanam — “the colour of swara” — was founded to share the beauty of
              Carnatic music with learners of every age. Our teaching follows the
              guru–shishya parampara: careful listening, steady practice and personal
              correction.
            </p>
            <p className="leading-relaxed text-muted-foreground">
              Today we teach students across India and abroad through live online classes,
              recorded lessons and in-person sessions — each built on a clear syllabus that
              takes students from Sarali Varisai to kritis and manodharma.
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {stats.map((stat) => (
                <li
                  key={stat.label}
                  className="rounded-2xl border border-border bg-card p-4 text-center shadow-soft"
                >
                  <span className="block font-heading text-3xl font-semibold text-maroon">
                    {stat.value}
                  </span>
                  <span className="text-xs text-muted-foreground">{stat.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section tone="muted" pattern="kolam">
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
