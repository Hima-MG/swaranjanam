import { cn } from "@/lib/utils";

export function ProgressBar({
  percent,
  label,
  className,
}: {
  percent: number;
  /** Accessible name, e.g. "Basics for Beginners progress". */
  label: string;
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn("h-2 overflow-hidden rounded-full bg-cream-deep", className)}
    >
      <div className="h-full rounded-full bg-gold" style={{ width: `${value}%` }} />
    </div>
  );
}
