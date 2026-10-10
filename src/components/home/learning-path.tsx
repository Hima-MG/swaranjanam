import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { journey } from "@/data/content";

export function LearningPath() {
  return (
    <Section tone="maroon" pattern="kolam" spacing="lg">
      <SectionHeader
        tone="inverted"
        eyebrow="Your learning path"
        title="From first swara to the concert stage"
        description="A time-tested progression, adapted for modern learners. Start where you are — we will guide you from there."
      />
      <ol className="relative grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Connecting line on large screens */}
        <span
          aria-hidden="true"
          className="absolute top-9 right-[12%] left-[12%] hidden h-px bg-gradient-to-r from-gold-light/0 via-gold-light/50 to-gold-light/0 lg:block"
        />
        {journey.map((step) => (
          <li
            key={step.step}
            className="group relative flex flex-col items-center gap-4 rounded-2xl border border-cream/10 bg-cream/5 p-7 text-center backdrop-blur-sm transition-colors hover:border-gold-light/40 hover:bg-cream/10"
          >
            <span className="relative flex size-12 items-center justify-center rounded-full border border-gold-light/50 bg-maroon-deep font-heading text-xl font-semibold text-gold-light">
              {step.step}
            </span>
            <h3 className="type-h3 text-cream">{step.title}</h3>
            <p className="text-sm leading-relaxed text-cream/75">{step.description}</p>
            <Link
              href="/courses"
              className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-gold-light transition-colors hover:text-cream"
            >
              Explore courses
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}
