import { Quote } from "lucide-react";

import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import { testimonials } from "@/data/content";

export function Testimonials() {
  return (
    <Section tone="muted">
      <SectionHeader
        eyebrow="Student voices"
        title="Loved by students and parents"
        description="Learners of every age share what music at Swaraanjanam means to them."
      />
      <div className="grid gap-6 md:grid-cols-3">
        {testimonials.map((t) => (
          <figure
            key={t.name}
            className="relative flex flex-col gap-6 rounded-2xl border border-border bg-card p-8 shadow-soft"
          >
            <Quote className="size-8 text-gold/60" aria-hidden="true" />
            <blockquote className="font-heading text-xl leading-relaxed text-brown italic">
              “{t.quote}”
            </blockquote>
            <figcaption className="mt-auto flex items-center gap-3 border-t border-border pt-5">
              <span
                aria-hidden="true"
                className="flex size-11 items-center justify-center rounded-full bg-maroon font-heading text-lg font-semibold text-gold-light"
              >
                {t.name.charAt(0)}
              </span>
              <span className="flex flex-col">
                <span className="font-semibold text-brown">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.role}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}
