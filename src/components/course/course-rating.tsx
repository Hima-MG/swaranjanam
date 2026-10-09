import { Star } from "lucide-react";

import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CourseRatingProps {
  rating: number;
  reviewCount?: number;
  size?: "sm" | "md";
  className?: string;
}

export function CourseRating({ rating, reviewCount, size = "sm", className }: CourseRatingProps) {
  const starSize = size === "sm" ? "size-3.5" : "size-4.5";

  return (
    <div
      className={cn("flex items-center gap-1.5", size === "sm" ? "text-sm" : "text-base", className)}
    >
      <span className="font-semibold text-brown">{rating.toFixed(1)}</span>
      <span
        className="flex items-center gap-0.5"
        role="img"
        aria-label={`Rated ${rating.toFixed(1)} out of 5`}
      >
        {Array.from({ length: 5 }, (_, i) => {
          // Fraction of this star to fill, clamped to [0, 1].
          const fill = Math.min(Math.max(rating - i, 0), 1);
          return (
            <span key={i} className={cn("relative inline-block", starSize)}>
              <Star className={cn("absolute inset-0 text-gold/35", starSize)} strokeWidth={1.5} />
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={cn("fill-gold text-gold", starSize)} strokeWidth={1.5} />
              </span>
            </span>
          );
        })}
      </span>
      {reviewCount !== undefined && (
        <span className="text-muted-foreground">({formatCount(reviewCount)})</span>
      )}
    </div>
  );
}
