import { ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";

import { Mandala } from "@/components/decor/mandala";
import { Ornament } from "@/components/decor/ornament";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/config/site";

const swaras = ["Sa", "Ri", "Ga", "Ma", "Pa", "Da", "Ni"];

function HeroArt() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      {/* Temple-arch frame */}
      <div className="relative isolate aspect-[4/5] overflow-hidden rounded-t-[999px] rounded-b-[2rem] border-[6px] border-ivory bg-gradient-to-b from-maroon to-maroon-deep shadow-lifted ring-1 ring-gold/40">
        <div className="absolute inset-0 -z-10 pattern-kolam-light" />
        <Mandala className="absolute top-[38%] left-1/2 size-[115%] -translate-x-1/2 -translate-y-1/2 text-gold-light/45 motion-safe:animate-[spin_120s_linear_infinite]" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-maroon-deep via-maroon-deep/90 to-transparent px-6 pt-20 pb-10 text-center">
          <Ornament className="text-gold-light" />
          <p className="font-heading text-2xl text-cream italic sm:text-3xl">
            Nada is the soul of music
          </p>
          <p className="flex flex-wrap justify-center gap-x-3 text-xs font-semibold tracking-[0.3em] text-gold-light/90 uppercase">
            {swaras.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </p>
        </div>
      </div>

      {/* Floating info cards */}
      <div className="absolute top-12 -left-3 flex items-center gap-3 rounded-2xl border border-border bg-ivory/95 p-3 pr-5 shadow-card backdrop-blur sm:-left-6">
        <span className="flex size-10 items-center justify-center rounded-xl bg-gold-soft text-maroon">
          <CalendarDays className="size-5" aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <p className="text-xs text-muted-foreground">New batches</p>
          <p className="text-sm font-semibold text-brown">Every month</p>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pattern-kolam-gold">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-cream/40 via-cream/80 to-cream"
      />
      <Container className="grid items-center gap-14 py-14 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-20 lg:py-24">
        <div className="flex flex-col items-start gap-7">
          <Badge variant="gold" className="h-7 px-3.5">
            Admissions open · New batches every month
          </Badge>
          <p className="font-heading text-xl text-maroon italic sm:text-2xl">{siteConfig.motto}</p>
          <h1 className="type-display text-brown">
            Where every <span className="text-maroon italic">swara</span> finds its voice
          </h1>
          <p className="type-lead max-w-xl text-muted-foreground">
            Learn Carnatic vocal music the traditional way — rooted in the guru–shishya
            parampara, thoughtfully structured for today&apos;s learners, from first
            Sarali Varisai to the concert stage.
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg">
              <Link href="/courses">
                Explore Courses <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/contact">Book a Free Trial</Link>
            </Button>
          </div>
        </div>
        <HeroArt />
      </Container>
    </section>
  );
}
