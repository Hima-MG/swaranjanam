import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CoursePriceProps {
  price: number;
  originalPrice?: number;
  size?: "sm" | "lg";
  showDiscount?: boolean;
  className?: string;
}

export function CoursePrice({
  price,
  originalPrice,
  size = "sm",
  showDiscount = false,
  className,
}: CoursePriceProps) {
  const hasDiscount = originalPrice !== undefined && originalPrice > price;
  const discount = hasDiscount ? Math.round((1 - price / originalPrice) * 100) : 0;

  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1", className)}>
      <span
        className={cn(
          "font-heading font-bold text-maroon",
          size === "sm" ? "text-2xl" : "text-4xl",
        )}
      >
        {formatINR(price)}
      </span>
      {hasDiscount && (
        <>
          <span className="text-sm text-muted-foreground line-through">
            <span className="sr-only">Original price </span>
            {formatINR(originalPrice)}
          </span>
          {showDiscount && (
            <span className="text-sm font-semibold text-gold">{discount}% off</span>
          )}
        </>
      )}
    </div>
  );
}
