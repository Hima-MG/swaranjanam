import { Ornament } from "@/components/decor/ornament";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  /** Use "inverted" on dark (maroon) sections. */
  tone?: "default" | "inverted";
  /** Optional element (e.g. a "View all" link) shown beside a left-aligned header. */
  action?: React.ReactNode;
  as?: "h1" | "h2";
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "center",
  tone = "default",
  action,
  as: Heading = "h2",
  className,
}: SectionHeaderProps) {
  const centered = align === "center";
  const inverted = tone === "inverted";

  return (
    <div
      className={cn(
        "mb-10 flex flex-col gap-6 sm:mb-14",
        centered ? "items-center text-center" : "md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className={cn("flex max-w-2xl flex-col gap-3", centered && "items-center")}>
        {eyebrow && (
          <p className={cn("type-eyebrow", inverted ? "text-gold-light" : "text-gold")}>
            {eyebrow}
          </p>
        )}
        <Heading
          className={cn(
            Heading === "h1" ? "type-h1" : "type-h2",
            inverted ? "text-cream" : "text-foreground",
          )}
        >
          {title}
        </Heading>
        {centered && <Ornament className={inverted ? "text-gold-light" : undefined} />}
        {description && (
          <p className={cn("type-lead", inverted ? "text-cream/80" : "text-muted-foreground")}>
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
