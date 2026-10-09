import type { Feature } from "@/data/content";
import { cn } from "@/lib/utils";

export function FeatureCard({
  feature,
  className,
}: {
  feature: Feature;
  className?: string;
}) {
  const Icon = feature.icon;
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-border bg-card p-7 shadow-soft transition-colors hover:border-gold/50",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-maroon-soft text-maroon ring-1 ring-maroon/10">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <h3 className="type-h3">{feature.title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
    </div>
  );
}
