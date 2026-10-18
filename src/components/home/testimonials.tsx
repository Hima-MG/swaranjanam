import { Quote } from "lucide-react";

import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import type { PublicTestimonial } from "@/lib/lms/testimonials";

export const EMPTY_TESTIMONIALS_MESSAGE = "Student stories will appear here as our learning community grows.";

/**
 * Student stories. Shows only the testimonials passed in, which must come from
 * getPublicTestimonials() (approved by a teacher AND consented to by the
 * student). No placeholder quotes, names or ratings.
 */
export function Testimonials({ testimonials }: { testimonials: PublicTestimonial[] }) {
  return (
    <Section tone="muted">
      <SectionHeader eyebrow="Student voices" title="In our students' words" />
      {testimonials.length === 0 ? (
        <p className="mx-auto max-w-xl rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center text-muted-foreground">
          {EMPTY_TESTIMONIALS_MESSAGE}
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((t) => (
            <figure key={t.id} className="relative flex flex-col gap-6 rounded-2xl border border-border bg-card p-8 shadow-soft">
              <Quote className="size-8 text-gold/60" aria-hidden="true" />
              <blockquote className="font-heading text-xl leading-relaxed whitespace-pre-line text-brown italic">“{t.quote}”</blockquote>
              <figcaption className="mt-auto flex items-center gap-3 border-t border-border pt-5">
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-maroon font-heading text-lg font-semibold text-gold-light"
                >
                  {t.name.charAt(0)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold break-words text-brown">{t.name}</span>
                  {t.courseTitle && <span className="text-xs text-muted-foreground">{t.courseTitle}</span>}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </Section>
  );
}
