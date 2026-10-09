import Link from "next/link";

import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("size-10", className)}>
      <circle cx="20" cy="20" r="19" className="fill-maroon" />
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        className="stroke-gold-light"
        strokeWidth="0.75"
        strokeDasharray="1.5 2"
      />
      <g className="fill-gold-light">
        <path d="M20 9c2.6 3.2 2.6 8 0 11.5-2.6-3.5-2.6-8.3 0-11.5Z" />
        <path d="M20 21c-3.2-.6-6.8-3.2-8-6.8 3.7.1 6.6 2.7 8 6.8Z" fillOpacity="0.85" />
        <path d="M20 21c3.2-.6 6.8-3.2 8-6.8-3.7.1-6.6 2.7-8 6.8Z" fillOpacity="0.85" />
      </g>
      <path
        d="M11 25.5c2.7 2.2 5.7 3.3 9 3.3s6.3-1.1 9-3.3"
        fill="none"
        className="stroke-gold-light"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M14 29.5c1.8 1.1 3.8 1.7 6 1.7s4.2-.6 6-1.7"
        fill="none"
        className="stroke-gold-light"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeOpacity="0.7"
      />
    </svg>
  );
}

export function Logo({
  inverted = false,
  className,
}: {
  inverted?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/"
      aria-label={`${siteConfig.fullName} — home`}
      className={cn("group inline-flex items-center gap-3", className)}
    >
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-heading text-2xl font-semibold tracking-wide",
            inverted ? "text-cream" : "text-maroon",
          )}
        >
          {siteConfig.name}
        </span>
        <span
          className={cn(
            "mt-1 text-[0.625rem] font-semibold tracking-[0.22em] uppercase",
            inverted ? "text-gold-light" : "text-gold",
          )}
        >
          {siteConfig.tagline}
        </span>
      </span>
    </Link>
  );
}
