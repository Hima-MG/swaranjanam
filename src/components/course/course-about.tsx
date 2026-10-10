"use client";

import { Check } from "lucide-react";

import { LanguageToggle } from "@/components/shared/language-toggle";
import { useLanguagePreference } from "@/lib/i18n/language-preference";
import { LANGUAGE_LABELS } from "@/lib/lms/types";

/**
 * Course description and outcomes in English or Malayalam. Text missing in
 * the chosen language is reported as unavailable, never machine-translated or
 * silently replaced.
 */
export function CourseAbout({
  description,
  descriptionMl,
  outcomes,
  outcomesMl,
}: {
  description: string;
  descriptionMl: string;
  outcomes: string[];
  outcomesMl: string[];
}) {
  const [language, setLanguage] = useLanguagePreference();
  const hasMalayalam = Boolean(descriptionMl.trim()) || outcomesMl.length > 0;
  const text = language === "ml" ? descriptionMl : description;
  const items = language === "ml" ? outcomesMl : outcomes;
  const unavailable = (
    <p className="text-sm text-muted-foreground" lang="en">
      Not available in {LANGUAGE_LABELS[language]} yet.
    </p>
  );

  return (
    <>
      <section aria-labelledby="about-course" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="about-course" className="type-h2">
            About this course
          </h2>
          {hasMalayalam && (
            <LanguageToggle value={language} onChange={setLanguage} label="Course description language" />
          )}
        </div>
        {text.trim() ? (
          <p lang={language} className="type-lead whitespace-pre-line text-muted-foreground">
            {text}
          </p>
        ) : (
          unavailable
        )}
      </section>

      {(outcomes.length > 0 || outcomesMl.length > 0) && (
        <section
          aria-labelledby="outcomes"
          className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-7 shadow-soft sm:p-9"
        >
          <h2 id="outcomes" className="type-h3">
            What you will learn
          </h2>
          {items.length === 0 ? (
            unavailable
          ) : (
            <ul lang={language} className="grid gap-4 sm:grid-cols-2">
              {items.map((outcome) => (
                <li key={outcome} className="flex gap-3 text-sm leading-relaxed">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-gold-soft text-maroon">
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                  {outcome}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
