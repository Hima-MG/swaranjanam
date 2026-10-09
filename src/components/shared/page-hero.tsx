import { Mandala } from "@/components/decor/mandala";
import { Container } from "@/components/ui/container";
import { SectionHeader } from "@/components/ui/section-header";

interface PageHeroProps {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}

/** Compact banner used at the top of inner pages. */
export function PageHero({ eyebrow, title, description, children }: PageHeroProps) {
  return (
    <section className="relative isolate overflow-hidden border-b border-border bg-cream-deep/70 pattern-kolam-gold">
      <Mandala className="pointer-events-none absolute -top-24 -right-24 -z-10 size-80 text-gold/40 sm:size-96" />
      <Mandala className="pointer-events-none absolute -bottom-32 -left-32 -z-10 size-72 text-gold/25" />
      <Container className="py-16 sm:py-20">
        <SectionHeader
          as="h1"
          eyebrow={eyebrow}
          title={title}
          description={description}
          className="mb-0 sm:mb-0"
        />
        {children}
      </Container>
    </section>
  );
}
