import { ChevronRight } from "lucide-react";

import { Section } from "@/components/ui/section";
import { SectionHeader } from "@/components/ui/section-header";
import type { FaqItem } from "@/data/faq";

export const FAQ_SECTION_ID = "faq";

/** Homepage FAQ. Native <details>, so it works without JavaScript and with the keyboard. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <Section id={FAQ_SECTION_ID} tone="muted" spacing="lg" className="scroll-mt-24">
      <SectionHeader eyebrow="Questions" title="Frequently asked questions" />
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {items.map((item) => (
          <details key={item.question} className="group rounded-2xl border border-border bg-card shadow-soft open:border-gold/40">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-heading text-lg font-semibold text-brown [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronRight className="size-4 shrink-0 text-gold transition-transform group-open:rotate-90" aria-hidden="true" />
            </summary>
            <p className="border-t border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
