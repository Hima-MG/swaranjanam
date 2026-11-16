import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Mandala } from "@/components/decor/mandala";
import { Ornament } from "@/components/decor/ornament";
import { SectionLink } from "@/components/shared/section-link";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

const OUTLINE_ON_MAROON = "border-cream/40 text-cream hover:border-cream hover:bg-cream/10 hover:text-cream";

interface CtaBannerProps {
  title?: string;
  description?: string;
}

export function CtaBanner({
  title = "Begin your musical journey today",
  description = "Choose an open course, add the learner's details and pay for your first class to confirm your place. That payment is deducted on your first monthly invoice.",
}: CtaBannerProps) {
  return (
    <section className="py-16 sm:py-24">
      <Container>
        <div className="relative isolate overflow-hidden rounded-3xl bg-maroon-deep pattern-kolam-light px-6 py-14 text-center shadow-lifted sm:px-12 sm:py-20">
          <Mandala className="pointer-events-none absolute -top-20 -left-20 -z-10 size-72 text-gold-light/25" />
          <Mandala className="pointer-events-none absolute -right-24 -bottom-24 -z-10 size-80 text-gold-light/20" />
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-5">
            <h2 className="type-h2 text-cream">{title}</h2>
            <Ornament className="text-gold-light" />
            <p className="type-lead text-cream/80">{description}</p>
            <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              {/* Enrol: student sign-up, then choose a course and pay for the first class. */}
              <Button asChild size="lg" variant="gold">
                <Link href="/register">
                  Enrol now <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className={OUTLINE_ON_MAROON}>
                <SectionLink href="/#courses">Courses</SectionLink>
              </Button>
              <Button asChild size="lg" variant="outline" className={OUTLINE_ON_MAROON}>
                <SectionLink href="/#fees">Fees</SectionLink>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
