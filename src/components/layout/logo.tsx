import Image from "next/image";
import Link from "next/link";

import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/** The academy's emblem (square JPEG, 1254 × 1254). */
export const LOGO_SRC = "/images/swaraanjanam-logo.jpeg";
const LOGO_ALT = "Swaraanjanam Carnatic Music Academy";

const emblemSizes = {
  // 44px on phones, 48px from sm up: fits the 72px navbar without dominating it.
  sm: { className: "size-11 sm:size-12", sizes: "48px" },
  lg: { className: "size-20 sm:size-24", sizes: "96px" },
} as const;

/**
 * The circular emblem on a round ivory badge. The source image is a square
 * with white corners; the badge absorbs them on light and dark backgrounds.
 */
export function LogoEmblem({
  size = "sm",
  eager = false,
  className,
}: {
  size?: keyof typeof emblemSizes;
  /** Load immediately (small, above-the-fold placements). Not a preload. */
  eager?: boolean;
  className?: string;
}) {
  const { className: sizeClass, sizes } = emblemSizes[size];
  return (
    <Image
      src={LOGO_SRC}
      alt={LOGO_ALT}
      width={1254}
      height={1254}
      sizes={sizes}
      loading={eager ? "eager" : undefined}
      className={cn("shrink-0 rounded-full bg-ivory object-contain shadow-soft ring-1 ring-gold/30", sizeClass, className)}
    />
  );
}

/**
 * Site logo: emblem + wordmark, linking home. The single shared logo for the
 * navbar, mobile menu and footer. `variant="emblem"` shows only the larger
 * emblem (sign-in and registration cards).
 */
export function Logo({
  inverted = false,
  variant = "full",
  eager = false,
  className,
}: {
  inverted?: boolean;
  variant?: "full" | "emblem";
  eager?: boolean;
  className?: string;
}) {
  if (variant === "emblem") {
    return (
      <Link
        href="/"
        aria-label={`${siteConfig.fullName} — home`}
        className={cn("inline-flex rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
      >
        <LogoEmblem size="lg" eager={eager} />
      </Link>
    );
  }

  return (
    <Link
      href="/"
      aria-label={`${siteConfig.fullName} — home`}
      className={cn(
        "group inline-flex items-center gap-3 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <LogoEmblem eager={eager} className={inverted ? "ring-gold-light/40" : undefined} />
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
