"use client";

import { LANGUAGE_LABELS, LANGUAGES, type Language } from "@/lib/lms/types";
import { cn } from "@/lib/utils";

/** English | മലയാളം segmented switch. Each option is a toggle button (aria-pressed). */
export function LanguageToggle({
  value,
  onChange,
  label = "Content language",
  tone = "default",
  className,
}: {
  value: Language;
  onChange: (language: Language) => void;
  label?: string;
  tone?: "default" | "inverted";
  className?: string;
}) {
  const inverted = tone === "inverted";
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex rounded-full border p-1",
        inverted ? "border-cream/25 bg-cream/10" : "border-border bg-ivory shadow-soft",
        className,
      )}
    >
      {LANGUAGES.map((language) => {
        const active = language === value;
        return (
          <button
            key={language}
            type="button"
            lang={language}
            aria-pressed={active}
            onClick={() => onChange(language)}
            className={cn(
              "min-w-24 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? inverted
                  ? "bg-gold-light text-maroon-deep"
                  : "bg-maroon text-cream"
                : inverted
                  ? "text-cream/85 hover:bg-cream/10"
                  : "text-brown hover:bg-cream-deep",
            )}
          >
            {LANGUAGE_LABELS[language]}
          </button>
        );
      })}
    </div>
  );
}
