"use client";

import { Check } from "lucide-react";
import Image from "next/image";

import { Mandala } from "@/components/decor/mandala";
import { Ornament } from "@/components/decor/ornament";
import { LanguageToggle } from "@/components/shared/language-toggle";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/config/site";
import { aboutFounderContent } from "@/data/about-founder";
import { useLanguagePreference } from "@/lib/i18n/language-preference";

/** Renders the paragraph with the founder's name in bold, as in the source document. */
function WithFounderName({ text, name }: { text: string; name: string }) {
  const index = text.indexOf(name);
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <strong className="font-semibold text-brown">{name}</strong>
      {text.slice(index + name.length)}
    </>
  );
}

function FounderPortrait() {
  const { photo, name } = siteConfig.founder;
  if (photo) {
    // Frame matches the photo's 3:4 ratio, so object-cover never crops it; the
    // arched top only trims the background corners. Below the fold: lazy-loaded.
    return (
      <div className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-t-[999px] rounded-b-[2rem] border-[6px] border-ivory bg-cream-deep shadow-lifted ring-1 ring-gold/40 lg:max-w-none">
        <Image
          src={photo.src}
          alt={`${name}, founder of Swaraanjanam`}
          fill
          sizes="(min-width: 1024px) 380px, (min-width: 640px) 384px, 90vw"
          className="object-cover object-[50%_30%]"
        />
      </div>
    );
  }
  return (
    <div className="relative mx-auto aspect-[4/5] w-full max-w-sm overflow-hidden rounded-t-[999px] rounded-b-[2rem] border-[6px] border-ivory bg-gradient-to-b from-maroon to-maroon-deep shadow-lifted ring-1 ring-gold/40">
      {/* Placeholder shown only when siteConfig.founder.photo is null. */}
      <div role="img" aria-label={`${name} — photograph coming soon`} className="absolute inset-0">
        <div className="absolute inset-0 pattern-kolam-light" />
        <Mandala className="absolute top-[42%] left-1/2 size-[110%] -translate-x-1/2 -translate-y-1/2 text-gold-light/35" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pt-10">
          <span className="flex size-24 items-center justify-center rounded-full bg-cream/10 font-heading text-4xl font-semibold text-gold-light ring-1 ring-gold-light/40">
            AM
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * "About Swaraanjanam" followed by "Notes from the Founder". One language
 * switch controls both sections; the choice is remembered in this browser.
 */
export function AboutFounder() {
  const [language, setLanguage] = useLanguagePreference();
  const { about, founder, founderName } = aboutFounderContent[language];

  return (
    <div lang={language}>
      <section id="about-swaraanjanam" aria-labelledby="about-heading" className="relative isolate py-16 sm:py-24">
        <Container>
          <div className="mb-10 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-3">
              <h2 id="about-heading" className="type-h2">
                {about.heading}
              </h2>
              <Ornament className="-ml-1" />
            </div>
            <LanguageToggle
              value={language}
              onChange={setLanguage}
              label="Language for About and Founder sections"
            />
          </div>

          <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
            <div className="flex flex-col gap-5">
              {about.paragraphs.map((paragraph, index) => (
                <p key={index} className={index === 0 ? "type-lead text-brown" : "leading-relaxed text-muted-foreground"}>
                  {index === 0 ? <WithFounderName text={paragraph} name={founderName} /> : paragraph}
                </p>
              ))}

              <div className="mt-2 flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-soft">
                <h3 className="type-h3">{about.differentHeading}</h3>
                <p className="leading-relaxed text-muted-foreground">{about.differentText}</p>
                <p className="font-heading text-xl text-maroon italic">{about.tagline}</p>
              </div>
            </div>

            <div className="flex flex-col gap-5 self-start rounded-2xl border border-gold/30 bg-cream-deep/60 p-6 pattern-kolam-gold sm:p-8">
              <h3 className="type-h3">{about.learnHeading}</h3>
              <ul className="flex flex-col gap-3">
                {about.learnItems.map((item) => (
                  <li key={item} className="flex gap-3 text-brown">
                    <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-gold-soft text-maroon">
                      <Check className="size-3.5" aria-hidden="true" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      <section
        id="founder"
        aria-labelledby="founder-heading"
        className="relative isolate bg-cream-deep/60 py-16 pattern-kolam-gold sm:py-24"
      >
        <Container className="grid items-start gap-12 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-16">
          <FounderPortrait />
          <div className="flex flex-col gap-5">
            <h2 id="founder-heading" className="type-h2">
              {founder.heading}
            </h2>
            <Ornament className="-ml-1" />
            <p className="font-heading text-2xl text-maroon">{founder.greeting}</p>
            {founder.paragraphs.map((paragraph, index) => (
              <p key={index} className="leading-relaxed text-brown/90">
                {paragraph}
              </p>
            ))}
            <div className="mt-2 flex flex-col gap-1">
              <p className="text-brown-muted italic">{founder.signOff}</p>
              <p className="font-semibold text-brown">{founder.name}</p>
              <p className="text-sm text-muted-foreground">{founder.title}</p>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
